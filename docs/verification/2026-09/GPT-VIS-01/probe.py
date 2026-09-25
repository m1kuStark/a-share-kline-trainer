# -*- coding: utf-8 -*-
"""GPT-VIS-01 只读探测：以自有子进程运行 `codex app-server`（stdio JSON-RPC），
验证协议握手与线程读取。不做 turn/start（写操作）——那一步另行决定。"""
import json
import os
import subprocess
import sys
import threading
import time

SESSION = "01a0d79e-979c-7b80-a28a-448eefa402ca"
CODEX = os.environ.get("CODEX_CMD", "codex.cmd")

proc = subprocess.Popen([CODEX, "app-server"], stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        text=True, encoding="utf-8", bufsize=1)
messages = {}
notifications = []
done = threading.Event()


def reader():
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if "id" in msg:
            messages[msg["id"]] = msg
        else:
            notifications.append(msg.get("method", "?"))


threading.Thread(target=reader, daemon=True).start()


def rpc(method, params=None, rid=[0]):
    rid[0] += 1
    req = {"jsonrpc": "2.0", "id": rid[0], "method": method}
    if params is not None:
        req["params"] = params
    proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()
    deadline = time.time() + 20
    while rid[0] not in messages:
        if time.time() > deadline:
            return {"error": {"message": "timeout waiting for %s" % method}}
        time.sleep(0.1)
    return messages[rid[0]]


def brief(result):
    if isinstance(result, dict):
        text = json.dumps(result, ensure_ascii=False)
        return text[:600]
    return str(result)[:600]


try:
    print("== initialize ==")
    init = rpc("initialize", {"clientInfo": {"name": "orch-investigator",
                                             "title": "ORCH Investigator",
                                             "version": "0.0.1"}})
    print(brief(init.get("result") or init.get("error")))

    print("== thread/list ==")
    lst = rpc("thread/list", {"cursor": None, "pageSize": 5})
    r = lst.get("result") or {}
    print("keys:", sorted(r.keys()))
    for t in (r.get("threads") or r.get("items") or [])[:5]:
        if isinstance(t, dict):
            print("  thread:", t.get("id"), "|", str(t.get("name", ""))[:40],
                  "| updated:", t.get("updatedAt"))
    print(brief(lst.get("error") or "")[:200])

    print("== thread/loaded/list ==")
    loaded = rpc("thread/loaded/list", {})
    print(brief(loaded.get("result") or loaded.get("error")))

    print("== thread/read (%s) ==" % SESSION[:8])
    read = rpc("thread/read", {"threadId": SESSION})
    if "result" in read:
        res = read["result"]
        items = res.get("items") or res.get("thread", {}).get("items") or []
        print("read ok; items:", len(items) if isinstance(items, list) else "?",
              "| keys:", sorted(res.keys()))
    else:
        print("error:", brief(read.get("error")))
finally:
    proc.kill()
