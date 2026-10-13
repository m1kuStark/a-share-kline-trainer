// DL-HANG-01 更新下载挂起无反馈修复·RED 回归（矩阵行 UPD-DL-WATCHDOG /
// UPD-DL-START-CONFIRM / UPD-DL-RETRY-AFTER-STALL，2026-10-13 planned）。
// 真机缺陷（w5）：点击「下载并更新」后 20 分钟死寂——electron-updater
// ElectronHttpExecutor（electron net）零超时，网络层挂起时 downloadUpdate promise
// 永久 pending → 无事件、无错误、按钮永久禁用、无重试入口。
// oracle 独立性：期望值手写自矩阵 EARS 与派发简报（90s 阈值/人话原因含已等待时长/
// 重试不设上限），非实现回显；「挂起场景」由桩 adapter 复现（never settle），
// 测试以 withTimeout 显式判定「必须在有限时间内以失败收敛」——无看门狗的实现
// 将死于该断言（RED 即缺陷复现）。
// 时间注入：stallTimeoutMs 经 controller deps 注入小值（60ms 级），不真等 90s。
import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopUpdateController,
  type DesktopUpdaterAdapter,
  type DesktopUpdateEvent,
  type DownloadCancellation,
} from '../src/desktop-updates.js'
import { desktopEventToApplyView } from '../../web/src/updateFlow.js'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 显式时限判定：挂起（promise 永不 settle）时以人话消息失败，而非等 vitest 全局超时 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

interface ProgressShape {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

type StallMode = 'hang' | 'ok' | 'late-reject-after-cancel' | 'slow-progress'

interface StallStubState {
  mode: StallMode
  progressIntervalMs: number
  progressTimes: number
}

/**
 * 桩 adapter：downloadUpdate 行为可切换。
 * - hang：永不 settle（复现真机挂起；响应 cancel 后 reject 以便测试收尾与晚到 settle 场景）
 * - ok：立即 resolve 成功
 * - late-reject-after-cancel：收到 cancellation 后延迟 reject（复现「看门狗已判停滞、
 *   底层 promise 晚到 settle」——实现必须吞掉，不得 unhandledRejection）
 * - slow-progress：每 intervalMs 发一次 progress、共 times 次，随后 resolve（慢但活着）
 */
function makeStallAdapter(initial: Partial<StallStubState> = {}) {
  const state: StallStubState = { mode: 'hang', progressIntervalMs: 50, progressTimes: 4, ...initial }
  let receivedCancellation: DownloadCancellation | undefined
  let downloadCalls = 0
  const progressListeners: Array<(p: ProgressShape) => void> = []
  const adapter: DesktopUpdaterAdapter = {
    setFeedURL: () => {},
    checkForUpdates: async () => ({ updateAvailable: true, version: '9.9.9', releaseNotes: 'fixture notes' }),
    downloadUpdate: (cancellation?: DownloadCancellation) => {
      downloadCalls++
      receivedCancellation = cancellation
      return new Promise<{ version: string }>((resolve, reject) => {
        if (state.mode === 'ok') {
          resolve({ version: '9.9.9' })
          return
        }
        if (state.mode === 'late-reject-after-cancel') {
          void cancellation?.whenCancelled.then(() => {
            setTimeout(() => reject(new Error('late failure after stall')), 20)
          })
          return
        }
        if (state.mode === 'slow-progress') {
          let sent = 0
          const timer = setInterval(() => {
            sent++
            if (sent > state.progressTimes) {
              clearInterval(timer)
              resolve({ version: '9.9.9' })
              return
            }
            for (const listener of progressListeners) {
              listener({ percent: 10 * sent, transferred: 100 * sent, total: 1000, bytesPerSecond: 500 })
            }
          }, state.progressIntervalMs)
          return
        }
        // hang：永不 settle；cancel 后 reject（CancellationError 语义替身）
        void cancellation?.whenCancelled.then(() => reject(new Error('cancelled download')))
      })
    },
    quitAndInstall: () => {},
    onDownloadProgress: callback => { progressListeners.push(callback) },
  }
  return {
    adapter,
    setMode: (mode: StallMode) => { state.mode = mode },
    receivedCancellation: () => receivedCancellation,
    downloadCallCount: () => downloadCalls,
  }
}

function makeHarness(adapter: DesktopUpdaterAdapter, stallTimeoutMs: number) {
  const events: DesktopUpdateEvent[] = []
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
  const controller = createDesktopUpdateController({
    adapter,
    getCurrentVersion: () => '1.2.7',
    sendEvent: event => { events.push(event) },
    requestInstallWithDrain: () => {},
    logger,
    stallTimeoutMs,
  })
  return { controller, events, logger }
}

describe('DL-HANG-01 下载停滞看门狗与启动反馈', () => {
  it('UPD-DL-WATCHDOG: a silent download converges to a human failure with waited seconds, cancel handle fired, error event sent', async () => {
    const stub = makeStallAdapter({ mode: 'hang' })
    const harness = makeHarness(stub.adapter, 60)
    await harness.controller.checkForUpdates()
    const outcome = await withTimeout(
      harness.controller.downloadAndInstall(),
      2000,
      '看门狗未生效：downloadAndInstall 对永不 settle 的下载挂起（真机缺陷复现）',
    )
    // 失败收敛＋人话原因：含停滞语义、已等待时长（N 秒）、网络提示、可重试指引
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error).toContain('下载停滞')
      expect(outcome.error).toContain('没有任何进度')
      expect(outcome.error).toMatch(/\d+ 秒/)
      expect(outcome.error).toContain('网络')
      expect(outcome.error).toContain('重试')
      // 事件面同步失败（渲染端 failed 呈现＝重试入口的既有通路）
      const errorEvents = harness.events.filter(event => event.type === 'error')
      expect(errorEvents).toHaveLength(1)
      if (errorEvents[0]?.type === 'error') expect(errorEvents[0].message).toBe(outcome.error)
    }
    // 中止句柄尽力触发（electron-updater CancellationToken 的上游信号）
    expect(stub.receivedCancellation()?.cancelled).toBe(true)
  })

