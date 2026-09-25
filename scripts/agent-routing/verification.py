"""Controller-owned verification: pinned policy, clean candidate, authenticated receipts."""
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import time
import uuid

from route import digest, git, paths_from, read_input
from owned_process import run_owned
from routing import matches, relative_path, require, strings, validate_contract

VERSION = "independent-verifier-1"


def sha_file(path):
    value = hashlib.sha256()
    with pathlib.Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def plain_file(path):
    try:
        info = path.lstat()
    except OSError as error:
        raise ValueError("missing verification file: " + str(path)) from error
    require(stat.S_ISREG(info.st_mode) and not (
        getattr(info, "st_file_attributes", 0) & 0x400), "linked or nonregular file: " + str(path))


def external(path, repo):
    path = pathlib.Path(path).resolve()
    require(path != repo and repo not in path.parents, "controller resource must be outside candidate")
    return path


def pinned(path, expected_hash, repo):
    path = external(path, repo)
    plain_file(path)
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_hash, "configuration pin mismatch")
    value = read_input(path)
    require(hashlib.sha256(path.read_bytes()).hexdigest() == expected_hash,
            "configuration changed while reading")
    return value


def tracked(repo, commit):
    result = {}
    for item in git(repo, "ls-tree", "-rz", commit).split(b"\0"):
        if not item:
            continue
        meta, name = item.split(b"\t", 1)
        mode, kind, oid = meta.decode().split()
        path = name.decode("utf-8")
        require(relative_path(path) and kind == "blob" and mode in {"100644", "100755"},
                "unsupported tracked object: " + path)
        result[path] = oid
    return result


def snapshot_repo(repo, expected_commit, base_commit):
    repo = pathlib.Path(repo).resolve()
    actual = pathlib.Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    require(actual == repo, "candidate must be a Git root")
    require(re.fullmatch(r"[a-f0-9]{40,64}", expected_commit) is not None, "full expected commit required")
    require(git(repo, "rev-parse", "HEAD").decode().strip() == expected_commit, "candidate commit changed")
    git(repo, "merge-base", "--is-ancestor", base_commit, expected_commit)
    require(not git(repo, "status", "--porcelain", "-z", "--untracked-files=all"), "candidate is dirty")
    tree = git(repo, "rev-parse", "HEAD^{tree}").decode().strip()
    for item in git(repo, "ls-files", "-v", "-z").split(b"\0"):
        if item:
            require(item[:1] == b"H", "hidden or nonstandard Git index flag")
    eol = {}
    for item in git(repo, "ls-files", "--eol", "-z").split(b"\0"):
        if item:
            information, name = item.split(b"\t", 1)
            eol[name.decode("utf-8")] = information
    entries = tracked(repo, expected_commit)
    files = {}
    for name in sorted(entries):
        path = repo / name
        require(path.resolve() == path.absolute(), "tracked path resolves through a link: " + name)
        plain_file(path)
        raw = path.read_bytes()
        algorithm = hashlib.sha1 if len(entries[name]) == 40 else hashlib.sha256
        def blob_id(data):
            return algorithm(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        actual_blob = blob_id(raw)
        if actual_blob != entries[name]:
            # Permit only Git's ordinary LF checkout conversion, never arbitrary filters.
            info = eol.get(name, b"")
            require(b"i/lf" in info and b"w/crlf" in info and
                    blob_id(raw.replace(b"\r\n", b"\n")) == entries[name],
                    "working bytes differ from committed blob: " + name)
        files[name] = hashlib.sha256(raw).hexdigest()
    require(git(repo, "rev-parse", "HEAD").decode().strip() == expected_commit, "candidate changed")
    require(not git(repo, "status", "--porcelain", "-z", "--untracked-files=all"), "candidate changed during snapshot")
    changed = sorted(paths_from(git(repo, "diff", "--name-only", "--no-renames", "-z",
                                   base_commit, expected_commit, "--")))
    return {"head": expected_commit, "tree": tree, "files": files,
            "source_digest": digest(files), "changed_paths": changed}


def validate_policy(policy):
    require(isinstance(policy, dict), "policy must be an object")
    require(type(policy.get("schema_version")) is int and policy["schema_version"] == 1, "unsupported policy version")
    require(isinstance(policy.get("policy_id"), str) and policy["policy_id"], "policy_id required")
    require(type(policy.get("revision")) is int and policy["revision"] > 0, "policy revision invalid")
    require(isinstance(policy.get("executables"), dict) and policy["executables"], "executables required")
    for name, path in policy["executables"].items():
        require(isinstance(name, str) and isinstance(path, str) and pathlib.Path(path).is_absolute(),
                "executables require absolute controller paths")
    for field in ("protected_paths", "allow_added_tests"):
        require(strings(policy.get(field)), field + " required")
        require(all(relative_path(p) for p in policy[field]), "invalid policy path")
    require(bool(policy["protected_paths"]), "protected_paths must not be empty")
    approvals = policy.get("approved_protected_files")
    require(isinstance(approvals, dict), "approved_protected_files required")
    for path, checksum in approvals.items():
        require(relative_path(path) and isinstance(checksum, str) and
                re.fullmatch(r"[a-f0-9]{64}", checksum), "invalid protected-file approval")
    profiles = policy.get("profiles")
    require(isinstance(profiles, dict) and profiles, "profiles required")
    for profile_id, profile in profiles.items():
        require(isinstance(profile_id, str) and isinstance(profile, dict), "invalid profile")
        checks = profile.get("checks")
        require(isinstance(checks, list) and checks, "checks must not be empty")
        seen = set()
        for check in checks:
            require(isinstance(check, dict), "invalid check")
            name = check.get("id")
            require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_-]+", name)
                    and name not in seen, "invalid or duplicate check id")
            seen.add(name)
            require(check.get("executable") in policy["executables"], "unregistered executable")
            require(isinstance(check.get("args"), list) and all(
                isinstance(a, str) and "\0" not in a for a in check["args"]), "args must be an argv array")
            timeout = check.get("timeout_seconds")
            require(type(timeout) in (int, float) and 0 < timeout <= 3600, "invalid timeout")
    return policy


