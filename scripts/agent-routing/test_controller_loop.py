"""ORCH-03 controller loop behavior tests: synthetic Git, external store, fake runner."""
import json
import hashlib
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from controller_loop import Controller, ControllerError
from controller_state import TaskStore, ConflictError
from test_controller_runner import (FAKE_CODEX_RUNNER, FAKE_RUNNER,
                                    write_json)
from test_routing import contract as make_contract, report as make_report

CONTROLLER_CLI = pathlib.Path(__file__).resolve().parent / "controller.py"

FAULT_CASES = {
    "nonzero_exit": {"exit_code": 2, "jobs_state": "failed", "jobs_exit": 1},
    "no_commit": {"commit_file": None},
    "dirty_exit": {"dirty": True},
    "out_of_scope": {"commit_file": {"path": "server/private/x.ts",
                                     "content": "leak\n"}, "fact_path": "server/private/x.ts"},
    "missing_report": {"report": False},
    "needs_replan": {"needs_replan": True},
    "scope_expansion_request": {"requested_scope": ["web/theme/**"]},
}


class LoopFixture(unittest.TestCase):
    TASK = "LOOP-01"

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="loop-case-")
        self.root = pathlib.Path(self.temp.name)
        self.repo = self.root / "candidate"
        self.repo.mkdir()
        self.git("init", "-q")
        for setting in (("user.name", "Loop Fixture"),
                        ("user.email", "fixture@example.invalid"),
                        ("core.autocrlf", "false")):
            self.git("config", *setting)
        (self.repo / "check.py").write_text(
            "value = int(open('app.py', encoding='utf-8').read().split('=')[1])\n"
            "assert value == 1, 'AssertionError: expected correct price'\n",
            encoding="utf-8")
        (self.repo / "app.py").write_text("value = 1\n", encoding="utf-8")
        self.commit()
        self.base = self.head()
        self.store_dir = self.root / "control-store"
        self.entry = self.root / "fake_runner.py"
        self.entry.write_text(FAKE_RUNNER, encoding="utf-8")
        self.gpt_entry = self.root / "fake_codex.py"
        self.gpt_entry.write_text(FAKE_CODEX_RUNNER, encoding="utf-8")
        (self.root / "cli").write_text("fake CLI", encoding="utf-8")
        (self.root / "provider.json").write_text("{}", encoding="utf-8")
        self.cpath = self.root / "contract.json"
        self.ppath = self.root / "policy.json"
        self.rpath = self.root / "runner.json"
        self.policy = {
            "schema_version": 1, "policy_id": "loop-policy", "revision": 1,
            "executables": {"python": sys.executable},
            "protected_paths": ["check.py", "test_*.py"],
            "allow_added_tests": ["test_*.py"],
            "approved_protected_files": {},
            "profiles": {"fixture": {"checks": [
                {"id": "behavior", "executable": "python",
                 "args": ["-B", "check.py"], "timeout_seconds": 20}]}},
        }
        self.controller = Controller(self.store_dir)

    def tearDown(self):
        self.controller.close()
        self.temp.cleanup()

    # -- helpers ---------------------------------------------------------

    def git(self, *args):
        result = subprocess.run(["git", "-C", str(self.repo), *args],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(0, result.returncode,
                         (args, result.stderr.decode("utf-8", "replace")))
        return result.stdout.decode("utf-8").strip()

    def head(self):
        return self.git("rev-parse", "HEAD")

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        return self.head()

    def reset_repo(self):
        """Return the shared candidate worktree to the fixture baseline."""
        self.git("reset", "-q", "--hard", self.base)
        self.git("clean", "-fdq")

    def write_pins(self, task_id=None, budgets=None, shape="mechanical",
                   gpt_dispatch=False, gpt_section=None):
        task_id = task_id or self.TASK
        self.contract = make_contract(
            task_id=task_id, base_commit=self.base, task_shape=shape,
            oracle="reliable", verification_profile="fixture",
            allowed_paths=["**"], forbidden_paths=["server/private/**"],
            semantic_scopes=["loop.scope"], budgets=budgets or {
                "scout_rounds": 1, "same_failure_repairs": 2,
                "total_attempts": 4, "environment_retries": 1})
        self.csha = write_json(self.cpath, self.contract)
        if gpt_dispatch:
            self.policy["gpt_dispatch"] = True
        self.psha = write_json(self.ppath, self.policy)
        runner_config = {
            "schema_version": 1, "python_executable": sys.executable,
            "runner_entry": str(self.entry), "cli": str(self.root / "cli"),
            "provider": str(self.root / "provider.json"),
            "home": str(self.root / "glm-home"), "db": str(self.root / "db.sqlite"),
            "permission_mode": "yolo", "timeout_minutes": 5,
            "idle_minutes": 1, "max_output_tokens": 4096,
        }
        if gpt_section is not None:
            runner_config["schema_version"] = 2
            runner_config["gpt"] = gpt_section
        self.rsha = write_json(self.rpath, runner_config)
        return self.contract

    def directives(self, attempt_no, task_id=None, **values):
        task_id = task_id or self.TASK
        base = {"task_id": task_id, "contract_revision": 1,
                "base_commit": self.base, "fact_path": "notes.md",
                "commit_file": {"path": "notes.md", "content": "# done\n"}}
        base.update(values)
        attempt_dir = self.store_dir / "tasks" / task_id / "attempts" / str(attempt_no)
        attempt_dir.mkdir(parents=True, exist_ok=True)
        write_json(attempt_dir / "directives.json", base)
        return base

    def register(self, task_id=None, allow=True, **kwargs):
        task_id = task_id or self.TASK
        self.write_pins(task_id=task_id, **kwargs)
        return self.controller.register(
            task_id, str(self.repo), self.cpath, self.ppath, self.rpath,
            allow=allow, contract_sha256=self.csha, policy_sha256=self.psha,
            runner_config_sha256=self.rsha)

    def run_task(self, task_id=None):
        return self.controller.run(task_id or self.TASK)

    def events(self, task_id=None):
        store = TaskStore(self.store_dir)
        try:
            return store.get(task_id or self.TASK)["events"]
        finally:
            store.close()

    def counts(self, task_id=None):
        result = {}
        for event in self.events(task_id):
            result[event["kind"]] = result.get(event["kind"], 0) + 1
        return result

    def attempts(self, task_id=None):
        directory = self.store_dir / "tasks" / (task_id or self.TASK) / "attempts"
        return sorted(int(p.name) for p in directory.iterdir()) if directory.is_dir() else []


class RegistrationTests(LoopFixture):
    def test_registration_without_allowlist_flag_is_refused(self):
        with self.assertRaises(ControllerError):
            self.controller.register(self.TASK, str(self.repo), self.cpath,
                                     self.ppath, self.rpath, allow=False)
        self.write_pins()
        with self.assertRaises(ControllerError):
            self.controller.register(self.TASK, str(self.repo), self.cpath,
                                     self.ppath, self.rpath)

    def test_duplicate_registration_only_identical(self):
        first = self.register()
        again = self.register()
        self.assertEqual(first["contract_sha256"], again["contract_sha256"])
        store = TaskStore(self.store_dir)
        try:
            drifted = dict(store.get(self.TASK)["registration"], goal="changed")
            with self.assertRaises(ConflictError):
                store.register(self.TASK, drifted)
        finally:
            store.close()

    def test_dirty_baseline_bad_ancestor_and_inner_store_rejected(self):
        (self.repo / "app.py").write_text("value = 9\n", encoding="utf-8")
        with self.assertRaises(ControllerError):
            self.register()
        self.git("checkout", "--", ".")
        inside = Controller(self.repo / "store")
        try:
            with self.assertRaises(ControllerError):
                inside.register(self.TASK, str(self.repo), self.cpath,
                                self.ppath, self.rpath, allow=True)
        finally:
            inside.close()
        self.write_pins()
        bad = dict(self.contract, base_commit="f" * 40)
        write_json(self.cpath, bad)
        with self.assertRaises(ControllerError):
            self.controller.register(self.TASK, str(self.repo), self.cpath,
                                     self.ppath, self.rpath, allow=True)


class SuccessTests(LoopFixture):
    def test_success_reaches_authenticated_verified_without_promotion(self):
        self.register()
        self.directives(1)
        status = self.run_task()
        self.assertEqual("verified", status["stage"])
        self.assertFalse(status["can_promote"])
        self.assertEqual({"execution_started": 1, "verification_passed": 1},
                         self.counts())
        receipts = self.store_dir / "verification" / "receipts"
        self.assertTrue(any(receipts.glob("verify-*.json")))
        self.assertIn("fake worker commit", self.git("log", "--format=%s", "-1"))
        self.assertEqual(self.head(), status["verified"]["tested_commit"])
        self.assertEqual([1], self.attempts())

    def test_repeat_run_on_terminal_is_inert(self):
        self.register()
        self.directives(1)
        self.assertEqual("verified", self.run_task()["stage"])
        before_events = len(self.events())
        status = self.run_task()
        self.assertEqual("verified", status["stage"])
        self.assertEqual(before_events, len(self.events()))
        self.assertEqual([1], self.attempts())

    def test_tampered_receipt_invalidates_verified(self):
        self.register()
        self.directives(1)
        self.assertEqual("verified", self.run_task()["stage"])
        receipt = next((self.store_dir / "verification" / "receipts").glob("*.json"))
        envelope = json.loads(receipt.read_text(encoding="utf-8"))
        envelope["report"]["status"] = "forged"
        receipt.write_text(json.dumps(envelope), encoding="utf-8")
        self.assertEqual("waiting_control", self.run_task()["stage"])

    def test_moved_head_invalidates_verified(self):
        self.register("LOOP-HEAD")
        self.directives(1, task_id="LOOP-HEAD")
        self.assertEqual("verified", self.run_task("LOOP-HEAD")["stage"])
        (self.repo / "notes.md").write_text("# drift\n", encoding="utf-8")
        self.commit()
        self.assertEqual("waiting_control", self.run_task("LOOP-HEAD")["stage"])

    def test_worker_fake_pass_cannot_be_accepted_without_oracle(self):
        self.register()
        self.directives(1, fact_path="app.py",
                        commit_file={"path": "app.py", "content": "value = 2\n"})
        self.directives(2, fact_path="app.py",
                        commit_file={"path": "app.py", "content": "value = 1\n"})
        status = self.run_task()
        self.assertEqual("verified", status["stage"])
        self.assertEqual({"execution_started": 2, "failure": 1,
                          "verification_passed": 1}, self.counts())


class RepairAndBudgetTests(LoopFixture):
    def break_oracle(self, attempt_no, value):
        self.directives(attempt_no, fact_path="app.py",
                        commit_file={"path": "app.py",
                                     "content": "value = %d\n" % value})

    def test_two_same_cause_repairs_accumulate_across_jobs_then_handoff(self):
        self.register()
        self.break_oracle(1, 2)
        self.break_oracle(2, 3)
        self.break_oracle(3, 4)
        status = self.run_task()
        self.assertEqual("waiting_control", status["stage"])
        counts = self.counts()
        self.assertEqual(3, counts["execution_started"])
        self.assertEqual(1, counts["failure"])
        self.assertEqual(2, counts["repair_failed"])
        events = self.events()
        fingerprints = {e["failure_fingerprint"] for e in events
                        if e["kind"] in ("failure", "repair_failed")}
        self.assertEqual(1, len(fingerprints))
        self.assertIsNotNone(status["handoff_path"])
        self.assertEqual([1, 2, 3], self.attempts())

    def test_total_attempts_budget_terminates(self):
        self.register(budgets={"scout_rounds": 1, "same_failure_repairs": 2,
                               "total_attempts": 1, "environment_retries": 1})
        self.break_oracle(1, 2)
        status = self.run_task()
        self.assertEqual("waiting_control", status["stage"])
        self.assertEqual(1, self.counts()["execution_started"])
        self.assertEqual([1], self.attempts())

    def test_environment_failure_is_bounded_then_waiting_environment(self):
        # An actual OS launch failure is an environment error. A malformed
        # receipt store is an integrity failure and must not exercise this
        # path by weakening authentication exceptions.
        unavailable = self.root / "unavailable-check.exe"
        unavailable.write_bytes(b"not an executable")
        self.policy["executables"]["python"] = str(unavailable)
        self.register()
        self.directives(1)
        status = self.run_task()
        self.assertEqual("waiting_environment", status["stage"])
        self.assertEqual(1, self.counts()["environment_failure"])
        self.assertEqual(1, self.counts()["execution_started"])

    def test_invalid_receipt_store_requires_control_handoff(self):
        self.register()
        self.directives(1)
        (self.store_dir / "verification").write_text("not a directory", encoding="utf-8")
        self.assertEqual("waiting_control", self.run_task()["stage"])
        self.assertNotIn("verification_passed", self.counts())
        self.assertNotIn("environment_failure", self.counts())


class LeaseTests(LoopFixture):
    def test_two_process_conflict_does_not_dispatch(self):
        self.register()
        other = TaskStore(self.store_dir)
        try:
            self.assertTrue(other.acquire(self.TASK, "foreigntoken123"))
        finally:
            other.close()
        status = self.run_task()
        self.assertTrue(status.get("blocked_by_lease"))
        self.assertEqual({}, self.counts())
        self.assertEqual([], self.attempts())

    def test_crash_leftover_pending_attempt_is_never_redispatched(self):
        self.register()
        self.directives(1)
        token = "leftovertoken0001"
        store = TaskStore(self.store_dir)
        try:
            self.assertTrue(store.acquire(self.TASK, token))
            store.append_event(self.TASK, {
                "event_id": "exec-leftover", "kind": "execution_started",
                "task_id": self.TASK, "job_id": "job-leftover"})
        finally:
            store.close()
        progress_path = self.store_dir / "tasks" / self.TASK / "progress.json"
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        progress.update(stage="running", owner_token=token,
                        current_job="job-leftover")
        write_json(progress_path, progress)
        status = self.run_task()
        self.assertEqual("waiting_control", status["stage"])
        self.assertEqual({"execution_started": 1}, self.counts())
        self.assertIsNotNone(status["handoff_path"])

    def test_unknown_owner_leftover_lease_blocks_without_stealing(self):
        self.register()
        other = TaskStore(self.store_dir)
        try:
            other.acquire(self.TASK, "crashedprocess999")
        finally:
            other.close()
        status = self.run_task()
        self.assertTrue(status.get("blocked_by_lease"))
        self.assertEqual({}, self.counts())
        store = TaskStore(self.store_dir)
        try:
            self.assertEqual("crashedprocess999",
                             store.get(self.TASK)["lease"]["owner_token"])
        finally:
            store.close()

    def test_recover_without_confirmed_identity_never_releases_lease(self):
        self.register()
        token = "recordedtoken0001"
        store = TaskStore(self.store_dir)
        try:
            self.assertTrue(store.acquire(self.TASK, token))
        finally:
            store.close()
        progress_path = self.store_dir / "tasks" / self.TASK / "progress.json"
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        progress.update(owner_token=token, stage="running")
        write_json(progress_path, progress)
        with self.assertRaises(ControllerError):
            self.controller.recover(self.TASK)
        store = TaskStore(self.store_dir)
        try:
            self.assertEqual(token, store.get(self.TASK)["lease"]["owner_token"])
        finally:
            store.close()


class GateAndFaultTests(LoopFixture):
    def test_unsupported_routes_wait_for_control(self):
        cases = {"continuous_judgment": "LOOP-CJ", "uncertain": "LOOP-UN",
                 "requires_design": "LOOP-RD"}
        for shape, task_id in cases.items():
            with self.subTest(shape=shape):
                self.reset_repo()
                self.register(task_id=task_id, shape=shape)
                self.directives(1, task_id=task_id)
                status = self.run_task(task_id)
                self.assertEqual("waiting_control", status["stage"])
                self.assertEqual({}, self.counts(task_id))

    # -- GPT Direct auto-dispatch (GPT-WAKE-02) --------------------------

    def gpt_pins(self, task_id):
        return {"shape": "continuous_judgment", "gpt_dispatch": True,
                "gpt_section": {"runner_entry": str(self.gpt_entry),
                                "home": str(self.root / "gpt-home"),
                                "session_id": "01a0d79e-fixture-session"}}

    def test_gpt_direct_auto_dispatch_reaches_verified(self):
        self.reset_repo()
        self.register(task_id="LOOP-GPT", **self.gpt_pins("LOOP-GPT"))
        self.directives(1, task_id="LOOP-GPT")
        status = self.run_task("LOOP-GPT")
        self.assertEqual("verified", status["stage"])
        self.assertEqual({"execution_started": 1, "verification_passed": 1},
                         self.counts("LOOP-GPT"))
        self.assertEqual("gpt_direct", self.events("LOOP-GPT")[0]["route"])
        prompt = (self.store_dir / "tasks" / "LOOP-GPT" / "attempts" / "1" /
                  "prompt.md").read_text(encoding="utf-8")
        self.assertIn("LOOP-GPT", prompt)
        self.assertIn("REPORT:", prompt)
        record = json.loads(((self.root / "gpt-home") / "jobs" /
                             (json.loads((self.store_dir / "tasks" / "LOOP-GPT" /
                                          "attempts" / "1" / "outcome.json")
                                         .read_text(encoding="utf-8"))["job_id"]
                              + ".json")).read_text(encoding="utf-8"))
        self.assertEqual("01a0d79e-fixture-session", record["sessionId"])
        self.assertEqual("resume", record["sessionMode"])

    def test_verify_only_resume_verifies_committed_work_without_redispatch(self):
        self.register()
        self.directives(1, unexpected_findings=["benign environment note"])
        status = self.run_task()
        self.assertEqual("waiting_control", status["stage"])
        self.assertEqual(1, self.counts()["execution_started"])
        status = self.controller.resume(
            self.TASK, allow=True, expected_commit=self.head(),
            reason="attempt escalated after committing; operator requests verification only",
            verify_only=True)
        self.assertEqual("verified", status["stage"])
        self.assertEqual(1, self.counts()["execution_started"])
        self.assertEqual(1, self.counts()["verification_passed"])
        self.assertEqual(self.head(), status["verified"]["tested_commit"])

    def test_gpt_direct_requires_policy_opt_in(self):
        self.reset_repo()
        pins = self.gpt_pins("LOOP-GPT2")
        pins.pop("gpt_dispatch")
        self.register(task_id="LOOP-GPT2", **pins)
        self.directives(1, task_id="LOOP-GPT2")
        status = self.run_task("LOOP-GPT2")
        self.assertEqual("waiting_control", status["stage"])
        self.assertEqual({}, self.counts("LOOP-GPT2"))
        self.assertTrue((self.store_dir / "tasks" / "LOOP-GPT2" /
                         "handoff.json").is_file())

    def test_gpt_direct_requires_pinned_runner_section(self):
        self.reset_repo()
        pins = self.gpt_pins("LOOP-GPT3")
        pins.pop("gpt_section")
        self.register(task_id="LOOP-GPT3", **pins)
        self.directives(1, task_id="LOOP-GPT3")
        status = self.run_task("LOOP-GPT3")
        self.assertEqual("waiting_control", status["stage"])
        self.assertEqual({}, self.counts("LOOP-GPT3"))

    def test_pin_change_before_run_hands_off_without_dispatch(self):
        self.register()
        self.directives(1)
        self.contract["goal"] = "drifted after approval"
        self.csha = write_json(self.cpath, self.contract)
        status = self.run_task()
        self.assertEqual("waiting_control", status["stage"])
        self.assertEqual({}, self.counts())

    def test_worker_faults_hand_off_and_preserve_evidence(self):
        for index, (name, values) in enumerate(FAULT_CASES.items()):
            task_id = "LOOP-F%d" % index
            with self.subTest(case=name):
                self.reset_repo()
                self.register(task_id=task_id)
                self.directives(1, task_id=task_id, **values)
                status = self.run_task(task_id)
                self.assertEqual("waiting_control", status["stage"])
                self.assertEqual(1, self.counts(task_id)["execution_started"])
                self.assertEqual(
                    0, self.counts(task_id).get("verification_passed", 0))
                self.assertIsNotNone(status["handoff_path"])
                self.assertTrue(pathlib.Path(status["handoff_path"]).is_file())

    def test_protected_test_change_is_blocked(self):
        self.register()
        self.directives(1, fact_path="check.py",
                        commit_file={"path": "check.py",
                                     "content": "assert True  # weakened\n"})
        status = self.run_task()
        self.assertEqual("waiting_control", status["stage"])
        self.assertEqual(1, self.counts()["execution_started"])
        self.assertNotIn("verification_passed", self.counts())


class CliTests(LoopFixture):
    def test_cli_register_run_status_round_trip(self):
        def cli(*args):
            result = subprocess.run(
                [sys.executable, "-B", str(CONTROLLER_CLI), "--store",
                 str(self.store_dir), *args],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
            self.assertEqual(0, result.returncode,
                             result.stderr.decode("utf-8", "replace"))
            return json.loads(result.stdout.decode("utf-8"))

        self.write_pins(task_id="CLI-01")
        registered = cli("register", "--task-id", "CLI-01", "--repo",
                         str(self.repo), "--contract", str(self.cpath),
                         "--policy", str(self.ppath), "--runner-config",
                         str(self.rpath), "--allow", "--contract-sha256", self.csha,
                         "--policy-sha256", self.psha, "--runner-config-sha256", self.rsha)
        self.assertEqual("registered", registered["stage"])
        self.directives(1, task_id="CLI-01")
        done = cli("run", "--task-id", "CLI-01")
        self.assertEqual("verified", done["stage"])
        shown = cli("status", "--task-id", "CLI-01")
        self.assertEqual("verified", shown["stage"])
        self.assertFalse(shown["can_promote"])


class ControlBoundaryTests(LoopFixture):
    def test_explicit_resume_preserves_attempts_after_resolved_worker_handoff(self):
        self.register()
        self.directives(1, report=False)
        self.assertEqual("waiting_control", self.run_task()["stage"])
        blocked_head = self.head()
        self.directives(2, commit_file={"path": "notes.md", "content": "# resumed\n"})
        self.controller.resume(self.TASK, allow=True, expected_commit=blocked_head,
                               reason="Operator resolved external tool configuration")
        self.assertEqual("verified", self.run_task()["stage"])
        self.assertEqual(2, self.counts()["execution_started"])
        self.assertEqual([1, 2], self.attempts())
        self.assertEqual(1, self.counts()["replan"])
        prompt = self.store_dir / "tasks" / self.TASK / "attempts" / "2" / "prompt.md"
        self.assertTrue("Operator resolved external tool configuration" in prompt.read_text(encoding="utf-8"),
                        "resolved operator decision missing from worker prompt")

    def test_resume_rejects_missing_approval_live_lease_and_dirty_candidate(self):
        self.register()
        self.directives(1, report=False)
        self.run_task()
        expected = self.head()
        with self.assertRaises(ControllerError):
            self.controller.resume(self.TASK, expected_commit=expected, reason="resolved")
        token = "still-running-owner"
        self.controller.store.acquire(self.TASK, token)
        with self.assertRaises(ControllerError):
            self.controller.resume(self.TASK, allow=True, expected_commit=expected, reason="resolved")
        self.controller.store.release(self.TASK, token)
        (self.repo / "notes.md").write_text("unreviewed", encoding="utf-8")
        with self.assertRaises(ControllerError):
            self.controller.resume(self.TASK, allow=True, expected_commit=expected, reason="resolved")
        self.assertEqual(1, self.counts()["execution_started"])

    def test_resume_requires_matching_finished_attempt_and_known_cleanup(self):
        self.register()
        self.directives(1, report=False)
        self.run_task()
        expected = self.head()
        path = self.store_dir / "tasks" / self.TASK / "attempts" / "1" / "outcome.json"
        original = json.loads(path.read_text(encoding="utf-8"))
        for override in ({"cleanup_confirmed": False}, {"job_id": "wrong-job"}):
            write_json(path, dict(original, **override))
            with self.assertRaises(ControllerError):
                self.controller.resume(self.TASK, allow=True, expected_commit=expected, reason="resolved")
        write_json(path, original)
        with self.assertRaises(ControllerError):
            self.controller.resume(self.TASK, allow=True, expected_commit=self.base, reason="stale head")
        self.assertEqual(1, self.counts()["execution_started"])
    def test_runner_failure_classification_cannot_become_verified(self):
        for name, directives in (("orphan", {"orphan_child": True}),
                                 ("contradiction", {"jobs_exit": 1})):
            with self.subTest(name=name):
                self.reset_repo()
                self.register(name)
                self.directives(1, task_id=name, **directives)
                self.assertEqual("waiting_control", self.run_task(name)["stage"])
                self.assertNotIn("verification_passed", self.counts(name))

    def test_terminal_recheck_requires_passing_authenticated_report(self):
        self.register()
        reg = self.controller.store.get(self.TASK)["registration"]
        with patch("controller_loop.verification.verify_evidence", return_value={"status": "failed"}):
            status = self.controller._recheck_verified(
                self.TASK, reg, {"verified": {"receipt_path": str(self.root / "failed-receipt")}})
        self.assertEqual("waiting_control", status["stage"])
    def test_designed_task_cannot_finish_with_partial_or_unbound_report(self):
        for name, override in (
                ("partial", {"status": "partial"}),
                ("empty", {"facts": []}),
                ("risk", {"reported_changes": ["public_api"]}),
                ("stale", {"facts": [{"statement": "stale", "path": "notes.md", "line": 1, "sha256": "0" * 64}]})):
            with self.subTest(name=name):
                self.reset_repo()
                self.register(name, shape="designed")
                (self.repo / "notes.md").write_text("note", encoding="utf-8")
                head = self.commit()
                report = make_report(task_id=name, base_commit=self.base,
                                     observed_commit=head, facts=[{
                                         "statement": "note", "path": "notes.md", "line": 1,
                                         "sha256": hashlib.sha256(b"note").hexdigest()}])
                report.update(override)
                report_path = self.root / "report.json"
                write_json(report_path, report)
                result = {"exit_code": 0, "status": "passed", "failure_kind": None,
                          "record": {"state": "completed", "exitCode": 0},
                          "jobs_path": self.root / "job.json", "report_path": report_path}
                outcome = self.controller._worker_outcome(
                    self.repo, self.base, self.base, result, self.contract)
                self.assertNotEqual("ok", outcome[0])

    def test_completed_attempt_retains_before_after_and_runner_evidence(self):
        self.register()
        self.directives(1)
        self.assertEqual("verified", self.run_task()["stage"])
        path = self.store_dir / "tasks" / self.TASK / "attempts" / "1" / "outcome.json"
        self.assertTrue(path.is_file())
        outcome = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(self.base, outcome["before_sha"])
        self.assertEqual(self.head(), outcome["after_sha"])
        self.assertTrue(outcome["cleanup_confirmed"])
        self.assertEqual(0, outcome["exit_code"])
        self.assertIn("job_id", outcome)
        before = path.read_bytes()
        self.run_task()
        self.assertEqual(before, path.read_bytes())
    def test_authentication_failure_is_control_handoff_not_environment_retry(self):
        self.register()
        data = self.controller.store.get(self.TASK)
        with patch("controller_loop.verification.run_verification", return_value=self.root / "receipt"), \
                patch("controller_loop.verification.verify_evidence", side_effect=ValueError("bad signature")):
            stage = self.controller._verify_and_classify(
                self.TASK, data["registration"], self.repo, {},
                {"job_id": "job-auth"}, {"observed_commit": self.head()})
        self.assertEqual("waiting_control", stage)
        self.assertEqual({}, self.counts())

    def test_two_failed_repairs_with_new_same_cause_exhaust_budget(self):
        self.register()
        reg = self.controller.store.get(self.TASK)["registration"]
        progress = {}
        for index, fingerprint in enumerate(("first-cause", "new-cause", "new-cause")):
            evidence = {"run_id": "verify-%d" % index, "status": "failed",
                        "failure_fingerprint": fingerprint,
                        "checks": [{"id": "oracle", "status": "failed", "failure_kind": "check_failure"}]}
            with patch("controller_loop.verification.run_verification", return_value=self.root / "receipt"), \
                    patch("controller_loop.verification.verify_evidence", return_value=evidence):
                self.controller._verify_and_classify(
                    self.TASK, reg, self.repo, progress,
                    {"job_id": "job-%d" % index}, {"observed_commit": self.head()})
        self.assertEqual(["failure", "repair_failed", "repair_failed"],
                         [e["kind"] for e in self.events()])

    def test_runner_mutation_during_execution_cannot_get_verified(self):
        self.register()
        reg = self.controller.store.get(self.TASK)["registration"]
        self.entry.write_text("changed during execution", encoding="utf-8")
        with patch("controller_loop.verification.run_verification", side_effect=AssertionError("must not verify")):
            stage = self.controller._verify_and_classify(
                self.TASK, reg, self.repo, {},
                {"job_id": "job-pin"}, {"observed_commit": self.head()})
        self.assertEqual("waiting_control", stage)

    def test_explicit_approval_hashes_must_match_registration_inputs(self):
        self.write_pins()
        with self.assertRaises(ControllerError):
            self.controller.register(
                self.TASK, self.repo, self.cpath, self.ppath, self.rpath,
                allow=True, contract_sha256="0" * 64,
                policy_sha256=self.psha, runner_config_sha256=self.rsha)

    def test_started_event_without_progress_is_never_redispatched(self):
        self.register()
        self.controller.store.append_event(self.TASK, {
            "event_id": "exec-lost-progress", "kind": "execution_started",
            "task_id": self.TASK, "job_id": "job-lost-progress"})
        self.assertEqual("waiting_control", self.run_task()["stage"])
        self.assertEqual(1, self.counts()["execution_started"])
        self.assertEqual([], self.attempts())

    def test_uncertain_child_cleanup_keeps_exclusive_lease(self):
        self.register()
        fake = {"exit_code": None, "cleanup_confirmed": False,
                "failure_kind": "cleanup_incomplete", "record": None,
                "job_dir": self.root / "job", "log_path": self.root / "log",
                "jobs_path": self.root / "jobs", "report_path": self.root / "report"}
        with patch("controller_loop.run_job", return_value=fake):
            status = self.run_task()
        self.assertEqual("waiting_control", status["stage"])
        self.assertTrue(status["lease_held"])
    def test_second_cli_cannot_reuse_live_owner_token(self):
        self.register()
        self.directives(1)
        token = "live-owner-token"
        self.assertTrue(self.controller.store.acquire(self.TASK, token))
        write_json(self.store_dir / "tasks" / self.TASK / "progress.json",
                   {"stage": "running", "owner_token": token})
        result = subprocess.run(
            [sys.executable, "-B", str(CONTROLLER_CLI), "--store",
             str(self.store_dir), "run", "--task-id", self.TASK],
            capture_output=True, timeout=30)
        self.assertEqual(0, result.returncode, result.stderr)
        status = json.loads(result.stdout)
        self.assertTrue(status["blocked_by_lease"])
        self.assertEqual({}, self.counts())
        self.assertEqual(token, self.controller.store.get(self.TASK)["lease"]["owner_token"])

    def test_worker_continuous_judgment_escalates_before_verification(self):
        self.register()
        self.directives(1, assessment="continuous_judgment")
        self.assertEqual("waiting_control", self.run_task()["stage"])
        self.assertNotIn("verification_passed", self.counts())

    def test_verified_rechecks_runner_configuration(self):
        self.register()
        self.directives(1)
        self.assertEqual("verified", self.run_task()["stage"])
        config = json.loads(self.rpath.read_text(encoding="utf-8"))
        config["timeout_minutes"] = 99
        write_json(self.rpath, config)
        self.assertEqual("waiting_control", self.controller.status(self.TASK)["stage"])
        self.assertEqual("waiting_control", self.run_task()["stage"])
        self.assertEqual(1, self.counts()["execution_started"])

    def test_modified_runner_code_is_rejected_before_execution(self):
        self.register()
        self.directives(1)
        with self.entry.open("a", encoding="utf-8") as stream:
            stream.write("\n# replaced runner\n")
        self.assertEqual("waiting_control", self.run_task()["stage"])
        self.assertEqual({}, self.counts())

    def test_dirty_candidate_after_registration_never_dispatches(self):
        self.register()
        self.directives(1)
        (self.repo / "notes.md").write_text("user work", encoding="utf-8")
        self.assertEqual("waiting_control", self.run_task()["stage"])
        self.assertEqual({}, self.counts())
        self.assertEqual("user work", (self.repo / "notes.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
