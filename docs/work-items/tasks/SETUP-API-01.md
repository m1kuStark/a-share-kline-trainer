# SETUP-API-01 受保护候选诊断只读端点

```json
{
  "id": "SETUP-API-01",
  "title": "SETUP-01 第四片：受保护候选诊断只读端点",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "GET /api/setup/candidates 受 validateSetupRequest 保护（Host/Origin/Sec-Fetch-Site/控制令牌，失败结构化 401/403 且不调用诊断）；expectedHost 由配置监听 host:port 构造、不从请求 Host 反推；成功组合 defaultTdxCandidates＋collectProcessClues＋collectTdxCandidateDiagnostics 返回诊断；诊断异常结构化 503 SETUP_DIAGNOSTICS_UNAVAILABLE 不伪装空候选；TRAINER_CONTROL_TOKEN 环境只读透传 config.controlToken，不生成/不回显/不写日志。",
  "next_action": "GPT diff 审查（setup-api-01-complete-20260926-18）；通过后接后续切片（原生目录选择、原子保存、受控重启另片冻结）。",
  "allowed_paths": [
    "server/src/config.ts",
    "server/src/api.ts",
    "server/test/setup-api.test.ts",
    "docs/work-items/tasks/SETUP-API-01.md"
  ],
  "depends_on": ["SETUP-AUTH-01", "SETUP-CLUES-02", "SETUP-CLUES-01"],
  "base_commit": "7e7eb683f18b7192f56720abb6ba85a869bfafa1",
  "docs_impact": {
    "reason": "SETUP-API-01 冻结合同授权的切片；受保护只读诊断端点，不保存配置/不选择候选/不重启/不改全局 CORS/launcher/web/DB。",
    "update": ["docs/work-items/tasks/SETUP-API-01.md"]
  },
  "verification_refs": ["server/test/setup-api.test.ts"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 实现要点

- guard 先行：validateSetupRequest 任一失败（结构化 401/403）直接返回，不调用进程查询或目录检查。
- expectedHost 由配置 host:port 构造；expectedOrigin 为 `http://<expectedHost>`；请求 Host/Origin 逐字比较。
- TRAINER_CONTROL_TOKEN 只从环境读取透传 guard；不生成、不持久化、不回显、不写日志。空时浏览器同源路径仍工作，助手路径返回 TOKEN_UNCONFIGURED。
- 候选根 = defaultTdxCandidates() + collectProcessClues(processQuery)；collectTdxCandidateDiagnostics 单次 inspect；诊断异常结构化 503，不伪装空候选。
- registerApi 增加可选 setup 注入参数（processQuery/inspect stub）供合成测试；生产缺省走真实查询。

## 门禁记录

- setup-api 9/9 + SETUP 相邻（guard/clues/diagnostics/discover/tdx-inspect）合计 85/85，EXIT=0。
- build:server 退出 0；docs:check 0 错误；范围表单 E2E 复跑 4/4（冻结 TDX 样本 run-4ea2b497）。
- 日志：attempt-glm-coord-01/logs/setup-api-{tests,build,docs}.log。
