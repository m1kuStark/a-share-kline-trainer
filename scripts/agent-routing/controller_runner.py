"""Pinned run_glm adapter: owned dispatch, jobs registry parsing, worker prompt.

The runner entry, its interpreter, and every board path come from a
controller-pinned configuration file. Dispatch uses an argv array (no
shell) and runs inside an owned_process group so descendants are
terminated and cleanup is confirmed on every exit path. Results are
read from the runner's own jobs/<batch>.json registry and must be
attributed to this exact job (batch id, worktree, log) before they are
returned. Provider files are passed through by path and never read.

run_job result keys: the previous keys plus
- cleanup_confirmed: True only when the owned group terminated cleanly;
  False means descendants may remain and the lease must be retained.
- failure_kind: None, or one of "check_failure" (nonzero runner exit),
  "timeout", "environment", "orphaned_process", "cleanup_incomplete"
  (from run_owned) or "registry_mismatch" (the dispatch was clean but
  the registry record is missing, unattributable, or contradicts a
  successful run).
- status: "passed" only when the dispatch was clean, cleanup confirmed,
  and the registry shows exactly state=completed/exitCode=0.
"""
import hashlib
import json
import math
import os
import pathlib
import re
import sys
import uuid

sys.dont_write_bytecode = True
from owned_process import run_owned
from route import read_input
from routing import validate_contract, validate_report

RUNNER_CONFIG_SCHEMA = 1
REQUIRED_FLAGS = ("--batch", "--title", "--cwd", "--prompt", "--log",
                  "--provider", "--cli")
BATCH_RE = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9_-]{0,100}\Z")
REPORT_FILENAME = "worker_report.json"
SUCCESS_STATE = "completed"
# Bounded extra wait on top of the runner's own timeout-minutes budget;
# covers registry flush, group teardown, and supervisor bookkeeping.
SUPERVISOR_MARGIN_SECONDS = 60.0


class RunnerError(ValueError):
    """Invalid runner configuration, dispatch arguments, or worker report."""


def _absolute(value, field):
    if not isinstance(value, str) or not value.strip():
        raise RunnerError("runner config %s must be a nonempty string" % field)
    path = pathlib.Path(value)
    if not path.is_absolute():
        raise RunnerError("runner config %s must be absolute: %r" % (field, value))
    return str(path)


def validate_runner_config(value):
    if not isinstance(value, dict):
        raise RunnerError("runner config must be an object")
    if type(value.get("schema_version")) is not int or \
            value["schema_version"] != RUNNER_CONFIG_SCHEMA:
        raise RunnerError("unsupported runner config schema_version")
    config = dict(value)
    for field in ("python_executable", "runner_entry", "cli", "provider", "home"):
        config[field] = _absolute(config.get(field), field)
    for field in ("node", "db"):
        if config.get(field) is not None:
            config[field] = _absolute(config[field], field)
    mode = config.get("permission_mode")
    if mode not in ("build", "edit", "plan", "yolo"):
        raise RunnerError("runner config permission_mode invalid: %r" % (mode,))
    total = config.get("timeout_minutes")
    if isinstance(total, bool) or not isinstance(total, (int, float)) or \
            not math.isfinite(total) or total <= 0:
        raise RunnerError("runner config timeout_minutes must be a finite "
                          "positive number; the controller bounds the total wait")
    idle = config.get("idle_minutes")
    if isinstance(idle, bool) or not isinstance(idle, (int, float)) or \
            not math.isfinite(idle) or idle < 0:
        raise RunnerError("runner config idle_minutes must be a finite "
                          "nonnegative number")
    tokens = config.get("max_output_tokens")
    if isinstance(tokens, bool) or not isinstance(tokens, int) or tokens <= 0:
        raise RunnerError("runner config max_output_tokens must be a positive integer")
    return config


