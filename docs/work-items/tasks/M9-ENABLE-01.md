# M9-ENABLE-01 公式启停持久化与整批候选

```json
{
  "id": "M9-ENABLE-01",
  "title": "修复公式启停保存并准备 M9 整批验收候选",
  "owner": "integrator",
  "state": "planned",
  "milestone": "M9",
  "base_commit": "2c66477f0c4875ac3a100338fdbc42b4878dadd8",
  "summary": "首批开发计划已获用户批准：三个内置示例默认停用，逐个开启后自动按预设主图/副图显示。先复现自定义 enabled 未保存与内置保存被 name/source 保护拒绝，再修请求字段，保留后端保护；完整验证后交付同提交 Windows 验收包。",
  "next_action": "在维护基线稳定后执行 RED→GREEN；核验真实设置交互、图表刷新、M9 全批回归及主代理深浅主题检查。用户验收和发布均未授权。",
  "allowed_paths": [
    "web/src/components/FormulaSettings.vue",
    "web/src/api.ts",
    "server/src/formulas/seed.ts",
    "server/test/formulas/formula-storage.test.ts",
    "server/test/formula-library-api.test.ts",
    "e2e/formula-enable.spec.ts",
    "e2e/README.md",
    "docs/specs/formulas.md",
    "docs/specs/README.md",
    "docs/proposals/M9-04-formula-product-ui.md",
    "docs/work-items/tasks/M9-ENABLE-01.md",
    "docs/work-items/tasks/M9-04B.md",
    "docs/work-items/tasks/M9-04C.md",
    "docs/work-items/tasks/M9-04D.md",
    "docs/work-items/milestones/M9.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/release/M9-ENABLE-01.md",
    "docs/verification/2026-11/M9-ENABLE-01/**",
    "CHANGELOG.md",
    "docs/work-items/tasks/ENG-PLAN-01.md",
    "docs/work-items/tasks/RUNTIME-CANCEL-02.md",
    "docs/work-items/tasks/DEP-SEC-MINIMATCH-01.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/proposals/development-batch-2026-11.md",
    "docs/proposals/development-plan-2026-11.md"
  ],
  "depends_on": ["RUNTIME-CANCEL-02", "DEP-SEC-MINIMATCH-01", "M9-04D"],
  "docs_impact": {
    "update": ["docs/specs/formulas.md", "docs/specs/README.md", "docs/proposals/M9-04-formula-product-ui.md", "docs/work-items/tasks/M9-04B.md", "docs/work-items/tasks/M9-04C.md", "docs/work-items/tasks/M9-04D.md", "docs/work-items/milestones/M9.md", "docs/work-items/README.md", "docs/status.md", "e2e/README.md"],
    "reason": "冻结已批准的内置启停口径，纠正已有开关却未持久化的实施描述；记录整批候选与人工验收边界。集成人另回填本批前置任务的实际合入引用、阶段计划和Issue8分诊；不修改前置实现或补造人工验收。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

批准来源：[首批批准记录](../../verification/2026-11/ENG-PLAN-01/approval.md)（随 ENG-PLAN-01 合入）。本卡不把批准开发解释为接受当前回放限制或发布许可。

验收路径：新建自定义公式时选择启停并保存；重开设置与刷新仍保留；内置逐一开启后按预设位置显示，停用消失。内置 name/source/删除继续受保护。保存失败清除旧成功提示并显示错误。默认停用只约束新 seed，升级不重置已有选择。

整批检查包含 M9 引擎本机语料、导入/错误、三个示例、主副图、日周月、推进、随机遮蔽、镜像、只读 API 和录像回放。当前回放使用现公式库、公式 pane 高度不录入、公式 pane 画线回落主图为待用户验收的已知限制，不在本卡改行为。

2026-11-18 集成人范围补记：本批前置卡合并后，在此卡回填真实 integration_ref 和下一步，并同步 ENG/GH 阶段入口与已批准的执行计划；Issue #8 仅复现、分诊及形成后续方案，证据归本卡 verification。不会修改该反馈对应产品行为，也不向 Issue 自动回复。
