# REL-03 v0.3.2接入与训练体验发布

```json
{
  "id": "REL-03",
  "title": "v0.3.2接入与训练体验发布",
  "owner": "integrator",
  "state": "closed",
  "milestone": "M5",
  "summary": "用户授权实施DATA-05、SETUP-01、TRAIN-02、UI-02与受控退出，验收后公开发布v0.3.2。",
  "next_action": "v0.3.2 工程门禁与公开发布已完成；用户最终验收单独记录，M4/M5不在本任务范围。",
  "allowed_paths": [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "package.json",
    "package-lock.json",
    ".gitignore",
    ".gitattributes",
    ".github/**",
    "server/**",
    "web/**",
    "e2e/**",
    "scripts/**",
    "docs/**",
    "assets/**",
    "third-party/**",
    "tools/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REL-03.md"
    ],
    "reason": "模块首批按固定合同独立实现；运行行为接线、规格和公共文档由REL-03集成人负责。"
  },
  "verification_refs": [
    "docs/verification/2026-09/REL-03/runtime-cancel-review.json",
    "docs/verification/2026-09/REL-03/ui-02-journey.json",
    "docs/verification/2026-09/REL-03/recording-daily-journey.json",
    "docs/verification/2026-09/REL-03/module-acceptance.json",
    "docs/verification/2026-09/REL-03/public-release-verification.json"
  ],
  "integration_ref": "1eb9a0e",
  "acceptance_ref": null
}
```

合同：[v0.3.2首批](../../engineering/release-032-contracts.md)。Prompt在派发前独立保存；仅改allowed_paths，不改共享文件。

## 工程收尾（2026-09-23）

- 精确主分支工程提交 `1eb9a0e83995d076ba185a7507044652a46d6145` 已完成 858/858 单测、类型检查、构建和相关回归；四项模块验收见 `module-acceptance.json`。
- 公开 clean-room 源码提交和 `v0.3.2` 标签均指向 `5b6c38a0094bc08b565547c481f4c1ba1e123062`；Windows ZIP 与校验文件经匿名下载复核，证据见 `public-release-verification.json`。
- 公开仓库为 `https://github.com/m1kuStark/kline-trainer`；本地开发仓库的 `origin` 仍指向旧地址 `m1kuStark/a-share-kline-trainer`，未在本轮修改远端或执行push，不能把两个提交线当成同一发布源。
- 公开发布不包含个人训练库、真实行情、浏览器录像或凭据；用户最终验收仍未记录。
