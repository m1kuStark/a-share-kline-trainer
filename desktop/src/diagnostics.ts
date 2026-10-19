// GAP1-DIAG（用户 2026-10-19 拍板 G1）诊断信息组装＋窄 IPC 粘合。
// 矩阵行 DESKTOP-DIAG-CLIPBOARD / DESKTOP-DIAG-IPC：
//   - buildDiagnosticsText＝纯组装器（零 IO）：应用版本/平台/数据目录/更新通道与最近检查
//     结果/最近错误（主进程 ring，root 2026-10-19 裁定：renderer 错误不采集）/日志尾部
//     有限行；绝不包含训练与交易数据（组装来源封闭＝版本、环境、更新状态、主进程自身
//     日志，无任何库表读取面）。
//   - registerDiagnosticsIpc＝唯一新增通道 desktop-diagnostics:invoke（method copy）：
//     组装→系统剪贴板→结构化结果；任何失败返回 {ok:false,error 中文}，绝不向渲染端抛异常
//     （desktopRecordings/desktopMigration 同纪律）。
import type { DiagLogger } from './diag-log.js'

/** 诊断文本携带的日志尾部行数上限（proposed_default） */
export const DIAG_TAIL_MAX_LINES = 200
/** 最近错误环容量（proposed_default；root 裁定＝主进程口径） */
export const DIAG_RECENT_ERROR_LIMIT = 20

/** 主进程最近一次更新检查的人话快照 */
export interface UpdateCheckSnapshot {
  at: string
  ok: boolean
  summary: string
}

export interface DiagnosticsFacts {
  appVersion: string | null
  platform: { os: string, arch: string, electron: string | null, chrome: string | null, node: string }
  dataDir: string | null
  updateChannel: string
  lastUpdateCheck: UpdateCheckSnapshot | null
  recentErrors: string[]
  logTail: { ok: boolean, lines: string[], reason: string | null }
}

/** 更新检查结果 → 一行人话（独立于呈现层；三态：发现新版/已是最新/检查失败） */
export function summarizeUpdateCheck(
  at: string,
  view: { currentVersion: string | null, latestVersion: string | null, updateAvailable: boolean, error: string | null },
): UpdateCheckSnapshot {
  if (view.error !== null) return { at, ok: false, summary: `检查失败：${view.error}` }
  if (view.updateAvailable) {
    const current = view.currentVersion ? `（当前 ${view.currentVersion}）` : ''
    return { at, ok: true, summary: `发现新版 ${view.latestVersion ?? '未知'}${current}` }
  }
  return { at, ok: true, summary: `已是最新（${view.currentVersion ?? '未知'}）` }
}

/** 诊断纯文本组装（冻结字段顺序；尾部/错误环在上限内取最旧保留最新的末段） */
export function buildDiagnosticsText(facts: DiagnosticsFacts): string {
  const parts: string[] = ['K线训练器诊断信息']
  parts.push(`应用版本：${facts.appVersion ? `v${facts.appVersion}` : '未知'}`)

  const engineParts: string[] = []
  if (facts.platform.electron) engineParts.push(`Electron ${facts.platform.electron}`)
  if (facts.platform.chrome) engineParts.push(`Chrome ${facts.platform.chrome}`)
  if (facts.platform.node) engineParts.push(`Node ${facts.platform.node}`)
  parts.push(`平台：${facts.platform.os} / ${facts.platform.arch}${engineParts.length > 0 ? `（${engineParts.join('、')}）` : ''}`)

  parts.push(`数据目录：${facts.dataDir ?? '未知'}`)
  parts.push(`更新通道：${facts.updateChannel}`)
  parts.push(facts.lastUpdateCheck
    ? `最近更新检查：${facts.lastUpdateCheck.at}（${facts.lastUpdateCheck.summary}）`
    : '最近更新检查：本进程未执行更新检查')

  parts.push('最近错误：')
  const errors = facts.recentErrors.slice(-DIAG_RECENT_ERROR_LIMIT)
  if (errors.length === 0) {
    parts.push('（无）')
  } else {
    for (const line of errors) parts.push(`- ${line}`)
  }

  parts.push(`日志尾部（最近 ${DIAG_TAIL_MAX_LINES} 行）：`)
  if (!facts.logTail.ok) {
    parts.push(`（日志不可用：${facts.logTail.reason ?? '未知原因'}）`)
  } else {
    const lines = facts.logTail.lines.slice(-DIAG_TAIL_MAX_LINES)
    if (lines.length === 0) parts.push('（暂无日志）')
    else for (const line of lines) parts.push(line)
  }
  return `${parts.join('\n')}\n`
}

// ===== 窄 IPC 粘合（依赖注入 Electron API；vitest 经注入桩直测） =====

export interface DiagnosticsIpcDeps {
  ipcMain: {
    handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void
  }
  clipboard: { writeText(text: string): void }
  collectFacts: () => Promise<DiagnosticsFacts>
  logger?: { error(...args: unknown[]): void }
}

/**
 * 注册诊断专用通道（唯一新增 IPC 面；preload 对应 desktopDiagnostics.copyDiagnostics）。
 * 成功路径：collectFacts → buildDiagnosticsText → clipboard.writeText → {ok:true}。
 */
export function registerDiagnosticsIpc(deps: DiagnosticsIpcDeps): void {
  deps.ipcMain.handle('desktop-diagnostics:invoke', async (_event, request) => {
    const method = (request as { method?: unknown } | null)?.method
    if (method !== 'copy') {
      return { ok: false, error: `未知的诊断 IPC 方法：${String(method)}` }
    }
    try {
      const text = buildDiagnosticsText(await deps.collectFacts())
      deps.clipboard.writeText(text)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.logger?.error('[desktop] 复制诊断信息失败:', message)
      return { ok: false, error: `复制诊断信息失败：${message}` }
    }
  })
}

/** readTail 结果 → facts.logTail 形状（无 sink＝启动早期/dev 窗口的结构化原因） */
export function tailResultToFactsLogTail(
  tail: Awaited<ReturnType<DiagLogger['readTail']>>,
): DiagnosticsFacts['logTail'] {
  return tail.ok ? { ok: true, lines: tail.lines, reason: null } : { ok: false, lines: [], reason: tail.reason }
}
