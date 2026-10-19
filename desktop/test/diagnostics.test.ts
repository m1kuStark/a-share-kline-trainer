// GAP1-DIAG DESKTOP-DIAG-CLIPBOARD / DESKTOP-DIAG-IPC：诊断文本组装＋窄 IPC 粘合。
// oracle 独立性：字段清单＝复盘缺口 G1 用户冻结口径（版本/平台/数据目录/更新通道与最近
// 检查结果/最近错误/日志尾部有限行），期望文案为测试手写常量，非实现回显；负向断言锁定
// 「绝不包含训练与交易数据」。上限截断期望（500→末 200 行、50→末 20 条）为独立手算。
import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  DIAG_RECENT_ERROR_LIMIT,
  DIAG_TAIL_MAX_LINES,
  buildDiagnosticsText,
  registerDiagnosticsIpc,
  summarizeUpdateCheck,
  type DiagnosticsFacts,
} from '../src/diagnostics.js'

function fixtureFacts(overrides: Partial<DiagnosticsFacts> = {}): DiagnosticsFacts {
  return {
    appVersion: '1.3.0',
    platform: { os: 'win32', arch: 'x64', electron: '33.0.0', chrome: '130.0.0', node: '20.11.0' },
    dataDir: 'D:\\data\\trainer',
    updateChannel: 'packaged',
    lastUpdateCheck: { at: '2026-10-19T03:00:00.000Z', ok: true, summary: '发现新版 9.9.9（当前 1.3.0）' },
    recentErrors: ['2026-10-19T02:00:00.000Z [error] [desktop] uncaught exception'],
    logTail: { ok: true, lines: ['2026-10-19T02:00:00.000Z [log] [desktop] boot ok'], reason: null },
    ...overrides,
  }
}

describe('GAP1-DIAG 诊断文本组装（DESKTOP-DIAG-CLIPBOARD）', () => {
  it('builds the frozen field list in order（版本/平台/数据目录/更新通道与最近检查/最近错误/日志尾部）', () => {
    const text = buildDiagnosticsText(fixtureFacts())
    // 逐字段手写期望（冻结清单顺序即出现顺序）
    const anchors = [
      '应用版本：v1.3.0',
      '平台：win32 / x64（Electron 33.0.0、Chrome 130.0.0、Node 20.11.0）',
      '数据目录：D:\\data\\trainer',
      '更新通道：packaged',
      '最近更新检查：2026-10-19T03:00:00.000Z（发现新版 9.9.9（当前 1.3.0））',
      '最近错误：',
      '- 2026-10-19T02:00:00.000Z [error] [desktop] uncaught exception',
      '日志尾部（最近 200 行）：',
      '2026-10-19T02:00:00.000Z [log] [desktop] boot ok',
    ]
    let cursor = -1
    for (const anchor of anchors) {
      const at = text.indexOf(anchor)
      expect(at, `应包含且晚于前一字段：${anchor}`).toBeGreaterThan(cursor)
      cursor = at
    }
    expect(text.startsWith('K线训练器诊断信息\n')).toBe(true)
  })

  it('renders honest placeholders for absent sections（无检查/无错误/日志尾部空或不可用）', () => {
    const text = buildDiagnosticsText(fixtureFacts({
      appVersion: null,
      lastUpdateCheck: null,
      recentErrors: [],
      logTail: { ok: true, lines: [], reason: null },
    }))
    expect(text).toContain('应用版本：未知')
    expect(text).toContain('最近更新检查：本进程未执行更新检查')
    expect(text).toContain('最近错误：\n（无）')
    expect(text).toContain('日志尾部（最近 200 行）：\n（暂无日志）')

    const unusable = buildDiagnosticsText(fixtureFacts({
      logTail: { ok: false, lines: [], reason: 'EACCES: locked' },
    }))
    expect(unusable).toContain('日志尾部（最近 200 行）：\n（日志不可用：EACCES: locked）')
  })

  it('caps the log tail to the last DIAG_TAIL_MAX_LINES lines and errors to the ring limit（独立手算）', () => {
    const tailLines = Array.from({ length: 500 }, (_, i) => `tail-${i}`)
    const errors = Array.from({ length: 50 }, (_, i) => `err-${i}`)
    expect(DIAG_TAIL_MAX_LINES).toBe(200)
    expect(DIAG_RECENT_ERROR_LIMIT).toBe(20)
    const text = buildDiagnosticsText(fixtureFacts({ recentErrors: errors, logTail: { ok: true, lines: tailLines, reason: null } }))
    // 末 200 行＝tail-300..tail-499；末 20 条错误＝err-30..err-49
    expect(text).toContain('tail-300')
    expect(text).toContain('tail-499')
    expect(text).not.toContain('tail-299')
    expect(text).toContain('err-30')
    expect(text).toContain('err-49')
    expect(text).not.toContain('err-29')
  })

  it('never contains training or trading data（负向断言：清洁输入零泄漏）', () => {
    const text = buildDiagnosticsText(fixtureFacts())
    expect(text).not.toMatch(/持仓|委托|成交明细|订单簿|盈亏|训练局|初始资金|trainer\.sqlite/)
  })

  it('summarizeUpdateCheck maps the three outcomes with human text', () => {
    expect(summarizeUpdateCheck('2026-10-19T03:00:00.000Z', {
      currentVersion: '1.3.0', latestVersion: '9.9.9', updateAvailable: true, error: null,
    })).toEqual({ at: '2026-10-19T03:00:00.000Z', ok: true, summary: '发现新版 9.9.9（当前 1.3.0）' })
    expect(summarizeUpdateCheck('2026-10-19T03:00:00.000Z', {
      currentVersion: '1.3.0', latestVersion: '1.3.0', updateAvailable: false, error: null,
    })).toEqual({ at: '2026-10-19T03:00:00.000Z', ok: true, summary: '已是最新（1.3.0）' })
    expect(summarizeUpdateCheck('2026-10-19T03:00:00.000Z', {
      currentVersion: '1.3.0', latestVersion: null, updateAvailable: false, error: 'network down',
    })).toEqual({ at: '2026-10-19T03:00:00.000Z', ok: false, summary: '检查失败：network down' })
  })
})

