// PACK-02（DESKTOP-GRACEFUL-QUIT-DRAIN / DESKTOP-DRAIN-TIMEOUT-FORCE / DESKTOP-QUIT-NO-ORPHAN）：
// 退出状态机。oracle 独立性：期望来自 SETUP-01 冻结排空控制器合同＋server/src/api.ts
// lifecycleInvokeShutdownOnce 的 in-app 退出口径（prepare(allowActiveTraining:true)＋shutdown），
// 与 PACK-02 派发简报决策②（15s 外层超时强制退出、如实记录、单飞收敛）——不从实现反推。
import { describe, expect, it } from 'vitest'
import { nextQuitState, resolveDrainTimeoutMs, type QuitState } from '../src/quit-state.js'

const idle: QuitState = { phase: 'idle' }

describe('DESKTOP-GRACEFUL-QUIT-DRAIN：窗口关闭→冻结排空→服务关闭→退出', () => {
  it('DESKTOP-GRACEFUL-QUIT-DRAIN: quitting a running embedded server drains with the in-app exit profile before closing', () => {
    // 第一步：request-quit（服务在运行）→ 进入 draining，发出 prepare 动作
    // 关键口径：allowActiveTraining=true（in-app 退出保留未完成训练，与页面「保存并退出」同语义；
    // 区别于控制端点严格守卫）。attemptId 透传，宿主自行生成。
    const draining = nextQuitState(idle, { type: 'request-quit', attemptId: 'desktop-abc' }, true)
    expect(draining.state).toEqual({ phase: 'draining', attemptId: 'desktop-abc' })
    expect(draining.actions).toEqual([
      { call: 'prepare', attemptId: 'desktop-abc', allowActiveTraining: true },
    ])
    // 第二步：prepared → closing，发出 shutdown 动作
    const closing = nextQuitState(draining.state, { type: 'drain-outcome', kind: 'prepared' }, true)
    expect(closing.state).toEqual({ phase: 'closing', forced: false, forcedReason: null })
    expect(closing.actions).toEqual([{ call: 'shutdown' }])
    // 第三步：shutdown-done → quit，发出自然退出动作（非强制）
    const quit = nextQuitState(closing.state, { type: 'shutdown-done' }, true)
    expect(quit.state).toEqual({ phase: 'quit' })
    expect(quit.actions).toEqual([{ call: 'exit', code: 0, forced: false, reason: null }])
  })

  it('DESKTOP-GRACEFUL-QUIT-DRAIN: repeated quit requests are absorbed while one lifecycle is in flight', () => {
    const draining = nextQuitState(idle, { type: 'request-quit', attemptId: 'a1' }, true)
    // draining / closing / quit 各阶段再收 request-quit → 状态不变、零动作（单飞）
    expect(nextQuitState(draining.state, { type: 'request-quit', attemptId: 'a2' }, true))
      .toEqual({ state: draining.state, actions: [] })
    const closing = nextQuitState(draining.state, { type: 'drain-outcome', kind: 'prepared' }, true)
    expect(nextQuitState(closing.state, { type: 'request-quit', attemptId: 'a3' }, true))
      .toEqual({ state: closing.state, actions: [] })
    expect(nextQuitState({ phase: 'quit' }, { type: 'request-quit', attemptId: 'a4' }, true))
      .toEqual({ state: { phase: 'quit' }, actions: [] })
  })

  it('DESKTOP-GRACEFUL-QUIT-DRAIN: quitting without a running server skips drain and exits directly', () => {
    const quit = nextQuitState(idle, { type: 'request-quit', attemptId: 'a1' }, false)
    expect(quit.state).toEqual({ phase: 'quit' })
    expect(quit.actions).toEqual([{ call: 'exit', code: 0, forced: false, reason: null }])
  })

  it('DESKTOP-GRACEFUL-QUIT-DRAIN: stale drain outcomes (busy/cancelled/expired/active-training) still converge to closing', () => {
    for (const kind of ['busy', 'cancelled', 'expired', 'active-training', 'closing'] as const) {
      const draining = nextQuitState(idle, { type: 'request-quit', attemptId: 'a1' }, true)
      const closing = nextQuitState(draining.state, { type: 'drain-outcome', kind }, true)
      expect(closing.state.phase).toBe('closing')
      expect(closing.actions).toEqual([{ call: 'shutdown' }])
    }
  })
})

