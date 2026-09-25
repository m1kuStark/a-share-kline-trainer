"""Run a pinned controller verification profile or inspect an authenticated receipt."""
import argparse
import json
import pathlib
import subprocess
import sys

sys.dont_write_bytecode = True
from verification import run_verification, verify_evidence
from receipts import ReceiptError


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["run", "inspect"])
    for name in ("repo", "contract", "policy", "store"):
        parser.add_argument("--" + name, type=pathlib.Path, required=True)
    parser.add_argument("--contract-sha256", required=True)
    parser.add_argument("--policy-sha256", required=True)
    parser.add_argument("--expected-commit")
    parser.add_argument("--receipt", type=pathlib.Path)
    args = parser.parse_args(argv)
    common = (args.repo, args.contract, args.contract_sha256,
              args.policy, args.policy_sha256, args.store)
    try:
        if args.action == "run":
            if not args.expected_commit or args.receipt:
                raise ValueError("run requires --expected-commit and creates its own receipt")
            receipt = run_verification(*common, args.expected_commit)
            # The just-issued record can include a blocked dirty candidate.
            # Authenticate the record; full current-candidate recheck belongs to inspect.
            from receipts import verify_receipt
            report = verify_receipt(args.store, receipt, {
                "kind": "independent-verification",
                "contract_sha256": args.contract_sha256, "policy_sha256": args.policy_sha256,
                "tested_commit": args.expected_commit})
            if report["status"] == "passed":
                report = verify_evidence(*common, receipt)
        else:
            if not args.receipt or args.expected_commit:
                raise ValueError("inspect requires --receipt; it uses the current candidate HEAD")
            receipt = args.receipt
            report = verify_evidence(*common, receipt)
        print(json.dumps({"status": report["status"], "receipt": str(receipt),
                          "run_id": report["run_id"], "authenticated": True,
                          "failure_fingerprint": report["failure_fingerprint"],
                          "reason": report["reason"], "can_promote": False}, ensure_ascii=True))
        return {"passed": 0, "failed": 2, "blocked": 3}[report["status"]]
    except (ValueError, TypeError, OSError, ReceiptError, subprocess.SubprocessError) as error:
        print("verification error: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
