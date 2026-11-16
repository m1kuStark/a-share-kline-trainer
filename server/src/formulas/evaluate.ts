import type { FormulaEngineModule } from './engine.js'
import { futureFunctionsOf, validationErrorOf } from './engine.js'
import type { FormulaBar, FormulaEvaluationResult, FormulaOutputLine, FormulaValidationResult } from './types.js'

export interface EvaluateBarsInput {
  source: string
  bars: FormulaBar[]
  dates: string[]
  stockContext?: Record<string, unknown> | null
  auxiliaryFormulas?: Record<string, string>
  limit: number
  warnings?: string[]
}

/** 校验：parse（语法/词法）＋未来函数静态标记；不做求值，不写任何数据 */
export function validateSource(engine: FormulaEngineModule, source: string, warnings: string[] = []): FormulaValidationResult {
  try {
    new engine.FormulaEngine().parse(source)
  } catch (error) {
    return { ok: false, error: validationErrorOf(error), warnings }
  }
  return { ok: true, futureFunctions: futureFunctionsOf(engine, source), warnings }
}

/** 在既有 bars 上求值（不负责取数/持久化）：输出线与 bars 等长；NaN/Infinity → null（JSON 安全） */
export function evaluateOnBars(engine: FormulaEngineModule, input: EvaluateBarsInput): FormulaEvaluationResult {
  const warnings = [...(input.warnings ?? [])]
  if (input.bars.length === 0) return { ok: false, error: { kind: 'runtime', message: '没有可求值的行情数据' }, warnings }
  const instance = new engine.FormulaEngine()
  const options: Record<string, unknown> = {}
  if (input.auxiliaryFormulas && Object.keys(input.auxiliaryFormulas).length > 0) options.auxiliaryFormulas = input.auxiliaryFormulas
  if (input.stockContext) options.stockContext = input.stockContext
  let result
  try {
    result = instance.evaluate(input.source, input.bars, Object.keys(options).length > 0 ? options : undefined)
  } catch (error) {
    return { ok: false, error: validationErrorOf(error), warnings }
  }
  const bars = input.bars.map((bar, index) => ({ date: input.dates[index] ?? '', timestamp: bar.timestamp })).slice(-input.limit)
  const outputs: FormulaOutputLine[] = result.outputs.map(line => ({
    name: line.name,
    ...(line.style === undefined ? {} : { style: line.style }),
    data: Array.from(line.data.slice(-input.limit), value => Number.isFinite(value) ? value : null),
  }))
  return { ok: true, outputs, bars, futureFunctions: futureFunctionsOf(engine, input.source), warnings }
}
