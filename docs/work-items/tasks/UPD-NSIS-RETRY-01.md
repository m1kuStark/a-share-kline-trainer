# UPD-NSIS-RETRY-01 NSIS 安装中断自愈重试

```json
{
  "id": "UPD-NSIS-RETRY-01",
  "title": "桌面链更新意图标记＋启动校验：安装中断后静默自动重走更新",
  "owner": "integrator",
  "state": "planned",
  "milestone": "UPD",
  "summary": "冷审 P1-2 修复（用户 2026-10-19 批复 2：无感自动诊断与处理）。现状：NSIS 静默安装中断（A6/A7 窗口）后应用可能停在旧版本且无人知晓——repo 无观测无恢复，缓存 setup 路径无 UI 暴露（证据：cold-review.md A6/A7 条）。修复：quitAndInstall 排空退出前在数据目录落「更新意图标记」（fromVersion/toVersion/时间戳）；下次启动校验——版本==target 清标记（成功收尾）；版本≠target 且标记在 → 静默自动重走 check→download→verify→install（有界重试，超界才呈现人话指引），用户不感知中断发生过。矩阵行 UPD-NSIS-INTENT-RETRY 已由 root 预登记（worker 不得编辑矩阵）。硬约束：不改 GAP1 冻结的诊断字段集（DESKTOP-DIAG-CLIPBOARD EARS），信息呈现走更新状态既有面。",
  "next_action": "读 desktop 更新控制器与 boot 检查既有编排（update-boot-check/cn-feed/drain）→RED（标记在＋版本不符场景）→实现标记/校验/重触发→desktop 全量回归。",
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
