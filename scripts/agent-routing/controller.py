"""ORCH-03 controller CLI: register / run / status / explicit resume.

All state lives under --store (a control directory outside every
candidate repo). Registration requires an explicit --allow allowlist
flag. See controller_usage.md for the full contract.
"""
import argparse
import json
import sys

sys.dont_write_bytecode = True
from controller_loop import Controller, ControllerError
from controller_state import TaskStoreError


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", required=True,
                        help="control directory (TaskStore, progress, receipts)")
    commands = parser.add_subparsers(dest="command", required=True)

    register = commands.add_parser("register", help="register an approved task")
    register.add_argument("--task-id", required=True)
    register.add_argument("--repo", required=True)
    register.add_argument("--contract", required=True)
    register.add_argument("--policy", required=True)
    register.add_argument("--runner-config", required=True)
    register.add_argument("--contract-sha256", required=True)
    register.add_argument("--policy-sha256", required=True)
    register.add_argument("--runner-config-sha256", required=True)
    register.add_argument("--allow", action="store_true",
                          help="explicit allowlist approval; required")

    for name, help_text in (("run", "execute one controlled attempt loop"),
                            ("status", "show persisted task state")):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--task-id", required=True)

    resume = commands.add_parser("resume", help="explicitly resolve a finished blocked attempt")
    resume.add_argument("--task-id", required=True)
    resume.add_argument("--allow", action="store_true")
    resume.add_argument("--expected-commit", required=True)
    resume.add_argument("--reason", required=True)

    args = parser.parse_args(argv)
    controller = Controller(args.store)
    try:
        if args.command == "register":
            result = controller.register(
                args.task_id, args.repo, args.contract, args.policy,
                args.runner_config, allow=args.allow,
                contract_sha256=args.contract_sha256,
                policy_sha256=args.policy_sha256,
                runner_config_sha256=args.runner_config_sha256)
        elif args.command == "run":
            result = controller.run(args.task_id)
        elif args.command == "status":
            result = controller.status(args.task_id)
        elif args.command == "resume":
            result = controller.resume(args.task_id, allow=args.allow,
                                       expected_commit=args.expected_commit, reason=args.reason)
    except (ControllerError, TaskStoreError) as error:
        print(json.dumps({"error": str(error), "task_id":
                          getattr(args, "task_id", None)}, ensure_ascii=False),
              file=sys.stderr)
        return 1
    finally:
        controller.close()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