  it('UPD-DL-WATCHDOG: slow-but-alive progress resets the watchdog and completes without stall', async () => {
    // 4 次 progress、间隔 50ms（每段空窗 < 60ms 阈值）、总时长 250ms > 60ms——无推进重置则必被误杀
    const stub = makeStallAdapter({ mode: 'slow-progress', progressIntervalMs: 50, progressTimes: 4 })
    const harness = makeHarness(stub.adapter, 60)
    await harness.controller.checkForUpdates()
    const outcome = await withTimeout(harness.controller.downloadAndInstall(), 3000, '慢速但持续有进度的下载被看门狗误杀')
    expect(outcome.ok).toBe(true)
    expect(harness.events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(harness.events.some(event => event.type === 'downloaded')).toBe(true)
    expect(harness.events.filter(event => event.type === 'download-progress').length).toBeGreaterThanOrEqual(4)
    expect(stub.receivedCancellation()?.cancelled ?? false).toBe(false)
  })

  it('UPD-DL-WATCHDOG: late settlement after a stall is swallowed without unhandled rejection', async () => {
    const stub = makeStallAdapter({ mode: 'late-reject-after-cancel' })
    const harness = makeHarness(stub.adapter, 60)
    await harness.controller.checkForUpdates()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const outcome = await withTimeout(harness.controller.downloadAndInstall(), 2000, '看门狗未生效：晚到 settle 场景同样挂起')
      expect(outcome.ok).toBe(false)
      await sleep(150) // 留出晚到 reject 的窗口
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('UPD-DL-START-CONFIRM: download start is observable immediately via event and log line', async () => {
    const stub = makeStallAdapter({ mode: 'hang' })
    const harness = makeHarness(stub.adapter, 80)
    await harness.controller.checkForUpdates()
    const pending = harness.controller.downloadAndInstall()
    // 不等下载完成：启动反馈必须即时（10 秒内的极限形态＝毫秒级事件＋日志观测缝）
    await sleep(5)
    expect(harness.events).toContainEqual({ type: 'download-started' })
    expect(harness.logger.info.mock.calls.some(call => String(call[0]).includes('download started'))).toBe(true)
    // 收尾（挂起桩由看门狗收敛），同时验证下载未完成时不会误发 downloaded
    const outcome = await withTimeout(pending, 2000, '收尾失败：看门狗未生效')
    expect(outcome.ok).toBe(false)
    expect(harness.events.some(event => event.type === 'downloaded')).toBe(false)
  })

  it('UPD-DL-RETRY-AFTER-STALL: retry after a stall reruns the full chain with a fresh watchdog and no attempt cap', async () => {
    const stub = makeStallAdapter({ mode: 'hang' })
    const harness = makeHarness(stub.adapter, 60)
    await harness.controller.checkForUpdates()
    const first = await withTimeout(harness.controller.downloadAndInstall(), 2000, '第一次下载停滞未收敛')
    expect(first.ok).toBe(false)
    // 重试：残留状态清理后完整链重启（新 download-started＋新看门狗）；网络恢复形态＝立即成功
    stub.setMode('ok')
    const second = await withTimeout(harness.controller.downloadAndInstall(), 2000, '重试被残留状态拒绝或挂起')
    expect(second.ok).toBe(true)
    // 不设上限：第三次（再次挂起→再次失败→可继续重试）
    stub.setMode('hang')
    const third = await withTimeout(harness.controller.downloadAndInstall(), 2000, '第三次重试未独立收敛')
    expect(third.ok).toBe(false)
    expect(stub.downloadCallCount()).toBe(3)
    // 每次重试都独立走完整链：download-started 恰 3 次
    expect(harness.events.filter(event => event.type === 'download-started')).toHaveLength(3)
    expect(harness.events.some(event => event.type === 'downloaded')).toBe(true)
  })

  it('UPD-DL-WATCHDOG: resolveDownloadStallTimeoutMs defaults to 90s with env override and rejects garbage', async () => {
    const mod = await import('../src/desktop-updates.js')
    const fn = mod.resolveDownloadStallTimeoutMs as ((env: NodeJS.ProcessEnv) => number) | undefined
    expect(typeof fn).toBe('function')
    if (typeof fn === 'function') {
      expect(fn({})).toBe(90_000)
      expect(fn({ TRAINER_DESKTOP_DL_STALL_MS: '250' })).toBe(250)
      expect(fn({ TRAINER_DESKTOP_DL_STALL_MS: ' 250 ' })).toBe(250)
      // 非法值（空/非数字/0/负）一律回默认（fail-safe，不让坏 env 关掉看门狗）
      expect(fn({ TRAINER_DESKTOP_DL_STALL_MS: '' })).toBe(90_000)
      expect(fn({ TRAINER_DESKTOP_DL_STALL_MS: 'abc' })).toBe(90_000)
      expect(fn({ TRAINER_DESKTOP_DL_STALL_MS: '0' })).toBe(90_000)
      expect(fn({ TRAINER_DESKTOP_DL_STALL_MS: '-5' })).toBe(90_000)
    }
  })

  it('UPD-DL-START-CONFIRM: renders download-started onto the downloading presentation at zero percent', () => {
    // 渲染端映射（web/src/updateFlow.ts 真实导出）：download-started → 既有 downloading 态 0%
    expect(desktopEventToApplyView({ type: 'download-started' })).toEqual({ state: 'downloading', progressPercent: 0 })
  })
})
