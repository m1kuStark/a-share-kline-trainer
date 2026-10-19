# UPD-BUSY-HEAL-01 更新链陈旧 busy 状态无感自愈

```json
{
  "id": "UPD-BUSY-HEAL-01",
  "title": "zip 更新链陈旧 busy 自愈：自动诊断＋同请求重试放行，用户无感",
  "owner": "integrator",
  "state": "planned",
  "milestone": "UPD",
  "summary": "冷审 P1-G1 修复（用户 2026-10-19 批复 2：无感路径，已知根因报错应能自动诊断与处理）。现状：更新器/服务在五 busy 态任一被杀后，apply 守卫永久 409 UPDATE_IN_PROGRESS（api.ts:325-328 持久读 status；status.ts:92-99 reconcile 仅 restarting→completed；全 server/src 无陈旧复位路径——证据：docs/verification/2026-10/U5-BRIEF/cold-review.md G1 条）。修复：apply（及受影响入口）遇 busy 先判陈旧（状态 updatedAt 超阈值且无活跃 attempt/进程），陈旧则自动复位为 failed（人话原因入日志）并在同一请求内自动重试放行——用户不看到报错；真 busy 仍守卫 409。启动期 reconcile 同步补陈旧 busy 复位。矩阵行 UPD-STALE-BUSY-SELFHEAL 已由 root 预登记（updater.yaml，worker 不得编辑矩阵）。",
  "next_action": "读码定位状态文件形状与活跃度信号（updatedAt/attemptId/pid 可用性）→RED（陈旧 busy 场景 409 复现）→实现自愈→真 busy 守卫回归不破。",
  "allowed_paths": [
    "server/src/**",
    "server/test/**",
    "docs/verification/**",
    "docs/work-items/tasks/UPD-BUSY-HEAL-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/UPD-BUSY-HEAL-01.md"
    ],
    "reason": "冷审 P1 修复的证据与验收记录承载。"
  },
  "verification_refs": [
    "docs/verification/2026-10/U5-BRIEF/cold-review.md"
  ],
  "integration_ref": null,
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 验收要点

- 陈旧 busy（构造超阈值状态文件）→ apply 不再 409：自动复位＋同请求重试成功，日志含人话原因。
- 真 busy（新鲜状态）→ 仍 409 UPDATE_IN_PROGRESS（守卫语义不破，既有守卫测试回归绿）。
- 阈值（如 30 分钟，冷审建议值）为 proposed_default，env 可覆盖。
- 启动期 reconcile：陈旧 busy 复位为 failed（不误伤 restarting→completed 既有路径）。
