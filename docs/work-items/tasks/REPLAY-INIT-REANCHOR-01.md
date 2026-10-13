# REPLAY-INIT-REANCHOR-01 回放普通跨日重锚拉回实时位（相邻问题登记，未排期）

```json
{
  "id": "REPLAY-INIT-REANCHOR-01", "title": "回放普通跨日（无画线变化）init 重锚会把用户已平移的历史位视口拉回实时位", "owner": "unassigned",
  "state": "queued", "milestone": "R5",
  "summary": "REPLAY-VIEWPORT-01 修复过程中发现的相邻问题：普通跨日 loader 'init' 路径会把视口重锚到实时位（带右侧空白），若用户已平移到历史位，推进一日会被拉回实时位。SessionReplay.vue 头注『缩放/平移跨日保留』对此名不副实。不属 REPLAY-VIEWPORT-STEADY-ADVANCE 行违约（EARS 限定未平移用户）。",
  "next_action": "未排期；用户如认为历史位保持重要再立项。",
  "allowed_paths": [], "depends_on": ["REPLAY-VIEWPORT-01"],
  "docs_impact": { "update": [], "reason": "仅登记。" }, "verification_refs": [], "integration_ref": null, "acceptance_ref": null
}
```
