# SETUP-CLUES-01 运行进程线索

```json
{
  "id": "SETUP-CLUES-01",
  "title": "SETUP-01 首片：只读运行进程线索",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "process-clues.ts 提取运行中通达信安装根目录线索，保留五态结果、固定 PowerShell 白名单、-First 8、UTF-8 字节上限和跨块中文路径安全；52 项定向测试通过。",
  "next_action": "候选已通过 GPT 定向复核并接入隔离产品候选；先冻结 inspect 组合与受保护 setup API 合同，再做后续接线。",
  "allowed_paths": [
    "server/src/tdx/process-clues.ts",
    "server/test/process-clues.test.ts",
    "docs/work-items/tasks/SETUP-CLUES-01.md"
  ],
  "depends_on": [],
  "base_commit": "c4006937cdbba374dbd93b3f87004bcf9f4aee87",
  "docs_impact": {
    "reason": "SETUP-01 首片冻结合同（SETUP-01-clues-contract.md）授权的三文件切片；只读线索提取，不接 HTTP/UI/保存/重启，不新增暴露本机路径的端点。",
    "update": ["docs/work-items/tasks/SETUP-CLUES-01.md"]
  },
  "verification_refs": [
    "server/test/process-clues.test.ts",
    "server/test/discover.test.ts",
    "server/test/tdx-inspect.test.ts"
  ],
  "integration_ref": "integration/product-integration-20260926@42378805f2302bafe3e951a7c89fd4cde9f1eba2",
  "acceptance_ref": null
}
```

## 合同边界（SETUP-01-clues-contract.md）

- 线索只表示"值得检查"，绝不等于可训练或自动生效；`running-process` 来源保留。
- 生产查询：固定 powershell 程序＋固定字面脚本参数数组（进程名白名单 TdxW.exe，可按证据扩充），限定超时 10s 与数量上限 8；不拼 shell、不读命令行/账号、不记录完整本机路径。
- 失败（denied/unavailable）、超时（timeout）、非 Windows（not_applicable）与"确实没有进程"（ok＋空 clues）分别可区分。
- 非 Windows 平台明确返回不适用；测试全程合成路径，不读真实 TDX/配置。

## 门禁

- process-clues 12/12、相邻 discover/inspect 测试、build:server、docs:check（日志见 attempt-glm-coord-01/logs/）。
