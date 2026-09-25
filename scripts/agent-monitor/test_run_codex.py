# -*- coding: utf-8 -*-
"""run_codex.py 的契约测试。不调用任何模型：--cli 指向夹具生成的假 codex.cmd。"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import run_codex  # noqa: E402

FAKE_IMPL = r'''
import json, os, sys, time
out = os.environ["FAKE_ARGV_OUT"]
with open(out, "w", encoding="utf-8") as h:
    h.write(json.dumps(sys.argv[1:]))
data = sys.stdin.read()
with open(out + ".stdin", "w", encoding="utf-8") as h:
    h.write(data)
mode = os.environ.get("FAKE_MODE", "complete")
calls = os.environ.get("FAKE_CALLS_LOG")
if calls:
    with open(calls, "a", encoding="utf-8") as h:
        h.write(mode + "\n")
argv_list = sys.argv[1:]
session_id = argv_list[argv_list.index("resume") + 1] if "resume" in argv_list else "fake-thread-1234"
if mode == "identity_mismatch":
    for event in (
        {"type": "thread.started", "thread_id": "different-thread-999"},
        {"type": "turn.started"},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "FAKE-ANSWER"}},
        {"type": "turn.completed", "usage": {"input_tokens": 10, "cached_input_tokens": 4}},
    ):
        print(json.dumps(event))
    with open(sys.argv[sys.argv.index("-o") + 1], "w", encoding="utf-8") as h:
        h.write("FAKE-ANSWER")
    sys.exit(0)
if mode == "no_identity":
    print(json.dumps({"type": "turn.started"}))
    print(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "FAKE-ANSWER"}}))
    print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 1}}))
    sys.exit(0)
if mode == "hang":
    time.sleep(float(os.environ.get("FAKE_HANG_SECONDS", "30")))
    sys.exit(0)
if mode == "writer_busy":
    sys.stderr.write("thread-store conflict: thread t already has an active writer\n")
    sys.exit(1)
if mode == "exit_fail":
    sys.stderr.write("boom\n")
    sys.exit(3)
events = [
    {"type": "thread.started", "thread_id": session_id},
    {"type": "turn.started"},
    {"type": "item.completed", "item": {"type": "agent_message", "text": "FAKE-ANSWER"}},
    {"type": "turn.completed", "usage": {"input_tokens": 10, "cached_input_tokens": 4}},
]
for event in events:
    print(json.dumps(event))
last = sys.argv[sys.argv.index("-o") + 1]
with open(last, "w", encoding="utf-8") as h:
    h.write("FAKE-ANSWER")
sys.exit(0)
'''


def make_fake_cli(tmp):
    impl = tmp / "fake_codex_impl.py"
    impl.write_text(FAKE_IMPL, encoding="utf-8")
    py = shutil.which("py") or shutil.which("python")
    cmd = tmp / "fake_codex.cmd"
    cmd.write_text('@echo off\n"%s" -3.9 -X utf8 "%s" %%*\n' % (py, impl),
                   encoding="utf-8")
    return str(cmd)


class RunCodexTest(unittest.TestCase):
    def setUp(self):
        os.environ.pop("FAKE_CALLS_LOG", None)
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = pathlib.Path(self._tmp.name)
        self.home = self.tmp / "home"
        self.codex_home = self.tmp / "codex-home"
        self.home.mkdir()
        self.codex_home.mkdir()
        self.cli = make_fake_cli(self.tmp)
        os.environ["FAKE_ARGV_OUT"] = str(self.tmp / "argv.json")

    def tearDown(self):
        self._tmp.cleanup()

    def wake(self, *extra, mode="complete", expect=0):
        os.environ["FAKE_MODE"] = mode
        prompt = self.tmp / "prompt.txt"
        prompt.write_text("你好", encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, "-B", str(pathlib.Path(run_codex.__file__)),
             "--home", str(self.home), "--codex-home", str(self.codex_home),
             "--cli", self.cli, "wake", "--prompt-file", str(prompt),
             "--stable-seconds", "0", "--poll-seconds", "0.1", *extra],
            capture_output=True, text=True, timeout=90)
        self.assertEqual(proc.returncode, expect,
                         msg="stdout=%s stderr=%s" % (proc.stdout, proc.stderr))
        return proc

    def test_wake_completes_and_writes_registry(self):
        proc = self.wake("--session-id", "t1", "--batch", "B1")
        result = json.loads(proc.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["answer"], "FAKE-ANSWER")
        self.assertEqual(result["state"], "completed")
        record = json.loads((self.home / "jobs" / "B1.json").read_text(
            encoding="utf-8"))
        self.assertEqual(record["id"], "B1")
        self.assertEqual(record["state"], "completed")
        self.assertEqual(record["sessionId"], "t1",
                         "registry keeps the requested pinned session id")
        self.assertTrue(record["logPath"].endswith("events.jsonl"))
        self.assertTrue(pathlib.Path(record["logPath"]).is_file())

    def test_argv_contract_flags_before_resume(self):
        self.wake("--session-id", "t2", "--batch", "B2",
                  "--sandbox", "workspace-write")
        argv = json.loads(pathlib.Path(os.environ["FAKE_ARGV_OUT"]).read_text(
            encoding="utf-8"))
        self.assertEqual(argv[0], "exec")
        self.assertEqual(argv[argv.index("-s") + 1], "workspace-write")
        self.assertLess(argv.index("-s"), argv.index("resume"))
        self.assertIn("--skip-git-repo-check", argv)
        self.assertEqual(argv[argv.index("resume") + 1], "t2")
        self.assertEqual(argv[argv.index("resume") + 2], "-")
        stdin_path = pathlib.Path(os.environ["FAKE_ARGV_OUT"] + ".stdin")
        self.assertEqual(stdin_path.read_text(encoding="utf-8"), "你好")

    def test_lock_blocks_second_wake(self):
        lock = run_codex.SessionLock(str(self.home), "t3")
        self.assertTrue(lock.acquire())
        try:
            proc = self.wake("--session-id", "t3", "--batch", "B3",
                             expect=run_codex.EXIT_LOCK_BUSY)
            self.assertIn("already in progress", proc.stderr)
        finally:
            lock.release()
        self.assertFalse(lock.path.exists())

    def test_timeout_kills_and_reports(self):
        proc = self.wake("--session-id", "t4", "--batch", "B4",
                         "--timeout-minutes", "0.05", mode="hang",
                         expect=run_codex.EXIT_TIMEOUT)
        self.assertIn("timeout", proc.stdout)

    def test_writer_busy_reported_without_wait(self):
        proc = self.wake("--session-id", "t5", "--batch", "B5", mode="writer_busy",
                         expect=run_codex.EXIT_THREAD_BUSY)
        result = json.loads(proc.stdout)
        self.assertTrue(result["writerBusy"])
        record = json.loads((self.home / "jobs" / "B5.json").read_text(
            encoding="utf-8"))
        self.assertIn("writer busy", record["error"])

    def test_plain_failure_maps_to_exec_failed(self):
        self.wake("--session-id", "t6", "--batch", "B6", mode="exit_fail",
                  expect=run_codex.EXIT_EXEC_FAILED)

    def test_pin_discovers_session_by_cwd(self):
        day = self.codex_home / "sessions" / "2026" / "09" / "25"
        day.mkdir(parents=True)
        rollout = day / "rollout-2026-09-25T10-00-00-aaaa.jsonl"
        meta = {"payload": {"session_id": "disc-thread", "cwd": str(self.tmp),
                            "originator": "Codex Desktop"}}
        rollout.write_text(json.dumps(meta) + "\n", encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, "-B", str(pathlib.Path(run_codex.__file__)),
             "--home", str(self.home), "--codex-home", str(self.codex_home),
             "pin", "--cwd", str(self.tmp)],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        payload = json.loads(proc.stdout)
        self.assertEqual(payload["sessionId"], "disc-thread")
        pinned = json.loads((self.home / "session.json").read_text(
            encoding="utf-8"))
        self.assertEqual(pinned["session_id"], "disc-thread")

    def test_wake_without_pin_fails_cleanly(self):
        proc = self.wake("--batch", "B7", expect=run_codex.EXIT_NO_PIN)
        self.assertIn("no pinned session", proc.stderr)

    def test_parse_events_extracts_answer_and_usage(self):
        sample = self.tmp / "sample.jsonl"
        sample.write_text("\n".join([
            json.dumps({"type": "thread.started", "thread_id": "x"}),
            json.dumps({"type": "item.completed",
                        "item": {"type": "agent_message", "text": "答案"}}),
            json.dumps({"type": "turn.completed",
                        "usage": {"input_tokens": 9}}),
        ]), encoding="utf-8")
        completed, answer, usage, thread = run_codex.parse_events(sample)
        self.assertTrue(completed)
        self.assertEqual(answer, "答案")
        self.assertEqual(usage["input_tokens"], 9)
        self.assertEqual(thread, "x")


    def wake_inprocess(self, *extra):
        prompt = self.tmp / "prompt-inline.txt"
        prompt.write_text("你好", encoding="utf-8")
        return run_codex.main([
            "--home", str(self.home), "--codex-home", str(self.codex_home),
            "--cli", self.cli, "wake", "--prompt-file", str(prompt),
            "--stable-seconds", "0", "--poll-seconds", "0.1", *extra])

    def test_notify_fires_on_completion(self):
        with patch.object(run_codex, "_notify") as notify:
            code = self.wake_inprocess("--session-id", "t8", "--batch", "B8",
                                       "--notify")
        self.assertEqual(run_codex.EXIT_OK, code)
        self.assertTrue(notify.called)
        title, body = notify.call_args[0]
        self.assertIn("GPT 已应答", title)
        self.assertIn("FAKE-ANSWER", body)

    def test_notify_silent_without_flag(self):
        with patch.object(run_codex, "_notify") as notify:
            self.wake_inprocess("--session-id", "t9", "--batch", "B9")
        self.assertFalse(notify.called)

    def test_notify_escapes_quotes_and_never_raises(self):
        captured = {}

        def fake_popen(argv, **kwargs):
            captured["cmd"] = argv
            return None

        with patch.object(run_codex.subprocess, "Popen", side_effect=fake_popen):
            run_codex._notify("标题'引号", "正文'引号")
        script = captured["cmd"][3]
        self.assertIn("标题''引号", script)
        self.assertIn("正文''引号", script)


class BatchClaimAndIdentityTests(unittest.TestCase):
    """Reproduce 2026-09-26 integrator review counterexamples (P1-1 duplicate
    dispatch, P1-2 session identity, P2-5 handles). Zero model calls."""

    def setUp(self):
        self._old_env = {k: os.environ.get(k) for k in
                         ("FAKE_ARGV_OUT", "FAKE_CALLS_LOG", "FAKE_MODE")}
        self.addCleanup(lambda: [os.environ.pop(k, None) if v is None
                                 else os.environ.__setitem__(k, v)
                                 for k, v in self._old_env.items()])
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = pathlib.Path(self._tmp.name)
        self.home = self.tmp / "home"
        self.codex_home = self.tmp / "codex-home"
        self.home.mkdir()
        self.codex_home.mkdir()
        self.cli = make_fake_cli(self.tmp)
        os.environ["FAKE_ARGV_OUT"] = str(self.tmp / "argv.json")
        os.environ["FAKE_CALLS_LOG"] = str(self.tmp / "calls.log")
        for f in (self.tmp / "argv.json", self.tmp / "calls.log"):
            if f.exists():
                f.unlink()

    def tearDown(self):
        self._tmp.cleanup()

    def wake_inprocess(self, *extra, mode="complete", expect=None):
        os.environ["FAKE_MODE"] = mode
        prompt = self.tmp / "prompt.txt"
        prompt.write_text("你好", encoding="utf-8")
        code = run_codex.main([
            "--home", str(self.home), "--codex-home", str(self.codex_home),
            "--cli", self.cli, "wake", "--prompt-file", str(prompt),
            "--stable-seconds", "0", "--poll-seconds", "0.1", *extra])
        if expect is not None:
            self.assertEqual(expect, code)
        return code

    def calls(self):
        log = self.tmp / "calls.log"
        return log.read_text(encoding="utf-8").splitlines() if log.is_file() else []

    def test_duplicate_batch_claimed_once_second_refused(self):
        first = self.wake_inprocess("--session-id", "tA", "--batch", "SAME-EVENT")
        self.assertEqual(run_codex.EXIT_OK, first)
        self.assertEqual(1, len(self.calls()))
        second = self.wake_inprocess("--session-id", "tA", "--batch", "SAME-EVENT")
        self.assertEqual(run_codex.EXIT_BATCH_EXISTS, second)
        self.assertEqual(1, len(self.calls()),
                         "second same-batch wake must not invoke codex again")
        record = json.loads((self.home / "jobs" / "SAME-EVENT.json")
                            .read_text(encoding="utf-8"))
        self.assertEqual("completed", record["state"],
                         "original evidence must survive")

    def test_session_identity_mismatch_fails_without_override(self):
        code = self.wake_inprocess("--session-id", "pinned-thread",
                                   "--batch", "B-ID1", mode="identity_mismatch",
                                   expect=run_codex.EXIT_EXEC_FAILED)
        self.assertEqual(run_codex.EXIT_EXEC_FAILED, code)
        record = json.loads((self.home / "jobs" / "B-ID1.json")
                            .read_text(encoding="utf-8"))
        self.assertEqual("failed", record["state"])
        self.assertEqual("pinned-thread", record["sessionId"],
                         "requested id must be kept")
        self.assertEqual("different-thread-999", record.get("returnedSessionId"))
        self.assertIn("identity", (record.get("error") or ""))

    def test_missing_thread_identity_fails(self):
        code = self.wake_inprocess("--session-id", "pinned-thread",
                                   "--batch", "B-ID2", mode="no_identity",
                                   expect=run_codex.EXIT_EXEC_FAILED)
        record = json.loads((self.home / "jobs" / "B-ID2.json")
                            .read_text(encoding="utf-8"))
        self.assertEqual("failed", record["state"])
        self.assertEqual("pinned-thread", record["sessionId"])
        self.assertIn("identity", (record.get("error") or ""))

    def test_resourcewarning_free_wake(self):
        prompt = self.tmp / "prompt.txt"
        prompt.write_text("你好", encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, "-W", "error::ResourceWarning", "-B",
             str(pathlib.Path(run_codex.__file__)),
             "--home", str(self.home), "--codex-home", str(self.codex_home),
             "--cli", self.cli, "wake", "--prompt-file", str(prompt),
             "--stable-seconds", "0", "--poll-seconds", "0.1",
             "--session-id", "tW", "--batch", "B-W"],
            capture_output=True, text=True, timeout=90)
        self.assertEqual(run_codex.EXIT_OK, proc.returncode,
                         msg="stdout=%s stderr=%s" % (proc.stdout,
                                                      proc.stderr[-800:]))


if __name__ == "__main__":
    unittest.main()
