# SETUP-CLUES-01 运行进程线索

```json
{
  "id": "SETUP-CLUES-01",
  "title": "SETUP-01 首片：只读运行进程线索",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "process-clues.ts 从注入的进程查询结果提取通达信安装根目录线索（保留 running-process 来源）：标准 bin 布局/中文空格路径/大小写去重/数量上限，ok、timeout、denied、unavailable、not_applicable 五态可区分；生产查询为固定 powershell 字面脚本＋参数数组＋有界超时。测试 12/12，零真实进程/配置读取。",
  "next_action": "GPT 定向复核；后续切片（inspect 组合、受保护端点、原生选择、原子保存、受控重启）按边界另片。",
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
  "verification_refs": [],
  "integration_ref": null,
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
