# SETUP-01 用户确认式通达信接入

```json
{
  "id": "SETUP-01",
  "title": "用户确认式通达信接入",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "V1 候选已接入用户确认式 Windows 原生目录选择、单目录检查、原子保存和受控重启；2026-10-01 反馈关闭自动发现与扫描，目录选择与页面退出互斥，最终 Windows 包及用户验收仍待记录。",
  "next_action": "按最终候选复核原生选择器前台与模态行为、取消后恢复页面、选择期间退出受阻、失败后重试退出、校验失败保留旧选择、保存重启与旧配置兼容；完成安装→接入→训练→退出→再启动 Windows 全流程，再交用户验收。",
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
  "verification_refs": [],
  "integration_ref": "wt/integration/v1（V1.1.1 候选；最终提交 SHA 待集成包完成后回填）",
  "acceptance_ref": "docs/verification/2026-09/SETUP-design-acceptance/record.json"
}
```

## 现行边界（2026-10-01）

- 顶栏与设置中的连接入口使用 Windows 原生目录选择器；不另弹配置向导，不自动检测进程、默认安装目录或附近目录。
- 用户确认根目录后单目录检查，通过后自动复验、保存并受控重启；取消不写入，失败保留旧选择，活动训练不切换数据源。
- 原自动发现设计与 wt/B 接线记录仅供追溯，见[历史方案](../../proposals/tdx-onboarding.md)；`acceptance_ref` 指向 2026-09-22 设计接受，不代表最终功能验收。
- 当前运行状态、候选提交与产物以统一工作状态文件为准；本卡不依据旧 worktree 引用重新派发已合入代码。