describe('GAP1-DIAG 诊断 IPC 粘合（DESKTOP-DIAG-IPC）', () => {
  function makeHarness(collectFacts: () => Promise<DiagnosticsFacts> = async () => fixtureFacts()) {
    const registrations: Array<{ channel: string, listener: (event: unknown, request: unknown) => unknown }> = []
    const ipcMain = { handle: (channel: string, listener: (event: unknown, request: unknown) => unknown) => { registrations.push({ channel, listener }) } }
    const writes: string[] = []
    const clipboard = { writeText: (text: string) => { writes.push(text) } }
    const logger = { error: vi.fn(), warn: vi.fn() }
    registerDiagnosticsIpc({ ipcMain, clipboard, collectFacts, logger })
    return { registrations, writes, clipboard, logger }
  }

  it('registers exactly one channel desktop-diagnostics:invoke; method copy → clipboard receives the built text', async () => {
    const h = makeHarness()
    expect(h.registrations.map(r => r.channel)).toEqual(['desktop-diagnostics:invoke'])
    const result = await h.registrations[0].listener(undefined, { method: 'copy' })
    expect(result).toEqual({ ok: true })
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0]).toContain('应用版本：v1.3.0')
    expect(h.writes[0]).toContain('[desktop] boot ok')
  })

  it('rejects unknown methods with a structured error and leaves the clipboard untouched', async () => {
    const h = makeHarness()
    const result = await h.registrations[0].listener(undefined, { method: 'nope' }) as { ok: boolean, error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('未知的诊断 IPC 方法')
    expect(h.writes).toHaveLength(0)
  })

  it('maps collectFacts / clipboard failures to a structured Chinese error without throwing to the renderer', async () => {
    const h = makeHarness(async () => { throw new Error('facts boom') })
    const result = await h.registrations[0].listener(undefined, { method: 'copy' }) as { ok: boolean, error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('复制诊断信息失败')
    expect(result.error).toContain('facts boom')
    expect(h.writes).toHaveLength(0)
    expect(h.logger.error).toHaveBeenCalledTimes(1)

    const failing = makeHarness()
    failing.clipboard.writeText = () => { throw new Error('clipboard busy') }
    const result2 = await failing.registrations[0].listener(undefined, { method: 'copy' }) as { ok: boolean, error: string }
    expect(result2.ok).toBe(false)
    expect(result2.error).toContain('clipboard busy')
    expect(failing.logger.error).toHaveBeenCalledTimes(1)
  })
})

describe('GAP1-DIAG 主进程接线源码契约（main.ts / diagnostics.ts 无数据面）', () => {
  async function readSource(relative: string): Promise<string> {
    return readFile(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
  }
  /** 行注释剥离后再做负向断言（注释里的关键词不算违约；口径见 oracle.md 契约细则） */
  function stripLineComments(source: string): string {
    return source.replace(/\/\/[^\n]*/g, '')
  }

  it('main.ts routes all logging through the tee and wires the diagnostics IPC', async () => {
    const source = stripLineComments(await readSource('../src/main.ts'))
    expect(source).toMatch(/createTeeConsole/)
    expect(source).toMatch(/registerDiagnosticsIpc/)
    expect(source).toMatch(/createDiagLogger/)
    // 主进程日志全部经 tee（diag-log.ts 的降级 console 在其模块内部，不在 main.ts）
    expect(source).not.toMatch(/console\.(log|warn|error)\(/)
    // DI 注入点不再直通 console
    expect(source).not.toMatch(/logger:\s*console/)
  })

  it('diagnostics.ts stays a pure assembler with no database or server surface（负向：源码零数据面引用）', async () => {
    const source = stripLineComments(await readSource('../src/diagnostics.ts'))
    expect(source).not.toMatch(/sqlite|better-sqlite3|trainer\.sqlite/)
    expect(source).not.toMatch(/from '\.\.\/\.\.\/server|from '\.\.\/server/)
    // buildDiagnosticsText 不做任何 IO：无 fs import
    expect(source).not.toMatch(/node:fs/)
  })
})
