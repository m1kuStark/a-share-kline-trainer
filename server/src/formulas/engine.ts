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

/** 生产默认：bundle 优先、dev/test 源码回退；进程内缓存一次加载结果 */
export const bundleEngineProvider: FormulaEngineProvider = () => cached ??= loadEngine()

/** 测试/调用方专用的无缓存实例（验证加载器回退路径时必须真实执行） */
export function createEngineProvider(): FormulaEngineProvider {
  return () => loadEngine()
}

async function loadEngine(): Promise<FormulaEngineModule> {
  let bundleError: unknown = null
  try {
    return await import(new URL('./engine-bundle/index.mjs', import.meta.url).href) as FormulaEngineModule
  } catch (error) {
    bundleError = error
  }
  try {
    return await loadSourceEngine()
  } catch (sourceError) {
    const bundleMessage = bundleError instanceof Error ? bundleError.message : String(bundleError)
    const sourceMessage = sourceError instanceof Error ? sourceError.message : String(sourceError)
    throw new Error(`公式引擎加载失败（bundle: ${bundleMessage}；源码回退: ${sourceMessage}）。生产构建请先运行 npm run build:server。`)
  }
}

/**
 * 开发/测试回退：只加载两个纯值入口（FormulaEngine.ts / futureFunctions.ts）。
 * 不能直接加载 index.ts：它把纯类型（如 AuxiliaryFormulaRegistry）按值再导出，
 * tsx/Node 的 ESM 校验会报 does not provide an export named，导致 dev 全接口 500。
 */
async function loadSourceEngine(): Promise<FormulaEngineModule> {
  const base = new URL('../../../web/src/formula-engine/', import.meta.url)
  const [engineModule, futureModule] = await Promise.all([
    import(new URL('FormulaEngine.ts', base).href) as Promise<{ FormulaEngine: new () => FormulaEngineLike }>,
    import(new URL('futureFunctions.ts', base).href) as Promise<{ scanFutureFunctions: (source: string) => string[] }>,
  ])
  if (typeof engineModule.FormulaEngine !== 'function' || typeof futureModule.scanFutureFunctions !== 'function') {
    throw new Error('源码回退入口缺少 FormulaEngine/scanFutureFunctions 导出')
  }
  return { FormulaEngine: engineModule.FormulaEngine, scanFutureFunctions: futureModule.scanFutureFunctions }
}

const DETAIL_TRANSLATIONS: Array<[RegExp, string]> = [
  [/^Unexpected end of input/i, '表达式未完成'],
  [/^Unexpected character: ?'(.+)'/i, "无法识别的字符 '$1'"],
  [/^Unexpected token: ?(.+)/i, '意外的记号：$1'],
  [/^Expected expression/i, '缺少表达式'],
  [/^Expected ';'/i, "语句缺少分号 ';'"],
  [/^Expected closing parenthesis|^Expected '\)'/i, '括号未闭合'],
  [/^Unterminated string literal/i, '字符串缺少结束引号'],
  [/^Unterminated block comment/i, '块注释未闭合'],
  [/^Unknown function/i, '未知函数（该函数尚未实现或拼写有误）'],
  [/^Undefined variable/i, '未定义变量'],
]

function localizeDetail(detail: string): string {
  for (const [pattern, replacement] of DETAIL_TRANSLATIONS) {
    if (pattern.test(detail)) return detail.replace(pattern, replacement)
  }
  return detail
}

/** 把引擎抛出的 lexer/parser/runtime 错误转成稳定契约：中文原因＋行/列（保留引擎细节便于排查） */
export function validationErrorOf(error: unknown): FormulaValidationError {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  const record = (typeof error === 'object' && error !== null ? error : {}) as { line?: unknown; column?: unknown }
  const line = typeof record.line === 'number' ? record.line : undefined
  const column = typeof record.column === 'number' ? record.column : undefined
  const kind: FormulaValidationError['kind'] = name === 'LexerError' ? 'lexer' : name === 'ParserError' ? 'parser' : 'runtime'
  const detail = localizeDetail(rawMessage.replace(/^(?:Lexer|Parser) error at line \d+, column \d+: /, ''))
  const position = line === undefined ? '' : `（第 ${line} 行${column === undefined ? '' : `第 ${column} 列`}）`
  const prefix = kind === 'lexer' ? '词法错误' : kind === 'parser' ? '语法错误' : '运行错误'
  return { kind, message: prefix + position + '：' + detail, ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }) }
}

/** 未来函数扫描容错：扫描失败不应阻塞校验/保存（引擎未来函数层为纯静态扫描） */
export function futureFunctionsOf(engine: FormulaEngineModule, source: string): string[] {
  try {
    return engine.scanFutureFunctions(source)
  } catch {
    return []
  }
}
