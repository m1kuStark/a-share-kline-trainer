# SETUP-01 用户确认式通达信接入

```json
{
  "id": "SETUP-01",
  "title": "用户确认式通达信接入",
  "owner": "integrator",
  "state": "closed",
  "milestone": "M5",
  "summary": "用户确认式通达信接入（Windows 原生目录选择、单目录检查、原子保存、受控重启）已随 v1.2.7 最终包（bbd368b）完成用户验收；首配受控重启缺陷由 SETUP-RESTART-FIX-01 修复并同包发布。",
  "next_action": "无未结工作；保持已验收能力的回归，后续首配问题按新任务立项。",
  "allowed_paths": [
    "server/src/config.ts",
    "server/src/tdx/discover.ts",
    "server/src/api.ts",
    "server/src/data/refresh.ts",
    "scripts/release/launcher.cjs",
    "scripts/runtime.ts",
    "scripts/runtime/snapshot.ts",
    "scripts/release/trainer.config.example.json",
    "tools/diagnostics/**",
    "server/test/discover.test.ts",
    "server/test/release-launcher.test.ts",
    "server/test/api.test.ts",
    "server/test/data-refresh.test.ts",
    "web/src/api.ts",
    "web/src/App.vue",
    "docs/user/install.md",
    "docs/proposals/tdx-onboarding.md",
    "docs/work-items/tasks/SETUP-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/proposals/tdx-onboarding.md",
      "docs/user/install.md",
      "docs/work-items/tasks/SETUP-01.md"
    ],
    "reason": "原接入设计已获用户接受，2026-10-01 用户反馈替代自动发现与向导；当前以用户确认路径、只读校验和保存生效为准，具体写范围仍按派发合同冻结。"
  },
  "verification_refs": [
    "docs/verification/2026-10/V1.2.7-setup-restart-fix/README.md"
  ],
  "integration_ref": "v1.2.7-20261004-published@bbd368b09a463183364861678db83a9ae86b1472",
  "acceptance_ref": "docs/verification/2026-10/V1.2.7-user-acceptance/README.md"
}
```

## 现行边界（2026-10-01）

- 顶栏与设置中的连接入口使用 Windows 原生目录选择器；不另弹配置向导，不自动检测进程、默认安装目录或附近目录。
- 用户确认根目录后单目录检查，通过后自动复验、保存并受控重启；取消不写入，失败保留旧选择，活动训练不切换数据源。
- 原自动发现设计与 wt/B 接线记录仅供追溯，见[历史方案](../../proposals/tdx-onboarding.md)。

## 关闭对账（2026-10-04）

- 依据 [v1.2.7 用户验收记录](../../verification/2026-10/V1.2.7-user-acceptance/README.md)：用户从 Windows 发布包执行首次使用流程，确认通达信数据可正常连接且不卡死，随包验收通过并授权发布；本卡随之关闭。
- 2026-09-22 的 [设计接受记录](../../verification/2026-09/SETUP-design-acceptance/record.json) 保留为历史设计接受，不代表最终功能验收；旧 `wt/integration/v1`（V1.1.1 候选）集成引用已被正式包 `v1.2.7-20261004-published` 取代。
- 首配受控重启缺陷（CLI 装配层断链、Chromium 无 Origin 轮询 401）的修复与回归证据见 [SETUP-RESTART-FIX-01](SETUP-RESTART-FIX-01.md) 与[修复记录](../../verification/2026-10/V1.2.7-setup-restart-fix/README.md)。
