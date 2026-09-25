#!/usr/bin/env python3
"""run_codex.py — 会话中枢桥：向 pinned 的 Codex 会话注入 prompt 并收回结构化结果。

所有强模型调用续接同一会话（上下文继承、缓存命中）；默认 read-only 沙箱，
执行类派发显式提权 workspace-write。与 run_glm.py 同构：注册表归 `--home`，
jobs/<batch>.json 与 controller_runner 的归属校验（id/worktree/logPath）兼容。

实测契约（2026-09-25，codex-cli 0.157.0，Desktop 写入 0.155.0-alpha.16.4）：
- 旗标必须置于 resume 子命令之前：codex exec -s <sandbox> --skip-git-repo-check
  resume <thread-id> - --json -o <file>；prompt 走 stdin（"-"）。
- stdout 事件流块缓冲，退出后才可完整读取；运行中判活靠 rollout 轮次文件实时追加。
- 事件：thread.started(thread_id) → turn.started → item.completed(agent_message)
  → turn.completed(usage)。完成谓词 = turn.completed。
- 每轮新建 sessions/YYYY/MM/DD/rollout-<ts>-<turn-uuid>.jsonl，首行
  session_meta.session_id 即会话 id，逐事件实时落盘。
- Desktop 0.155+ 写入的线程需 CLI >= 0.157（0.145 反序列化 subagent-completed
  变体失败，报 thread/resume -32603）。
- Desktop 正打开的会话持有线程写入者锁，外部 resume 报 "already has an active
  writer"（-32600）；--wait-writer-minutes > 0 时等待其释放后重试，超时报忙退出。
- 无内建超时；本工具对子进程计时，超时 taskkill /T /F 杀进程树，日志保留。
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

EXIT_OK = 0
EXIT_LOCK_BUSY = 2
EXIT_THREAD_BUSY = 3
EXIT_TIMEOUT = 4
EXIT_NO_PIN = 5
EXIT_EXEC_FAILED = 6
EXIT_USAGE = 7
EXIT_BATCH_EXISTS = 8
# 超时杀树后验证整棵进程树消亡的有界等待（秒）。
KILL_WAIT_SECONDS = 10.0
TREE_POLL_SECONDS = 0.5

SANDBOX_CHOICES = ("read-only", "workspace-write", "danger-full-access")


def default_home():
    base = os.environ.get("CODEX_HOME") or str(
        pathlib.Path.home() / ".codex")
    return str(pathlib.Path(base) / "headroom-cache" / "codex-bridge")


def default_codex_home():
    return os.environ.get("CODEX_HOME") or str(pathlib.Path.home() / ".codex")


def default_cli():
    vendor = pathlib.Path(os.environ.get("APPDATA", "")) / "npm" / "node_modules" / (
        "@openai") / "codex" / "node_modules" / "@openai" / "codex-win32-x64" / (
        "vendor") / "x86_64-pc-windows-msvc" / "bin" / "codex.exe"
    if vendor.is_file():
        return str(vendor)
    found = shutil.which("codex") or shutil.which("codex.exe")
    if not found:
        raise SystemExit("codex CLI not found on PATH; pass --cli explicitly")
    return found


def _atomic_write_json(path, payload):
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, str(path))


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def iter_turn_files(codex_home, max_depth_days=14):
    """按 mtime 新→旧产出 sessions/YYYY/MM/DD/rollout-*.jsonl 的候选路径。"""
    root = pathlib.Path(codex_home) / "sessions"
    if not root.is_dir():
        return
    day_dirs = []
    for path in root.glob("*/*/*"):
        if path.is_dir():
            day_dirs.append(path)
    day_dirs.sort(key=lambda p: p.name, reverse=True)
    for day in day_dirs[:max_depth_days]:
        files = list(day.glob("rollout-*.jsonl"))
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        for path in files:
            yield path


def _turn_file_matches(path, thread_id):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            first = handle.readline()
        meta = json.loads(first).get("payload", {})
    except (OSError, ValueError):
        return False
    return thread_id in (meta.get("session_id"), meta.get("thread_id"),
                         meta.get("parent_thread_id"))


def find_newest_turn_file(codex_home, thread_id):
    for path in iter_turn_files(codex_home):
        if _turn_file_matches(path, thread_id):
            return path
    return None


def _norm_cwd(value):
    try:
        return os.path.normcase(str(pathlib.Path(value).resolve()))
    except OSError:
        return os.path.normcase(str(value))


def discover_newest_session(codex_home, cwd):
    """返回 cwd 匹配的最新会话 id（读 session_meta 首行，resolved 后比较）。"""
    want = _norm_cwd(cwd)
    for path in iter_turn_files(codex_home):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                meta = json.loads(handle.readline()).get("payload", {})
        except (OSError, ValueError):
            continue
        meta_cwd = meta.get("cwd")
        if meta_cwd and _norm_cwd(meta_cwd) == want:
            return meta.get("session_id") or meta.get("id"), path
    return None, None


def is_stable(path, seconds):
    """rollout 轮次文件在 seconds 内尺寸与 mtime 均未变化才视为空闲。"""
    if path is None:
        return True
    path = pathlib.Path(path)

    def snap():
        st = path.stat()
        return (st.st_size, st.st_mtime_ns)

    first = snap()
    time.sleep(seconds)
    return snap() == first


class SessionLock:
    def __init__(self, home, session_id):
        digest = hashlib.sha256(os.path.normcase(session_id).encode()).hexdigest()
        self.path = pathlib.Path(home) / "locks" / ("session-%s.lock" % digest[:16])
        self.fd = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return False
        os.write(self.fd, json.dumps({
            "pid": os.getpid(), "acquiredAt": _now_iso()}).encode())
        return True

    def release(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
            try:
                os.unlink(str(self.path))
            except FileNotFoundError:
                pass


def _pid_alive(pid):
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    try:
        probe = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/NH"],
                               capture_output=True, text=True, timeout=10,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return True  # 不可验证按存活保守处理
    return bool(probe.stdout) and str(pid) in probe.stdout


def _descendant_pids(root_pid):
    """Return all live descendant PIDs of root, or None when the enumeration
    itself is unreliable (caller must then treat cleanup as unconfirmed)."""
    if os.name != "nt":
        try:
            r = subprocess.run(["pgrep", "-P", str(root_pid)],
                               capture_output=True, text=True)
        except OSError:
            return None
        if r.returncode not in (0, 1):
            return None
        return [int(x) for x in (r.stdout or "").split()]
    ps = ("$q=[System.Collections.Queue]::new();$q.Enqueue(%d);"
          "while($q.Count){$p=$q.Dequeue();"
          "Get-CimInstance -ClassName Win32_Process -Filter \"ParentProcessId=$p\" | "
          "ForEach-Object{$q.Enqueue([int]$_.ProcessId);[int]$_.ProcessId}}") % root_pid
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                           capture_output=True, text=True, timeout=25,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0:
        return None
    try:
        return [int(x) for x in (r.stdout or "").split()]
    except ValueError:
        return None


def kill_tree(pid):
    if os.name != "nt":
        proc = subprocess.run(["kill", "-9", str(pid)], check=False)
        return proc.returncode == 0
    try:
        proc = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                              capture_output=True, check=False, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0


def parse_events(events_path):
    """返回 (completed, answer, usage, thread_id)。stdout 块缓冲，退出后解析。"""
    completed, answer, usage, thread_id = False, None, None, None
    try:
        with open(events_path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                kind = event.get("type")
                if kind == "thread.started":
                    thread_id = event.get("thread_id") or thread_id
                elif kind == "item.completed":
                    item = event.get("item") or {}
                    if item.get("type") == "agent_message":
                        answer = item.get("text")
                elif kind == "turn.completed":
                    completed = True
                    usage = event.get("usage")
    except OSError:
        pass
    return completed, answer, usage, thread_id


def build_argv(cli, sandbox, session_id, out_dir, add_dirs=()):
    argv = [cli, "exec", "-s", sandbox, "--skip-git-repo-check"]
    for extra in add_dirs:
        argv += ["--add-dir", str(extra)]
    argv += ["resume", session_id, "-", "--json",
             "-o", str(pathlib.Path(out_dir) / "last.txt")]
    return argv


def read_prompt(args):
    if args.prompt_file == "-":
        return sys.stdin.read()
    with open(args.prompt_file, "r", encoding="utf-8") as handle:
        return handle.read()


WRITER_BUSY_MARKER = "already has an active writer"


def _notify(title, body):
    """Fire-and-forget Windows balloon toast so the operator can keep the
    desktop visible; failures are silently ignored (never blocks a wake)."""
    if os.name != "nt":
        return
    try:
        script = ("Add-Type -AssemblyName System.Windows.Forms;"
                  "Add-Type -AssemblyName System.Drawing;"
                  "$n = New-Object System.Windows.Forms.NotifyIcon;"
                  "$n.Icon = [System.Drawing.SystemIcons]::Information;"
                  "$n.Visible = $true;"
                  "$n.ShowBalloonTip(8000, '%s', '%s', "
                  "[System.Windows.Forms.ToolTipIcon]::Info);"
                  "Start-Sleep -Seconds 9; $n.Dispose()"
                  % (title.replace("'", "''"), body.replace("'", "''")))
        subprocess.Popen(["powershell", "-NoProfile", "-Command", script],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=subprocess.CREATE_NO_WINDOW)
    except (OSError, ValueError):
        pass


def _attempt(argv, prompt, events_path, err_path, cwd, timeout_minutes,
             poll_seconds):
    """单次派发：返回 (exit_code, state, duration, cleanup_confirmed)。
    state ∈ running/timeout；句柄在等待结束后显式关闭（无 ResourceWarning）。"""
    started = time.monotonic()
    out_handle = open(events_path, "wb")
    err_handle = open(err_path, "wb")
    try:
        proc = subprocess.Popen(
            argv, stdin=subprocess.PIPE, stdout=out_handle,
            stderr=err_handle, cwd=cwd or None, shell=False)
    except Exception:
        out_handle.close()
        err_handle.close()
        raise
    try:
        proc.stdin.write(prompt.encode("utf-8"))
        proc.stdin.close()
    except OSError:
        pass
    state, exit_code = "running", None
    cleanup_confirmed = False
    deadline = time.monotonic() + timeout_minutes * 60
    try:
        while True:
            exit_code = proc.poll()
            if exit_code is not None:
                cleanup_confirmed = True
                break
            if time.monotonic() > deadline:
                descendants = _descendant_pids(proc.pid)
                rc_ok = kill_tree(proc.pid)
                survivors = [p for p in ([proc.pid] + (descendants or []))
                             if _pid_alive(p)]
                if survivors:
                    # repair pass: finish whatever the tree kill missed
                    for pid in survivors:
                        kill_tree(pid)
                wait_until = time.monotonic() + KILL_WAIT_SECONDS
                while True:
                    alive = [p for p in ([proc.pid] + (descendants or []))
                             if _pid_alive(p)]
                    if not alive and proc.poll() is not None:
                        cleanup_confirmed = True
                        break
                    if time.monotonic() > wait_until:
                        break
                    time.sleep(TREE_POLL_SECONDS)
                if descendants is None or not rc_ok:
                    # 无法枚举子树或杀树异常：保守视作未确认，调用方保留锁
                    cleanup_confirmed = False
                exit_code = proc.poll()
                state = "timeout"
                break
            time.sleep(poll_seconds)
    finally:
        try:
            proc.stdin.close()
        except (OSError, ValueError):
            pass
        out_handle.close()
        err_handle.close()
    return exit_code, state, round(time.monotonic() - started, 2), cleanup_confirmed


def cmd_wake(args):
    home = pathlib.Path(args.home)
    pin_path = home / "session.json"
    session_id = args.session_id
    if not session_id:
        if not pin_path.is_file():
            print(json.dumps({"ok": False, "error": "no pinned session; run pin first"}),
                  file=sys.stderr)
            return EXIT_NO_PIN
        session_id = json.loads(pin_path.read_text(encoding="utf-8"))["session_id"]

    lock = SessionLock(args.home, session_id)
    if not lock.acquire():
        print(json.dumps({"ok": False, "error": "wake already in progress for session",
                          "lock": str(lock.path)}), file=sys.stderr)
        return EXIT_LOCK_BUSY
    cleanup_uncertain = False
    try:
        jobs_dir = home / "jobs"
        jobs_dir.mkdir(parents=True, exist_ok=True)
        claim_path = jobs_dir / ("%s.json" % args.batch)
        try:
            with open(str(claim_path), "x", encoding="utf-8") as handle:
                json.dump({"id": args.batch, "state": "claimed",
                           "sessionId": session_id, "claimedAt": _now_iso()},
                          handle, ensure_ascii=False)
        except FileExistsError:
            print(json.dumps({"ok": False, "state": "already_claimed",
                              "error": "batch already claimed; reuse a new "
                                       "batch id to preserve prior evidence",
                              "jobsRecord": str(claim_path)}), file=sys.stderr)
            return EXIT_BATCH_EXISTS
        newest = find_newest_turn_file(args.codex_home, session_id)
        if newest is not None and not args.skip_stable:
            if not is_stable(newest, args.stable_seconds):
                print(json.dumps({"ok": False, "error": "thread turn file still growing; "
                                  "desktop may be mid-turn", "rollout": str(newest)}),
                      file=sys.stderr)
                return EXIT_THREAD_BUSY

        out_dir = home / "wakes" / ("%s-%s" % (
            datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
            args.batch))
        out_dir.mkdir(parents=True, exist_ok=True)
        if args.log:
            events_path = pathlib.Path(args.log).resolve()
            events_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            events_path = out_dir / "events.jsonl"
        err_path = pathlib.Path(str(events_path) + ".err")
        prompt = read_prompt(args)
        argv = build_argv(args.cli, args.sandbox, session_id, out_dir,
                          add_dirs=[pathlib.Path(p).resolve()
                                    for p in (args.add_dirs or [])])

        duration = 0.0
        exit_code, state = None, "failed"
        cleanup_confirmed = True
        writer_busy = False
        started_iso = _now_iso()
        wait_deadline = time.monotonic() + args.wait_writer_minutes * 60
        notified_wait = False
        while True:
            exit_code, state, duration, cleanup_confirmed = _attempt(
                argv, prompt, events_path, err_path, args.cwd,
                args.timeout_minutes, args.poll_seconds)
            if state == "timeout" or exit_code == 0:
                break
            err_text = ""
            try:
                err_text = err_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass
            if WRITER_BUSY_MARKER not in err_text:
                break
            writer_busy = True
            if args.wait_writer_minutes > 0 and time.monotonic() < wait_deadline:
                if args.notify and not notified_wait:
                    notified_wait = True
                    _notify("Codex 唤醒等待中",
                            "目标会话被占用（Desktop 正打开）；切离该会话后自动继续")
                time.sleep(max(args.poll_seconds * 5, 15.0))
                continue
            break

        completed, answer, usage, reported_id = parse_events(events_path)
        if state == "timeout" and not cleanup_confirmed:
            cleanup_uncertain = True
        if state != "timeout":
            state = "completed" if completed and exit_code == 0 else "failed"
        identity_error = None
        if state == "completed":
            if not reported_id:
                state = "failed"
                identity_error = ("thread identity missing from the event "
                                  "stream; cannot prove the pinned session "
                                  "answered")
            elif reported_id != session_id:
                state = "failed"
                identity_error = ("session identity mismatch: requested %s, "
                                  "thread.started returned %s"
                                  % (session_id, reported_id))
        record = {
            "id": args.batch, "title": args.title, "worktree": args.cwd,
            "state": state, "runner": "run_codex", "sandbox": args.sandbox,
            "mode": "headless", "sessionMode": "resume",
            "resumedFrom": session_id, "sessionId": session_id,
            "returnedSessionId": reported_id,
            "startedAt": started_iso, "finishedAt": _now_iso(),
            "exitCode": exit_code, "durationSeconds": duration,
            "cleanupUncertain": cleanup_uncertain,
            "logPath": str(events_path), "stderrPath": str(err_path),
            "error": identity_error if identity_error else
            None if state == "completed" else
            "turn did not complete before timeout" +
            ("" if cleanup_confirmed else "; process cleanup unconfirmed, "
             "session lock retained") if state == "timeout" else
            "thread writer busy (desktop holds the session open)" if writer_busy
            else "codex exited without turn.completed",
            "usage": usage,
        }
        _atomic_write_json(jobs_dir / ("%s.json" % args.batch), record)
        if args.notify:
            if state == "completed":
                preview = (answer or "").strip().replace("\n", " ")[:80]
                _notify("GPT 已应答（%ds）" % round(duration), preview or "无文本答复")
            elif state == "timeout":
                _notify("Codex 唤醒超时", "已达 --timeout-minutes 上限，进程树已终止")
            else:
                _notify("Codex 唤醒失败", "writer busy" if writer_busy else "退出码 %s" % exit_code)
        result = {"ok": state == "completed", "state": state,
                  "writerBusy": writer_busy, "sessionId": session_id,
                  "returnedSessionId": reported_id,
                  "cleanupUncertain": cleanup_uncertain,
                  "answer": answer,
                  "usage": usage, "durationSeconds": duration,
                  "exitCode": exit_code, "jobsRecord":
                  str(jobs_dir / ("%s.json" % args.batch)),
                  "outDir": str(out_dir)}
        print(json.dumps(result, ensure_ascii=False))
        if state == "completed":
            return EXIT_OK
        if writer_busy:
            return EXIT_THREAD_BUSY
        return EXIT_TIMEOUT if state == "timeout" else EXIT_EXEC_FAILED
    finally:
        # P2-5: 超时杀树后仍无法确认进程消亡时保留会话锁，不盲放行下一次唤醒。
        if not cleanup_uncertain:
            lock.release()


def cmd_pin(args):
    session_id = args.session_id
    if not session_id:
        session_id, turn_path = discover_newest_session(args.codex_home, args.cwd)
        if not session_id:
            print(json.dumps({"ok": False, "error": "no session found for cwd",
                              "cwd": args.cwd}), file=sys.stderr)
            return EXIT_NO_PIN
    else:
        turn_path = find_newest_turn_file(args.codex_home, session_id)
    newest = find_newest_turn_file(args.codex_home, session_id)
    stable = is_stable(newest, args.stable_seconds) if newest else False
    payload = {"session_id": session_id, "cwd": args.cwd,
               "pinnedAt": _now_iso(), "rolloutHint": str(newest) if newest else None,
               "stableAtPin": stable}
    home = pathlib.Path(args.home)
    home.mkdir(parents=True, exist_ok=True)
    _atomic_write_json(home / "session.json", payload)
    print(json.dumps({"ok": True, "sessionId": session_id,
                      "rolloutHint": payload["rolloutHint"],
                      "stable": stable}, ensure_ascii=False))
    return EXIT_OK


def cmd_list(args):
    index_path = pathlib.Path(args.codex_home) / "session_index.jsonl"
    rows = []
    if index_path.is_file():
        with open(index_path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
    rows = rows[-args.limit:]
    if args.cwd:
        known = {_norm_cwd(args.cwd)}
        matched_ids = set()
        for path in iter_turn_files(args.codex_home, max_depth_days=5):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    meta = json.loads(handle.readline()).get("payload", {})
            except (OSError, ValueError):
                continue
            meta_cwd = meta.get("cwd")
            if meta_cwd and _norm_cwd(meta_cwd) in known:
                matched_ids.add(meta.get("session_id") or meta.get("id"))
        rows = [row for row in rows if row.get("id") in matched_ids]
    for row in rows:
        print(json.dumps({"id": row.get("id"),
                          "thread_name": (row.get("thread_name") or "")[:60],
                          "updated_at": row.get("updated_at")},
                         ensure_ascii=False))
    return EXIT_OK


def cmd_event_log(args):
    """持久事件登记：向回调日志登记 event_id，返回是否重复。
    回调发送方先调用本命令，duplicate=true 时不得再次唤醒。"""
    path = pathlib.Path(args.home) / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    try:
                        if json.loads(line).get("event_id") == args.event_id:
                            print(json.dumps({"duplicate": True,
                                              "eventId": args.event_id}))
                            return EXIT_OK
                    except ValueError:
                        continue
    entry = {"event_id": args.event_id, "loggedAt": _now_iso(),
             "detail": args.detail or ""}
    with open(str(path), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(json.dumps({"duplicate": False, "eventId": args.event_id}))
    return EXIT_OK


def build_parser():
    parser = argparse.ArgumentParser(
        description="Wake the pinned Codex session in the same conversation.")
    parser.add_argument("--home", default=default_home(),
                        help="bridge home (default $CODEX_HOME/headroom-cache/codex-bridge)")
    parser.add_argument("--codex-home", default=default_codex_home(),
                        help="Codex home holding sessions/ (default $CODEX_HOME)")
    parser.add_argument("--cli", default=None,
                        help="codex executable (default vendor codex.exe or PATH)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_pin = sub.add_parser("pin", help="pin the shared session id")
    p_pin.add_argument("--session-id", default=None,
                       help="explicit thread id; default: newest session for --cwd")
    p_pin.add_argument("--cwd", default=os.getcwd())
    p_pin.add_argument("--stable-seconds", type=float, default=10.0)
    p_pin.set_defaults(func=cmd_pin)

    p_list = sub.add_parser("list", help="list recent sessions from session_index")
    p_list.add_argument("--cwd", default=None,
                        help="only sessions whose rollout meta cwd matches")
    p_list.add_argument("--limit", type=int, default=10)
    p_list.set_defaults(func=cmd_list)

    p_wake = sub.add_parser("wake", help="inject a prompt into the pinned session")
    p_wake.add_argument("--session-id", default=None,
                        help="override the pinned session id")
    p_wake.add_argument("--prompt-file", required=True,
                        help="prompt text file, or '-' for stdin")
    p_wake.add_argument("--sandbox", choices=SANDBOX_CHOICES,
                        default="read-only",
                        help="default read-only; execution dispatches pass "
                             "workspace-write explicitly")
    p_wake.add_argument("--batch", default=None,
                        help="registry record id (default wake-<pid>-<ts>)")
    p_wake.add_argument("--title", default="codex wake")
    p_wake.add_argument("--cwd", default=os.getcwd(),
                        help="reported worktree for the registry record")
    p_wake.add_argument("--timeout-minutes", type=float, default=15.0)
    p_wake.add_argument("--wait-writer-minutes", type=float, default=0.0,
                        help="when the thread writer lock is held (desktop has "
                             "the conversation open), retry until released; 0 "
                             "reports busy immediately")
    p_wake.add_argument("--log", type=pathlib.Path, default=None,
                        help="controller-pinned event log path (mirrors run_glm "
                             "--log so jobs records attribute by id/worktree/log)")
    p_wake.add_argument("--add-dir", action="append", type=pathlib.Path,
                        default=[], dest="add_dirs",
                        help="extra writable directory for the codex sandbox "
                             "(e.g. the control job dir holding the report)")
    p_wake.add_argument("--notify", action="store_true",
                        help="Windows balloon toast on waiting/completed/failed "
                             "so the operator can keep the desktop visible")
    p_wake.add_argument("--stable-seconds", type=float, default=30.0)
    p_wake.add_argument("--skip-stable", action="store_true")
    p_wake.add_argument("--poll-seconds", type=float, default=2.0)
    p_wake.set_defaults(func=cmd_wake)

    p_evt = sub.add_parser("event-log",
                           help="register a callback event id (dedup log)")
    p_evt.add_argument("--event-id", required=True)
    p_evt.add_argument("--detail", default="")
    p_evt.set_defaults(func=cmd_event_log)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.cli is None:
        args.cli = default_cli()
    if args.command == "wake" and not args.batch:
        args.batch = "wake-%d-%s" % (
            os.getpid(),
            datetime.datetime.now(datetime.timezone.utc).strftime("%H%M%S"))
    if args.command == "wake" and args.timeout_minutes <= 0:
        parser.error("--timeout-minutes must be positive")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
