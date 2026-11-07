# F7-DEPS-01 依赖安全升级（vite / fast-uri / undici）

```json
{
  "id": "F7-DEPS-01",
  "title": "依赖安全升级：vite 7.3.7、fast-uri 3.1.9/4.2.3、undici 6.29.1/7.30.1",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "ae9f6b8",
  "summary": "按用户 Q9 拍板（本地等价 chore 提交，push 后关闭 Dependabot PR #4/#5/#6）：等价应用三处依赖安全/bug 修复——vite 7.3.6→7.3.7（devDependencies 范围 ^7.1.3→^7.3.7）、ajv 内嵌 fast-uri 3.1.8→3.1.9＋根 fast-uri 4.2.1→4.2.3（4 个 URI 解析/规范化安全修复）、node-gyp 内嵌 undici 6.29.0→6.29.1＋根 undici 7.30.0→7.30.1（5 个 TLS/DoS/EventSource/WebSocket 安全修复）。仅 package.json/package-lock.json 变更＋真实安装升级后全量门禁。",
  "next_action": "整批验收通过后随批合入 main 并推送；push 后关闭 PR #4/#5/#6 并注明已由本地等价提交覆盖。",
  "allowed_paths": [
    "package.json",
    "package-lock.json",
    "docs/work-items/tasks/F7-DEPS-01.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/F7-DEPS-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "维护性依赖升级（无产品行为/规格变化）；记录于任务卡与验证记录，不新增规格正文。"
  },
  "verification_refs": ["docs/verification/2026-11/F7-DEPS-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 等价对照（Dependabot PR → 本地提交）

| PR | 原升级 | 本地等价 |
|---|---|---|
| #4 | vite 7.3.6 → 7.3.7（devDependencies 范围 ^7.3.7） | 相同 |
| #5 | fast-uri 嵌套 3.1.8 → 3.1.9；根 4.2.1 → 4.2.3 | 相同 |
| #6 | undici 嵌套 6.29.0 → 6.29.1；根 7.30.0 → 7.30.1 | 相同 |

## 验证

- `npm install --ignore-scripts` 后实测：vite 7.3.7、根 fast-uri 4.2.3、嵌套 3.1.9、根 undici 7.30.1、嵌套 6.29.1。
- build + 全量测试（server+desktop）退出码 0；无新增断言/依赖。
- push 后回归 GitHub：关闭 #4/#5/#6，说明已由本地 chore 提交等价覆盖。
