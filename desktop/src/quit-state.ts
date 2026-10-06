// PACK-02 退出状态机（DESKTOP-GRACEFUL-QUIT-DRAIN / DESKTOP-DRAIN-TIMEOUT-FORCE / DESKTOP-QUIT-NO-ORPHAN）。
// 纯 reducer：事件→状态迁移＋宿主应执行的动作。口径＝SETUP-01 冻结排空控制器合同＋
// server/src/api.ts lifecycleInvokeShutdownOnce 的 in-app 退出口径（prepare(allowActiveTraining:true)
// ＋shutdown——未完成训练保留 SQLite），与 PACK-02 派发简报决策②（超时强制退出、如实记录、单飞）。
// 不变量：任一路径最终收敛到 quit＋exit 动作（不挂起）；shutdown 至多发出一次；重复请求全部吸收。

export type DrainOutcomeKind =
  | 'prepared'
  | 'drain-timeout'
  | 'busy'
  | 'closing'
  | 'cancelled'
  | 'expired'
  | 'active-training'
  | 'outer-timeout'

export type QuitEvent =
  | { type: 'request-quit'; attemptId: string }
  | { type: 'drain-outcome'; kind: DrainOutcomeKind }
  | { type: 'shutdown-done' }
  | { type: 'shutdown-error'; message: string }
  | { type: 'shutdown-timeout' }
  | { type: 'outer-timeout' }

export type QuitAction =
  | { call: 'prepare'; attemptId: string; allowActiveTraining: true }
  | { call: 'shutdown' }
  | { call: 'exit'; code: 0; forced: boolean; reason: string | null }

export type QuitState =
  | { phase: 'idle' }
  | { phase: 'draining'; attemptId: string }
  | { phase: 'closing'; forced: boolean; forcedReason: string | null }
  | { phase: 'quit' }

export const DEFAULT_DRAIN_TIMEOUT_MS = 15_000

export interface QuitTransition {
  state: QuitState
  actions: QuitAction[]
}

export function nextQuitState(state: QuitState, event: QuitEvent, serverRunning: boolean): QuitTransition {
  // 已退出：任何事件全吸收（迟到结果/重复请求不再产生动作）
  if (state.phase === 'quit') return { state, actions: [] }

  if (event.type === 'request-quit') {
    // 单飞：draining/closing 中重复退出请求全部吸收
    if (state.phase !== 'idle') return { state, actions: [] }
    if (!serverRunning) {
      return { state: { phase: 'quit' }, actions: [{ call: 'exit', code: 0, forced: false, reason: null }] }
    }
    return {
      state: { phase: 'draining', attemptId: event.attemptId },
      // in-app 退出口径：未完成训练保留于 SQLite（与页面「保存并退出」同一语义）
      actions: [{ call: 'prepare', attemptId: event.attemptId, allowActiveTraining: true }],
    }
  }

  if (event.type === 'outer-timeout') {
    // 整体退出流程超时（draining 或 closing 阶段）→ 强制退出并如实记录
    return {
      state: { phase: 'quit' },
      actions: [{ call: 'exit', code: 0, forced: true, reason: `outer-timeout: graceful quit exceeded the drain budget` }],
    }
  }

  if (state.phase === 'draining') {
    if (event.type === 'drain-outcome') {
      if (event.kind === 'outer-timeout') {
        return {
          state: { phase: 'quit' },
          actions: [{ call: 'exit', code: 0, forced: true, reason: 'outer-timeout: graceful quit exceeded the drain budget' }],
        }
      }
      const forced = event.kind === 'drain-timeout'
      const forcedReason = forced ? `drain-timeout: in-flight work did not drain within the controller budget` : null
      // prepared→正常关闭；drain-timeout→仍尝试关闭但标记强制（外层兜底 app.exit）；
      // busy/cancelled/expired/active-training 等陈旧结果→关闭幂等，照常收敛
      return {
        state: { phase: 'closing', forced, forcedReason },
        actions: [{ call: 'shutdown' }],
      }
    }
    // draining 阶段收到 shutdown 事件＝时序错乱：吸收不动作（宿主还没发 shutdown）
    return { state, actions: [] }
  }

  if (state.phase === 'closing') {
    if (event.type === 'drain-outcome') {
      // 关闭中迟到的排空结果：shutdown 已发出，不再重复
      return { state, actions: [] }
    }
    if (event.type === 'shutdown-done') {
      return {
        state: { phase: 'quit' },
        actions: [{ call: 'exit', code: 0, forced: state.forced, reason: state.forcedReason }],
      }
    }
    if (event.type === 'shutdown-error') {
      return {
        state: { phase: 'quit' },
        actions: [{ call: 'exit', code: 0, forced: true, reason: `shutdown-error: ${event.message}` }],
      }
    }
    if (event.type === 'shutdown-timeout') {
      return {
        state: { phase: 'quit' },
        actions: [{ call: 'exit', code: 0, forced: true, reason: 'shutdown-timeout: server close did not finish in time' }],
      }
    }
  }

  // idle 阶段收到 drain/shutdown 事件（未发起过退出）：吸收不动作
  return { state, actions: [] }
}

/** TRAINER_DESKTOP_DRAIN_TIMEOUT_MS 解析：unset→默认 15000；给值必须为正整数毫秒，非法报错不猜 */
export function resolveDrainTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.TRAINER_DESKTOP_DRAIN_TIMEOUT_MS?.trim()
  if (!raw) return DEFAULT_DRAIN_TIMEOUT_MS
  if (!/^\d+$/.test(raw)) {
    throw new Error(`TRAINER_DESKTOP_DRAIN_TIMEOUT_MS must be a positive integer of milliseconds, got: ${raw}`)
  }
  const value = Number(raw)
  if (value <= 0) {
    throw new Error(`TRAINER_DESKTOP_DRAIN_TIMEOUT_MS must be a positive integer of milliseconds, got: ${raw}`)
  }
  return value
}
