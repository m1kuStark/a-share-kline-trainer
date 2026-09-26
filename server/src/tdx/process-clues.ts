// 进程线索提取（SETUP-CLUES-01 冻结合同）：从运行中的通达信进程可执行文件位置
// 提取安装根目录"线索"。线索只表示"值得检查"，绝不等于可训练或自动生效；
// 失败、超时、拒绝与"确实没有进程"分别可区分。生产查询使用固定程序与参数数组，
// 限定进程名/数量/超时，不拼接 shell、不读取命令行或账号、不记录完整本机路径。
import { spawn } from 'node:child_process'

export interface ProcessQueryResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
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
    const separator = exePath.lastIndexOf('\\') >= 0 ? '\\' : '/'
    const basename = exePath.slice(exePath.lastIndexOf(separator) + 1)
    if (!isKnownTdxExecutable(basename)) continue
    const exeDirectory = exePath.slice(0, exePath.length - basename.length - 1)
    const parentName = exeDirectory.slice(exeDirectory.lastIndexOf(separator) + 1)
    const root = parentName.toLowerCase() === 'bin' && exeDirectory.includes(separator)
      ? exeDirectory.slice(0, exeDirectory.length - separator.length - parentName.length)
      : exeDirectory
    const dedupKey = root.toLowerCase()
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    roots.push(root)
    if (roots.length >= MAX_PROCESS_CLUES) break
  }
  return roots
}

/** 生产查询（仅 Windows 调用）：固定 powershell 程序＋固定字面脚本参数数组，
 * 限定进程名白名单与超时；stdout/stderr 全量收集供状态区分，不记录进日志。 */
export function defaultProcessQuery(): Promise<ProcessQueryResult> {
  const filter = TDX_PROCESS_NAMES.map(name => `Name='${name}'`).join(' OR ')
  const script = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object -ExpandProperty ExecutablePath -ErrorAction SilentlyContinue`
  return new Promise(resolve => {
    const child = spawn('powershell', ['-NoProfile', '-Command', script], {
      timeout: PROCESS_QUERY_TIMEOUT_MS,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', (exitCode, signal) => {
      resolve({ exitCode, stdout, stderr, timedOut: signal === 'SIGTERM' })
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
