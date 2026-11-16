import type { Bar, FormulaView } from './api'
import { FormulaEngine } from './formula-engine/FormulaEngine'
import { scanFutureFunctions } from './formula-engine/futureFunctions'
import type { MarketData } from './formula-engine/types/MarketData'
import type { StockContext, StockIndustryContext } from './formula-engine/marketContext'

// M9-04C 公式图表挂载：浏览器侧对"图表当前已加载 bars"求值，输出按 timestamp 对齐的
// 多输出线，供 KlineChart 以 klinecharts 动态指标渲染（主图挂 candle_pane，副图每公式一个 pane）。
// 引擎唯一来源 web/src/formula-engine：只 import 纯值入口（FormulaEngine/futureFunctions），
// 不 import index（index 把纯类型按值再导出，tsx/Node/Vite 运行时可能报 does not provide export）。

export interface FormulaLinePoint { timestamp: number; value: number | null }
export interface FormulaChartLine { name: string; points: FormulaLinePoint[] }
export interface FormulaChartRender {
  id: number
  name: string
  placement: 'main' | 'sub'
  lines: FormulaChartLine[]
  futureFunctions: string[]
  /** 人话错误（上下文缺失/语法/运行期）；有错误时本公式不渲染线条但不影响其他公式 */
  error: string | null
}

export interface FormulaStockContext {
  code: string
  name: string
  industry: StockIndustryContext | null
  industryIndexBars?: MarketData[]
}

export interface EvaluateFormulaChartInput {
  bars: Bar[]
  formulas: FormulaView[]
  /** 随机训练/盲训/只读回放不注入（M7-01 边界） */
  stockContext?: FormulaStockContext | null
}

/** 图表 KLineData timestamp 约定：UTC 午夜（KlineChart dateTimestamp 同源）；月键缺日按 01 补。
 *  引擎内部只把 timestamp 当单调时间轴；跨周期按本地日历日分组时，UTC 午夜在 Asia/Shanghai 仍属同日。 */
export function barTimestamp(date: string): number {
  return Date.parse((date.length === 7 ? date + '-01' : date) + 'T00:00:00Z')
}

export function toMarketData(bars: Bar[]): MarketData[] {
  return bars.map(bar => ({
    timestamp: barTimestamp(bar.date),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    amount: bar.amount,
  }))
}

const CONTEXT_MISSING_TEXT = '缺少证券上下文（随机训练/盲训/只读回放），NAMELIKE/CODELIKE/HYBLOCK 等上下文函数不可用'

function humanizeFormulaError(name: string, failure: unknown): string {
  const raw = failure instanceof Error ? failure.message : String(failure)
  if (/StockContext/i.test(raw) || /requires? .*context/i.test(raw) || /上下文/.test(raw)) {
    return '公式「' + name + '」求值失败：' + CONTEXT_MISSING_TEXT
  }
  return '公式「' + name + '」求值失败：' + raw
}

/**
 * 对当前 bars 求值所有 enabled 公式；单公式失败只记录 error，不影响其他公式。
 * 主图/副图由 placement 决定（渲染层负责 pane 归属）。NaN/Infinity 归一为 null。
 */
export function evaluateFormulaChart(input: EvaluateFormulaChartInput): FormulaChartRender[] {
  const formulas = input.formulas.filter(formula => formula.enabled && (formula.placement === 'main' || formula.placement === 'sub'))
  if (formulas.length === 0) return []
  const marketData = toMarketData(input.bars)
  const timestamps = marketData.map(item => item.timestamp)
  const auxiliaryFormulas: Record<string, string> = {}
  for (const formula of input.formulas) auxiliaryFormulas[formula.name] = formula.source
  const engine = new FormulaEngine()
  const renders: FormulaChartRender[] = []
  for (const formula of formulas) {
    const futureFunctions = safeFutureFunctions(formula.source)
    if (marketData.length === 0) {
      renders.push({ id: formula.id, name: formula.name, placement: formula.placement, lines: [], futureFunctions, error: null })
      continue
    }
    try {
      const options = buildOptions(auxiliaryFormulas, input.stockContext ?? null)
      const result = engine.evaluate(formula.source, marketData, options)
      const lines: FormulaChartLine[] = result.outputs.map(output => ({
        name: output.name,
        points: timestamps.map((timestamp, index) => {
          const value = output.data[index]
          return { timestamp, value: Number.isFinite(value) ? value : null }
        }),
      }))
      renders.push({ id: formula.id, name: formula.name, placement: formula.placement, lines, futureFunctions, error: null })
    } catch (failure) {
      renders.push({ id: formula.id, name: formula.name, placement: formula.placement, lines: [], futureFunctions, error: humanizeFormulaError(formula.name, failure) })
    }
  }
  return renders
}

function buildOptions(auxiliaryFormulas: Record<string, string>, stockContext: FormulaStockContext | null) {
  const options: Record<string, unknown> = { auxiliaryFormulas }
  if (stockContext) options.stockContext = stockContext as StockContext
  return options
}

function safeFutureFunctions(source: string): string[] {
  try {
    return scanFutureFunctions(source)
  } catch {
    return []
  }
}

// ===== 指标命名与 pane 语义（KlineChart 与 server 单测共用） =====

export const FORMULA_INDICATOR_PREFIX = 'FORMULA_'

export function formulaIndicatorName(formulaId: number, lineIndex: number): string {
  return FORMULA_INDICATOR_PREFIX + formulaId + '_' + lineIndex
}

export function isFormulaIndicatorName(name: string): boolean {
  return name.startsWith(FORMULA_INDICATOR_PREFIX)
}

/** 当前图中公式指标占用的 paneId 集合（用于 paneHeights 捕获跳过公式 pane） */
export function formulaPaneIdsOf(indicators: ReadonlyArray<{ name: string; paneId: string }>): Set<string> {
  const ids = new Set<string>()
  for (const indicator of indicators) {
    if (isFormulaIndicatorName(indicator.name)) ids.add(indicator.paneId)
  }
  return ids
}

/**
 * 录像 paneHeights 捕获语义映射：跳过公式 pane（不得把公式窗格高度写回 candle_pane），
 * 其余 pane 用调用方给出的语义名。纯函数（server 单测覆盖）。
 */
export function paneHeightsForCapture(
  panes: ReadonlyArray<{ id: string; height: number }>,
  formulaPaneIds: ReadonlySet<string>,
  semanticName: (paneId: string) => string,
): Record<string, number> {
  const heights: Record<string, number> = {}
  for (const pane of panes) {
    if (pane.id === 'x_axis_pane') continue
    if (formulaPaneIds.has(pane.id)) continue
    if (Number.isFinite(pane.height) && pane.height > 0) heights[semanticName(pane.id)] = pane.height
  }
  return heights
}

/** 公式渲染状态的人话摘要（状态区提示；无错误时返回空串） */
export function formulaChartStatus(renders: ReadonlyArray<FormulaChartRender>): string {
  const errors = renders.map(render => render.error).filter((error): error is string => !!error)
  if (errors.length > 0) return errors.join('；')
  const future = new Set<string>()
  for (const render of renders) for (const name of render.futureFunctions) future.add(name)
  if (future.size > 0) return '公式未来函数：' + [...future].join('、') + '（允许使用，图表标记）'
  return ''
}
