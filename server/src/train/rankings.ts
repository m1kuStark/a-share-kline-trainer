import type { DatabaseSync } from 'node:sqlite'
import { HttpError, TIERS, type Tier } from './engine.js'
import { parseTrainingRules } from './rules.js'
import { settledFact } from './history-report.js'
import { maxDrawdownOf } from './metrics.js'

// M4-01 五档排行：1M/3M/6M/1Y/2Y 独立分组排行，纯同步只读查询。
// 范围（roadmap §2.7 冻结）：RANGE 训练不混入五档；放弃不入榜；完整周期与提前结算分组。
// 排序（roadmap §2.7 冻结）：完整组 收益率降序→最大回撤升序→胜率降序→稳定键 id 降序；
// 提前结算组 收益率降序→稳定键 id 降序，展示实际天数。
// 胜率/盈亏比/基准超额依赖固定样例口径（部分卖出计平仓笔、费用权息归属、基准对齐），
// 拍板 S4 冻结前一律输出 null，绝不以猜测口径冒充（骨架阶段字段框架先行）。

export type RankingClassification = 'complete' | 'early-settled'

export interface RankingItem {
  id: number
  code: string
  name: string
  tier: string
  classification: RankingClassification
  startDate: string
  settleDate: string | null
  /** 实际经历交易日数＝[startDate, settleDate] 内持久权益点数（提前结算组展示） */
  actualDays: number
  initialCash: number
  finalEquity: number
  /** 已含费用与权息的权益口径收益率（结算日持久点，与历史列表同一手算口径） */
  returnRate: number
  /** 最大回撤（比率 0..1，基于持久权益点峰值，不插值） */
  maxDrawdown: number
  tradeCount: number
  /** 口径冻结前恒 null（骨架）；冻结后＝盈利卖出笔占比 */
  winRate: number | null
  /** 口径冻结前恒 null（骨架）；冻结后＝平均盈利额/平均亏损额 */
  profitLossRatio: number | null
  /** 口径冻结前恒 null（骨架）；冻结后＝收益率−同期沪深300收益率 */
  benchmarkExcess: number | null
}

export interface RankingGroups {
  tier: Tier
  /** 到期结算组：收益率↓→最大回撤↑→胜率↓（null 殿后）→id↓ */
  complete: RankingItem[]
  /** 提前结算组：收益率↓→id↓ */
  earlySettled: RankingItem[]
  /** 坏规则/legacy-raw/结算点缺失/权益点非有限而行级不可认证的局数（如实展示，不入榜） */
  excludedUnavailable: number
}

/** 排行查询参数：tier 必填且必须是五档之一；非法一律 400。 */
export function parseRankingsQuery(raw: unknown): { tier: Tier } {
  const tier = (raw as { tier?: unknown } | undefined)?.tier
  if (typeof tier !== 'string' || !TIERS.includes(tier as Tier)) {
    throw new HttpError(400, `tier 必须是 ${TIERS.join(' / ')} 之一`)
  }
  return { tier: tier as Tier }
}

interface RankingRow {
  id: number
  tier: string
  code: string
  name: string
  start_date: string
  settle_date: string | null
  early_settle: number
  initial_cash: number
  rules_json: string | null
}

/** 规则层面的不可认证判定：与历史列表同一口径（坏/缺快照、legacy-raw），只影响本行。 */
function rankableRulesReason(rulesJson: string | null): string | null {
  const rules = parseTrainingRules(rulesJson)
  if (!rules) return '训练规则快照缺失、损坏或版本不支持，无法认证本局成绩'
  if (rules.corporateActionPolicy === 'legacy-raw-unverified') {
    return '旧版不复权训练缺少完整权息记录，成绩未经验证'
  }
  return null
}

function itemOf(database: DatabaseSync, row: RankingRow): { item: RankingItem } | { reason: string } {
  const rulesReason = rankableRulesReason(row.rules_json)
  if (rulesReason) return { reason: rulesReason }
  const settlePoint = row.settle_date
    ? (database.prepare(
        'SELECT equity FROM equity_curve WHERE training_id = ? AND date = ?',
      ).get(row.id, row.settle_date) as unknown as { equity: number } | undefined)
    : undefined
  const fact = settledFact(row.initial_cash, row.settle_date, settlePoint?.equity)
  if (fact.finalEquity === null || fact.returnRate === null) {
    return { reason: fact.integrityReason ?? '结算权益缺失' }
  }
  const curve = (database.prepare(
    'SELECT equity FROM equity_curve WHERE training_id = ? AND date >= ? AND date <= ? ORDER BY date',
  ).all(row.id, row.start_date, row.settle_date) as unknown as Array<{ equity: number }>)
    .map(point => point.equity)
  if (curve.some(value => !Number.isFinite(value))) {
    return { reason: '权益曲线包含非有限值，无法认证回撤指标' }
  }
  const tradeCount = (database.prepare(
    'SELECT COUNT(*) AS count FROM trades WHERE training_id = ?',
  ).get(row.id) as unknown as { count: number }).count
  return {
    item: {
      id: row.id,
      code: row.code,
      name: row.name,
      tier: row.tier,
      classification: row.early_settle === 1 ? 'early-settled' : 'complete',
      startDate: row.start_date,
      settleDate: row.settle_date,
      actualDays: curve.length,
      initialCash: row.initial_cash,
      finalEquity: fact.finalEquity,
      returnRate: fact.returnRate,
      maxDrawdown: maxDrawdownOf(curve),
      tradeCount,
      winRate: null,
      profitLossRatio: null,
      benchmarkExcess: null,
    },
  }
}

/** null 视为最小（排序中殿后）：零交易/口径未冻结值不冒充 0，也不挡住有值行。 */
function byWinRateDesc(left: RankingItem, right: RankingItem): number {
  return (right.winRate ?? Number.NEGATIVE_INFINITY) - (left.winRate ?? Number.NEGATIVE_INFINITY)
}

function byIdDesc(left: RankingItem, right: RankingItem): number {
  return right.id - left.id
}

function byReturnDesc(left: RankingItem, right: RankingItem): number {
  return right.returnRate - left.returnRate
}

/** 五档分组排行：完整组 收益率↓→回撤↑→胜率↓→id↓；提前组 收益率↓→id↓。 */
export function rankingGroups(database: DatabaseSync, tier: Tier): RankingGroups {
  const rows = database.prepare(`
    SELECT id, tier, code, name, start_date, settle_date, early_settle, initial_cash, rules_json
    FROM trainings WHERE status = 'settled' AND tier = ?
  `).all(tier) as unknown as RankingRow[]
  const complete: RankingItem[] = []
  const earlySettled: RankingItem[] = []
  let excludedUnavailable = 0
  for (const row of rows) {
    const built = itemOf(database, row)
    if ('reason' in built) {
      excludedUnavailable += 1
      continue
    }
    (built.item.classification === 'early-settled' ? earlySettled : complete).push(built.item)
  }
  complete.sort((left, right) =>
    byReturnDesc(left, right)
    || left.maxDrawdown - right.maxDrawdown
    || byWinRateDesc(left, right)
    || byIdDesc(left, right))
  earlySettled.sort((left, right) => byReturnDesc(left, right) || byIdDesc(left, right))
  return { tier, complete, earlySettled, excludedUnavailable }
}
