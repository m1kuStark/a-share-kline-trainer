# UPD-BUSY-HEAL-01 更新链陈旧 busy 状态无感自愈

```json
{
  "id": "UPD-BUSY-HEAL-01",
  "title": "zip 更新链陈旧 busy 自愈：自动诊断＋同请求重试放行，用户无感",
  "owner": "integrator",
  "state": "review",
  "milestone": "UPD",
  "summary": "冷审 P1-G1 修复（用户 2026-10-19 批复 2：无感路径，已知根因报错应能自动诊断与处理）。现状：更新器/服务在五 busy 态任一被杀后，apply 守卫永久 409 UPDATE_IN_PROGRESS（api.ts:325-328 持久读 status；status.ts:92-99 reconcile 仅 restarting→completed；全 server/src 无陈旧复位路径——证据：docs/verification/2026-10/U5-BRIEF/cold-review.md G1 条）。修复：apply（及受影响入口）遇 busy 先判陈旧（状态 updatedAt 超阈值且无活跃 attempt/进程），陈旧则自动复位为 failed（人话原因入日志）并在同一请求内自动重试放行——用户不看到报错；真 busy 仍守卫 409。启动期 reconcile 同步补陈旧 busy 复位。矩阵行 UPD-STALE-BUSY-SELFHEAL 已由 root 预登记（updater.yaml，worker 不得编辑矩阵）。",
  "next_action": "修复已合入main；共享updater矩阵UPD-STALE-BUSY-SELFHEAL现有test_ids且为covered，无需重复回填。ENG-HEALTH-02完整轮仍记录updater-stale-busy失败、隔离通过，不据历史或隔离绿认定当前完整基线通过；保留review。",
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
  "verification_refs": ["docs/verification/2026-10/U5-BRIEF/cold-review.md","docs/verification/2026-11/ENG-PLAN-01/reconciliation.md","docs/verification/2026-10/UPD-BUSY-HEAL-01/README.md"],
  "integration_ref": "main@3f68a3247d8e0132abdf8daa41ce6d52aa8eedac",
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 验收要点

- 陈旧 busy（构造超阈值状态文件）→ apply 不再 409：自动复位＋同请求重试成功，日志含人话原因。
- 真 busy（新鲜状态）→ 仍 409 UPDATE_IN_PROGRESS（守卫语义不破，既有守卫测试回归绿）。
- 阈值（如 30 分钟，冷审建议值）为 proposed_default，env 可覆盖。
- 启动期 reconcile：陈旧 busy 复位为 failed（不误伤 restarting→completed 既有路径）。