def verifier_digest():
    directory = pathlib.Path(__file__).resolve().parent
    return digest({name: sha_file(directory / name)
                   for name in ("verification.py", "owned_process.py", "receipts.py", "route.py", "routing.py")})


def guard_scope(state, contract, policy, repo):
    for name in state["changed_paths"]:
        require(any(matches(name, p) for p in contract["allowed_paths"]) and not
                any(matches(name, p) for p in contract["forbidden_paths"]), "scope violation: " + name)
    baseline = tracked(repo, contract["base_commit"])
    for name in state["changed_paths"]:
        if not any(matches(name, p) for p in policy["protected_paths"]):
            continue
        if name not in baseline and any(matches(name, p) for p in policy["allow_added_tests"]):
            continue
        approved = policy["approved_protected_files"].get(name)
        require(approved is not None and state["files"].get(name) == approved,
                "protected file changed or deleted: " + name)


def isolated_environment(run_dir):
    names = {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "SYSTEMDRIVE",
             "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES",
             "PROGRAMFILES(X86)", "LANG", "LC_ALL"}
    env = {k: v for k, v in os.environ.items() if k.upper() in names}
    env.update(OPEN_BROWSER="0", TDX_ROOT="", TRAINER_DB=str(run_dir / "check.sqlite"),
               TRAINER_RUN_ID=run_dir.name, TRAINER_STATIC_DIR=str(run_dir / "web"),
               TRAINER_READY_FILE=str(run_dir / "ready.json"), PORT="0", HOST="127.0.0.1",
               PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    return env


def run_check(repo, store, run_dir, executable, check):
    log = run_dir / (check["id"] + ".log")
    started = time.monotonic()
    with log.open("xb") as output:
        result = run_owned([str(executable), *check["args"]], repo,
                           isolated_environment(run_dir), output, check["timeout_seconds"])
    fingerprint = None
    if result["failure_kind"]:
        with log.open("rb") as stream:
            stream.seek(max(0, log.stat().st_size - 8192))
            tail = stream.read().decode("utf-8", errors="replace")
        tail = tail.replace(str(repo), "<repo>").replace(str(run_dir), "<run>")
        tail = re.sub(r"\b[0-9a-f]{8}-[0-9a-f-]{27,}\b", "<id>", tail, flags=re.I)
        tail = re.sub(r"\b\d+(?:\.\d+)?(?:ms|s)\b", "<duration>", tail)
        fingerprint = digest({"id": check["id"], "kind": result["failure_kind"],
                              "exit": result["exit_code"], "tail": tail})
    return {**result, "id": check["id"], "executable": check["executable"], "args": check["args"],
            "failure_fingerprint": fingerprint,
            "elapsed_seconds": round(time.monotonic() - started, 4),
            "log_path": log.relative_to(store).as_posix(), "log_sha256": sha_file(log)}


def configuration(repo, cpath, csha, ppath, psha, store):
    repo = pathlib.Path(repo).resolve()
    external(pathlib.Path(__file__).resolve().parent, repo)
    store = external(store, repo)
    c = validate_contract(pinned(cpath, csha, repo))
    p = validate_policy(pinned(ppath, psha, repo))
    profile_id = c["verification_profile"]
    require(profile_id in p["profiles"], "contract profile not registered")
    for value in p["executables"].values():
        executable = external(value, repo)
        plain_file(executable)
    return repo, c, p, store


def run_verification(repo, cpath, csha, ppath, psha, store, expected_commit):
    from receipts import initialize_store, issue_receipt
    repo, c, p, store = configuration(repo, cpath, csha, ppath, psha, store)
    initialize_store(store)
    run_id = "verify-" + uuid.uuid4().hex
    run_dir = store / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    profile = p["profiles"][c["verification_profile"]]
    report = {"schema_version": 1, "kind": "independent-verification", "run_id": run_id,
              "task_id": c["task_id"], "base_commit": c["base_commit"],
              "contract_revision": c["contract_revision"], "contract_sha256": csha,
              "policy_sha256": psha, "policy_id": p["policy_id"], "policy_revision": p["revision"],
              "profile_id": c["verification_profile"], "profile_sha256": digest(profile),
              "verifier_version": VERSION, "verifier_digest": verifier_digest(),
              "tested_commit": expected_commit, "tested_tree": None, "source_digest": None,
              "status": "blocked", "reason": None, "checks": [], "failure_fingerprint": None,
              "can_promote": False}
    try:
        state = snapshot_repo(repo, expected_commit, c["base_commit"])
        report.update(tested_tree=state["tree"], source_digest=state["source_digest"])
        guard_scope(state, c, p, repo)
        manifest = run_dir / "source-manifest.json"
        manifest.write_text(json.dumps(state, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        report["manifest_path"] = manifest.relative_to(store).as_posix()
        report["manifest_sha256"] = sha_file(manifest)
        for check in profile["checks"]:
            result = run_check(repo, store, run_dir, pathlib.Path(p["executables"][check["executable"]]), check)
            report["checks"].append(result)
            if result["status"] != "passed":
                report.update(status="failed", reason="check failed: " + check["id"],
                              failure_fingerprint=result["failure_fingerprint"])
                break
        else:
            report["status"] = "passed"
        try:
            after = snapshot_repo(repo, expected_commit, c["base_commit"])
            require(after["source_digest"] == state["source_digest"], "candidate bytes changed")
            pinned(cpath, csha, repo)
            pinned(ppath, psha, repo)
            checked_artifact(store, run_id, report["manifest_path"], report["manifest_sha256"])
            for check in report["checks"]:
                checked_artifact(store, run_id, check["log_path"], check["log_sha256"])
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            report.update(status="blocked", reason="candidate or configuration changed: " + str(error))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        report.update(status="blocked", reason=str(error))
    return issue_receipt(store, report)


def checked_artifact(store, run_id, path, expected_hash):
    require(relative_path(path), "invalid artifact path")
    candidate = store / path
    require(candidate.resolve() == candidate.absolute(), "linked artifact")
    expected_parent = store / "runs" / run_id
    require(expected_parent in candidate.parents, "artifact outside owned run")
    plain_file(candidate)
    require(sha_file(candidate) == expected_hash, "artifact digest mismatch")


def verify_evidence(repo, cpath, csha, ppath, psha, store, receipt_path):
    from receipts import verify_receipt, ReceiptError
    repo, c, p, store = configuration(repo, cpath, csha, ppath, psha, store)
    head = git(repo, "rev-parse", "HEAD").decode().strip()
    expected = {"kind": "independent-verification", "schema_version": 1,
                "task_id": c["task_id"], "contract_revision": c["contract_revision"],
                "contract_sha256": csha, "policy_sha256": psha,
                "base_commit": c["base_commit"], "tested_commit": head,
                "profile_id": c["verification_profile"],
                "profile_sha256": digest(p["profiles"][c["verification_profile"]]),
                "verifier_version": VERSION, "verifier_digest": verifier_digest(),
                "can_promote": False}
    try:
        report = verify_receipt(store, pathlib.Path(receipt_path), expected)
    except ReceiptError as error:
        raise ValueError(str(error)) from error
    require(report.get("status") in {"passed", "failed", "blocked"}, "invalid verification status")
    state = snapshot_repo(repo, head, c["base_commit"])
    require(report["tested_tree"] == state["tree"] and
            report["source_digest"] == state["source_digest"], "candidate fingerprint mismatch")
    if report.get("manifest_path"):
        checked_artifact(store, report["run_id"], report["manifest_path"], report["manifest_sha256"])
    for check in report["checks"]:
        checked_artifact(store, report["run_id"], check["log_path"], check["log_sha256"])
    if report["status"] == "passed":
        required = p["profiles"][c["verification_profile"]]["checks"]
        require([c["id"] for c in report["checks"]] == [c["id"] for c in required], "missing checks")
        require(all(c["status"] == "passed" and type(c["exit_code"]) is int and
                    c["exit_code"] == 0 and c["cleanup_confirmed"] is True
                    for c in report["checks"]), "invalid passing checks")
        guard_scope(state, c, p, repo)
    return report
