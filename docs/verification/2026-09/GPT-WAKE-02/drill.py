# -*- coding: utf-8 -*-
"""GPT-WAKE-02 真实端到端演练：合成任务经控制器自动派发到 pinned Codex 会话。

在仓库外临时目录构建：候选 git 仓库（app.py 值为 0，check.py 断言为 1）、
合同（continuous_judgment → gpt_direct/take_over）、policy（gpt_dispatch=true）、
runner config v2（gpt 段指向真实 run_codex.py 与用户 Desktop 中枢会话）。
然后 controller.py register + run。预期终态 verified。
"""
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
CONTROLLER = REPO_ROOT / "scripts" / "agent-routing" / "controller.py"
RUN_CODEX = REPO_ROOT / "scripts" / "agent-monitor" / "run_codex.py"
SESSION_ID = "01a0d79e-979c-7b80-a28a-448eefa402ca"
BRIDGE_HOME = pathlib.Path.home() / ".codex" / "headroom-cache" / "codex-bridge"


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=str(cwd), check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def main():
    root = pathlib.Path(tempfile.mkdtemp(prefix="gpt-wake-drill-"))
    repo = root / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    for setting in (("user.name", "GPT Wake Drill"), ("user.email", "drill@example.invalid"),
                    ("core.autocrlf", "false")):
        git(repo, "config", *setting)
    (repo / "app.py").write_text("value = 0\n", encoding="utf-8")
    (repo / "check.py").write_text(
        "value = int(open('app.py', encoding='utf-8').read().split('=')[1])\n"
        "assert value == 1, 'expected corrected value'\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "drill base")
    base = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(repo),
                          capture_output=True, text=True).stdout.strip()

    contract = {
        "schema_version": 1, "task_id": "DRILL-GPT-01", "contract_revision": 1,
        "base_commit": base,
        "goal": "Make check.py pass: app.py must define value = 1. Fix app.py, "
                "run python -B check.py to confirm, then commit.",
        "acceptance_criteria": ["python -B check.py exits 0"],
        "invariants": ["check.py must not be modified"],
        "allowed_paths": ["app.py"],
        "context_refs": [], "known_risks": [],
        "forbidden_changes": ["Do not modify check.py"],
        "forbidden_paths": ["check.py"], "approved_changes": [],
        "semantic_scopes": ["drill.value"], "task_shape": "continuous_judgment",
        "oracle": "reliable", "verification_profile": "fixture",
        "budgets": {"scout_rounds": 1, "same_failure_repairs": 1,
                    "total_attempts": 2, "environment_retries": 1},
    }
    policy = {
        "schema_version": 1, "policy_id": "drill-policy", "revision": 1,
        "executables": {"python": sys.executable},
        "protected_paths": ["check.py"], "allow_added_tests": [],
        "approved_protected_files": {},
        "gpt_dispatch": True,
        "profiles": {"fixture": {"checks": [
            {"id": "behavior", "executable": "python",
             "args": ["-B", "check.py"], "timeout_seconds": 30}]}},
    }
    runner = {
        "schema_version": 2, "python_executable": sys.executable,
        "runner_entry": str(REPO_ROOT / "scripts" / "agent-monitor" / "run_glm.py"),
        "cli": str(root / "unused-cli"), "provider": str(root / "unused-provider.json"),
        "home": str(root / "unused-glm-home"), "permission_mode": "yolo",
        "timeout_minutes": 5, "idle_minutes": 1, "max_output_tokens": 4096,
        "gpt": {"runner_entry": str(RUN_CODEX), "home": str(BRIDGE_HOME),
                "session_id": SESSION_ID, "sandbox": "danger-full-access",
                "timeout_minutes": 12},
    }
    cpath, ppath, rpath = (root / "contract.json", root / "policy.json",
                           root / "runner.json")
    # The controller pins every path field in the runner config, including
    # unused GLM-side fields; give them real files/dirs to satisfy the gate.
    (root / "unused-cli").write_text("unused", encoding="utf-8")
    (root / "unused-provider.json").write_text("{}", encoding="utf-8")
    (root / "unused-glm-home").mkdir()
    for path, value in ((cpath, contract), (ppath, policy), (rpath, runner)):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2),
                        encoding="utf-8")
    store = root / "control-store"

    def controller(*args):
        result = subprocess.run(
            [sys.executable, "-B", str(CONTROLLER), "--store", str(store), *args],
            capture_output=True, text=True, timeout=1500)
        return result

    reg = controller("register", "--task-id", "DRILL-GPT-01", "--repo", str(repo),
                     "--contract", str(cpath), "--contract-sha256", sha(cpath),
                     "--policy", str(ppath), "--policy-sha256", sha(ppath),
                     "--runner-config", str(rpath),
                     "--runner-config-sha256", sha(rpath), "--allow")
    print("REGISTER rc=%s" % reg.returncode)
    print((reg.stdout or reg.stderr).strip()[:400])
    if reg.returncode != 0:
        return 1
    run = controller("run", "--task-id", "DRILL-GPT-01")
    print("RUN rc=%s" % run.returncode)
    print((run.stdout or run.stderr).strip()[:1200])
    st = controller("status", "--task-id", "DRILL-GPT-01")
    status = json.loads(st.stdout)
    if status.get("stage") == "waiting_control" and status.get("counts", {}).get(
            "execution_started", 0) >= 1:
        # Attempt 1 hit a transient external constraint (measured: sandbox
        # .git protection). Explicit controller resume dispatches attempt 2
        # into the same pinned session — the repair path under test.
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(repo),
                              capture_output=True, text=True).stdout.strip()
        res = controller("resume", "--task-id", "DRILL-GPT-01", "--allow",
                         "--expected-commit", head,
                         "--reason", "attempt-1 sandbox blocked .git commit; "
                         "sandbox raised to danger-full-access by operator; "
                         "same pinned session continues")
        print("RESUME rc=%s" % res.returncode)
        print((res.stdout or res.stderr).strip()[:300])
        run2 = controller("run", "--task-id", "DRILL-GPT-01")
        print("RUN2 rc=%s" % run2.returncode)
        print((run2.stdout or run2.stderr).strip()[:1200])
        st = controller("status", "--task-id", "DRILL-GPT-01")
    print("STATUS:", (st.stdout or st.stderr).strip()[:800])
    handoff = store / "tasks" / "DRILL-GPT-01" / "handoff.json"
    if handoff.is_file():
        print("HANDOFF:", handoff.read_text(encoding="utf-8")[:600])
    return 0 if '"stage": "verified"' in st.stdout else 1


if __name__ == "__main__":
    sys.exit(main())
