# REL-MIGRATE-SCOPE-01 migrate 资产期望集收窄（v1.3.0 专属）

```json
{
  "id": "REL-MIGRATE-SCOPE-01",
  "title": "verify-release-assets 期望集：migrate-v127.zip 仅对 v1.3.0 期望",
  "owner": "integrator",
  "state": "planned",
  "milestone": "REL",
  "summary": "用户 2026-10-19 批复 3：migrate-v127.zip 是 v1.3.0 发布时专属连带的 v1.2.7→v1.3.x 数据迁移工具，其他 v1.3.x 版本不需要连带。改动：desktop/scripts/verify-release-assets*.mjs 期望集推导——migrate 条目默认仅对 v1.3.0 期望（新增 --migrate-tags 参数，缺省 v1.3.0，逗号分隔可扩展）；单测同步（含「v1.3.1 无 migrate 行＝合法」场景）；发布手册 desktop-release-manual.md 补口径：后续 v1.3.x 发布不连带 migrate 资产、SHA256SUMS-desktop 亦不含该行，v1.2.7 用户从 v1.3.0 release 获取迁移工具。线上 v1.3.1 已存在的 migrate 资产不删（历史 release 不动）。零产品码。",
  "next_action": "TDD 改期望集推导与单测；对 v1.3.1 线上复跑核对应仍 PASS（新口径）；手册补节。",
  "allowed_paths": [
    "desktop/scripts/**",
    "desktop/test/**",
    "docs/release/**",
    "docs/verification/**",
    "docs/work-items/tasks/REL-MIGRATE-SCOPE-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/release/desktop-release-manual.md"
    ],
    "reason": "发布资产口径变更需入手册，v1.3.2 发布轮直接依此执行。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 验收要点

- v1.3.0 核对（--expect-latest）仍 PASS（期望集含 migrate）。
- v1.3.1 核对在新口径下 PASS 且不再依赖「期望集硬含 migrate」补齐（报告显示 migrate 属非期望多余资产时应容忍或按 asset-extra 规则处理——注意与「多余资产判缺陷」既有规则的一致性：非 migrate-tags 的 migrate 资产按已知豁免处理并在输出注明，不判缺陷）。
