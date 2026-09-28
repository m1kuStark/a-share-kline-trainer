# SETUP-CLUES-02 诊断组合

```json
{
  "id": "SETUP-CLUES-02",
  "title": "SETUP-01 第二片：候选诊断组合",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "candidate-diagnostics.ts 把 process-clues 结果与 inspectTdxCandidates 组合成诊断数组：running-process+manual 双来源、首次出现顺序、Windows 大小写不敏感去重、单次 inspect、返回顺序与 inspect 一致、五态与 reason 原样透传。测试 9/9（注入 stub），零真实 TDX/进程读取。",
  "next_action": "GPT 定向复核；后续受保护 setup API 与原生选择/保存/重启切片按边界另片冻结。",
  "allowed_paths": [
    "server/src/tdx/candidate-diagnostics.ts",
    "server/test/candidate-diagnostics.test.ts",
    "docs/work-items/tasks/SETUP-CLUES-02.md"
  ],
  "depends_on": ["SETUP-CLUES-01"],
  "base_commit": "6c93aeae52f87b7806ce96f10b577a714e84fecd",
  "docs_impact": {
    "reason": "SETUP-01 第二片冻结合同（SETUP-01-clues-contract.md 派发）授权的三文件切片；纯组合，不接 HTTP/UI/config/launcher，不保存路径、不自动选择、不重启。",
    "update": ["docs/work-items/tasks/SETUP-CLUES-02.md"]
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结接口

- `CandidateSource = 'running-process' | 'manual'`
- `TdxCandidateDiagnostic = { check: TdxCandidateCheck; sources: CandidateSource[] }`
- `collectTdxCandidateDiagnostics(input, inspect?)`：候选根 = process.clues 根 + manualRoots，首次出现顺序，Windows 大小写不敏感去重；同根两来源合并（running-process 在前）；去重后 roots 单次传 inspect；返回顺序与 inspect 结果一致；process 五态与 reason 原样透传；无 roots 时不调用 inspect 正常返回空。默认 inspect 为已有 inspectTdxCandidates（未修改）。

## 门禁

- candidate-diagnostics 9/9（合并/去重/顺序/单次 inspect/reason 保留/空结果）；相邻 process-clues/discover/tdx-inspect 合计 61/61；build:server 退出 0；docs:check 0 错误（日志见 attempt-glm-coord-01/logs/setup-clues02-*.log）。
