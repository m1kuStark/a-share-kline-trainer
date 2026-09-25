# -*- coding: utf-8 -*-
"""GPT-VIS-01 决定性写探查：经自有 app-server 对 Desktop 正打开的会话
resume＋turn/start（显式 readOnly 沙箱＋never 审批，标注探测消息）。
验证：写入者锁是否同样拦截 daemon 协议路径；事件流形态如何。"""
import json
import os
import subprocess
import sys
import threading
import time

SESSION = "01a0d79e-979c-7b80-a28a-448eefa402ca"
PROMPT = "【GPT-VIS-01 调研探测·可忽略】这是经 app-server 协议注入的链路验证。请只回复四个字：探针正常。不要执行任何操作。"

proc = subprocess.Popen(["codex.cmd", "app-server"], stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        text=True, encoding="utf-8", bufsize=1)
messages = {}
notifications = []


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
            notifications.append(msg)


threading.Thread(target=reader, daemon=True).start()


def rpc(method, params=None, timeout=60):
    results["id"] += 1
    rid = results["id"]
    req = {"jsonrpc": "2.0", "id": rid, "method": method}
    if params is not None:
        req["params"] = params
    proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()
    deadline = time.time() + timeout
    while rid not in messages:
        if time.time() > deadline:
            return {"error": {"message": "timeout: " + method}}
        time.sleep(0.1)
    return messages[rid]


results = {"id": 0}
try:
    print("initialize:", json.dumps(
        (rpc("initialize", {"clientInfo": {"name": "orch-investigator",
                                           "title": "ORCH Investigator",
                                           "version": "0.0.1"}})
         .get("result") or {}).get("codexHome", "?")))

    print("== thread/resume ==")
    res = rpc("thread/resume", {"threadId": SESSION})
    print(" result keys:", sorted((res.get("result") or {}).keys()) or
          res.get("error"))

    print("== turn/start (readOnly + never) ==")
    start = time.time()
    turn = rpc("turn/start", {
        "threadId": SESSION,
        "input": [{"type": "text", "text": PROMPT}],
        "sandboxPolicy": {"type": "readOnly"},
        "approvalPolicy": "never",
        "cwd": r"D:\Superlinear_Academy\Stock_WorkSpace",
    }, timeout=240)
    if "error" in turn:
        print(" ERROR:", json.dumps(turn["error"], ensure_ascii=False)[:300])
    else:
        turn_id = ((turn.get("result") or {}).get("turn") or {}).get("id")
        print(" turn started id=%s，等待完成事件…" % str(turn_id)[:20])
        deadline = time.time() + 240
        agent_text = []
        seen = set()
        completed = False
        while time.time() < deadline and not completed:
            time.sleep(0.3)
            for n in list(notifications):
                key = json.dumps(n, sort_keys=True)[:80]
                if key in seen:
                    continue
                seen.add(key)
                method = n.get("method", "")
                if method.endswith("AgentMessageDelta"):
                    delta = ((n.get("params") or {}).get("delta") or {})
                    agent_text.append(delta.get("delta") or delta.get("text") or "")
                if method in ("turn/completed", "TurnCompletedNotification",
                              "turn/aborted"):
                    completed = True
        print(" notifications:", len(notifications), "| sample methods:",
              sorted({n.get("method", "?") for n in notifications})[:10])
        print(" agent text:", ("".join(agent_text)).strip()[:120])
        print(" completed flag:", completed, "| elapsed %.1fs" % (time.time() - start))
finally:
    proc.kill()
