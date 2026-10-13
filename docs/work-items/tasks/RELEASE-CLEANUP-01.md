# RELEASE-CLEANUP-01 GitHub Release 治理与定版 v1.3.0

```json
{
  "id": "RELEASE-CLEANUP-01", "title": "清理贸然发布的 v1.3.x release，全部修复合入后定版重发 v1.3.0（可加 v1.3.1 供 update 测试，测后清理）", "owner": "zcode:release-cleanup",
  "state": "queued", "milestone": "R5",
  "summary": "用户批评：GitHub 上多出很多没用的 v1.3.x release（v1.3.0/1/2/3 四个并存，每个 7 资产）。目标态：最终发布版本号仍为 v1.3.0；可增加 v1.3.1 用于测试 update 功能，测试+用户验收通过后清理，保持 release 目录可用性。",
  "next_action": "在 T1/T2/T3/T5 修复合入 main 后执行：删 v1.3.1/2/3（及新 v1.3.0）release+tag→版本号回到 1.3.0 重建定版→（可选）发 v1.3.1 测试版→CloudBase 镜像同步。所有 outward-facing 动作执行前需向用户呈报执行清单确认。",
  "allowed_paths": ["docs/verification/2026-10/RELEASE-CLEANUP-01/", "desktop/scripts/release-desktop.mjs", "desktop/scripts/sync-feed.mjs", "package.json", "docs/work-items/tasks/RELEASE-CLEANUP-01.md"],
  "depends_on": ["TDX-RECONNECT-01", "REPLAY-VIEWPORT-01", "MIG-ONECLICK-01", "INSTALLER-UPGRADE-01"],
  "docs_impact": { "update": [], "reason": "发布流程文档需沉淀本轮版本治理决策。" },
  "verification_refs": [], "integration_ref": null, "acceptance_ref": null
}
```

用户原话（oracle）：「由于你的贸然发布，github 上多出了很多没用的 v1.3.x 版本 release 包」「最终发布版本号仍设定为 v1.3.0」「可以增加一个 v1.3.1 版本用于测试 update 功能，但是经过你的测试和我的验收都通过之后，就要清理掉，避免影响 github release 目录的可用性」（2026-10-13 第五轮任务 4）。
