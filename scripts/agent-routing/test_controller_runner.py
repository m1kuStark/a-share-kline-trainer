"""Contract tests for the pinned run_glm adapter. No model is invoked."""
import hashlib
import json
import pathlib
import re
import sys
import tempfile
import unittest

from controller_runner import (RunnerError, SUPPORTED_RUNNER_CONFIG_SCHEMAS,
                               build_argv, build_gpt_argv,
                               build_prompt, contract_anchor,
                               load_runner_config, new_job_id,
                               read_worker_report, run_gpt_job, run_job,
                               validate_runner_config, GPT_SANDBOX)
from test_routing import contract as make_contract
from routing import validate_report

REAL_RUNNER = pathlib.Path(__file__).resolve().parents[1] / "agent-monitor" / "run_glm.py"
REAL_CODEX = pathlib.Path(__file__).resolve().parents[1] / "agent-monitor" / "run_codex.py"

FAKE_RUNNER = """\
import hashlib, json, os, pathlib, subprocess, sys, time
argv = sys.argv[1:]
flags = {}
index = 0
while index < len(argv):
    token = argv[index]
    if token.startswith("--"):
        flags[token[2:]] = argv[index + 1]
        index += 2
    else:
        index += 1
job_dir = pathlib.Path(os.environ["ORCH_JOB_DIR"])
(job_dir / "runner_argv.json").write_text(json.dumps(flags), encoding="utf-8")
(job_dir / "env_seen.json").write_text(json.dumps(
    {k: os.environ.get(k) for k in
     ("ORCH_TASK_ID", "ORCH_JOB_ID", "ORCH_ATTEMPT_NO")}), encoding="utf-8")
directives = json.loads((job_dir / "directives.json").read_text(encoding="utf-8"))
log = pathlib.Path(flags["log"])
log.parent.mkdir(parents=True, exist_ok=True)
log.write_text("fake runner log\\n", encoding="utf-8")
cwd = pathlib.Path(flags["cwd"])
commit = directives.get("commit_file")
observed = subprocess.check_output(
    ["git", "rev-parse", "HEAD"], cwd=cwd).decode().strip()
if commit:
    target = cwd / commit["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(commit["content"], encoding="utf-8")
    subprocess.check_call(["git", "add", commit["path"]], cwd=cwd)
    subprocess.check_call(["git", "commit", "-qm", "fake worker commit"], cwd=cwd)
    observed = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=cwd).decode().strip()
if directives.get("dirty"):
    (cwd / "stray.txt").write_text("untracked\\n", encoding="utf-8")
if directives.get("report", True):
    raw = (cwd / directives["fact_path"]).read_bytes()
    report = {
        "schema_version": 1, "task_id": directives["task_id"],
        "contract_revision": directives["contract_revision"],
        "base_commit": directives["base_commit"], "observed_commit": observed,
        "status": directives.get("report_status", "completed"),
        "assessment": directives.get("assessment", "local_execution"),
        "facts": [{"statement": "fake fact", "path": directives["fact_path"],
                   "line": 1, "sha256": hashlib.sha256(raw).hexdigest()}],
        "tests": directives.get("tests") or [
            {"command": "fake check", "exit_code": 0, "artifact": "fake"}],
        "assumptions": [], "uninspected_areas": [],
        "unexpected_findings": directives.get("unexpected_findings", []),
        "requested_scope": directives.get("requested_scope", []),
        "reported_changes": [], "needs_replan": directives.get("needs_replan", False),
        "artifacts": [],
    }
    report.update(directives.get("report_overrides", {}))
    (job_dir / "worker_report.json").write_text(
        json.dumps(report, ensure_ascii=False), encoding="utf-8")
home = pathlib.Path(flags["home"])
jobs = home / "jobs"
jobs.mkdir(parents=True, exist_ok=True)
record = {
    "id": directives.get("jobs_id", flags["batch"]),
    "state": directives.get("jobs_state", "completed"),
    "exitCode": directives.get("jobs_exit", 0), "sessionId": "sess_fake",
    "response": "fake response", "logPath": directives.get("jobs_log", str(log)),
    "worktree": directives.get("jobs_worktree", flags["cwd"]),
}
if directives.get("jobs_raw") is not None:
    (jobs / (flags["batch"] + ".json")).write_text(
        directives["jobs_raw"], encoding="utf-8")
else:
    (jobs / (flags["batch"] + ".json")).write_text(
        json.dumps(record), encoding="utf-8")
if directives.get("orphan_child"):
    subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if directives.get("hang_seconds"):
    time.sleep(directives["hang_seconds"])
sys.exit(directives.get("exit_code", 0))
"""


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def base_config(root, entry):
    return {
        "schema_version": 1, "python_executable": sys.executable,
        "runner_entry": str(entry), "cli": str(root / "fake-cli"),
        "provider": str(root / "provider.json"), "home": str(root / "glm-home"),
        "db": str(root / "board.sqlite"), "permission_mode": "yolo",
        "timeout_minutes": 5, "idle_minutes": 1, "max_output_tokens": 4096,
    }


