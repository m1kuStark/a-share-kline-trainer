import type { FormulaBar, FormulaValidationError } from './types.js'

/** 引擎输出线（结构镜像 web/src/formula-engine OutputLine；不跨树 import 以保持 server 构建独立） */
export interface EngineOutputLine {
  name: string
  data: number[]
  style?: unknown
}

export interface EngineResult {
  outputs: EngineOutputLine[]
  variables?: Record<string, unknown>
  drawings?: unknown[]
}

export interface FormulaEngineLike {
  parse(source: string): unknown
  evaluate(source: string, bars: FormulaBar[], options?: Record<string, unknown>): EngineResult
}

export interface FormulaEngineModule {
  FormulaEngine: new () => FormulaEngineLike
  scanFutureFunctions(source: string): string[]
}

export type FormulaEngineProvider = () => Promise<FormulaEngineModule>

let cached: Promise<FormulaEngineModule> | null = null

/**
 * M9-04A：服务端加载同一份 web/src/formula-engine。
 * - 生产（server/dist）：构建期 esbuild bundle 到 server/dist/formulas/engine-bundle/index.mjs
 *   （scripts/build/formula-engine-bundle.mjs），运行期按 URL 动态加载。
 * - 开发/测试（tsx/vitest 直接跑 TS）：bundle 不存在时回退直接 import 仓库内 TS 源码。
 * 任何情况下不复制引擎实现，唯一来源仍是 web/src/formula-engine。
 */
export const bundleEngineProvider: FormulaEngineProvider = () => cached ??= loadEngine()

async function loadEngine(): Promise<FormulaEngineModule> {
  let bundleError: unknown = null
  try {
    return await import(new URL('./engine-bundle/index.mjs', import.meta.url).href) as FormulaEngineModule
  } catch (error) {
    bundleError = error
  }
  const sourceUrl = new URL('../../../web/src/formula-engine/index.ts', import.meta.url).href
  try {
    return await import(/* @vite-ignore */ sourceUrl) as FormulaEngineModule
  } catch (sourceError) {
    const bundleMessage = bundleError instanceof Error ? bundleError.message : String(bundleError)
    const sourceMessage = sourceError instanceof Error ? sourceError.message : String(sourceError)
    throw new Error(`公式引擎加载失败（bundle: ${bundleMessage}；源码回退: ${sourceMessage}）。生产构建请先运行 npm run build:server。`)
  }
}

/** 把引擎抛出的 lexer/parser/runtime 错误转成稳定契约（中文人话保留引擎消息，另给行/列） */
export function validationErrorOf(error: unknown): FormulaValidationError {
  const message = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  const record = (typeof error === 'object' && error !== null ? error : {}) as { line?: unknown; column?: unknown }
  const line = typeof record.line === 'number' ? record.line : undefined
  const column = typeof record.column === 'number' ? record.column : undefined
  const kind: FormulaValidationError['kind'] = name === 'LexerError' ? 'lexer' : name === 'ParserError' ? 'parser' : 'runtime'
  return { kind, message, ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }) }
}

/** 未来函数扫描容错：扫描失败不应阻塞校验/保存（引擎未来函数层为纯静态扫描） */
export function futureFunctionsOf(engine: FormulaEngineModule, source: string): string[] {
  try {
    return engine.scanFutureFunctions(source)
  } catch {
    return []
  }
}
