import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

from test_routing import contract, report

CLI = pathlib.Path(__file__).with_name("route.py")


class CommandLineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="route-test-")
        self.root = pathlib.Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Routing Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "core.hooksPath", str(self.root / "empty-hooks"))
        (self.repo / "web").mkdir()
        self.source = self.repo / "web/label.ts"
        self.source.write_text("export const label = 'A'\n", encoding="utf-8")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.head = self.git("rev-parse", "HEAD").strip()
        self.contract = self.root / "contract.json"
        self.contract.write_text(json.dumps(contract(base_commit=self.head)), encoding="utf-8")
        self.out = self.root / "decision.json"
        self.cli = CLI

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo, text=True,
                                       stderr=subprocess.PIPE)

    def run_cli(self, *extra):
        return subprocess.run([sys.executable, str(self.cli), "--repo", str(self.repo),
                               "--contract", str(self.contract), "--out", str(self.out), *extra],
                              capture_output=True, text=True)

    def test_observes_untracked_violation_without_changing_repository(self):
        (self.repo / "outside.txt").write_text("unexpected", encoding="utf-8")
        before = self.git("status", "--porcelain")
        run = self.run_cli()
        self.assertEqual(0, run.returncode, run.stderr)
        result = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertIn("outside.txt", result["scope_violations"])
        self.assertEqual(before, self.git("status", "--porcelain"))
        self.assertFalse(result["can_dispatch"])
        self.assertEqual("gpt_plan_glm_execute", result["route"])

    def test_staged_change_is_seen_even_if_working_copy_restores_baseline(self):
        self.git("add", ".")
        self.git("show", "HEAD:web/label.ts")
        original = self.source.read_text(encoding="utf-8")
        self.source.write_text("export const label = 'B'\n", encoding="utf-8")
        self.git("add", ".")
        self.source.write_text(original, encoding="utf-8")
        run = self.run_cli()
        self.assertEqual(0, run.returncode, run.stderr)
        self.assertIn("web/label.ts", json.loads(self.out.read_text())["changed_paths"])

    def test_hash_checked_scout_reference_can_route_local_work(self):
        r = report(base_commit=self.head, observed_commit=self.head)
        r["facts"][0]["sha256"] = hashlib.sha256(self.source.read_bytes()).hexdigest()
        report_path = self.root / "scout.json"
        report_path.write_text(json.dumps(r), encoding="utf-8")
        run = self.run_cli("--report", str(report_path))
        self.assertEqual(0, run.returncode, run.stderr)
        self.assertEqual("glm_direct", json.loads(self.out.read_text())["route"])

    def test_changed_fact_content_cannot_downgrade_to_direct(self):
        r = report(base_commit=self.head, observed_commit=self.head)
        report_path = self.root / "scout.json"
        report_path.write_text(json.dumps(r), encoding="utf-8")
        run = self.run_cli("--report", str(report_path))
        self.assertEqual(0, run.returncode, run.stderr)
        result = json.loads(self.out.read_text())
        self.assertIn("stale_report", result["reason_codes"])
        self.assertIn("web/label.ts", result["invalid_fact_refs"])

    def test_existing_output_is_preserved_and_repo_output_is_refused(self):
        self.out.write_text("sentinel", encoding="utf-8")
        self.assertNotEqual(0, self.run_cli().returncode)
        self.assertEqual("sentinel", self.out.read_text())
        self.out = self.repo / "decision.json"
        self.assertNotEqual(0, self.run_cli().returncode)
        self.assertFalse(self.out.exists())

    def test_json_duplicate_keys_and_invalid_history_fail_explicitly(self):
        self.contract.write_text('{"schema_version":1,"schema_version":2}', encoding="utf-8")
        run = self.run_cli()
        self.assertNotEqual(0, run.returncode)
        self.assertIn("duplicate", run.stderr.lower())
        self.assertFalse(self.out.exists())

    def test_cli_does_not_write_bytecode_into_its_own_directory(self):
        tools = self.root / "controller"
        tools.mkdir()
        for name in ("route.py", "routing.py"):
            (tools / name).write_bytes(CLI.with_name(name).read_bytes())
        self.cli = tools / "route.py"
        run = self.run_cli()
        self.assertEqual(0, run.returncode, run.stderr)
        self.assertFalse((tools / "__pycache__").exists())

    def test_dirty_worktree_rejects_clean_scout_even_when_fact_is_unchanged(self):
        r = report(base_commit=self.head, observed_commit=self.head)
        r["facts"][0]["sha256"] = hashlib.sha256(self.source.read_bytes()).hexdigest()
        report_path = self.root / "scout.json"
        report_path.write_text(json.dumps(r), encoding="utf-8")
        (self.repo / "web/other.ts").write_text("new behavior", encoding="utf-8")
        run = self.run_cli("--report", str(report_path))
        self.assertEqual(0, run.returncode, run.stderr)
        self.assertNotEqual("glm_direct", json.loads(self.out.read_text())["route"])


if __name__ == "__main__":
    unittest.main()
