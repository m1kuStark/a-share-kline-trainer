// 进程线索提取（SETUP-CLUES-01 冻结合同）：从运行中的通达信进程可执行文件位置
// 提取安装根目录"线索"。线索只表示"值得检查"，绝不等于可训练或自动生效；
// 失败、超时、拒绝与"确实没有进程"分别可区分。生产查询使用固定程序与参数数组，
// 限定进程名/数量/超时，不拼接 shell、不读取命令行或账号、不记录完整本机路径。
import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export interface ProcessQueryResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** 输出超过有界上限被截断：不完整结果不得按 ok 处理 */
  truncated?: boolean
}

export type ProcessQuery = () => Promise<ProcessQueryResult>

export interface ProcessClue {
  root: string
  source: 'running-process'
}

export interface ProcessClueQueryResult {
  status: 'ok' | 'timeout' | 'denied' | 'unavailable' | 'not_applicable'
  clues: ProcessClue[]
  reason?: string
}

/** 进程名白名单：只查询已知通达信主程序，券商定制名后续按证据扩充 */
export const TDX_PROCESS_NAMES: readonly string[] = ['TdxW.exe']
/** 查询与解析的数量上限：线索只取前若干个，不做全量进程遍历 */
export const MAX_PROCESS_CLUES = 8
/** 生产查询的有界超时（毫秒）；超时按 timeout 状态报告，不无限等待 */
export const PROCESS_QUERY_TIMEOUT_MS = 10_000
/** 生产查询 stdout/stderr 的累计字节上限；超过即终止并按截断失败处理 */
export const MAX_QUERY_OUTPUT_BYTES = 1024 * 1024

/** 有界输出累积：按 UTF-8 字节数计账（字符数会低估 CJK 三倍）。
 * 达到上限后仍有新数据到来即标记截断（而不是静默丢弃）。 */
export interface BoundedOutput {
  stdout: string
  stderr: string
  byteTotal: number
  truncated: boolean
  decoders?: { stdout: StringDecoder; stderr: StringDecoder }
}

export function appendBounded(
  state: BoundedOutput,
  target: 'stdout' | 'stderr',
  text: string,
  cap: number = MAX_QUERY_OUTPUT_BYTES,
): void {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (state.byteTotal >= cap) {
    state.truncated = true
    return
  }
  const room = cap - state.byteTotal
  if (bytes > room) {
    // 剩余空间容不下整个块：丢弃尾块并标记截断。不收部分块可保证
    // 输出字节严格不超上限（重编码替换符会膨胀账面），结果已判截断不可用。
    state.truncated = true
    return
  }
  state[target] += text
  state.byteTotal += bytes
}

/** 将跨 stream chunk 的 UTF-8 字节先用有状态解码器还原，再交给字节上限累积。 */
export function appendBoundedChunk(state: BoundedOutput, target: 'stdout' | 'stderr', chunk: Buffer): void {
  state.decoders ??= { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
  appendBounded(state, target, state.decoders[target].write(chunk))
}

/** 在子进程关闭时排出每个 stream 解码器保留的尾部字节。 */
export function flushBoundedChunk(state: BoundedOutput, target: 'stdout' | 'stderr'): void {
  if (!state.decoders) return
  appendBounded(state, target, state.decoders[target].end())
}

/** 已知通达信主程序的可执行文件名（大小写不敏感） */
function isKnownTdxExecutable(basename: string): boolean {
  return TDX_PROCESS_NAMES.some(name => name.toLowerCase() === basename.toLowerCase())
}

/** 从查询 stdout 提取安装根目录：按出现顺序、Windows 大小写去重、上限 MAX_PROCESS_CLUES。
 * exe 位于 <root>\bin\ 下时线索为上一级；无 bin 父级时线索即 exe 所在目录。 */
export function parseProcessQueryStdout(stdout: string): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const exePath = rawLine.trim()
    if (!exePath) continue
    // structured win32 path APIs handle drive roots correctly
    const basename = win32.basename(exePath)
    if (!isKnownTdxExecutable(basename)) continue
    const exeDirectory = win32.dirname(exePath)
    const parentName = win32.basename(exeDirectory)
    const root = parentName.toLowerCase() === 'bin'
      ? win32.dirname(exeDirectory)
      : exeDirectory
    const dedupKey = root.toLowerCase()
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    roots.push(root)
    if (roots.length >= MAX_PROCESS_CLUES) break
  }
  return roots
}

