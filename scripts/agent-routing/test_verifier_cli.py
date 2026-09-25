import json
import pathlib
import subprocess
import sys
import unittest

from test_verification import VerificationFixture

VERIFY_CLI = pathlib.Path(__file__).with_name("verify.py")
ROUTE_CLI = pathlib.Path(__file__).with_name("route.py")


class VerifierCliTests(VerificationFixture, unittest.TestCase):
    def command(self, action, *extra):
        return subprocess.run([
            sys.executable, "-B", str(VERIFY_CLI), action,
            "--repo", str(self.repo), "--contract", str(self.cpath),
            "--contract-sha256", self.csha, "--policy", str(self.ppath),
            "--policy-sha256", self.psha, "--store", str(self.store), *extra
        ], capture_output=True, text=True)

    def test_cli_help_describes_explicit_execution_and_receipt_check(self):
        result = subprocess.run([sys.executable, "-B", str(VERIFY_CLI), "--help"],
                                capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("inspect", result.stdout)
        self.assertIn("run", result.stdout)

    def test_router_declares_authenticated_receipt_inputs(self):
        result = subprocess.run([sys.executable, "-B", str(ROUTE_CLI), "--help"],
                                capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("--receipt-store", result.stdout)
        self.assertIn("--policy-sha256", result.stdout)

    def test_cli_run_and_inspect_bind_a_real_temporary_commit(self):
        result = self.command("run", "--expected-commit", self.head)
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual("passed", payload["status"])
        checked = self.command("inspect", "--receipt", payload["receipt"])
        self.assertEqual(0, checked.returncode, checked.stderr)
        self.assertTrue(json.loads(checked.stdout)["authenticated"])

    def test_router_rejects_unsigned_pass_and_consumes_authenticated_result(self):
        run = self.command("run", "--expected-commit", self.head)
        self.assertEqual(0, run.returncode, run.stderr)
        receipt = json.loads(run.stdout)["receipt"]
        output = self.root / "route.json"
        args = [sys.executable, "-B", str(ROUTE_CLI), "--repo", str(self.repo),
                "--contract", str(self.cpath), "--contract-sha256", self.csha,
                "--policy", str(self.ppath), "--policy-sha256", self.psha,
                "--receipt-store", str(self.store), "--receipt", receipt, "--out", str(output)]
        result = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        decision = json.loads(output.read_text())
        self.assertEqual("passed", decision["verification_status"])
        self.assertEqual("review_by_risk", decision["next_action"])
        self.assertFalse(decision["can_promote"])
        fake = self.root / "fake.json"
        fake.write_text('{"status":"passed"}')
        args[args.index("--receipt") + 1] = str(fake)
        args[args.index("--out") + 1] = str(self.root / "bad-route.json")
        self.assertNotEqual(0, subprocess.run(args, capture_output=True).returncode)

    def test_router_failure_provides_repair_evidence_instead_of_a_pass(self):
        self.policy["profiles"]["fixture"]["checks"][0]["args"] = [
            "-c", "import sys; print('AssertionError: price mismatch'); sys.exit(1)"]
        self.pins()
        receipt = self.run_checks()
        output = self.root / "failure-route.json"
        result = subprocess.run([
            sys.executable, "-B", str(ROUTE_CLI), "--repo", str(self.repo),
            "--contract", str(self.cpath), "--contract-sha256", self.csha,
            "--policy", str(self.ppath), "--policy-sha256", self.psha,
            "--receipt-store", str(self.store), "--receipt", str(receipt), "--out", str(output)
        ], capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        decision = json.loads(output.read_text())
        self.assertEqual("failed", decision["verification_status"])
        self.assertEqual("repair_contract", decision["next_action"])
        self.assertTrue(decision["failure_fingerprint"])


if __name__ == "__main__":
    unittest.main()