REPORT_KEYS = {"schema_version", "task_id", "contract_revision", "base_commit",
               "observed_commit", "status", "assessment", "facts", "tests",
               "assumptions", "uninspected_areas", "unexpected_findings",
               "requested_scope", "reported_changes", "needs_replan", "artifacts"}


def parse_argv_flags(argv):
    """Parse the dispatch array after interpreter+entry as strict flag/value pairs."""
    flags = {}
    index = 2
    while index < len(argv):
        token = argv[index]
        if not token.startswith("--") or index + 1 >= len(argv):
            raise AssertionError("malformed dispatch argv at %d: %r" % (index, token))
        flags[token[2:]] = argv[index + 1]
        index += 2
    return flags


class RunnerConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="runner-cfg-")
        self.root = pathlib.Path(self.temp.name)
        self.entry = self.root / "fake_runner.py"
        self.entry.write_text(FAKE_RUNNER, encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_config_round_trips_with_pin(self):
        config = base_config(self.root, self.entry)
        validate_runner_config(config)
        sha = write_json(self.root / "runner.json", config)
        loaded = load_runner_config(self.root / "runner.json", sha)
        self.assertEqual(config["runner_entry"], loaded["runner_entry"])

    def test_pin_mismatch_and_bad_fields_are_rejected(self):
        config = base_config(self.root, self.entry)
        sha = write_json(self.root / "runner.json", config)
        with self.assertRaises(RunnerError):
            load_runner_config(self.root / "runner.json", "0" * 64)
        for mutate in ({"runner_entry": "relative.py"},
                       {"permission_mode": "sudo"},
                       {"timeout_minutes": -1},
                       {"max_output_tokens": 0},
                       {"schema_version": 3},
                       {"cli": None}):
            with self.subTest(mutate=mutate), self.assertRaises(RunnerError):
                validate_runner_config({**base_config(self.root, self.entry), **mutate})

    def test_bool_schema_version_and_bad_timeouts_are_rejected(self):
        base = base_config(self.root, self.entry)
        for mutate in ({"schema_version": True},
                       {"timeout_minutes": 0},
                       {"timeout_minutes": float("inf")},
                       {"timeout_minutes": float("nan")},
                       {"timeout_minutes": True},
                       {"idle_minutes": float("inf")},
                       {"idle_minutes": float("nan")}):
            with self.subTest(mutate=mutate), self.assertRaises(RunnerError):
                validate_runner_config({**base, **mutate})

    def test_argv_is_array_with_required_flags_and_safe_batch(self):
        config = validate_runner_config(base_config(self.root, self.entry))
        argv = build_argv(config, "job-abc", "title", self.root, "p.md", "l.log")
        self.assertTrue(all(isinstance(item, str) for item in argv))
        for flag in ("--batch", "--title", "--cwd", "--prompt", "--log",
                     "--provider", "--cli", "--home", "--permission-mode",
                     "--timeout-minutes", "--idle-minutes", "--max-output-tokens"):
            self.assertIn(flag, argv)
        self.assertEqual("job-abc", argv[argv.index("--batch") + 1])
        with self.assertRaises(RunnerError):
            build_argv(config, "bad batch", "t", self.root, "p", "l")

    def test_argv_pairs_match_real_run_glm_parser_contract(self):
        if not REAL_RUNNER.is_file():
            self.skipTest("repository run_glm.py not present")
        source = REAL_RUNNER.read_text(encoding="utf-8")
        known = set(re.findall(r"add_argument\('(--[a-z-]+)'", source))
        required = {"--batch", "--title", "--cwd", "--prompt", "--log",
                    "--provider", "--cli"}
        config = validate_runner_config(base_config(self.root, self.entry))
        argv = build_argv(config, "job-abc", "title", self.root, "p.md", "l.log")
        used = {item for item in argv if item.startswith("--")}
        self.assertFalse(used - known)
        self.assertTrue(required <= used)
        self.assertFalse(used & {"--wake-state", "--resume", "--attach",
                                 "--parallelism"})
        flags = parse_argv_flags(argv)
        self.assertEqual("job-abc", flags["batch"])
        self.assertEqual(config["provider"], flags["provider"])
        self.assertEqual(config["cli"], flags["cli"])
        self.assertEqual(config["home"], flags["home"])
        self.assertEqual("yolo", flags["permission-mode"])
        self.assertEqual(repr(float(config["timeout_minutes"])),
                         flags["timeout-minutes"])
        self.assertEqual(repr(float(config["idle_minutes"])), flags["idle-minutes"])
        self.assertEqual(str(config["max_output_tokens"]), flags["max-output-tokens"])

    def test_default_node_omitted_and_explicit_node_passed(self):
        config = validate_runner_config(base_config(self.root, self.entry))
        self.assertNotIn("--node", build_argv(config, "job-abc", "t", self.root,
                                              "p", "l"))
        config["node"] = str(self.root / "node.exe")
        argv = build_argv(config, "job-abc", "t", self.root, "p", "l")
        self.assertEqual(config["node"], argv[argv.index("--node") + 1])

    def test_new_job_id_is_batch_safe_and_unique(self):
        ids = {new_job_id() for _ in range(20)}
        self.assertEqual(20, len(ids))
        for value in ids:
            self.assertTrue(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,100}", value))


class FakeJobTests(unittest.TestCase):
    def test_registry_cannot_omit_path_identity(self):
        from controller_runner import _attributed_record
        result = self.dispatch({})
        record = result["record"]
        for field in ("worktree", "logPath"):
            with self.subTest(field=field):
                incomplete = dict(record)
                incomplete.pop(field)
                self.assertIsNone(_attributed_record(incomplete, result["job_id"],
                                                      self.repo.resolve(), result["log_path"]))
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="runner-job-")
        self.root = pathlib.Path(self.temp.name)
        self.entry = self.root / "fake_runner.py"
        self.entry.write_text(FAKE_RUNNER, encoding="utf-8")
        self.config = validate_runner_config(base_config(self.root, self.entry))
        write_json(self.root / "provider.json", {"fake": True})
        self.repo = self.root / "repo"
        self.repo.mkdir()
        for args in (("init", "-q"), ("config", "user.name", "t"),
                     ("config", "user.email", "t@example.invalid"),
                     ("config", "core.autocrlf", "false")):
            self.run_git(*args)
        (self.repo / "app.py").write_text("value = 1\n", encoding="utf-8")
        self.run_git("add", ".")
        self.run_git("commit", "-qm", "base")
        self.contract = make_contract(task_id="RUN-01", base_commit=self.head(),
                                      task_shape="mechanical", oracle="reliable",
                                      verification_profile="fixture",
                                      allowed_paths=["**"])
        self._job_counter = 0

    def tearDown(self):
        self.temp.cleanup()

    def run_git(self, *args):
        import subprocess
        result = subprocess.run(["git", *args], cwd=self.repo,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(0, result.returncode, result.stderr)
        return result.stdout.decode().strip()

    def head(self):
        return self.run_git("rev-parse", "HEAD")

    def dispatch(self, directives, **kwargs):
        self._job_counter += 1
        job_dir = self.root / ("job-%d" % self._job_counter)
        job_dir.mkdir(parents=True, exist_ok=True)
        write_json(job_dir / "directives.json", {
            "task_id": self.contract["task_id"],
            "contract_revision": self.contract["contract_revision"],
            "base_commit": self.contract["base_commit"],
            "fact_path": "app.py", **directives})
        prompt = build_prompt(self.contract, job_dir=job_dir,
                              report_path=job_dir / "worker_report.json",
                              attempt_no=1)
        return run_job(self.config, task_id="RUN-01", job_id="job-x", attempt_no=1,
                       title="fake", repo=self.repo, job_dir=job_dir, prompt_text=prompt,
                       **kwargs)

    def test_run_job_dispatches_array_and_parses_jobs_registry(self):
        result = self.dispatch({"commit_file": {"path": "app.py",
                                                "content": "value = 2\n"}})
        self.assertEqual(0, result["exit_code"])
        self.assertEqual("passed", result["status"])
        self.assertIsNone(result["failure_kind"])
        self.assertTrue(result["cleanup_confirmed"])
        self.assertEqual("completed", result["record"]["state"])
        self.assertEqual(0, result["record"]["exitCode"])
        self.assertEqual("sess_fake", result["record"]["sessionId"])
        self.assertEqual("job-x", result["record"]["id"])
        flags = json.loads((result["job_dir"] / "runner_argv.json").read_text())
        self.assertEqual(str(pathlib.Path(self.repo).resolve()), flags["cwd"])
        env_seen = json.loads((result["job_dir"] / "env_seen.json").read_text())
        self.assertEqual("RUN-01", env_seen["ORCH_TASK_ID"])
        self.assertEqual("job-x", env_seen["ORCH_JOB_ID"])
        self.assertEqual("1", env_seen["ORCH_ATTEMPT_NO"])
        self.assertTrue(result["report_path"].is_file())
        self.assertFalse(result["jobs_path"].exists() is False)

    def test_registry_record_must_belong_to_this_job(self):
        for directives in ({"jobs_id": "other-batch"},
                           {"jobs_worktree": "D:/elsewhere/worktree"},
                           {"jobs_log": "D:/elsewhere/runner.log"},
                           {"jobs_raw": "{not json"},
                           {"jobs_raw": '{"id": "job-x", "id": "job-x", '
                                        '"state": "completed", "exitCode": 0}'}):
            with self.subTest(**directives):
                result = self.dispatch(directives)
                self.assertIsNone(result["record"])
                self.assertEqual("registry_mismatch", result["failure_kind"])
                self.assertEqual("failed", result["status"])
                self.assertTrue(result["cleanup_confirmed"])
                self.assertEqual(0, result["exit_code"])

    def test_clean_dispatch_with_contradictory_record_is_not_success(self):
        for directives in ({"jobs_state": "failed", "jobs_exit": 0},
                           {"jobs_exit": 1}):
            with self.subTest(**directives):
                result = self.dispatch(directives)
                self.assertIsNotNone(result["record"])
                self.assertEqual(0, result["exit_code"])
                self.assertTrue(result["cleanup_confirmed"])
                self.assertEqual("registry_mismatch", result["failure_kind"])
                self.assertEqual("failed", result["status"])

    def test_worker_report_binding_is_enforced(self):
        result = self.dispatch({"commit_file": {"path": "app.py",
                                                "content": "value = 2\n"}})
        report = read_worker_report(result["report_path"], self.contract)
        self.assertEqual("RUN-01", report["task_id"])
        validate_report(report)
        self.assertEqual(self.head(), report["observed_commit"])
        mutated = json.loads(result["report_path"].read_text(encoding="utf-8"))
        mutated["task_id"] = "OTHER-01"
        result["report_path"].write_text(json.dumps(mutated), encoding="utf-8")
        with self.assertRaises(RunnerError):
            read_worker_report(result["report_path"], self.contract)

    def test_report_read_is_bounded_strict_json(self):
        result = self.dispatch({})
        path = result["report_path"]
        self.assertTrue(read_worker_report(path, self.contract))
        good = json.loads(path.read_text(encoding="utf-8"))
        good["assumptions"] = ["x" * (1024 * 1024)]
        path.write_text(json.dumps(good), encoding="utf-8")
        with self.assertRaises(RunnerError):
            read_worker_report(path, self.contract)
        text = path.read_text(encoding="utf-8")
        text = text.replace('"schema_version": 1',
                            '"schema_version": 1, "schema_version": 1', 1)
        path.write_text(text, encoding="utf-8")
        with self.assertRaises(RunnerError):
            read_worker_report(path, self.contract)
        text = text.replace('"needs_replan": false', '"needs_replan": NaN', 1)
        path.write_text(text, encoding="utf-8")
        with self.assertRaises(RunnerError):
            read_worker_report(path, self.contract)
        path.write_text("{not json", encoding="utf-8")
        with self.assertRaises(RunnerError):
            read_worker_report(path, self.contract)
        with self.assertRaises(RunnerError):
            read_worker_report(path.with_name("missing.json"), self.contract)

    def test_nonzero_runner_exit_is_reported(self):
        result = self.dispatch({"exit_code": 3, "jobs_state": "failed",
                                "jobs_exit": 1})
        self.assertEqual(3, result["exit_code"])
        self.assertEqual("failed", result["record"]["state"])
        self.assertEqual("check_failure", result["failure_kind"])
        self.assertEqual("failed", result["status"])
        self.assertTrue(result["cleanup_confirmed"])

    def test_timeout_terminates_owned_group_and_is_not_success(self):
        result = self.dispatch({"hang_seconds": 30}, timeout_seconds=2)
        self.assertIsNone(result["exit_code"])
        self.assertEqual("timeout", result["failure_kind"])
        self.assertEqual("failed", result["status"])
        self.assertTrue(result["cleanup_confirmed"])

    def test_leftover_child_is_never_success(self):
        result = self.dispatch({"orphan_child": True})
        self.assertEqual(0, result["exit_code"])
        self.assertEqual("orphaned_process", result["failure_kind"])
        self.assertEqual("failed", result["status"])
        self.assertTrue(result["cleanup_confirmed"])

    def test_run_job_rejects_invalid_wait_bounds_before_touching_disk(self):
        for bad in (0, -1, True, float("inf"), float("nan"), "5"):
            with self.subTest(bad=bad):
                job_dir = self.root / ("bad-wait-%r" % (bad,))
                with self.assertRaises(RunnerError):
                    run_job(self.config, task_id="RUN-01", job_id="job-bad",
                            attempt_no=1, title="t", repo=self.repo,
                            job_dir=job_dir, prompt_text="x",
                            timeout_seconds=bad)
                self.assertFalse(job_dir.exists())

    def test_prompt_carries_contract_and_no_policy(self):
        job_dir = self.root / "job2"
        job_dir.mkdir(parents=True)
        text = build_prompt(self.contract, job_dir=job_dir,
                            report_path=job_dir / "worker_report.json",
                            attempt_no=1,
                            failure={"fingerprint": "f" * 64, "check_id": "behavior",
                                     "log_refs": ["runs/x/behavior.log"]})
        for marker in (self.contract["goal"], "Acceptance", "Invariant",
                       "Forbidden", "worker_report.json", "git commit"):
            self.assertIn(marker, text)
        self.assertIn("f" * 64, text)
        self.assertNotIn("policy_secret_marker", text)

    def test_prompt_pins_report_schema_contract_and_legal_values(self):
        job_dir = self.root / "job3"
        job_dir.mkdir(parents=True)
        text = build_prompt(self.contract, job_dir=job_dir,
                            report_path=job_dir / "worker_report.json",
                            attempt_no=1)
        self.assertIn('"schema_version": 1', text)
        self.assertIn(self.contract["task_id"], text)
        self.assertIn(self.contract["base_commit"], text)
        self.assertIn("completed | partial | failed | needs_replan", text)
        self.assertIn("local_execution | needs_design | continuous_judgment "
                      "| unknown", text)
        self.assertIn("public_api | database_schema | concurrency | security "
                      "| core_abstraction | verification_policy", text)

    def test_prompt_contains_complete_json_example_with_real_pins(self):
        job_dir = self.root / "job4"
        job_dir.mkdir(parents=True)
        text = build_prompt(self.contract, job_dir=job_dir,
                            report_path=job_dir / "worker_report.json",
                            attempt_no=1)
        begin = text.index("REPORT EXAMPLE BEGIN") + len("REPORT EXAMPLE BEGIN")
        end = text.index("REPORT EXAMPLE END")
        example = json.loads(text[begin:end].strip())
        self.assertEqual(REPORT_KEYS, set(example))
        self.assertIs(1, example["schema_version"])
        self.assertEqual(self.contract["task_id"], example["task_id"])
        self.assertEqual(self.contract["contract_revision"],
                         example["contract_revision"])
        self.assertEqual(self.contract["base_commit"], example["base_commit"])
        self.assertEqual(contract_anchor(self.contract),
                         example["facts"][0]["sha256"])
        self.assertIn("not a work claim", example["facts"][0]["statement"])
        self.assertTrue(example["observed_commit"].startswith("<"))

    def test_prompt_states_blocked_actions_and_denial_stop_rule(self):
        job_dir = self.root / "job5"
        job_dir.mkdir(parents=True)
        text = build_prompt(self.contract, job_dir=job_dir,
                            report_path=job_dir / "worker_report.json",
                            attempt_no=1)
        for marker in ("Do not push, do not merge, do not rebase",
                       "--no-verify", "Mimosa", "stop all writes immediately",
                       "do not switch tools or retry the denied action",
                       "independent verifier"):
            self.assertIn(marker, text)

    def test_prompt_carries_no_config_paths_or_credentials(self):
        job_dir = self.root / "job6"
        job_dir.mkdir(parents=True)
        text = build_prompt(self.contract, job_dir=job_dir,
                            report_path=job_dir / "worker_report.json",
                            attempt_no=1)
        self.assertNotIn("fake-cli", text)
        self.assertNotIn("provider.json", text)
        self.assertNotIn(str(self.config["home"]), text)


FAKE_CODEX_RUNNER = """\
import hashlib, json, os, pathlib, subprocess, sys
argv = sys.argv[1:]
assert "wake" in argv, "expected wake subcommand in %r"
flags = {}
index = 0
while index < len(argv):
    token = argv[index]
    if token.startswith("--"):
        flags.setdefault(token[2:], []).append(argv[index + 1])
        index += 2
    else:
        index += 1
add_dirs = flags.get("add-dir", [])
job_dir = pathlib.Path(os.environ["ORCH_JOB_DIR"])
(job_dir / "runner_argv.json").write_text(json.dumps(flags), encoding="utf-8")
(job_dir / "env_seen.json").write_text(json.dumps(
    {k: os.environ.get(k) for k in
     ("ORCH_TASK_ID", "ORCH_JOB_ID", "ORCH_ATTEMPT_NO")}), encoding="utf-8")
directives = json.loads((job_dir / "directives.json").read_text(encoding="utf-8"))
log = pathlib.Path(flags["log"][0])
log.parent.mkdir(parents=True, exist_ok=True)
log.write_text("fake codex events\\n", encoding="utf-8")
cwd = pathlib.Path(flags["cwd"][0])
observed = subprocess.check_output(
    ["git", "rev-parse", "HEAD"], cwd=cwd).decode().strip()
commit = directives.get("commit_file")
if commit:
    target = cwd / commit["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(commit["content"], encoding="utf-8")
    subprocess.check_call(["git", "add", commit["path"]], cwd=cwd)
    subprocess.check_call(["git", "commit", "-qm", "fake gpt commit"], cwd=cwd)
    observed = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=cwd).decode().strip()
raw = (cwd / directives["fact_path"]).read_bytes()
report = {
    "schema_version": 1, "task_id": directives["task_id"],
    "contract_revision": directives["contract_revision"],
    "base_commit": directives["base_commit"], "observed_commit": observed,
    "status": directives.get("report_status", "completed"),
    "assessment": directives.get("assessment", "continuous_judgment"),
    "facts": [{"statement": "fake gpt fact", "path": directives["fact_path"],
               "line": 1, "sha256": hashlib.sha256(raw).hexdigest()}],
    "tests": [{"command": "fake check", "exit_code": 0, "artifact": "fake"}],
    "assumptions": [], "uninspected_areas": [], "unexpected_findings": [],
    "requested_scope": [], "reported_changes": [],
    "needs_replan": directives.get("needs_replan", False), "artifacts": [],
}
(job_dir / "worker_report.json").write_text(
    json.dumps(report, ensure_ascii=False), encoding="utf-8")
home = pathlib.Path(flags["home"][0])
jobs = home / "jobs"
jobs.mkdir(parents=True, exist_ok=True)
(jobs / (flags["batch"][0] + ".json")).write_text(json.dumps({
    "id": flags["batch"][0], "state": directives.get("jobs_state", "completed"),
    "exitCode": directives.get("jobs_exit", 0),
    "sessionId": directives.get("codex_session", flags["session-id"][0]),
    "sessionMode": "resume", "resumedFrom": flags["session-id"][0],
    "worktree": flags["cwd"][0], "logPath": str(log),
}), encoding="utf-8")
sys.exit(directives.get("exit_code", 0))
"""


class GptConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="runner-gpt-")
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def base_v2(self, **gpt):
        config = base_config(self.root, self.root / "fake_runner.py")
        config["schema_version"] = 2
        if gpt is not None:
            config["gpt"] = dict({
                "runner_entry": str(self.root / "run_codex.py"),
                "home": str(self.root / "bridge-home"),
                "cli": str(self.root / "codex.exe"),
                "session_id": "01a0d79e-fixed-session"}, **gpt)
        return config

    def test_v1_config_still_valid_without_gpt(self):
        config = validate_runner_config(base_config(self.root, self.root / "e.py"))
        self.assertIsNone(config["gpt"])
        self.assertEqual((1, 2), SUPPORTED_RUNNER_CONFIG_SCHEMAS)

    def test_v2_gpt_section_defaults_are_filled(self):
        config = validate_runner_config(self.base_v2())
        self.assertEqual(GPT_SANDBOX, config["gpt"]["sandbox"])
        self.assertEqual(config["timeout_minutes"],
                         config["gpt"]["timeout_minutes"])
        self.assertEqual("01a0d79e-fixed-session", config["gpt"]["session_id"])

    def test_v2_gpt_section_requires_explicit_cli(self):
        broken = self.base_v2()
        broken["gpt"].pop("cli")
        with self.assertRaises(RunnerError):
            validate_runner_config(broken)

    def test_v2_gpt_section_rejects_read_only_and_missing_identity(self):
        with self.assertRaises(RunnerError):
            validate_runner_config(self.base_v2(sandbox="read-only"))
        config = validate_runner_config(self.base_v2(sandbox="danger-full-access"))
        self.assertEqual("danger-full-access", config["gpt"]["sandbox"])
        broken = self.base_v2()
        broken["gpt"].pop("session_id")
        with self.assertRaises(RunnerError):
            validate_runner_config(broken)

    def test_gpt_argv_flags_exist_in_real_run_codex_parser(self):
        if not REAL_CODEX.is_file():
            self.skipTest("repository run_codex.py not present")
        source = REAL_CODEX.read_text(encoding="utf-8")
        known = {match[1] for match in
                 re.findall(r"add_argument\((['\"])(--[a-z-]+)\1", source)}
        config = validate_runner_config(self.base_v2())
        argv = build_gpt_argv(config, config["gpt"], "job-gpt", "title",
                              self.root, "p.md", "l.log", add_dir=self.root / "job")
        used = {item for item in argv if item.startswith("--")}
        self.assertFalse(used - known, used - known)
        self.assertTrue({"--home", "--session-id", "--prompt-file", "--log",
                         "--sandbox", "--batch", "--title", "--cwd",
                         "--timeout-minutes", "--add-dir"} <= used)
        self.assertIn("wake", argv)
        self.assertLess(argv.index("--home"), argv.index("wake"))
        flags = {}
        index = argv.index("wake")
        while index < len(argv):
            if argv[index].startswith("--"):
                flags[argv[index][2:]] = argv[index + 1]
                index += 2
            else:
                index += 1
        self.assertEqual("01a0d79e-fixed-session", flags["session-id"])
        self.assertEqual(GPT_SANDBOX, flags["sandbox"])
        self.assertEqual(repr(float(config["gpt"]["timeout_minutes"])),
                         flags["timeout-minutes"])