def config_sha256(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def load_runner_config(path, expected_sha256):
    path = pathlib.Path(path)
    actual = config_sha256(path)
    if actual != expected_sha256:
        raise RunnerError("runner config pin mismatch: %s" % path)
    return validate_runner_config(json.loads(
        path.read_text(encoding="utf-8-sig")))


def new_job_id():
    return "job-" + uuid.uuid4().hex


def build_argv(config, batch, title, cwd, prompt_path, log_path):
    if BATCH_RE.fullmatch(batch) is None:
        raise RunnerError("batch id must match [A-Za-z0-9][A-Za-z0-9_-]{0,100}: %r"
                          % (batch,))
    if not isinstance(title, str) or not title.strip():
        raise RunnerError("title must be a nonempty string")
    argv = [config["python_executable"], config["runner_entry"],
            "--batch", batch, "--title", title, "--cwd", str(cwd),
            "--prompt", str(prompt_path), "--log", str(log_path),
            "--provider", config["provider"], "--cli", config["cli"]]
    if config.get("node"):
        argv += ["--node", config["node"]]
    if config.get("db"):
        argv += ["--db", config["db"]]
    argv += ["--home", config["home"],
             "--permission-mode", config["permission_mode"],
             "--timeout-minutes", repr(float(config["timeout_minutes"])),
             "--idle-minutes", repr(float(config["idle_minutes"])),
             "--max-output-tokens", str(config["max_output_tokens"])]
    return argv


def dispatch_wait_seconds(config, timeout_seconds=None):
    """Total bounded wait for one dispatch: the runner budget plus a fixed
    supervisor margin, or an explicit positive test override."""
    if timeout_seconds is not None:
        if isinstance(timeout_seconds, bool) or \
                not isinstance(timeout_seconds, (int, float)) or \
                not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise RunnerError("timeout_seconds must be a finite positive number")
        return float(timeout_seconds)
    return float(config["timeout_minutes"]) * 60.0 + SUPERVISOR_MARGIN_SECONDS


def _section(name, lines):
    return "## " + name + "\n" + "\n".join(lines) + "\n"


def contract_anchor(contract):
    """Deterministic sha256 of the approved contract JSON. Used as the
    prompt example's fact hash so the example cites a real digest instead
    of fabricated evidence."""
    return hashlib.sha256(json.dumps(
        contract, ensure_ascii=False, sort_keys=True,
        separators=(",", ":")).encode("utf-8")).hexdigest()


def build_prompt(contract, *, job_dir, report_path, attempt_no, failure=None):
    """Worker brief from contract fields only; never policy or credentials."""
    example = {
        "schema_version": 1,
        "task_id": contract["task_id"],
        "contract_revision": contract["contract_revision"],
        "base_commit": contract["base_commit"],
        "observed_commit": "<full hex hash of the HEAD you observed when done>",
        "status": "completed",
        "assessment": "local_execution",
        "facts": [{"statement": "shape example only, not a work claim: the sha256 "
                                "below hashes this job's approved contract JSON; "
                                "your real facts must hash the exact bytes of the "
                                "file at path",
                   "path": "<repo-relative/path/of/verified/file>",
                   "line": 1,
                   "sha256": contract_anchor(contract)}],
        "tests": [{"command": "<exact command you ran>", "exit_code": 0,
                   "artifact": "<path or log reference>"}],
        "assumptions": [], "uninspected_areas": [], "unexpected_findings": [],
        "requested_scope": [], "reported_changes": [], "needs_replan": False,
        "artifacts": [],
    }
    parts = [
        "You are an isolated implementation worker for task %s (revision %d)."
        % (contract["task_id"], contract["contract_revision"]),
        _section("Goal", [contract["goal"]]),
        _section("Acceptance", ["- " + item for item in contract["acceptance_criteria"]]),
        _section("Invariants", ["- " + item for item in contract["invariants"]]),
        _section("Allowed scope (repo-relative globs)",
                 ["- " + item for item in contract["allowed_paths"]]),
        _section("Forbidden",
                 ["- " + item for item in contract["forbidden_paths"]] +
                 ["- " + item for item in contract["forbidden_changes"]]),
        _section("Checks the independent verifier will run",
                 ["- " + item for item in contract["acceptance_criteria"]]),
        _section("Known risks", ["- " + item for item in contract["known_risks"]] or ["- none"]),
        _section("Context refs", ["- " + item for item in contract["context_refs"]] or ["- none"]),
    ]
    if attempt_no > 1:
        parts.append("This is repair attempt %d within the same approved contract; "
                     "do not change the acceptance bar." % attempt_no)
    if failure:
        parts.append(_section("Verification failure to repair",
                              ["fingerprint: " + failure["fingerprint"],
                               "failing check: " + failure["check_id"]] +
                              ["original log: " + ref
                               for ref in failure["log_refs"]]))
    parts.append(_section("Required working rules", [
        "- Implement, test, and document within the allowed scope only.",
        "- Finish with a normal git commit of your own changes (you run git add/commit "
        "yourself); leave the worktree clean.",
        "- Do not push, do not merge, do not rebase, and never bypass Git hooks "
        "(no --no-verify, no hook or git-config edits).",
        "- Do not touch files outside the allowed scope, do not weaken or delete "
        "existing tests, do not run interactive or network services.",
        "- If any Mimosa security-scan denial occurs, that is a hard stop: stop all "
        "writes immediately, set needs_replan=true, record the denial verbatim in "
        "unexpected_findings, and do not switch tools or retry the denied action.",
        "- Do not claim success: the independent verifier re-runs the checks and is "
        "the only acceptance authority.",
        "- Write a compact machine-readable report as JSON to: " + str(report_path),
    ]))
    parts.append(_section("Report schema (schema_version=1, every key required)", [
        "- status is exactly one of: completed | partial | failed | needs_replan",
        "- assessment is exactly one of: local_execution | needs_design | "
        "continuous_judgment | unknown",
        "- reported_changes entries, when present, come from: public_api | "
        "database_schema | concurrency | security | core_abstraction | "
        "verification_policy",
        "- facts must cite real repo files: repo-relative path, a real 1-based "
        "line, and the sha256 of the file's exact bytes at citation time; the "
        "verifier recomputes them.",
        "- Replace <...> placeholders with your real observations. The example "
        "shows the happy-path shape; choose the status that matches reality.",
        "REPORT EXAMPLE BEGIN",
        json.dumps(example, ensure_ascii=False, indent=2),
        "REPORT EXAMPLE END",
        "- Facts must reference real files with correct sha256; if new facts require "
        "a larger scope or redesign, set needs_replan=true instead of improvising.",
        "- End your answer with one line: REPORT: <path to the report JSON>"]))
    return "\n\n".join(parts) + "\n"


def _normcase(value):
    return os.path.normcase(str(value))


def _attributed_record(raw, batch, repo, log_path):
    """Return the record only when it provably belongs to this job."""
    if not isinstance(raw, dict) or raw.get("id") != batch:
        return None
    for field, expected in (("worktree", repo), ("logPath", log_path)):
        value = raw.get(field)
        if not isinstance(value, str) or not pathlib.Path(value).is_absolute():
            return None
        if _normcase(value) != _normcase(expected):
            return None
    return raw


def run_job(config, *, task_id, job_id, attempt_no, title, repo, job_dir,
            prompt_text, timeout_seconds=None):
    """Dispatch one worker attempt through the pinned runner; parse the board."""
    wait_seconds = dispatch_wait_seconds(config, timeout_seconds)
    job_dir = pathlib.Path(job_dir)
    repo = pathlib.Path(repo).resolve()
    job_dir = job_dir.resolve()
    if repo == job_dir or repo in job_dir.parents:
        raise RunnerError("job dir must live outside the candidate repo")
    job_dir.mkdir(parents=True, exist_ok=True)
    prompt_path = job_dir / "prompt.md"
    log_path = job_dir / "runner.log"
    report_path = job_dir / REPORT_FILENAME
    if prompt_path.exists() or log_path.exists() or report_path.exists():
        raise RunnerError("job dir already used: %s" % job_dir)
    prompt_path.write_text(prompt_text, encoding="utf-8")
    batch = job_id
    argv = build_argv(config, batch, title, repo, prompt_path, log_path)
    env = dict(os.environ)
    env.update({"ORCH_TASK_ID": task_id, "ORCH_JOB_ID": job_id,
                "ORCH_ATTEMPT_NO": str(attempt_no), "ORCH_JOB_DIR": str(job_dir)})
    dispatch_out = job_dir / "dispatch.out"
    with dispatch_out.open("wb") as output:
        owned = run_owned(argv, str(job_dir), env, output, wait_seconds)
    exit_code = owned["exit_code"]
    failure_kind = owned["failure_kind"]
    cleanup_confirmed = owned["cleanup_confirmed"]
    jobs_path = pathlib.Path(config["home"]) / "jobs" / (batch + ".json")
    record = None
    if jobs_path.is_file():
        try:
            record = _attributed_record(read_input(jobs_path), batch, repo,
                                        str(log_path))
        except (ValueError, OSError):
            record = None
    dispatch_ok = exit_code == 0 and failure_kind is None and cleanup_confirmed
    record_ok = record is not None and record.get("state") == SUCCESS_STATE and \
        type(record.get("exitCode")) is int and record["exitCode"] == 0
    if dispatch_ok and not record_ok:
        failure_kind = "registry_mismatch"
    status = "passed" if dispatch_ok and record_ok else "failed"
    return {"job_id": job_id, "attempt_no": attempt_no, "batch": batch,
            "exit_code": exit_code, "failure_kind": failure_kind,
            "cleanup_confirmed": cleanup_confirmed, "status": status,
            "record": record, "jobs_path": jobs_path,
            "prompt_path": prompt_path, "log_path": log_path,
            "report_path": report_path, "job_dir": job_dir}


def read_worker_report(path, contract):
    path = pathlib.Path(path)
    if not path.is_file():
        raise RunnerError("worker report missing: %s" % path)
    try:
        report = read_input(path)
    except (ValueError, OSError) as error:
        raise RunnerError("worker report unreadable: %s" % error) from error
    try:
        validate_report(report)
    except ValueError as error:
        raise RunnerError("worker report invalid: %s" % error) from error
    if report["task_id"] != contract["task_id"] or \
            report["contract_revision"] != contract["contract_revision"] or \
            report["base_commit"] != contract["base_commit"]:
        raise RunnerError("worker report is bound to a different contract")
    return report
