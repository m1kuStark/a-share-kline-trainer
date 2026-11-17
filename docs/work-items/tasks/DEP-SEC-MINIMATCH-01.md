# DEP-SEC-MINIMATCH-01 构建依赖 minimatch 安全维护

```json
{
  "id": "DEP-SEC-MINIMATCH-01",
  "title": "评估并修复构建依赖 minimatch 安全告警",
  "owner": "integrator",
  "state": "planned",
  "milestone": "ENG",
  "base_commit": "3b5fb110e506eb2e139f754c966cee3a64f55ea1",
  "summary": "2026-11-17 GH Dependabot alert #48 仍 open：GHSA-g3hv-75wg-m249（medium），开发依赖 minimatch 10.2.6 及 9.0.9 落入公告范围。评估 electron-builder/app-builder-lib 上游兼容修复或定向 override，独立验证打包，不与例行依赖分组或产品功能混合。此卡仅登记，尚未实施修复。",
  "next_action": "刷新公告与 npm 依赖树，确认受影响构建路径及修复兼容性，选择上游升级或最小 override；验证完整依赖树、build/test/Windows 打包，再按 PR 门禁交付并核对告警关闭。",
  "allowed_paths": ["package.json", "package-lock.json", "docs/work-items/tasks/DEP-SEC-MINIMATCH-01.md", "docs/work-items/milestones/ENG.md", "docs/work-items/README.md", "docs/status.md", "docs/verification/2026-11/DEP-SEC-MINIMATCH-01/**"],
  "depends_on": [],
  "docs_impact": {
    "update": ["docs/work-items/tasks/DEP-SEC-MINIMATCH-01.md", "docs/work-items/milestones/ENG.md", "docs/work-items/README.md", "docs/status.md"],
    "reason": "构建依赖升级需要明确受影响链、兼容性与打包收据，不能以当前 CI 绿色替代安全修复。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 已知范围（2026-11-17 快照）

- 公告范围 `>=7.0.0,<11.0.1`；实施前重新核对，不将快照当作永久版本约束。
- 开发链：`electron-builder@26.18.0 → app-builder-lib@26.18.0 → minimatch@10.2.6`；另经 `@electron/universal@2.0.3` 使用 `minimatch@9.0.9`。
- 生产链 `@fastify/static → glob → minimatch@11.0.5` 不在本次公告范围。开发依赖属性不等于可忽略构建风险。
- 不全局放开 Dependabot major 忽略，不用未经验证的 major override 直接换包；本卡不授予发布权限。
- 来源及本轮检查边界见[健康检查](../../verification/2026-11/ENG-HEALTH-02/README.md)。