/** 生产查询脚本（固定字面构造，无用户输入拼接）：白名单进程名 + 上限 8 条路径 */
export function buildProcessQueryScript(): string {
  const filter = TDX_PROCESS_NAMES.map(name => `Name='${name}'`).join(' OR ')
  return `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object -First 8 -ExpandProperty ExecutablePath -ErrorAction SilentlyContinue`
}

/** 生产查询（仅 Windows 调用）：固定 powershell 程序＋固定字面脚本参数数组，
 * 限定进程名白名单与超时；stdout/stderr 有界收集（超限截断并标记），不记录进日志。 */
export function defaultProcessQuery(): Promise<ProcessQueryResult> {
  const script = buildProcessQueryScript()
  return new Promise(resolve => {
    let settled = false
    let timedOut = false
    const output: BoundedOutput = { stdout: '', stderr: '', byteTotal: 0, truncated: false }
    // 手动 deadline 而非 spawn timeout：settle 时 clearTimeout，不留 10 秒内建句柄
    const deadline = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, PROCESS_QUERY_TIMEOUT_MS)
    const settle = (result: ProcessQueryResult) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(result)
    }
    const child = spawn('powershell', ['-NoProfile', '-Command', script], {
      windowsHide: true,
    })
    const boundedAppend = (target: 'stdout' | 'stderr', chunk: Buffer | string) => {
      if (typeof chunk === 'string') appendBounded(output, target, chunk)
      else appendBoundedChunk(output, target, chunk)
      if (output.truncated) child.kill('SIGTERM')
    }
    child.stdout.on('data', chunk => boundedAppend('stdout', chunk))
    child.stderr.on('data', chunk => boundedAppend('stderr', chunk))
    // spawn 失败（如 powershell 不在 PATH）：消化 error 事件并单次 settle，绝不让进程崩溃
    child.on('error', error => {
      settle({ exitCode: null, stdout: output.stdout, stderr: `进程查询启动失败：${error.message}`, timedOut: false, truncated: output.truncated || undefined })
    })
    child.on('close', (exitCode, signal) => {
      flushBoundedChunk(output, 'stdout')
      flushBoundedChunk(output, 'stderr')
      settle({
        exitCode,
        stdout: output.stdout,
        stderr: output.stderr,
        timedOut,
        truncated: output.truncated || undefined,
      })
    })
  })
}

/** 收集线索：调用注入的查询，按合同区分 ok/timeout/denied/unavailable/not_applicable。 */
export async function collectProcessClues(query: ProcessQuery): Promise<ProcessClueQueryResult> {
  if (process.platform !== 'win32') {
    return { status: 'not_applicable', clues: [] }
  }
  let result: ProcessQueryResult
  try {
    result = await query()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { status: 'unavailable', clues: [], reason }
  }
  // 截断优先于超时：超限 kill 的 SIGTERM 会同时给出两信号，截断语义必须先报告
  if (result.truncated) {
    return { status: 'unavailable', clues: [], reason: '进程查询输出超过有界上限被截断，结果不完整' }
  }
  if (result.timedOut) {
    return { status: 'timeout', clues: [] }
  }
  if (result.exitCode === null) {
    return { status: 'unavailable', clues: [], reason: `进程查询异常退出（信号终止）` }
  }
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(0, 200)
    const denied = /拒绝|denied|access/i.test(detail) || /access/i.test(detail)
    return {
      status: denied ? 'denied' : 'unavailable',
      clues: [],
      reason: detail ? `进程查询未成功：${detail}` : `进程查询未成功（exit ${result.exitCode}）`,
    }
  }
  const clues = parseProcessQueryStdout(result.stdout)
    .slice(0, MAX_PROCESS_CLUES)
    .map(root => ({ root, source: 'running-process' as const }))
  return { status: 'ok', clues }
}
