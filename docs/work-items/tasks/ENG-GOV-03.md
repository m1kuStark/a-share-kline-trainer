# ENG-GOV-03 发布 tag 与追溯基线

```json
{
  "id": "ENG-GOV-03",
  "title": "发布 tag 与追溯基线（v1.3.4–v1.3.6 回填 + v1.3.6 pre-release）",
  "owner": "integrator",
  "state": "closed",
  "milestone": "ENG",
  "base_commit": "da87d14",
  "summary": "补齐发布追溯：新增 scripts/release/tag-release.mjs（校验 main/干净树/版本/CHANGELOG/CI/tag 冲突，签名 annotated tag，可选 push/release）与纯函数测试；为 v1.3.4/v1.3.5/v1.3.6 在版本提交处补签名 tag；GitHub 只把 v1.3.6 发成 pre-release（setup/zip/SHA256SUMS），latest 稳定版仍是 v1.3.3；更新发布文档与验证记录。",
  "next_action": "治理收尾（GOV-CLOSE-01）；用户 2026-11-12 指示收尾并转产品开发；分项用户验收未单独记录。",
  "allowed_paths": [
    "package.json",
    "scripts/release/tag-release.mjs",
    "server/test/release-tag.test.ts",
    "docs/engineering/release.md",
    "docs/work-items/tasks/ENG-GOV-03.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/ENG-GOV-03/**"
  ],
  "depends_on": ["ENG-GOV-01"],
  "docs_impact": {
    "update": [
      "docs/engineering/release.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/ENG.md",
      "docs/status.md"
    ],
    "reason": "新增 tag/release 自动校验脚本与发布操作规范；v1.3.4–1.3.6 的 tag/pre-release 状态属于发布口径变化，需同步发布文档、任务/阶段索引与状态页。"
  },
  "verification_refs": ["docs/verification/2026-11/ENG-GOV-03/README.md"],
  "integration_ref": "6ba431b15d7412a9c85d57457f52f32da3c4f1dc",
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-11 继续执行）

- 只从 main/版本提交打 tag；tag 必须 annotated + SSH 签名。
- v1.3.4 / v1.3.5 / v1.3.6 分别打在 100f5c8 / 3ef59fe / 527ab29（package.json 版本对应 1.3.4/1.3.5/1.3.6）。
- GitHub 只发布 v1.3.6 为 **pre-release**，资产为 setup exe、ZIP、SHA256SUMS；latest 稳定指针保持 v1.3.3。
- 不回溯发布 v1.3.4/v1.3.5 的 GitHub Release；tag 只用于追溯。
- 不修改已发布产物；不把 preview 写成稳定版。

## 验收

1. tag-release 脚本 dry-run 校验通过；纯函数测试通过；`npm run release:tag -- --dry-run` 不产生副作用。
2. 三个 tag 在 GitHub 可见且签名可验证，指向正确版本提交。
3. v1.3.6 为 pre-release，资产 SHA256 与本地 SHA256SUMS 一致；GitHub latest 仍为 v1.3.3。
4. PR 的 docs/verify/pr-policy 全绿；main CI 绿；验证记录与 integration_ref 回填。