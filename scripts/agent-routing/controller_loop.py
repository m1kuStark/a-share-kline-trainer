"""ORCH-03 execution loop: leased dispatch, independent verification, bounded repair.

Controller state lives in a control directory outside every candidate repo:
TaskStore (registrations, append-only routing events, leases) plus a
per-task progress snapshot and handoff notes. Every attempt is recorded
as an execution_started event BEFORE the runner is spawned; counts are
always derived from events. Crash leftovers are resolved conservatively
(waiting_control, never a stolen lease, never a blind redispatch).
"""
import json
import os
import pathlib
import secrets
import subprocess
import sys
import uuid
from datetime import datetime, timezone

sys.dont_write_bytecode = True
import route
import routing
import verification
from controller_runner import (RunnerError, build_prompt, load_runner_config,
                               new_job_id, read_worker_report, run_job)
from controller_state import ConflictError, TaskStore
from receipts import ReceiptError
from routing import matches

STAGES = ("registered", "running", "verifying", "verified",
          "waiting_control", "waiting_environment")
TERMINAL = ("verified", "waiting_control", "waiting_environment")
DISPATCH_ROUTES = {"glm_direct", "gpt_plan_glm_execute"}
DISPATCH_ACTION = "execute_contract"


class ControllerError(ValueError):
    """Invalid controller input, configuration, or registration request."""


def _atomic_write_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    tmp.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True,
                              indent=2) + "\n", encoding="utf-8")
    os.replace(str(tmp), str(path))


def _now():
    return datetime.now(timezone.utc).isoformat()


