# UPD-NSIS-RETRY-01 NSIS 安装中断自愈重试

```json
{
  "id": "UPD-NSIS-RETRY-01",
  "title": "桌面链更新意图标记＋启动校验：安装中断后静默自动重走更新",
  "owner": "integrator",
  "state": "review",
  "milestone": "UPD",
  "summary": "冷审 P1-2 修复（用户 2026-10-19 批复 2：无感自动诊断与处理）。现状：NSIS 静默安装中断（A6/A7 窗口）后应用可能停在旧版本且无人知晓——repo 无观测无恢复，缓存 setup 路径无 UI 暴露（证据：cold-review.md A6/A7 条）。修复：quitAndInstall 排空退出前在数据目录落「更新意图标记」（fromVersion/toVersion/时间戳）；下次启动校验——版本==target 清标记（成功收尾）；版本≠target 且标记在 → 静默自动重走 check→download→verify→install（有界重试，超界才呈现人话指引），用户不感知中断发生过。矩阵行 UPD-NSIS-INTENT-RETRY 已由 root 预登记（worker 不得编辑矩阵）。硬约束：不改 GAP1 冻结的诊断字段集（DESKTOP-DIAG-CLIPBOARD EARS），信息呈现走更新状态既有面。2026-10-19 实现完成：desktop/src/update-intent.ts＋main.ts 接线＋26 用例（desktop 全量 351/351 绿）；验证记录 docs/verification/2026-10/UPD-NSIS-RETRY-01/README.md；真机中断场景 deferred（gpu3060 关机）。",
  "next_action": "root 回填矩阵 UPD-NSIS-INTENT-RETRY 的 test_ids（清单见验证 README §6）并升 covered；真机中断自愈验收（gpu3060 可用时）。",
  "allowed_paths": [
    "desktop/src/**",
    "desktop/test/**",
    "docs/verification/**",
    "docs/work-items/tasks/UPD-NSIS-RETRY-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/UPD-NSIS-RETRY-01.md"
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

- 单测锁定：意图标记写入时机（排空退出前）、启动三分支（无标记/版本符→清/版本不符→自动重触发）、重试上界、超界人话指引。
- 与既有 UPD-BOOT-AUTO-CHECK / UPD-DL-WATCHDOG / 排空管线语义零冲突（相关既有测试全绿）。
- 真机中断场景（真装/真中断）登记 deferred（gpu3060 关机），文档注明。

## 完成记录（2026-10-19，worker 交付）

- 三条验收要点逐一满足：26 用例锁全部子语义（写时机/三分支/上界/人话，含任务卡指定的
  两个 RED 场景）；desktop 全量 vitest 33 文件 351/351 绿（exit=0，含 update-boot-check/
  desktop-updates-stall/installer-upgrade 等既有面）＋tsc build:desktop:main exit=0；
  真机中断 deferred 已登记（验证 README §7.1，含建议验收脚本）。
- 变异抽检 2 处均被杀手用例击杀（README §5）；test_ids 清单见验证 README §6（待 root 回填矩阵）。
- proposed_default 5 项（上界 3/give-up 清标记/文案/文件名与字段/persist 失败放弃本轮），
  见验证 README §8。
