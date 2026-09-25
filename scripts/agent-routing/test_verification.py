import hashlib
import json
import pathlib
import subprocess
import sys
import time
import tempfile
import unittest

from test_routing import contract
from verification import run_verification, verify_evidence, snapshot_repo, validate_policy


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()


class VerificationFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="verifier-case-")
        self.root = pathlib.Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Verifier Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "core.hooksPath", str(self.root / "empty-hooks"))
        self.git("config", "core.autocrlf", "false")
        (self.repo / "check.py").write_text("print('all checks passed')\n", encoding="utf-8")
        (self.repo / "app.py").write_text("value = 1\n", encoding="utf-8")
        self.commit()
        self.base = self.head
        self.cpath = self.root / "contract.json"
        self.ppath = self.root / "policy.json"
        self.store = self.root / "control-store"
        self.c = contract(task_id="VERIFY-01", base_commit=self.base,
                          allowed_paths=["**"], task_shape="designed",
                          verification_profile="fixture")
        self.policy = {
            "schema_version": 1, "policy_id": "fixture-policy", "revision": 1,
            "executables": {"python": sys.executable},
            "protected_paths": ["check.py", "test_*.py"],
            "allow_added_tests": ["test_*.py"],
            "approved_protected_files": {},
            "profiles": {"fixture": {"checks": [
                {"id": "behavior", "executable": "python",
                 "args": ["-B", "check.py"], "timeout_seconds": 5}
            ]}},
        }
        self.pins()

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo, text=True,
                                       stderr=subprocess.PIPE).strip()

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture update")
        self.head = self.git("rev-parse", "HEAD")

    def pins(self):
        self.csha = write_json(self.cpath, self.c)
        self.psha = write_json(self.ppath, self.policy)

    def run_checks(self):
        return run_verification(self.repo, self.cpath, self.csha, self.ppath,
                                self.psha, self.store, self.head)

    def read_receipt(self, path):
        return json.loads(path.read_text(encoding="utf-8"))["report"]

    def checked(self, path):
        return verify_evidence(self.repo, self.cpath, self.csha, self.ppath,
                               self.psha, self.store, path)