class Controller:
    def __init__(self, store_dir):
        self._root = pathlib.Path(store_dir).resolve()
        self.store = TaskStore(self._root)
        self._tasks = self._root / "tasks"

    def close(self):
        self.store.close()

    # -- paths and shared helpers ----------------------------------------

    def _verification_store(self):
        return self._root / "verification"

    def _task_dir(self, task_id):
        return self._tasks / task_id

    def _progress_path(self, task_id):
        return self._task_dir(task_id) / "progress.json"

    def _read_progress(self, task_id):
        path = self._progress_path(task_id)
        if not path.is_file():
            return {}
        return json.loads(path.read_text(encoding="utf-8-sig"))

    def _write_progress(self, task_id, progress):
        _atomic_write_json(self._progress_path(task_id), progress)

    def _write_handoff(self, task_id, reason, detail, evidence=None):
        handoff = {"task_id": task_id, "created_at": _now(), "reason": reason,
                   "detail": detail, "evidence": evidence or {},
                   "guidance": "Manual or GPT-direct takeover required; "
                               "evidence is preserved under the control store."}
        path = self._task_dir(task_id) / "handoff.json"
        _atomic_write_json(path, handoff)
        return path

    def _load_contract(self, reg):
        actual = verification.sha_file(reg["contract_path"])
        if actual != reg["contract_sha256"]:
            raise ControllerError("contract pin mismatch: %s"
                                  % reg["contract_path"])
        return routing.validate_contract(route.read_input(
            pathlib.Path(reg["contract_path"])))

    def _check_pins(self, reg):
        for field, expected in (("contract_path", reg["contract_sha256"]),
                                ("policy_path", reg["policy_sha256"]),
                                ("runner_config_path",
                                 reg["runner_config_sha256"])):
            if verification.sha_file(reg[field]) != expected:
                raise ControllerError("%s pin mismatch" % field)
        for path, expected in reg["runner_file_hashes"].items():
            if verification.sha_file(path) != expected:
                raise ControllerError("runner file pin mismatch: " + path)
        return self._load_contract(reg), load_runner_config(
            reg["runner_config_path"], reg["runner_config_sha256"])

    def _counts(self, events):
        result = {}
        for event in events:
            result[event["kind"]] = result.get(event["kind"], 0) + 1
        return result

    def _status(self, task_id, stage, blocked_by_lease=False):
        data = self.store.get(task_id)
        progress = self._read_progress(task_id)
        handoff = self._task_dir(task_id) / "handoff.json"
        return {
            "task_id": task_id, "stage": stage, "can_promote": False,
            "counts": self._counts(data["events"]),
            "lease_held": data["lease"] is not None,
            "base_commit": data["registration"]["base_commit"],
            "repo": data["registration"]["repo"],
            "handoff_path": str(handoff) if handoff.is_file() else None,
            "verified": progress.get("verified"),
            "blocked_by_lease": blocked_by_lease,
        }

    # -- registration ----------------------------------------------------

    def register(self, task_id, repo, contract_path, policy_path,
                 runner_config_path, allow=None, *, contract_sha256=None,
                 policy_sha256=None, runner_config_sha256=None):
        if allow is not True:
            raise ControllerError(
                "registration requires explicit allowlist approval (allow=True)")
        try:
            repo = pathlib.Path(repo).resolve()
            toplevel = pathlib.Path(route.git(
                repo, "rev-parse", "--show-toplevel").decode().strip()).resolve()
            if toplevel != repo:
                raise ControllerError("repo must be the Git root: %s" % repo)
            for path in (contract_path, policy_path, runner_config_path):
                verification.external(path, repo)
            verification.external(self._root, repo)
            csha = verification.sha_file(contract_path)
            psha = verification.sha_file(policy_path)
            rsha = verification.sha_file(runner_config_path)
            if (csha, psha, rsha) != (contract_sha256, policy_sha256,
                                      runner_config_sha256):
                raise ControllerError("explicit approved registration hashes required and must match")
            contract = routing.validate_contract(route.read_input(
                pathlib.Path(contract_path)))
            policy = verification.validate_policy(route.read_input(
                pathlib.Path(policy_path)))
            runner_config = load_runner_config(runner_config_path, rsha)
            verification.external(pathlib.Path(__file__).resolve().parent, repo)
            runner_files = {}
            for field in ("python_executable", "runner_entry", "cli", "provider", "node"):
                if runner_config.get(field):
                    path = verification.external(runner_config[field], repo)
                    verification.plain_file(path)
                    runner_files[str(path)] = verification.sha_file(path)
            # These are imported by the existing run_glm adapter. Fake/test
            # runners need no such siblings, but real support code is pinned.
            for name in ("monitor.py", "telemetry.py"):
                path = pathlib.Path(runner_config["runner_entry"]).parent / name
                if path.is_file():
                    runner_files[str(path.resolve())] = verification.sha_file(path)
            verification.external(runner_config["home"], repo)
            if contract["task_id"] != task_id:
                raise ControllerError(
                    "task_id %r does not match contract task_id %r"
                    % (task_id, contract["task_id"]))
            if contract["verification_profile"] not in policy["profiles"]:
                raise ControllerError(
                    "contract verification_profile not registered in policy")
            head = route.git(repo, "rev-parse", "HEAD").decode().strip()
            route.git(repo, "merge-base", "--is-ancestor",
                      contract["base_commit"], head)
            if route.git(repo, "status", "--porcelain"):
                raise ControllerError("dirty baseline; register a clean worktree")
        except ControllerError:
            raise
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            raise ControllerError(str(error)) from error
        registration = {
            "repo": str(repo), "semantic_scopes": list(contract["semantic_scopes"]),
            "contract_sha256": csha, "policy_sha256": psha,
            "base_commit": contract["base_commit"],
            "contract_path": str(pathlib.Path(contract_path).resolve()),
            "policy_path": str(pathlib.Path(policy_path).resolve()),
            "runner_config_path": str(pathlib.Path(runner_config_path).resolve()),
            "runner_config_sha256": rsha, "allowlist_approved": True,
            "runner_file_hashes": runner_files,
        }
        try:
            stored = self.store.register(task_id, registration)
        except ConflictError:
            existing = self.store.get(task_id)["registration"]
            if existing != registration:
                raise
            stored = existing
        registration_owner = secrets.token_hex(16)
        if self.store.acquire(task_id, registration_owner):
            try:
                if not self._progress_path(task_id).exists():
                    self._write_progress(task_id, {"stage": "registered"})
            finally:
                self.store.release(task_id, registration_owner)
        return dict(stored, task_id=task_id, stage="registered")

    # -- execution -------------------------------------------------------

    def run(self, task_id):
        data = self.store.get(task_id)
        reg = data["registration"]
        progress = self._read_progress(task_id)
        repo = pathlib.Path(reg["repo"])
        stage = progress.get("stage", "registered")

        if stage in TERMINAL:
            if stage != "verified":
                return self._status(task_id, stage)
            return self._recheck_verified(task_id, reg, progress)

        try:
            self._check_pins(reg)
        except (ValueError, OSError) as error:
            return self._settle(task_id, reg, progress, "waiting_control",
                                "pin_mismatch", str(error), release=False)

        lease = data["lease"]
        token = secrets.token_hex(16)
        if lease is not None:
            path = self._write_handoff(
                task_id, "lease_held_elsewhere",
                "Lease is held by another owner token; no lock is stolen and "
                "nothing is dispatched. Verify whether that process is alive.",
                {"lease_acquired_at": lease.get("acquired_at")})
            status = self._status(task_id, "waiting_control",
                                  blocked_by_lease=True)
            return status
        if not self.store.acquire(task_id, token):
            return self._status(task_id, progress.get("stage", "registered"),
                                blocked_by_lease=True)

        # Another process may have finished between our initial read and
        # acquiring the lease. Never use that earlier progress snapshot.
        progress = self._read_progress(task_id)
        if progress.get("stage") in TERMINAL:
            self.store.release(task_id, token)
            return self.status(task_id)

        progress.update({"owner_token": token, "stage": "running"})
        self._write_progress(task_id, progress)
        release_at_end = True
        stage = None
        try:
            resolved = set(progress.get("resolved_execution_events", []))
            if progress.get("current_job") or any(
                    event["kind"] == "execution_started" and event["event_id"] not in resolved
                    for event in self.store.get(task_id)["events"]):
                self._write_handoff(
                    task_id, "pending_attempt_unknown_outcome",
                    "A previous run persisted execution_started for job %s and "
                    "died before recording an outcome. The worker may still be "
                    "alive; nothing is redispatched." % progress.get("current_job", "unknown"),
                    {"job_id": progress.get("current_job")})
                release_at_end = False
                progress["stage"] = "waiting_control"
                self._write_progress(task_id, progress)
                return self._status(task_id, "waiting_control")
            stage = self._attempt_loop(task_id, reg, repo, progress)
        except BaseException:
            release_at_end = False
            raise
        finally:
            progress = self._read_progress(task_id)
            if stage in STAGES:
                progress["stage"] = stage
                self._write_progress(task_id, progress)
            if release_at_end and not progress.get("uncertain_process"):
                try:
                    self.store.release(task_id, token)
                except ConflictError:
                    pass
        return self._status(task_id, progress.get("stage", "waiting_control"))

    def _attempt_loop(self, task_id, reg, repo, progress):
        while True:
            events = self.store.get(task_id)["events"]
            contract, runner_config = self._check_pins(reg)
            base = contract["base_commit"]
            observed = route.observe(repo, base)
            try:
                snapshot = verification.snapshot_repo(repo, observed["head"], base)
                policy = verification.pinned(reg["policy_path"], reg["policy_sha256"], repo)
                verification.guard_scope(snapshot, contract, policy, repo)
            except (ValueError, OSError, subprocess.SubprocessError) as error:
                self._write_handoff(task_id, "candidate_not_ready", str(error))
                return "waiting_control"
            report = self._bound_report(progress, contract, observed["head"])
            decision = routing.decide(contract, observed, report, events)
            if decision["route"] not in DISPATCH_ROUTES or \
                    decision["next_action"] != DISPATCH_ACTION:
                if decision["next_action"] == "waiting_environment":
                    self._write_handoff(task_id, "environment_budget_exhausted",
                                        "; ".join(decision["reason_codes"]))
                    return "waiting_environment"
                self._write_handoff(
                    task_id, "route_not_automatable",
                    "route=%s next_action=%s reasons=%s"
                    % (decision["route"], decision["next_action"],
                       ",".join(decision["reason_codes"])),
                    {"decision": {k: decision[k] for k in
                                  ("route", "next_action", "reason_codes")}})
                return "waiting_control"

            attempt_no = self._counts(events).get("execution_started", 0) + 1
            job_id = new_job_id()
            event = {"event_id": "exec-" + job_id, "kind": "execution_started",
                     "task_id": task_id, "job_id": job_id,
                     "attempt_no": attempt_no, "before_sha": observed["head"],
                     "route": decision["route"]}
            if not self.store.append_event(task_id, event):
                self._write_handoff(
                    task_id, "pending_attempt_unknown_outcome",
                    "execution_started for %s already existed without an "
                    "outcome; nothing is redispatched." % job_id)
                return "waiting_control"
            progress.update({"current_job": job_id, "stage": "running"})
            self._write_progress(task_id, progress)

            job_dir = self._task_dir(task_id) / "attempts" / str(attempt_no)
            prompt = build_prompt(contract, job_dir=job_dir,
                                  report_path=job_dir / "worker_report.json",
                                  attempt_no=attempt_no,
                                  failure=progress.get("failure_context"))
            if progress.get("control_resolution_reason"):
                prompt += ("\nControl-plane resolution from the authorized operator:\n" +
                           progress["control_resolution_reason"] +
                           "\nThe original task scope and attempt budgets still apply.\n")
            result = run_job(runner_config, task_id=task_id, job_id=job_id,
                             attempt_no=attempt_no,
                             title="%s attempt %d" % (task_id, attempt_no),
                             repo=repo, job_dir=job_dir, prompt_text=prompt)
            outcome_path = job_dir / "outcome.json"
            if outcome_path.exists():
                raise ControllerError("attempt outcome already exists; refusing to replace evidence")
            try:
                after_sha = route.git(repo, "rev-parse", "HEAD").decode().strip()
            except (OSError, subprocess.SubprocessError):
                after_sha = None
            record = result.get("record") or {}
            _atomic_write_json(outcome_path, {
                "task_id": task_id, "job_id": job_id, "attempt_no": attempt_no,
                "before_sha": observed["head"], "after_sha": after_sha,
                "exit_code": result["exit_code"], "finished_at": _now(),
                "cleanup_confirmed": result.get("cleanup_confirmed") is True,
                "failure_kind": result.get("failure_kind"),
                "runner_state": record.get("state"),
                "session_id": record.get("sessionId"),
                "jobs_path": str(result["jobs_path"]),
                "log_path": str(result["log_path"]),
                "report_path": str(result["report_path"])})
            if result.get("cleanup_confirmed") is not True:
                progress["uncertain_process"] = True
                self._write_progress(task_id, progress)
                self._write_handoff(task_id, "process_cleanup_unconfirmed",
                                    "Worker descendants may remain; retain lease and do not redispatch.")
                return "waiting_control"
            outcome = self._worker_outcome(repo, base, observed["head"],
                                           result, contract)
            if outcome[0] == "fault":
                self._write_handoff(task_id, outcome[1], outcome[2], {
                    "job_dir": str(result["job_dir"]),
                    "runner_log": str(result["log_path"]),
                    "jobs_path": str(result["jobs_path"])})
                return "waiting_control"
            if outcome[0] == "escalation":
                self._write_handoff(task_id, "worker_escalation", outcome[2], {
                    "report": str(result["report_path"]),
                    "job_dir": str(result["job_dir"])})
                return "waiting_control"
            report = outcome[1]
            progress.update({"report_path": str(result["report_path"]),
                             "stage": "verifying"})
            self._write_progress(task_id, progress)

            stage = self._verify_and_classify(task_id, reg, repo, progress,
                                              result, report)
            if stage is not None:
                return stage
            progress.update({"current_job": None, "stage": "running"})
            self._write_progress(task_id, progress)

    def _bound_report(self, progress, contract, head):
        path = progress.get("report_path")
        if not path:
            return None
        try:
            report = read_worker_report(path, contract)
        except (RunnerError, OSError):
            return None
        return report if report["observed_commit"] == head else None

    def _worker_outcome(self, repo, base, before_sha, result, contract):
        def fault(kind, detail):
            return ("fault", kind, detail)

        if result.get("status") != "passed" or result.get("failure_kind") is not None:
            return fault("runner_failed", str(result.get("failure_kind") or "unknown runner outcome"))
        if result["exit_code"] != 0:
            return fault("runner_exit_nonzero",
                         "runner exit_code=%r" % (result["exit_code"],))
        record = result["record"]
        if record is None:
            return fault("jobs_record_missing", str(result["jobs_path"]))
        if (record.get("state") != "completed" or
                type(record.get("exitCode")) is not int or record["exitCode"] != 0):
            return fault("worker_failed",
                         "jobs state=%r error=%r"
                         % (record.get("state"), record.get("error")))
        try:
            observed = route.observe(repo, base)
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            return fault("observation_failed", str(error))
        head = observed["head"]
        if head == before_sha:
            return fault("no_commit", "HEAD unchanged after the attempt")
        try:
            route.git(repo, "merge-base", "--is-ancestor", before_sha, head)
        except subprocess.SubprocessError:
            return fault("not_descendant",
                         "%s is not an ancestor of %s" % (before_sha, head))
        if observed["worktree_dirty"]:
            return fault("dirty_exit", "worktree left dirty by the worker")
        violations = [p for p in observed["changed_paths"]
                      if not any(matches(p, a) for a in contract["allowed_paths"])
                      or any(matches(p, f) for f in contract["forbidden_paths"])]
        if violations:
            return fault("scope_violation", ", ".join(violations))
        try:
            report = read_worker_report(result["report_path"], contract)
        except (RunnerError, OSError) as error:
            return fault("worker_report_invalid", str(error))
        if report["observed_commit"] != head:
            return fault("stale_report", "report does not match new HEAD")
        if (report["status"] != "completed" or
                report["assessment"] != "local_execution" or
                not report["facts"] or report["uninspected_areas"] or report["assumptions"]):
            return ("escalation", "incomplete_worker_evidence",
                    "worker requires further judgment or lacks complete evidence")
        if report["needs_replan"] or report["status"] == "needs_replan" or \
                report["assessment"] == "needs_design" or \
                report["requested_scope"] or report["unexpected_findings"]:
            return ("escalation", "worker_escalation",
                    "worker requested replan/design/scope expansion")
        observed["invalid_fact_refs"] = route.verify_fact_refs(repo, report)
        # Completion risks must be evaluated even on the last allowed
        # attempt. Attempt budgets govern dispatch, not acceptance of a
        # successfully completed final attempt.
        decision = routing.decide(contract, observed, report, history=[])
        if (decision["route"] not in DISPATCH_ROUTES or
                decision["next_action"] != DISPATCH_ACTION):
            return ("escalation", "worker_escalation",
                    ",".join(decision["reason_codes"]))
        return ("ok", report, None)

    def _verify_and_classify(self, task_id, reg, repo, progress, result, report):
        vstore = self._verification_store()
        try:
            self._check_pins(reg)
        except (ValueError, OSError) as error:
            self._write_handoff(task_id, "pin_mismatch", str(error))
            return "waiting_control"
        try:
            receipt = verification.run_verification(
                repo, reg["contract_path"], reg["contract_sha256"],
                reg["policy_path"], reg["policy_sha256"], vstore,
                report["observed_commit"])
            evidence = verification.verify_evidence(
                repo, reg["contract_path"], reg["contract_sha256"],
                reg["policy_path"], reg["policy_sha256"], vstore, receipt)
            self._check_pins(reg)
        except (ValueError, ReceiptError) as error:
            self._write_handoff(task_id, "verification_integrity_failure", str(error))
            return "waiting_control"
        except (OSError, subprocess.SubprocessError) as error:
            self.store.append_event(task_id, {
                "event_id": "env-" + result["job_id"],
                "kind": "environment_failure", "task_id": task_id,
                "job_id": result["job_id"], "error": str(error)[:500]})
            return None
        evidence_ref = {"run_id": evidence["run_id"],
                        "receipt": str(receipt), "status": evidence["status"]}
        if evidence["status"] == "passed":
            self.store.append_event(task_id, {
                "event_id": "vp-" + evidence["run_id"],
                "kind": "verification_passed", "task_id": task_id,
                "job_id": result["job_id"], "run_id": evidence["run_id"],
                "receipt": str(receipt),
                "tested_commit": evidence["tested_commit"]})
            progress.update({
                "verified": {"tested_commit": evidence["tested_commit"],
                             "receipt_path": str(receipt),
                             "run_id": evidence["run_id"],
                             "contract_sha256": reg["contract_sha256"],
                             "policy_sha256": reg["policy_sha256"],
                             "runner_config_sha256": reg["runner_config_sha256"]},
                "current_job": None, "failure_context": None})
            self._write_progress(task_id, progress)
            return "verified"
        if evidence["status"] == "blocked":
            self._write_handoff(task_id, "verification_blocked",
                                str(evidence.get("reason")), evidence_ref)
            return "waiting_control"
        fingerprint = evidence.get("failure_fingerprint")
        if not fingerprint:
            fingerprint = route.digest({"reason": evidence.get("reason")})
        failing = [c for c in evidence["checks"] if c.get("status") != "passed"]
        if failing and any(c.get("failure_kind") == "environment"
                           for c in failing):
            self.store.append_event(task_id, {
                "event_id": "env-" + evidence["run_id"],
                "kind": "environment_failure", "task_id": task_id,
                "job_id": result["job_id"], "run_id": evidence["run_id"],
                "failure_fingerprint": fingerprint})
            return None
        events = self.store.get(task_id)["events"]
        prior = any(e["kind"] in ("failure", "repair_failed") for e in events)
        kind = "repair_failed" if prior else "failure"
        self.store.append_event(task_id, {
            "event_id": "fail-" + evidence["run_id"], "kind": kind,
            "task_id": task_id, "job_id": result["job_id"],
            "run_id": evidence["run_id"], "receipt": str(receipt),
            "failure_fingerprint": fingerprint})
        progress["failure_context"] = {
            "fingerprint": fingerprint,
            "check_id": failing[0]["id"] if failing else "unknown",
            "log_refs": [str(vstore / c["log_path"])
                         for c in failing if c.get("log_path")]}
        return None

    def _recheck_verified(self, task_id, reg, progress):
        try:
            self._check_pins(reg)
            evidence = verification.verify_evidence(
                pathlib.Path(reg["repo"]), reg["contract_path"],
                reg["contract_sha256"], reg["policy_path"],
                reg["policy_sha256"], self._verification_store(),
                progress["verified"]["receipt_path"])
            if evidence["status"] != "passed":
                raise ControllerError("authenticated verification is not passed")
            return self._status(task_id, "verified")
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            return self._settle(task_id, reg, progress, "waiting_control",
                                "verified_binding_lost", str(error),
                                release=False)

    def _settle(self, task_id, reg, progress, stage, reason, detail,
                release=False):
        path = self._write_handoff(task_id, reason, detail)
        progress = self._read_progress(task_id)
        progress["stage"] = stage
        self._write_progress(task_id, progress)
        if release:
            token = progress.get("owner_token")
            if token:
                try:
                    self.store.release(task_id, token)
                except ConflictError:
                    pass
        return self._status(task_id, stage)

    # -- manual recovery -------------------------------------------------

    def resume(self, task_id, *, allow=False, expected_commit=None, reason=None):
        """Explicit control-plane resolution of a finished, blocked attempt.

        Never clears history or releases another process's lease. An
        unfinished/crashed process requires separate manual investigation.
        """
        if allow is not True or not isinstance(reason, str) or not reason.strip() or len(reason) > 1000:
            raise ControllerError("resume requires explicit approval and a bounded resolution reason")
        data = self.store.get(task_id)
        if data["lease"] is not None:
            raise ControllerError("cannot resume while a lease exists")
        token = secrets.token_hex(16)
        if not self.store.acquire(task_id, token):
            raise ControllerError("task or semantic scope is owned elsewhere")
        try:
            data = self.store.get(task_id)
            reg = data["registration"]
            progress = self._read_progress(task_id)
            if progress.get("stage") not in ("waiting_control", "waiting_environment"):
                raise ControllerError("only a blocked task can be explicitly resumed")
            contract, _ = self._check_pins(reg)
            starts = [e for e in data["events"] if e["kind"] == "execution_started"]
            if not starts:
                raise ControllerError("no completed attempt exists to resolve")
            last = starts[-1]
            attempt = last.get("attempt_no")
            if type(attempt) is not int or attempt < 1:
                raise ControllerError("attempt identity is incomplete")
            outcome = route.read_input(self._task_dir(task_id) / "attempts" / str(attempt) / "outcome.json")
            if (outcome.get("task_id") != task_id or outcome.get("job_id") != last["job_id"] or
                    outcome.get("attempt_no") != attempt or outcome.get("cleanup_confirmed") is not True or
                    outcome.get("after_sha") != expected_commit):
                raise ControllerError("finished attempt identity, cleanup or expected commit is not confirmed")
            repo = pathlib.Path(reg["repo"])
            state = verification.snapshot_repo(repo, expected_commit, reg["base_commit"])
            policy = verification.pinned(reg["policy_path"], reg["policy_sha256"], repo)
            verification.guard_scope(state, contract, policy, repo)
            resolution = {"event_id": "resume-" + uuid.uuid4().hex, "kind": "replan",
                          "task_id": task_id, "job_id": last["job_id"],
                          "reason": reason, "expected_commit": expected_commit,
                          "source_digest": state["source_digest"]}
            self.store.append_event(task_id, resolution)
            progress.update(stage="registered", current_job=None, report_path=None,
                            failure_context=None, uncertain_process=False,
                            resolved_execution_events=[e["event_id"] for e in starts],
                            control_resolution_reason=reason,
                            last_control_resolution=resolution["event_id"])
            self._write_progress(task_id, progress)
        except ControllerError:
            raise
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            raise ControllerError(str(error)) from error
        finally:
            self.store.release(task_id, token)
        return self._status(task_id, "registered")

    def recover(self, task_id):
        raise ControllerError(
            "automatic lease recovery is unavailable; confirm the original "
            "process tree is stopped before control-layer manual recovery")

    def status(self, task_id):
        data = self.store.get(task_id)
        progress = self._read_progress(task_id)
        stage = progress.get("stage", "registered")
        if stage == "verified":
            return self._recheck_verified(task_id,
                                          data["registration"], progress)
        return self._status(task_id, stage)