describe('DESKTOP-DRAIN-TIMEOUT-FORCE：排空/关闭超时强制退出', () => {
  it('DESKTOP-DRAIN-TIMEOUT-FORCE: a drain-timeout outcome forces exit with the reason recorded', () => {
    const draining = nextQuitState(idle, { type: 'request-quit', attemptId: 'a1' }, true)
    const closing = nextQuitState(draining.state, { type: 'drain-outcome', kind: 'drain-timeout' }, true)
    expect(closing.state).toMatchObject({ phase: 'closing', forced: true })
    expect(closing.state.forcedReason).toContain('drain-timeout')
    expect(closing.actions).toEqual([{ call: 'shutdown' }])
    // 强制口径下 shutdown 完成 → exit 动作带 forced=true＋原因（如实记录）
    const quit = nextQuitState(closing.state, { type: 'shutdown-done' }, true)
    expect(quit.actions).toEqual([
      { call: 'exit', code: 0, forced: true, reason: expect.stringContaining('drain-timeout') },
    ])
  })

  it('DESKTOP-DRAIN-TIMEOUT-FORCE: an outer shutdown stall forces exit instead of hanging', () => {
    const draining = nextQuitState(idle, { type: 'request-quit', attemptId: 'a1' }, true)
    // 外层整体超时（draining 阶段）→ 直接强制退出，不再等排空
    const outerFromDraining = nextQuitState(draining.state, { type: 'outer-timeout' }, true)
    expect(outerFromDraining.state).toEqual({ phase: 'quit' })
    expect(outerFromDraining.actions).toEqual([{ call: 'exit', code: 0, forced: true, reason: expect.stringContaining('outer-timeout') }])
    // closing 阶段卡死 → shutdown-timeout 强制退出
    const closing = nextQuitState(draining.state, { type: 'drain-outcome', kind: 'prepared' }, true)
    const stalled = nextQuitState(closing.state, { type: 'shutdown-timeout' }, true)
    expect(stalled.state).toEqual({ phase: 'quit' })
    expect(stalled.actions).toEqual([{ call: 'exit', code: 0, forced: true, reason: expect.stringContaining('shutdown-timeout') }])
  })

  it('DESKTOP-DRAIN-TIMEOUT-FORCE: resolveDrainTimeoutMs defaults to 15000, honors overrides, rejects invalid values', () => {
    expect(resolveDrainTimeoutMs({})).toBe(15_000)
    expect(resolveDrainTimeoutMs({ TRAINER_DESKTOP_DRAIN_TIMEOUT_MS: '3000' })).toBe(3_000)
    expect(() => resolveDrainTimeoutMs({ TRAINER_DESKTOP_DRAIN_TIMEOUT_MS: '0' })).toThrow(/TRAINER_DESKTOP_DRAIN_TIMEOUT_MS/)
    expect(() => resolveDrainTimeoutMs({ TRAINER_DESKTOP_DRAIN_TIMEOUT_MS: 'abc' })).toThrow(/TRAINER_DESKTOP_DRAIN_TIMEOUT_MS/)
    expect(() => resolveDrainTimeoutMs({ TRAINER_DESKTOP_DRAIN_TIMEOUT_MS: '-5' })).toThrow(/TRAINER_DESKTOP_DRAIN_TIMEOUT_MS/)
  })
})

describe('DESKTOP-QUIT-NO-ORPHAN：退出必然收敛（不挂起、不重复关闭）', () => {
  it('DESKTOP-QUIT-NO-ORPHAN: a shutdown error still converges to exit (recorded, never hung)', () => {
    const draining = nextQuitState(idle, { type: 'request-quit', attemptId: 'a1' }, true)
    const closing = nextQuitState(draining.state, { type: 'drain-outcome', kind: 'prepared' }, true)
    const failed = nextQuitState(closing.state, { type: 'shutdown-error', message: 'ECONNRESET' }, true)
    expect(failed.state).toEqual({ phase: 'quit' })
    expect(failed.actions).toEqual([{ call: 'exit', code: 0, forced: true, reason: expect.stringContaining('ECONNRESET') }])
  })

  it('DESKTOP-QUIT-NO-ORPHAN: shutdown runs at most once across duplicate quit paths', () => {
    // 关闭中重复收到 drain-outcome（不同 attempt 的迟到结果）→ 不再发第二个 shutdown
    const draining = nextQuitState(idle, { type: 'request-quit', attemptId: 'a1' }, true)
    const closing = nextQuitState(draining.state, { type: 'drain-outcome', kind: 'prepared' }, true)
    const duplicate = nextQuitState(closing.state, { type: 'drain-outcome', kind: 'prepared' }, true)
    expect(duplicate).toEqual({ state: closing.state, actions: [] })
    // 已退出后再来任何事件 → 全吸收
    const quit = nextQuitState(closing.state, { type: 'shutdown-done' }, true)
    expect(nextQuitState(quit.state, { type: 'shutdown-error', message: 'late' }, true))
      .toEqual({ state: quit.state, actions: [] })
  })
})