class VerificationTests(VerificationFixture, unittest.TestCase):
    def test_success_has_bound_code_configuration_and_full_log_evidence(self):
        receipt = self.run_checks()
        result = self.checked(receipt)
        self.assertEqual("passed", result["status"])
        self.assertEqual(self.head, result["tested_commit"])
        self.assertEqual(self.csha, result["contract_sha256"])
        self.assertEqual(self.psha, result["policy_sha256"])
        self.assertEqual(0, result["checks"][0]["exit_code"])
        log = self.store / result["checks"][0]["log_path"]
        self.assertIn("all checks passed", log.read_text())
        self.assertFalse(result["can_promote"])

    def test_nonzero_command_records_failure_and_stable_fingerprint(self):
        self.policy["profiles"]["fixture"]["checks"][0]["args"] = [
            "-c", "import sys; print('AssertionError: expected correct price'); sys.exit(3)"]
        self.pins()
        one = self.checked(self.run_checks())
        two = self.checked(self.run_checks())
        self.assertEqual("failed", one["status"])
        self.assertEqual(3, one["checks"][0]["exit_code"])
        self.assertEqual(one["failure_fingerprint"], two["failure_fingerprint"])

    def test_worker_fake_pass_and_tampered_receipt_are_rejected(self):
        receipt = self.run_checks()
        envelope = json.loads(receipt.read_text())
        envelope["report"]["status"] = "forged"
        receipt.write_text(json.dumps(envelope))
        with self.assertRaises(ValueError):
            self.checked(receipt)
        fake = self.root / "worker-passed.json"
        write_json(fake, {"status": "passed", "checks": []})
        with self.assertRaises(ValueError):
            self.checked(fake)

    def test_missing_or_modified_log_invalidates_pass(self):
        for modification in ("replace", "remove"):
            receipt = self.run_checks()
            log = self.store / self.read_receipt(receipt)["checks"][0]["log_path"]
            if modification == "replace":
                log.write_text("invented pass")
            else:
                log.unlink()
            with self.subTest(modification=modification), self.assertRaises(ValueError):
                self.checked(receipt)

    def test_dirty_candidate_is_blocked_without_executing_checks(self):
        (self.repo / "app.py").write_text("value = 2\n")
        result = self.read_receipt(self.run_checks())
        self.assertEqual("blocked", result["status"])
        self.assertEqual([], result["checks"])
        self.assertIn("dirty", result["reason"])

    def test_old_commit_cannot_reuse_a_pass(self):
        receipt = self.run_checks()
        (self.repo / "app.py").write_text("value = 2\n")
        self.commit()
        with self.assertRaises(ValueError):
            self.checked(receipt)

    def test_modifying_or_deleting_existing_test_requires_explicit_approval(self):
        (self.repo / "check.py").write_text("print('weaker test')\n")
        self.commit()
        result = self.read_receipt(self.run_checks())
        self.assertEqual("blocked", result["status"])
        self.assertIn("protected", result["reason"])
        (self.repo / "check.py").unlink()
        self.commit()
        self.assertEqual("blocked", self.read_receipt(self.run_checks())["status"])

    def test_adding_tests_is_allowed_and_exact_reviewed_test_change_can_pass(self):
        (self.repo / "test_extra.py").write_text("assert 2 + 2 == 4\n")
        self.commit()
        self.assertEqual("passed", self.checked(self.run_checks())["status"])
        (self.repo / "check.py").write_text("assert 1 == 1\n")
        self.commit()
        self.policy["approved_protected_files"]["check.py"] = hashlib.sha256(
            (self.repo / "check.py").read_bytes()).hexdigest()
        self.pins()
        self.assertEqual("passed", self.checked(self.run_checks())["status"])

    def test_policy_and_contract_pin_mismatch_refuses_to_run(self):
        self.c["goal"] = "changed after approval"
        write_json(self.cpath, self.c)
        with self.assertRaises(ValueError):
            self.run_checks()
        self.pins()
        self.policy["profiles"]["fixture"]["checks"] = []
        write_json(self.ppath, self.policy)
        with self.assertRaises(ValueError):
            self.run_checks()

    def test_executable_and_control_files_must_be_outside_candidate(self):
        internal = self.repo / "contract.json"
        internal.write_bytes(self.cpath.read_bytes())
        with self.assertRaises(ValueError):
            run_verification(self.repo, internal, self.csha, self.ppath,
                             self.psha, self.store, self.head)
        self.policy["executables"]["python"] = str(self.repo / "bad.exe")
        self.pins()
        with self.assertRaises(ValueError):
            self.run_checks()

    def test_source_mutation_during_check_never_signs_a_pass(self):
        self.policy["profiles"]["fixture"]["checks"][0]["args"] = [
            "-c", "from pathlib import Path; Path('app.py').write_text('mutated')"]
        self.pins()
        result = self.read_receipt(self.run_checks())
        self.assertNotEqual("passed", result["status"])
        self.assertIn("changed", result["reason"])

    def test_timeout_is_bounded_and_retains_failure_log(self):
        self.policy["profiles"]["fixture"]["checks"][0].update(
            args=["-c", "import time; print('starting', flush=True); time.sleep(60)"],
            timeout_seconds=0.2)
        self.pins()
        result = self.read_receipt(self.run_checks())
        self.assertEqual("failed", result["status"])
        self.assertEqual("timeout", result["checks"][0]["failure_kind"])
        self.assertIsNotNone(result["failure_fingerprint"])

    def test_check_receives_explicit_isolated_database_and_no_tdx_root(self):
        self.policy["profiles"]["fixture"]["checks"][0]["args"] = [
            "-c", "import os; assert os.environ['TRAINER_DB']; "
                  "assert os.environ['OPEN_BROWSER']=='0'; "
                  "assert not os.environ.get('TDX_ROOT')"]
        self.pins()
        self.assertEqual("passed", self.checked(self.run_checks())["status"])

    def test_policy_rejects_empty_profile_and_shell_shaped_command(self):
        self.policy["profiles"]["fixture"]["checks"] = []
        with self.assertRaises(ValueError):
            validate_policy(self.policy)
        self.policy["profiles"]["fixture"]["checks"] = [
            {"id": "x", "executable": "python", "args": "echo unsafe", "timeout_seconds": 3}]
        with self.assertRaises(ValueError):
            validate_policy(self.policy)

    def test_snapshot_matches_actual_bytes_and_commit(self):
        state = snapshot_repo(self.repo, self.head, self.base)
        self.assertEqual(self.head, state["head"])
        self.assertEqual(hashlib.sha256((self.repo / "app.py").read_bytes()).hexdigest(),
                         state["files"]["app.py"])
        self.assertEqual([], state["changed_paths"])

    def test_git_assume_unchanged_cannot_hide_weakened_baseline_test(self):
        self.git("update-index", "--assume-unchanged", "check.py")
        (self.repo / "check.py").write_text("print('weakened')\n")
        result = self.read_receipt(self.run_checks())
        self.assertEqual("blocked", result["status"])
        self.assertEqual([], result["checks"])

    def test_git_skip_worktree_cannot_hide_changed_source(self):
        self.git("update-index", "--skip-worktree", "app.py")
        (self.repo / "app.py").write_text("value = 999\n")
        result = self.read_receipt(self.run_checks())
        self.assertEqual("blocked", result["status"])

    def test_later_check_cannot_rewrite_an_earlier_check_log(self):
        self.policy["profiles"]["fixture"]["checks"].append({
            "id": "tamper", "executable": "python", "timeout_seconds": 5,
            "args": ["-c", "import os; from pathlib import Path; "
                     "(Path(os.environ['TRAINER_DB']).parent/'behavior.log').write_text('forged')"]})
        self.pins()
        result = self.read_receipt(self.run_checks())
        self.assertNotEqual("passed", result["status"])

    def test_normal_parent_exit_does_not_leave_a_background_writer(self):
        child_code = "import os,time; from pathlib import Path; time.sleep(1); " \
                     "(Path(os.environ['TRAINER_DB']).parent/'late.txt').write_text('late')"
        parent_code = "import subprocess,sys; subprocess.Popen([sys.executable,'-c'," + \
                      repr(child_code) + "],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)"
        self.policy["profiles"]["fixture"]["checks"][0]["args"] = ["-c", parent_code]
        self.pins()
        result = self.read_receipt(self.run_checks())
        time.sleep(1.2)
        self.assertFalse((self.store / "runs" / result["run_id"] / "late.txt").exists())
        self.assertNotEqual("passed", result["status"])


if __name__ == "__main__":
    unittest.main()
