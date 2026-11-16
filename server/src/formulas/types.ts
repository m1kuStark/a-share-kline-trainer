export type FormulaPlacement = 'main' | 'sub'

export interface FormulaRow {
  id: number
  name: string
  description: string
  placement: FormulaPlacement
  source: string
  enabled: number
  builtin: number
  createdAt: string
  updatedAt: string
}

export interface FormulaView {
  id: number
  name: string
  description: string
  placement: FormulaPlacement
  source: string
  enabled: boolean
  builtin: boolean
  futureFunctions: string[]
  createdAt: string
  updatedAt: string
}

export interface FormulaValidationError {
  kind: 'lexer' | 'parser' | 'runtime'
  message: string
  line?: number
  column?: number
}

export type FormulaValidationResult =
  | { ok: true; futureFunctions: string[]; warnings: string[] }
  | { ok: false; error: FormulaValidationError; warnings: string[] }

/** 引擎输入行情（与 web/src/formula-engine MarketData 结构一致；timestamp 为本地午夜毫秒） */
export interface FormulaBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface FormulaOutputLine {
  name: string
  style?: unknown
  data: Array<number | null>
}

export type FormulaEvaluationResult =
  | {
      ok: true
      outputs: FormulaOutputLine[]
      bars: Array<{ date: string; timestamp: number }>
      futureFunctions: string[]
      warnings: string[]
    }
  | { ok: false; error: FormulaValidationError; warnings: string[] }

export interface FormulaInputFields {
  name?: unknown
  description?: unknown
  placement?: unknown
  source?: unknown
  enabled?: unknown
}
