# INSTALLER-UPGRADE-01 安装包升级检测与数据继承

```json
{
  "id": "INSTALLER-UPGRADE-01",
  "title": "新版本安装包检测本地已装版本与位置，触发升级路径继承数据完成更新",
  "owner": "zcode:installer-upgrade",
  "state": "planned",
  "milestone": "R5",
  "summary": "用户期望：已装 v1.3.x 的机器直接运行从 GitHub 下载的 v1.3.x+1 安装包时，安装包检测本地已装版本与安装位置，走升级路径（继承本地数据完成版本更新），而非全新安装语义。",
  "next_action": "先侦察 NSIS 默认行为（perMachine/perUser、安装位置记忆、覆盖升级语义、数据目录继承现状）→方案呈报（含 needs_user_decision 项）→再实现。矩阵行 INSTALLER-UPGRADE-DETECT 已预登记 planned。",
  "allowed_paths": [
    "desktop/electron-builder.yml",
    "desktop/build-resources/",
    "desktop/scripts/package-desktop.mjs",
    "desktop/test/",
    "docs/work-items/tasks/INSTALLER-UPGRADE-01.md",
    "docs/verification/2026-10/INSTALLER-UPGRADE-01/**"
  ],
  "depends_on": [
    "PACK-05"
  ],
  "docs_impact": {
    "update": [],
    "reason": "安装升级语义若与现状不同需更新发布/安装文档。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

用户原话（oracle）：「未来用户装了 v1.3.x 之后，又从 github 上下载 v1.3.x+1 的安装包……安装包程序需要检测本地已经安装的 K 线训练器的版本和安装位置，然后触发本体的 update 功能，继承本地版本数据的同时完成版本更新」（2026-10-13 第五轮任务 5）。

## 2026-10-20 元数据修复

旧状态 `queued` 规范为 `planned`；仅对齐既有工作流枚举，不新增实现或用户验收结论。
