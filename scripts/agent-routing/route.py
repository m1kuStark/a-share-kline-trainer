"""Read-only shadow router CLI; the only write is a new external decision JSON."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys

sys.dont_write_bytecode = True
from routing import decide, validate_contract, validate_report

MAX_INPUT_BYTES = 1024 * 1024
MAX_FACT_BYTES = 2 * 1024 * 1024


def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key: " + key)
        result[key] = value
    return result


def read_input(path):
    raw = path.read_bytes()
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("routing input exceeds 1 MiB: " + path.name)
    return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=reject_duplicates,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ValueError("nonfinite JSON value: " + value)))


def git(repo, *args):
    env = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
    return subprocess.check_output(["git", "-C", str(repo), *args],
                                   stderr=subprocess.PIPE, env=env, timeout=20)


def paths_from(output):
    return [s.decode("utf-8") for s in output.split(b"\0") if s]


def observe(repo, base):
    head = git(repo, "rev-parse", "HEAD").decode().strip()
    tree = git(repo, "rev-parse", "HEAD^{tree}").decode().strip()
    git(repo, "merge-base", "--is-ancestor", base, head)
    paths = set(paths_from(git(repo, "diff", "--name-only", "--no-renames", "-z", base, "--")))
    paths.update(paths_from(git(repo, "diff", "--cached", "--name-only",
                               "--no-renames", "-z", base, "--")))
    paths.update(paths_from(git(repo, "ls-files", "--others", "--exclude-standard", "-z")))
    dirty = bool(git(repo, "status", "--porcelain", "-z", "--untracked-files=all"))
    return {"head": head, "tree": tree, "changed_paths": sorted(paths), "worktree_dirty": dirty}


def verify_fact_refs(repo, report):
    invalid = []
    for fact in report["facts"]:
        path = (repo / fact["path"]).resolve()
        try:
            path.relative_to(repo)
            if not path.is_file() or path.stat().st_size > MAX_FACT_BYTES:
                raise ValueError("missing or oversized fact")
            raw = path.read_bytes()
            if (hashlib.sha256(raw).hexdigest() != fact["sha256"] or
                    fact["line"] > len(raw.decode("utf-8").splitlines())):
                raise ValueError("stale fact")
        except (OSError, UnicodeError, ValueError):
            invalid.append(fact["path"])
    return sorted(set(invalid))


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False,
                                     sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=pathlib.Path, required=True)
    parser.add_argument("--contract", type=pathlib.Path, required=True)
    parser.add_argument("--report", type=pathlib.Path)
    parser.add_argument("--history", type=pathlib.Path)
    parser.add_argument("--active-contract", type=pathlib.Path, action="append", default=[])
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--receipt", type=pathlib.Path)
    parser.add_argument("--receipt-store", type=pathlib.Path)
    parser.add_argument("--policy", type=pathlib.Path)
    parser.add_argument("--policy-sha256")
    parser.add_argument("--contract-sha256")
    args = parser.parse_args(argv)
    try:
        repo, output = args.repo.resolve(), args.out.resolve()
        actual_root = pathlib.Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve()
        if repo != actual_root:
            raise ValueError("--repo must be the Git root")
        if output == repo or repo in output.parents:
            raise ValueError("--out must be outside the task repository")
        if output.exists():
            raise ValueError("output already exists; choose a new attempt path")
        contract = validate_contract(read_input(args.contract))
        report = validate_report(read_input(args.report)) if args.report else None
        history = read_input(args.history) if args.history else []
        active = [validate_contract(read_input(p)) for p in args.active_contract]
        observed = observe(repo, contract["base_commit"])
        invalid = verify_fact_refs(repo, report) if report else []
        observed["invalid_fact_refs"] = invalid
        result = decide(contract, observed, report, history, active)
        receipt_inputs = (args.receipt, args.receipt_store, args.policy,
                          args.policy_sha256, args.contract_sha256)
        if any(receipt_inputs):
            if not all(receipt_inputs):
                raise ValueError("receipt, receipt-store, policy and both configuration pins are required")
            from verification import verify_evidence
            verified = verify_evidence(repo, args.contract, args.contract_sha256,
                                       args.policy, args.policy_sha256,
                                       args.receipt_store, args.receipt)
            result.update(verification_status=verified["status"],
                          verification_run_id=verified["run_id"],
                          failure_fingerprint=verified["failure_fingerprint"])
            if result["next_action"] in {"execute_contract", "collect_evidence"}:
                if verified["status"] == "passed" and result["next_action"] == "execute_contract":
                    result["next_action"] = "review_by_risk"
                elif verified["status"] == "failed":
                    failures = [c for c in verified["checks"] if c["status"] != "passed"]
                    result["next_action"] = "waiting_environment" if any(
                        c["failure_kind"] == "environment" for c in failures) else "repair_contract"
                elif verified["status"] == "blocked":
                    result["next_action"] = "replan_contract"
            result["reason_codes"] = sorted(set(result["reason_codes"] + [
                "independent_verification_" + verified["status"]]))
        # HEAD/tree/path changes invalidate this observation; content refs have their own hashes.
        if observe(repo, contract["base_commit"]) != {
                k: v for k, v in observed.items() if k != "invalid_fact_refs"}:
            raise ValueError("Git changed while collecting evidence; retry observation")
        result.update(changed_paths=observed["changed_paths"], invalid_fact_refs=invalid,
                      input_digests={"contract": digest(contract), "report": digest(report),
                                     "history": digest(history), "active": digest(active)},
                      history_supplied=args.history is not None,
                      limitations=["shadow route; verified status requires an authenticated independent receipt",
                                   "risk path mapping is incomplete; semantic review may be needed",
                                   "reports and history are inputs, not authenticated controller state"])
        encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8") as stream:
            stream.write(encoded)
        print(json.dumps({"route": result["route"], "next_action": result["next_action"],
                          "mode": "shadow", "reason_codes": result["reason_codes"]},
                         ensure_ascii=True))
        return 0
    except (ValueError, TypeError, OSError, subprocess.SubprocessError) as error:
        print("routing input error: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
