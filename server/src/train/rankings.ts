import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config.js'
import { HttpError, TIERS, type Tier } from './engine.js'
import { parseTrainingRules } from './rules.js'
import { assertNoActiveTraining, settledFact } from './history-report.js'
import { maxDrawdownOf, profitLossRatioOf, realizedSellResults, winRateOf } from './metrics.js'
import { benchmarkReturnOf, loadBenchmarkSeries } from './benchmark.js'

// M4-01 五档排行：1M/3M/6M/1Y/2Y 独立分组排行，纯只读查询。
// 范围（roadmap §2.7 冻结）：RANGE 训练不混入五档；放弃不入榜；完整周期与提前结算分组。
// 排序（roadmap §2.7 冻结）：完整组 收益率降序→最大回撤升序→胜率降序→稳定键 id 降序；
// 提前结算组 收益率降序→稳定键 id 降序，展示实际天数（＝区间内持久权益点数）。
// 指标口径已按拍板 S4 冻结（2026-09-29）：胜率/盈亏比＝摊薄成本法逐笔卖出已实现盈亏
// （持有期分红不进单笔）；沪深300超额＝训练收益率−向后对齐基准区间收益，基准缺失行级 null＋原因。
// null 一律殿后且 UI 显示"--"，不冒充 0。

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
  /** 盈利卖出笔占比；零卖出 → null（"--"） */
  winRate: number | null
  /** 平均单笔盈利÷平均单笔亏损；零卖出/零亏损/零盈利 → null（"--"） */
  profitLossRatio: number | null
  /** 收益率−同期沪深300收益率；基准不可用/未覆盖 → null（"--"）＋原因 */
  benchmarkExcess: number | null
  benchmarkExcessReason?: string
}

export interface RankingGroups {
  tier: Tier
  /** 到期结算组：收益率↓→最大回撤↑→胜率↓(null 殿后)→id↓ */
  complete: RankingItem[]
  /** 提前结算组：收益率↓→id↓ */
  earlySettled: RankingItem[]
  /** 坏规则/legacy-raw/结算点缺失/权益点非有限而行级不可认证的局数（如实展示，不入榜） */
  excludedUnavailable: number
  /** 基准数据整体状态：文件缺失/无TDX 时整组超额置 null 并说明（行级未覆盖另有行级原因） */
  benchmark: { status: 'ok' | 'unavailable'; reason?: string }
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
  market: string
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
  // 摊薄成本法逐笔卖出已实现盈亏（拍板 S4）：费用含在内，持有期分红不进单笔。
  const sells = realizedSellResults(database, row.id, row.initial_cash, row.market, row.code)
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
      winRate: winRateOf(sells),
      profitLossRatio: profitLossRatioOf(sells),
      benchmarkExcess: null,
    },
  }
}

/** null 视为最小（排序中殿后）：零交易/基准缺失值不冒充 0，也不挡住有值行。 */
function byWinRateDesc(left: RankingItem, right: RankingItem): number {
  return (right.winRate ?? Number.NEGATIVE_INFINITY) - (left.winRate ?? Number.NEGATIVE_INFINITY)
}

function byIdDesc(left: RankingItem, right: RankingItem): number {
  return right.id - left.id
}

function byReturnDesc(left: RankingItem, right: RankingItem): number {
  return right.returnRate - left.returnRate
}

/** 五档分组排行（同步核心）：完整组 收益率↓→回撤↑→胜率↓→id↓；提前组 收益率↓→id↓。 */
export function rankingGroups(database: DatabaseSync, tier: Tier): RankingGroups {
  const rows = database.prepare(`
    SELECT id, tier, code, name, market, start_date, settle_date, early_settle, initial_cash, rules_json
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
  return { tier, complete, earlySettled, excludedUnavailable, benchmark: { status: 'ok' } }
}

/**
 * 排行响应装配：分组后异步读基准指数日线并逐行计算超额；读文件后重查 running 守卫
 * （守卫→同步读库→异步读基准→复守卫），杜绝异步窗口内新开训练绕过防未来。
 */
export async function rankingsPayload(database: DatabaseSync, config: AppConfig, tier: Tier): Promise<RankingGroups> {
  const groups = rankingGroups(database, tier)
  if (!groups.complete.length && !groups.earlySettled.length) return groups
  const benchmark = await loadBenchmarkSeries(config)
  if (!benchmark.ok) {
    groups.benchmark = { status: 'unavailable', reason: benchmark.reason }
    for (const item of [...groups.complete, ...groups.earlySettled]) {
      item.benchmarkExcess = null
      item.benchmarkExcessReason = benchmark.reason
    }
  } else {
    for (const item of [...groups.complete, ...groups.earlySettled]) {
      const outcome = benchmarkReturnOf(benchmark.bars, item.startDate, item.settleDate ?? item.startDate)
      if (outcome.ok) {
        item.benchmarkExcess = item.returnRate - outcome.value
      } else {
        item.benchmarkExcess = null
        item.benchmarkExcessReason = outcome.reason
      }
    }
  }
  assertNoActiveTraining(database)
  return groups
}