class GptArgvParserContractTests(unittest.TestCase):
    """P2-4: --cli must sit in the top-level option block, before the wake
    subcommand, and the whole argv must parse with the real run_codex parser."""

    def test_gpt_cli_position_and_full_argv_parse(self):
        if not REAL_CODEX.is_file():
            self.skipTest("repository run_codex.py not present")
        sys.path.insert(0, str(REAL_CODEX.parent))
        import run_codex
        root = pathlib.Path(tempfile.mkdtemp(prefix="gpt-argv-"))
        try:
            config = validate_runner_config({
                "schema_version": 2, "python_executable": sys.executable,
                "runner_entry": str(root / "runner.py"), "cli": str(root / "cli"),
                "provider": str(root / "provider.json"), "home": str(root / "home"),
                "permission_mode": "yolo", "timeout_minutes": 5,
                "idle_minutes": 1, "max_output_tokens": 4096,
                "gpt": {"runner_entry": str(root / "run_codex.py"),
                        "home": str(root / "bridge-home"),
                        "session_id": "pinned-thread",
                        "cli": str(root / "codex.exe"),
                        "timeout_minutes": 9},
            })
            argv = build_gpt_argv(config, config["gpt"], "job-gpt", "title",
                                  root, "p.md", "l.log", add_dir=root / "job")
            self.assertLess(argv.index("--cli"), argv.index("wake"),
                            "--cli belongs to the top-level option block")
            # The dispatch subprocess runs [python, run_codex.py, ...]; the parser
            # sees argv[2:].
            parsed = run_codex.build_parser().parse_args(argv[2:])
            self.assertEqual("wake", parsed.command)
            self.assertEqual(config["gpt"]["cli"], parsed.cli)
            self.assertEqual("pinned-thread", parsed.session_id)
            self.assertEqual("job-gpt", parsed.batch)
        finally:
            import shutil as _shutil
            _shutil.rmtree(root, ignore_errors=True)


class GptJobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="runner-gptjob-")
        self.root = pathlib.Path(self.temp.name)
        self.entry = self.root / "fake_codex.py"
        self.entry.write_text(FAKE_CODEX_RUNNER, encoding="utf-8")
        raw = base_config(self.root, self.root / "unused.py")
        raw["schema_version"] = 2
        raw["gpt"] = {"runner_entry": str(self.entry),
                      "home": str(self.root / "bridge-home"),
                      "cli": str(self.root / "codex.exe"),
                      "session_id": "01a0d79e-fixed-session"}
        self.config = validate_runner_config(raw)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        for args in (("init", "-q"), ("config", "user.name", "t"),
                     ("config", "user.email", "t@example.invalid"),
                     ("config", "core.autocrlf", "false")):
            self.run_git(*args)
        (self.repo / "app.py").write_text("value = 1\n", encoding="utf-8")
        self.run_git("add", ".")
        self.run_git("commit", "-qm", "base")
        self.contract = make_contract(task_id="GPT-01", base_commit=self.head(),
                                      task_shape="continuous_judgment",
                                      oracle="reliable",
                                      verification_profile="fixture",
                                      allowed_paths=["**"])

    def tearDown(self):
        self.temp.cleanup()

    def run_git(self, *args):
        import subprocess
        result = subprocess.run(["git", *args], cwd=self.repo,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(0, result.returncode, result.stderr)
        return result.stdout.decode().strip()

    def head(self):
        return self.run_git("rev-parse", "HEAD")

    def dispatch(self, directives):
        job_dir = self.root / "job-gpt"
        job_dir.mkdir(parents=True, exist_ok=True)
        write_json(job_dir / "directives.json", {
            "task_id": self.contract["task_id"],
            "contract_revision": self.contract["contract_revision"],
            "base_commit": self.contract["base_commit"],
            "fact_path": "app.py", **directives})
        prompt = build_prompt(self.contract, job_dir=job_dir,
                              report_path=job_dir / "worker_report.json",
                              attempt_no=1)
        return run_gpt_job(self.config, gpt=self.config["gpt"],
                           task_id="GPT-01", job_id="job-gpt-x", attempt_no=1,
                           title="fake gpt", repo=self.repo, job_dir=job_dir,
                           prompt_text=prompt)

    def test_gpt_job_passes_and_keeps_pinned_session(self):
        result = self.dispatch({"commit_file": {"path": "app.py",
                                                "content": "value = 2\n"}})
        self.assertEqual("passed", result["status"], result)
        self.assertTrue(result["cleanup_confirmed"])
        self.assertEqual("01a0d79e-fixed-session", result["record"]["sessionId"])
        self.assertEqual("resume", result["record"]["sessionMode"])
        flags = json.loads((result["job_dir"] / "runner_argv.json").read_text())
        self.assertEqual("01a0d79e-fixed-session", flags["session-id"][0])
        self.assertEqual(str(pathlib.Path(self.repo).resolve()),
                         flags["cwd"][0])
        self.assertEqual([str(result["job_dir"].resolve())], flags["add-dir"])
        self.assertTrue(result["report_path"].is_file())
        self.assertTrue(result["log_path"].is_file())

    def test_gpt_job_rejects_session_mismatch_record(self):
        result = self.dispatch({"codex_session": "different-thread-999"})
        self.assertEqual("failed", result["status"])
        self.assertEqual("registry_mismatch", result["failure_kind"])

    def test_gpt_job_registry_mismatch_fails(self):
        result = self.dispatch({"jobs_state": "failed"})
        self.assertEqual("failed", result["status"])
        self.assertEqual("registry_mismatch", result["failure_kind"])


if __name__ == "__main__":
    unittest.main()
