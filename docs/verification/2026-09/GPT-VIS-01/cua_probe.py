# -*- coding: utf-8 -*-
"""GPT-VIS-01 Computer Use 探针：以 stdio MCP 客户端驱动 zcode-cua 服务器。

用法：
  py cua_probe.py list                     # 列工具
  py cua_probe.py state <AppName>          # 读取应用可访问性状态
  py cua_probe.py call <tool> <json-args>  # 调用任意工具
"""
import json
import os
import subprocess
import sys
import threading
import time

SERVER_JS = (r"C:\Users\Stark_Du666\.zcode\cli\plugins\cache"
             r"\zcode-plugins-official\zcode-cua\0.5.12\dist\mcp\server.js")
ZCODE_EXE = r"D:\MySoftWares\Zcode\ZCode.exe"
ZCODE_CJS = r"D:\MySoftWares\Zcode\resources\glm\zcode.cjs"

_id = [0]
messages = {}


def reader(stdout):
    for line in stdout:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if isinstance(msg, dict) and "id" in msg:
            messages[msg["id"]] = msg


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "list"
    proc = subprocess.Popen(
        [ZCODE_EXE, ZCODE_CJS, "__zcode-plugin-host", SERVER_JS],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, encoding="utf-8", bufsize=1,
        env={**os.environ, "ELECTRON_RUN_AS_NODE": "1",
             "ZCODE_PLUGIN_ID": "zcode-cua@zcode-plugins-official"})
    threading.Thread(target=reader, args=(proc.stdout,), daemon=True).start()

    def rpc(method, params=None, timeout=30):
        _id[0] += 1
        rid = _id[0]
        req = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            req["params"] = params
        proc.stdin.write(json.dumps(req) + "\n")
        proc.stdin.flush()
        deadline = time.time() + timeout
        while rid not in messages:
            if time.time() > deadline:
                return {"error": "timeout: " + method}
            time.sleep(0.05)
        return messages[rid]

    def notify(method, params=None):
        note = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            note["params"] = params
        proc.stdin.write(json.dumps(note) + "\n")
        proc.stdin.flush()

    init = rpc("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "orch-cua-probe", "version": "0.0.1"}})
    if "error" in init or "result" not in init:
        print("INIT FAILED:", json.dumps(init, ensure_ascii=False)[:300])
        proc.kill()
        return 1
    notify("notifications/initialized")

    if action == "list":
        tools = rpc("tools/list", {})
        for tool in (tools.get("result") or {}).get("tools", []):
            desc = (tool.get("description") or "")[:90]
            print("-", tool.get("name"), "|", desc)
    elif action == "state":
        app = sys.argv[2] if len(sys.argv) > 2 else "Codex"
        res = rpc("tools/call", {"name": "get_app_state",
                                 "arguments": {"app": app}}, timeout=60)
        content = (res.get("result") or {}).get("content") or []
        for block in content:
            print(block.get("text", "")[:6000])
    elif action == "call":
        tool = sys.argv[2]
        args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        res = rpc("tools/call", {"name": tool, "arguments": args}, timeout=90)
        print(json.dumps(res.get("result", res), ensure_ascii=False)[:2000])
    proc.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
