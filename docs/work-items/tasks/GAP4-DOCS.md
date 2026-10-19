# GAP4-DOCS SmartScreen 与杀软拦截用户指引

```json
{
  "id": "GAP4-DOCS",
  "title": "troubleshooting 补 SmartScreen 放行与杀软拦更新自救指引",
  "owner": "integrator",
  "state": "active",
  "milestone": "DOC",
  "summary": "复盘缺口 G4（用户 2026-10-19 拍板）：docs/user/troubleshooting.md 补两段——①SmartScreen「更多信息→仍要运行」操作路径（exe 未签名，属预期提示）；②杀软/ Defender 拦截更新的自救（含 .old 已回滚场景：重新下载全量包覆盖安装），并加「报障时提供什么信息」清单（版本号在设置→关于与更新可见等，不前向引用未发布功能）。不做代码签名（复盘已定，成本档位不匹配）。零代码改动。",
  "next_action": "撰写两段指引＋报障清单；docs:check 过（新增错误为零）。",
  "allowed_paths": [
    "docs/user/**",
    "docs/verification/**",
    "docs/work-items/tasks/GAP4-DOCS.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/user/troubleshooting.md"
    ],
    "reason": "公开分发后用户第一大类环境问题缺少自助指引。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 验收要点

- 覆盖两大场景＋报障信息清单；语言面向非技术用户、给逐步操作。
- 不含前向引用（不提未发布按钮）。
