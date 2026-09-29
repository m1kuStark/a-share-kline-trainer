import { join } from 'node:path'
import { readDayFileRange, type DayBar } from '../tdx/dayfile.js'
import type { AppConfig } from '../config.js'

// M4-01 基准超额（拍板 S4 冻结）：基准＝通达信沪深300日线 vipdoc/sh/lday/sh000300.day，
// 与 tdx/inspect.ts 的基准检查同源。向后对齐：基准起点=≤startDate 最近收盘、
// 终点=≤settleDate 最近收盘；起点/终点任一缺失或文件不可读 → 该局超额 null＋中文原因，
// 不冒充数值。超额＝训练收益率 − 基准区间收益率（算术差）。

export const BENCHMARK_RELATIVE_PATH = join('vipdoc', 'sh', 'lday', 'sh000300.day')

export type BenchmarkSeries =
  | { ok: true; bars: DayBar[] }
  | { ok: false; reason: string }

/** 读取基准指数日线：一次整读后按日期升序（文件异常如实失败，不猜数）。 */
export async function loadBenchmarkSeries(config: AppConfig): Promise<BenchmarkSeries> {
  if (!config.tdxRoot) {
    return { ok: false, reason: '未发现 TDX 数据目录，无法计算沪深300超额' }
  }
  let bars: DayBar[]
  try {
    bars = await readDayFileRange(join(config.tdxRoot, BENCHMARK_RELATIVE_PATH))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, reason: '基准指数日线缺失（sh000300.day），无法计算沪深300超额' }
    }
    return { ok: false, reason: `基准指数日线读取失败：${error instanceof Error ? error.message : '未知错误'}` }
  }
  bars = [...bars].sort((left, right) => left.date.localeCompare(right.date))
  return { ok: true, bars }
}

export type BenchmarkReturn =
  | { ok: true; value: number }
  | { ok: false; reason: string }

/** 区间基准收益率（向后对齐）；基准点缺失/收盘非法 → 失败＋原因，不冒充。 */
export function benchmarkReturnOf(bars: readonly DayBar[], startDate: string, settleDate: string): BenchmarkReturn {
  let base: DayBar | undefined
  let end: DayBar | undefined
  for (const bar of bars) {
    if (bar.date <= startDate) base = bar
    if (bar.date <= settleDate) end = bar
    else break
  }
  if (!base) return { ok: false, reason: `训练起始日 ${startDate} 早于基准数据覆盖，无法计算同期沪深300收益` }
  if (!end) return { ok: false, reason: `结算日 ${settleDate} 之前无基准数据，无法计算同期沪深300收益` }
  if (!(base.close > 0) || !Number.isFinite(base.close) || !Number.isFinite(end.close)) {
    return { ok: false, reason: '基准收盘价非法，无法计算同期沪深300收益' }
  }
  return { ok: true, value: end.close / base.close - 1 }
}
