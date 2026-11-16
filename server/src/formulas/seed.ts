import type { DatabaseSync } from 'node:sqlite'

/**
 * M9-04D 内置示例公式（用户 2026-11-16 默认方案：3 个通达信示例，开箱可见）。
 *
 * - 只在启动时幂等写入：按 name（大小写不敏感）已存在则跳过——不重复、不覆盖用户同名公式，
 *   也不覆盖既有内置行（升级不改写用户可见内容）。
 * - builtin=1：UI 显示「内置」徽标，服务端禁止改名/改源码/删除（既有 403 保护）。
 * - enabled=0（默认停用）：避免开箱改变既有训练/回放图表的窗格布局与录像 paneHeights；
 *   示例在设置「公式指标」中始终可见、可预览；启用可通过 PUT /api/formulas/:id {enabled:true}
 *   （设置面板的开关留待后续卡；本卡不扩 UI）。
 * - source 必须能被引擎 parse/求值（回归见 server/test/formula-seed.test.ts 用真实引擎跑通）。
 */
export interface BuiltinFormulaSeed {
  name: string
  description: string
  placement: 'main' | 'sub'
  source: string
}

export const BUILTIN_FORMULAS: readonly BuiltinFormulaSeed[] = [
  {
    name: 'WEEK_MACD_SUB',
    description: '内置示例：周线 MACD（跨周期引用 "MACD.DIF#WEEK" 演示，副图三线）',
    placement: 'sub',
    source: 'W_DIF:"MACD.DIF#WEEK";\nW_DEA:"MACD.DEA#WEEK";\nW_MACD:"MACD.MACD#WEEK";',
  },
  {
    name: 'MA_BULL_MAIN',
    description: '内置示例：均线多头排列参考（MA5/10/20/60，主图叠加）',
    placement: 'main',
    source: 'MA5:MA(CLOSE,5);\nMA10:MA(CLOSE,10);\nMA20:MA(CLOSE,20);\nMA60:MA(CLOSE,60);',
  },
  {
    name: 'QINIU_B1_SUB',
    description: '内置示例：骑牛 B1 金叉信号（DIF/DEA 金叉输出 1，副图）',
    placement: 'sub',
    source: 'DIF:EMA(CLOSE,12)-EMA(CLOSE,26);\nDEA:EMA(DIF,9);\nB1:IF(CROSS(DIF,DEA),1,0);',
  },
]

/** 幂等 seed：返回本次新插入行数（0＝已全部存在）。 */
export function seedBuiltinFormulas(database: DatabaseSync, now = new Date().toISOString()): number {
  const exists = database.prepare('SELECT id FROM formulas WHERE name = ? COLLATE NOCASE')
  const insert = database.prepare(
    'INSERT INTO formulas (name, description, placement, source, enabled, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)',
  )
  let inserted = 0
  for (const formula of BUILTIN_FORMULAS) {
    if (exists.get(formula.name)) continue
    insert.run(formula.name, formula.description, formula.placement, formula.source, now, now)
    inserted += 1
  }
  return inserted
}
