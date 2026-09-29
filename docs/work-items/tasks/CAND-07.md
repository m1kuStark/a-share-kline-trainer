# CAND-07

```json
{
  "id": "CAND-07",
  "title": "基线裁定记录：58cc210/5bf4484 用户拍板并入基线",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M5",
  "summary": "纯记录任务（不合码、不跑门禁）：记录用户 2026-09-29 裁定——UI-03 实现 58cc210 与 stock-search fix 5bf4484（基线尖端本身，其父提交即 58cc210）已并入基线 5bf4484，无需 cherry-pick/merge/重跑全量门禁；在 UI-03 卡记录裁定并修正其待提升类过时表述（integration_ref 回填 main@58cc210），status.md 由生成器派生；8899 测试包用户复验仍待完成，归 V1-ACCEPT-01 组织。",
  "next_action": "裁定记录与卡面修正完成；剩余为 V1-ACCEPT-01 组织的 8899 用户复验及五项验收回填。",
  "base_commit": "06711b4ea0acd71c9063df59c675dcebd4a2d6d2",
  "allowed_paths": [
    "docs/status.md",
    "docs/work-items/tasks/CAND-07.md",
    "docs/work-items/tasks/UI-03.md"
  ],
  "depends_on": [
    "CAND-03",
    "V1-ACCEPT-01"
  ],
  "docs_impact": {
    "reason": "裁定记录仅触及 UI-03 卡与状态页生成区；不改任何产品代码，不做并码动作。",
    "update": []
  },
  "verification_refs": [],
  "integration_ref": "main@5bf4484a37a5a233ff12524cafd0166390cb274b",
  "acceptance_ref": null
}
```

## 裁定记录（2026-09-29，git 实测）

- 裁定内容（用户 2026-09-29）：58cc210（UI-03 实现「feat(launcher): UI-03 tier-startdate linkage, simplified custom range with auto-clamp, dual-input stock search with pinyin initials」）与 5bf4484（stock-search fix「return only public fields from searchStockIndex (no index internals in API payload)」，即基线尖端本身）并入基线。
- 实测：`git log -1 --format="%h parents:%p" 5bf4484` → parents:58cc210，即裁定对象本就在基线链上（5bf4484 为 main tip）；`git merge-base --is-ancestor 58cc210 5bf4484` 通过。无需 cherry-pick/merge/重跑全量门禁（全量门禁 verify:baseline 仍按 CAND-03 骨架归集成阶段）。
- 卡面修正：UI-03 next_action 以裁定领起，移除隐含「实现未入基线」的过时框架；integration_ref 由 null 回填 main@58cc210（58cc210 不在 integration/product-integration-20260926 上，系 V1 测试基线主线提交，故用 main@ 前缀）；卡内新增「基线裁定」节。
- 未竟事项如实保留：8899 测试包用户复验仍待完成（V1-ACCEPT-01 组织，record 骨架 status=not_performed）；用户验收通过前不提升发布；UI-03 状态保持 review。
