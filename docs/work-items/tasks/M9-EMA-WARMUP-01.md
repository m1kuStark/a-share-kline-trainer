# M9-EMA-WARMUP-01 公共 EMA 前导空值暖机

```json
{
  "id": "M9-EMA-WARMUP-01",
  "title": "修复公共EMA前导NaN暖机并保留正常输入结果",
  "owner": "integrator",
  "state": "review",
  "milestone": "M9",
  "base_commit": "df6cedd82fa3fe591615724259f83d16f6bb70fa",
  "summary": "公共EMA前导NaN暖机已完成：专项112项、真实语料43项、完整server2664＋desktop369同次3033项通过；回退修复8项语义失败，独立五维审查可合入。仅正整数周期契约，M9整批/Windows包/用户验收另行执行。",
  "next_action": "经文档和矩阵最终门禁后走独立PR合入；M9-ENABLE-01集成同一修复后运行最终整批候选、主代理视觉与Windows实包录像回放，交用户验收。",
  "allowed_paths": [
    "web/src/formula-engine/interpreter/functions/math.ts",
    "server/test/formula-engine/interpreter/functions/math.test.ts",
    "server/test/formula-engine/integration/FormulaEngine.test.ts",
    "server/test/formula-seed.test.ts",
    "server/test/formula-chart.test.ts",
    "web/src/formula-engine/README.md",
    "docs/specs/formulas.md",
    "docs/specs/README.md",
    "docs/work-items/tasks/M9-EMA-WARMUP-01.md",
    "docs/work-items/milestones/M9.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/M9-EMA-WARMUP-01/**"
  ],
  "depends_on": [
    "DEP-SEC-MINIMATCH-01"
  ],
  "docs_impact": {
    "update": [
      "web/src/formula-engine/README.md",
      "docs/specs/formulas.md",
      "docs/specs/README.md",
      "docs/work-items/tasks/M9-EMA-WARMUP-01.md",
      "docs/work-items/milestones/M9.md",
      "docs/work-items/README.md",
      "docs/status.md"
    ],
    "reason": "公共EMA是冻结vendor语义的明确已批准例外，记录暖机边界、正常输入兼容性、实际回归和M9后继交付边界。root单写矩阵、统一状态和聚合文档。"
  },
  "verification_refs": [
    "docs/verification/2026-11/M9-EMA-WARMUP-01/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

批准来源为本轮用户对“是否批准新增独立的EMA前导空值暖机修复，保持正常输入结果和现有验收断言，通过专项回归后继续交付M9”的明确答复：“批准独立修复，再完成M9（建议）”。本卡只授予修复与继续开发，不授予发布或人工验收。

冻结范围：首个非NaN输入位置后累积原连续N个位置，沿用逆序SMA种子、alpha=2/(N+1)和原递推。只跳过前导NaN；不跨内部空洞收集有效值，不重启内部NaN后的递推，不跳过Infinity，不改CROSS/IF、示例源码、其他EMA helper或内置MACD。

独立预期：EMA([NaN,NaN,2,4,6,8],3)在索引4/5为4/6；嵌套EMA3在CLOSE=1..7上前4项为空、后3项为3/4/5；120根CLOSE=1..120的QINIU DIF从25起95值、DEA从33起87值且为7；固定起伏样本的B1在索引61/93。正常连续有效输入必须逐项保持旧数值，新增测试不能调用修改后的函数计算expected。

矩阵由root预登记FE-EMA-LEADING-NAN、FE-EMA-FINITE-COMPAT、FE-EMA-NESTED、FE-EMA-QINIU-DEA、FE-EMA-QINIU-CROSS；worker不编辑矩阵或共享状态。保留旧FE-VENDOR-BASELINE和FE-CORPUS-SMOKE断言，冻结基线仅新增这项明确例外。

TDD和验证：先保存专项原生RED，修复后执行函数/引擎/seed/chart测试；真实6文件和23语料不可跳过，独立npm ci/build后跑完整server+desktop。定向变异验证只回退本次EMA补丁，保留所有断言；确认RED后复原精确候选再绿。最终M9完整Journey、深浅主题视觉、Windows实包训练/公式/录像回放由root在合入后的统一候选执行。

## 工程验证与后继

专项 RED→GREEN、真实语料、完整3033项、实际变异及独立五维审查收据均已归档于[验证记录](../../verification/2026-11/M9-EMA-WARMUP-01/README.md)。首次原生崩溃和后续控制环境污染失败原样保留；正常输入浮点向量和旧验收断言保持。当前 review 表示独立修复具备集成条件，M9 浏览器/Windows包和人工验收没有由此转正。
