# M9-ENABLE-01 公式启停持久化与整批候选

```json
{
  "id": "M9-ENABLE-01",
  "title": "修复公式启停保存并准备 M9 整批验收候选",
  "owner": "integrator",
  "state": "active",
  "milestone": "M9",
  "base_commit": "58ba0ffc13458fb136c7d885b62ee0c898d4bab8",
  "summary": "EMA已独立合入PR54；启停6/6和API13/13通过。f701完整Journey229通过18失败1跳过13未运行；夹具清理RED/GREEN与BOM-only修复已备，当前冻结新候选重跑，整批未验收。",
  "next_action": "冻结准备修复后完整重跑候选（含官方v1.2.7迁移夹具），验证同提交Windows包、实际CMD入口、主代理视觉和录像重启持久化，再交用户验收。",
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
    "docs/proposals/development-plan-2026-11.md",
    "server/test/formula-seed.test.ts",
    "docs/work-items/tasks/M9-EMA-WARMUP-01.md",
    "docs/verification/2026-11/M9-EMA-WARMUP-01/**",
    "e2e/formula-chart.spec.ts",
    "scripts/acceptance/Start-Acceptance.ps1"
  ],
  "depends_on": [
    "RUNTIME-CANCEL-02",
    "DEP-SEC-MINIMATCH-01",
    "M9-04D",
    "M9-EMA-WARMUP-01"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/formulas.md",
      "docs/specs/README.md",
      "docs/proposals/M9-04-formula-product-ui.md",
      "docs/work-items/tasks/M9-04B.md",
      "docs/work-items/tasks/M9-04C.md",
      "docs/work-items/tasks/M9-04D.md",
      "docs/work-items/milestones/M9.md",
      "docs/work-items/README.md",
      "docs/status.md",
      "e2e/README.md"
    ],
    "reason": "冻结已批准的内置启停口径，纠正已有开关却未持久化的实施描述；记录整批候选与人工验收边界。集成人另回填本批前置任务的实际合入引用、阶段计划和Issue8分诊；不修改前置实现或补造人工验收。"
  },
  "verification_refs": [
    "docs/verification/2026-11/M9-ENABLE-01/README.md",
    "docs/verification/2026-11/M9-ENABLE-01/review/saving-fix-review.md",
    "docs/verification/2026-11/M9-ENABLE-01/review/ema-diagnosis.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

批准来源：[首批批准记录](../../verification/2026-11/ENG-PLAN-01/approval.md)（随 ENG-PLAN-01 合入）。本卡不把批准开发解释为接受当前回放限制或发布许可。

验收路径：新建自定义公式时选择启停并保存；重开设置与刷新仍保留；内置逐一开启后按预设位置显示，停用消失。内置 name/source/删除继续受保护。保存失败清除旧成功提示并显示错误。默认停用只约束新 seed，升级不重置已有选择。

整批检查包含 M9 引擎本机语料、导入/错误、三个示例、主副图、日周月、推进、随机遮蔽、镜像、只读 API 和录像回放。当前回放使用现公式库、公式 pane 高度不录入、公式 pane 画线回落主图为待用户验收的已知限制，不在本卡改行为。

2026-11-18 集成人范围补记：本批前置卡合并后，在此卡回填真实 integration_ref 和下一步，并同步 ENG/GH 阶段入口与已批准的执行计划；Issue #8 仅复现、分诊及形成后续方案，证据归本卡 verification。不会修改该反馈对应产品行为，也不向 Issue 自动回复。

## 2026-11-18 接续状态

原立项基线为2c66477；已签名合入维护主线 df6cedd82fa3fe591615724259f83d16f6bb70fa，本轮归档时HEAD为c83cae6。前导NaN的EMA修复明确超出本卡“不改变公式引擎语义”的范围，已提交独立方案，未获答复，未应用候选补丁。当前blocked是交付阻断，不表示启停字段补丁未保存。

默认停用的保护另由seed测试锁定，E2E主动停用夹具不能替代默认值证据。公式UI矩阵仍8行、covered4/open4/RED0、strict退出3，未据局部绿提升。原始失败、后续就绪修正和最后DEA失败全部保留。

## 独立范围已获批准

用户在本轮随后明确选择“批准独立修复，再完成M9”，准确范围见[EMA批准记录](../../verification/2026-11/M9-ENABLE-01/ema-scope-approval.md)。此前blocked与待拍板记录保留为历史；当前active，先独立修复，不提前声称交付通过。

## 统一候选接续

2026-11-18，独立EMA修复由PR54合入main58ba0ff，必需docs/verify/pr-policy均通过，CI同次3033项通过。将此main更新集成到本卡，候选对比基线改为58ba0ff；保存补丁未变。独立修复完整收据保留，M9后继检查从统一候选重新执行。

## 整批验收准备修复范围

2026-11-18，冻结候选f701371的完整Journey发现公式图表套件遗留启用中的CHART_SUB，使后续共库用例多出第五窗格。本轮补充formula-chart矩阵关联测试范围，只增加用例后清理、API状态和无残留断言，原产品断言与窗格预期保留；先记录RED，再验证GREEN及完整候选。其他超时逐项核实，不合并归因。

真实CMD入口另复现Windows PowerShell 5.1误读无BOM脚本中的中文程序名。Start-Acceptance.ps1仅补UTF-8 BOM，原脚本主体逐字节不变；PS5/PS7解析正反例与全新解压后的实际CMD运行分别记录。以上属于本卡交付准备的明确缺陷修复，不扩展公式产品语义或发布权限。
