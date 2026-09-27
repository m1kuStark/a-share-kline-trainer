// 受控重启安全计划（SETUP-RESTART-PLAN-01，v3 之后由 GPT Direct 收尾）：
// 显式状态机步进纯函数——输入上一轮持久化状态与本轮观测，返回下一状态与本轮唯一允许动作。
// 执行者在执行动作前持久化 nextState；本模块不提供崩溃后的 OS exactly-once。
// 终态在同一次 attempt 内稳定（迟到观测不回退不重发）；动作首次派发与进行中分离
// （claimed 记录已派发，pending 只等待不重复副作用）；新 PID 在 spawn 成功回执前未分配，
// 由回执绑定，健康观测必须匹配该绑定，迟到回执不得覆盖；等待阶段全部由显式有限
// nowMs/timeout 驱动，非法时间输入一律保守阻断/超期，不可能延长等待或获得 ready。
// 除 ready 外 retainOldState=true。纯函数：不读时钟/环境/文件/进程/网络。
// 遵守 glm-failure-patterns FM-001/004/005/006/007/008（含 v2 追记）。

export interface RunIdentity {
  runId: string
  pid: number
  port: number
  databasePath: string
  origin: string
  dataDir: string
}

export type SourceInheritance = 'explicit-env' | 'recalculate'

export interface PlannedRuntime {
  dataDir: string
  databasePath: string
  port: number
  origin: string
  tdxRoot: string | null
  /** 新运行 tdxRoot 来源：explicit-env 可继承；recalculate 指重新解析 */
  source: SourceInheritance
}

// ---------- 本轮观测（四态显式，pending≠失败，unknown≠成功） ----------

export type SaveObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'success' }
  | { readonly kind: 'failure'; readonly detail: string }
  | { readonly kind: 'unknown'; readonly detail: string }

export type DrainObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'success' }
  | { readonly kind: 'failure'; readonly detail: string }
  | { readonly kind: 'unknown'; readonly detail: string }

export type ExitObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'unknown'; readonly detail: string }
  | { readonly kind: 'alive' }
  | { readonly kind: 'exited' }

/** spawn 回执：success 必须绑定本次目标 runId 和真实正整数 PID */
export type SpawnObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'success'; readonly runId: string; readonly pid: number }
  | { readonly kind: 'failure'; readonly detail: string }
  | { readonly kind: 'unknown'; readonly detail: string }

export type HealthObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'unknown'; readonly detail: string }
  | { readonly kind: 'success'; readonly runId: string; readonly pid: number }

export type RestoreObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'success' }
  | { readonly kind: 'failure'; readonly detail: string }
  | { readonly kind: 'unknown'; readonly detail: string }

/** 各等待阶段的有限正时限；任何非法值一律保守超期/阻断，不延长等待 */
export interface StageTimeouts {
  readonly saveMs: number
  readonly drainMs: number
  readonly sigtermMs: number
  readonly spawnMs: number
  readonly healthMs: number
  readonly restoreMs: number
}

export interface RestartObservations {
  /** 本轮时刻（有限毫秒）；由执行方显式传入，本模块不读时钟 */
  readonly nowMs: number
  /** 活动训练：仅 null 放行 */
  readonly activeTrainingId: number | null
  /** 委托方记录的旧服务身份（preflight 校验并作为状态证据，之后不再要求） */
  readonly oldRecorded: RunIdentity
  /** 独立观测的旧服务身份；preflight 缺失/不匹配即阻断 */
  readonly oldObserved: RunIdentity | null
  readonly planned: PlannedRuntime
  /** 新目标身份：spawn 前 PID 未分配，因此目标只含 runId/port/origin */
  readonly target: { readonly runId: string; readonly port: number; readonly origin: string }
  readonly saveNewSource: SaveObservation
  readonly drain: DrainObservation
  readonly oldExit: ExitObservation
  readonly spawn: SpawnObservation
  readonly health: HealthObservation
  readonly restore: RestoreObservation
  readonly timeouts: StageTimeouts
}

// ---------- 跨轮持久化状态（执行者保存并回传） ----------

export type RestartStage =
  | 'preflight'
  | 'saving'
  | 'draining'
  | 'exiting'
  | 'starting'
  | 'checking-health'
  | 'restoring'
  // 稳定终态（同一次 attempt 内迟到观测不可回退）
  | 'blocked-active-training'
  | 'blocked-identity'
  | 'blocked-runtime-mismatch'
  | 'blocked-save-failed'
  | 'drain-timeout'
  | 'old-exit-unconfirmed'
  | 'rolled-back'
  | 'ready'
  | 'restore-failed'

/** preflight 校验后复制的本次计划，执行者必须与 nextState 一起保存。 */
export interface RestartContext {
  readonly oldRecorded: Readonly<RunIdentity>
  readonly oldObserved: Readonly<RunIdentity>
  readonly planned: Readonly<PlannedRuntime>
  readonly target: RestartObservations['target']
  readonly timeouts: StageTimeouts
}

export interface ClaimedActions {
  readonly save: boolean
  readonly sigterm: boolean
  readonly sigkill: boolean
  readonly start: boolean
  readonly restore: boolean
}

export interface RestartAttemptState {
  readonly context: RestartContext | null
  readonly lastObservedAtMs: number | null
  readonly stage: RestartStage
  /** 已认领副作用动作：执行前持久化；true 防止重派，不证明 OS 操作已完成。 */
  readonly claimed: ClaimedActions
  /** spawn 成功回执绑定的 PID；未回执=null（不预填假 PID，迟到回执不覆盖） */
  readonly boundNewPid: number | null
  /** 进入当前非终端阶段的时刻 ms（有限）；终态阶段为 null */
  readonly stageStartedAtMs: number | null
  /** 进入终态时的具体原因（终态输出稳定所需） */
  readonly terminalReason: string | null
}

export function initialRestartState(): RestartAttemptState {
  return {
    context: null,
    lastObservedAtMs: null,
    stage: 'preflight',
    claimed: { save: false, sigterm: false, sigkill: false, start: false, restore: false },
    boundNewPid: null,
    stageStartedAtMs: null,
    terminalReason: null,
  }
}

// ---------- 输出 ----------

export type RestartPhase =
  | 'blocked-active-training'
  | 'blocked-identity'
  | 'blocked-runtime-mismatch'
  | 'blocked-save-failed'
  | 'preflight'
  | 'draining'
  | 'drain-timeout'
  | 'send-sigterm'
  | 'sigterm-wait'
  | 'sigterm-deadline'
  | 'old-exit-unconfirmed'
  | 'new-start'
  | 'new-start-failed'
  | 'rolled-back'
  | 'ready'

export type RestartAction =
  | 'abort'
  | 'save-new-source'
  | 'wait-save'
  | 'wait-drain'
  | 'send-sigterm'
  | 'await-old-exit'
  | 'send-sigkill-once'
  | 'start-new-server'
  | 'await-spawn-receipt'
  | 'await-health'
  | 'restore-old-config'
  | 'await-restore'
  | 'keep-old-state'
  | 'new-source-effective'

export interface RestartStepResult {
  /** 执行者在执行本轮动作前必须持久化的下一状态 */
  readonly nextState: RestartAttemptState
  readonly phase: RestartPhase
  readonly action: RestartAction
  readonly reason: string
  readonly retainOldState: boolean
  readonly tdxInheritance: SourceInheritance
}

// ---------- 内部助手 ----------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isValidTcpPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 65535
}

function isFiniteMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveFiniteMs(value: unknown): value is number {
  return isFiniteMs(value) && value > 0
}

function originFor(port: number): string {
  return `http://127.0.0.1:${port}`
}

function identityShapeReason(id: RunIdentity, label: string, requireDataDir: boolean): string | null {
  if (!isNonEmptyString(id.runId)) return `${label} runId 非空字符串`
  if (!isPositiveSafeInt(id.pid)) return `${label} pid 不是正安全整数`
  if (!isValidTcpPort(id.port)) return `${label} port 不是合法 TCP 端口`
  if (!isNonEmptyString(id.databasePath)) return `${label} databasePath 非空字符串`
  if (id.origin !== originFor(id.port)) return `${label} origin 与端口不一致`
  if (requireDataDir && !isNonEmptyString(id.dataDir)) return `${label} dataDir 非空字符串`
  return null
}

function recordedVsObservedMismatch(recorded: RunIdentity, observed: RunIdentity): string | null {
  if (observed.runId !== recorded.runId) return '观测 runId 与记录不一致'
  if (observed.pid !== recorded.pid) return '观测 pid 与记录不一致'
  if (observed.port !== recorded.port) return '观测 port 与记录不一致'
  if (observed.databasePath !== recorded.databasePath) return '观测 databasePath 与记录不一致'
  if (observed.origin !== recorded.origin) return '观测 origin 与记录不一致'
  return null
}

function plannedBoundaryReason(recorded: RunIdentity, planned: PlannedRuntime): string | null {
  if (planned.dataDir !== recorded.dataDir) return 'planned dataDir 与旧运行不一致'
  if (planned.databasePath !== recorded.databasePath) return 'planned databasePath 与旧运行不一致'
  if (planned.port !== recorded.port) return 'planned port 与旧运行不一致'
  if (planned.origin !== recorded.origin) return 'planned origin 与旧运行不一致'
  return null
}

type TerminalRestartStage = Extract<
  RestartStage,
  | 'blocked-active-training'
  | 'blocked-identity'
  | 'blocked-runtime-mismatch'
  | 'blocked-save-failed'
  | 'drain-timeout'
  | 'old-exit-unconfirmed'
  | 'rolled-back'
  | 'ready'
  | 'restore-failed'
>

const TERMINAL_STAGES: readonly TerminalRestartStage[] = [
  'restore-failed',
  'blocked-active-training',
  'blocked-identity',
  'blocked-runtime-mismatch',
  'blocked-save-failed',
  'drain-timeout',
  'old-exit-unconfirmed',
  'rolled-back',
  'ready',
]

function isTerminalStage(stage: RestartStage): stage is TerminalRestartStage {
  return (TERMINAL_STAGES as readonly string[]).includes(stage)
}

function terminalAction(stage: TerminalRestartStage): RestartAction {
  if (stage === 'ready') return 'new-source-effective'
  if (stage.startsWith('blocked-')) return 'abort'
  return 'keep-old-state'
}

/**
 * 恰好在 deadline 时视为超期（nowMs >= startedAtMs + timeoutMs）。
 * 任何非法时间输入（NaN/Infinity/负值/非数字）一律按已超期处理：等待只能有限，
 * 非法时间绝不可能延长等待。
 */
function deadlinePassed(startedAtMs: number | null, timeoutMs: number, nowMs: number): boolean {
  if (!isFiniteMs(startedAtMs) || !isPositiveFiniteMs(timeoutMs) || !isFiniteMs(nowMs)) return true
  const deadline = startedAtMs + timeoutMs
  return !Number.isFinite(deadline) || deadline <= startedAtMs || nowMs >= deadline
}

function sameFields<T extends object>(left: T, right: T): boolean {
  return (Object.keys(left) as (keyof T)[]).every(key => left[key] === right[key])
}

// ---------- 主步进函数 ----------

export function planRestartStep(
  state: RestartAttemptState,
  obs: RestartObservations,
): RestartStepResult {
  const inherit: SourceInheritance =
    (state.context?.planned.source ?? obs.planned.source) === 'explicit-env' ? 'explicit-env' : 'recalculate'
  const out = (
    nextState: RestartAttemptState,
    phase: RestartPhase,
    action: RestartAction,
    reason: string,
  ): RestartStepResult => ({
    nextState,
    phase,
    action,
    reason,
    retainOldState: phase !== 'ready',
    tdxInheritance: inherit,
  })
  const enter = (base: RestartAttemptState, stage: RestartStage): RestartAttemptState => ({
    ...base,
    stage,
    stageStartedAtMs: obs.nowMs,
  })
  const terminalOf = (base: RestartAttemptState, stage: RestartStage, reason: string): RestartAttemptState => ({
    ...base,
    stage,
    stageStartedAtMs: null,
    terminalReason: reason,
  })

  // 0) 终态稳定：迟到观测不能回退、不能重发任何动作
  if (isTerminalStage(state.stage)) {
    const reason = state.terminalReason ?? `已到达终态 ${state.stage}`
    return out(state, state.stage === 'restore-failed' ? 'new-start-failed' : state.stage,
      terminalAction(state.stage), reason)
  }

  // 时间输入非法：保守阻断（终态检查之后，稳定终态优先）
  const timeoutsValid = ['saveMs', 'drainMs', 'sigtermMs', 'spawnMs', 'healthMs', 'restoreMs']
    .every(key => {
      const duration = obs.timeouts[key as keyof StageTimeouts]
      return isPositiveFiniteMs(duration) && Number.isFinite(obs.nowMs + duration)
        && obs.nowMs + duration > obs.nowMs
    })
  if (!isFiniteMs(obs.nowMs) || !timeoutsValid
    || (state.lastObservedAtMs !== null && obs.nowMs < state.lastObservedAtMs)) {
    const reason = '时间输入非法（nowMs 必须有限，timeout 必须为正有限数）；保守阻断'
    return out(terminalOf(state, 'blocked-runtime-mismatch', reason),
      'blocked-runtime-mismatch', 'abort', reason)
  }

  if (state.context !== null && (
    !sameFields(state.context.oldRecorded, obs.oldRecorded)
    || !sameFields(state.context.planned, obs.planned)
    || !sameFields(state.context.target, obs.target)
    || !sameFields(state.context.timeouts, obs.timeouts)
  )) {
    const reason = '本次 attempt 已冻结的身份、运行边界、来源或期限发生变化；保留旧状态'
    return out(terminalOf(state, 'blocked-runtime-mismatch', reason), 'blocked-runtime-mismatch', 'abort', reason)
  }
  state = { ...state, lastObservedAtMs: obs.nowMs }

  // 1) preflight：活动训练 → 身份双轨 → 运行边界 → 目标（无 PID）→ 保存
  if (state.stage === 'preflight') {
    if (obs.activeTrainingId !== null) {
      const reason = `活动训练 ${obs.activeTrainingId} 进行中；受控重启被阻断`
      return out(terminalOf(state, 'blocked-active-training', reason),
        'blocked-active-training', 'abort', reason)
    }
    const recordedShape = identityShapeReason(obs.oldRecorded, '旧运行记录', true)
    if (recordedShape !== null) {
      return out(terminalOf(state, 'blocked-identity', recordedShape),
        'blocked-identity', 'abort', recordedShape)
    }
    if (obs.oldObserved === null) {
      const reason = '旧服务身份无独立观测值（缺失按 unknown 处理）；不用记录自洽代替归属确认'
      return out(terminalOf(state, 'blocked-identity', reason),
        'blocked-identity', 'abort', reason)
    }
    const observedShape = identityShapeReason(obs.oldObserved, '旧运行观测', false)
    if (observedShape !== null) {
      return out(terminalOf(state, 'blocked-identity', observedShape),
        'blocked-identity', 'abort', observedShape)
    }
    const mismatch = recordedVsObservedMismatch(obs.oldRecorded, obs.oldObserved)
    if (mismatch !== null) {
      const reason = `${mismatch}；阻断`
      return out(terminalOf(state, 'blocked-identity', reason),
        'blocked-identity', 'abort', reason)
    }
    const boundary = plannedBoundaryReason(obs.oldRecorded, obs.planned)
    if (boundary !== null) {
      return out(terminalOf(state, 'blocked-runtime-mismatch', boundary),
        'blocked-runtime-mismatch', 'abort', boundary)
    }
    if (obs.target.port !== obs.planned.port) {
      const reason = '新目标 port 与 planned 不一致（目标漂移）'
      return out(terminalOf(state, 'blocked-runtime-mismatch', reason),
        'blocked-runtime-mismatch', 'abort', reason)
    }
    if (obs.target.origin !== obs.planned.origin) {
      const reason = '新目标 origin 与 planned 不一致（目标漂移）'
      return out(terminalOf(state, 'blocked-runtime-mismatch', reason),
        'blocked-runtime-mismatch', 'abort', reason)
    }
    if (!isNonEmptyString(obs.target.runId)) {
      const reason = '新目标 runId 非空字符串'
      return out(terminalOf(state, 'blocked-identity', reason),
        'blocked-identity', 'abort', reason)
    }
    if (obs.target.runId === obs.oldRecorded.runId) {
      const reason = '新目标 runId 必须不同于旧 runId'
      return out(terminalOf(state, 'blocked-identity', reason),
        'blocked-identity', 'abort', reason)
    }
    state = { ...state, context: Object.freeze({
      oldRecorded: Object.freeze({ ...obs.oldRecorded }),
      oldObserved: Object.freeze({ ...obs.oldObserved }),
      planned: Object.freeze({ ...obs.planned }),
      target: Object.freeze({ ...obs.target }),
      timeouts: Object.freeze({ ...obs.timeouts }),
    }) }
    return savingEval(enter(state, 'saving'))
  }

  if (state.stage === 'saving') return savingEval(state)

  // 2) draining：观测超时/时限超期 → drain-timeout；成功 → exiting
  if (state.stage === 'draining') return drainingEval(state)

  // 3) exiting：unknown 优先于一切信号建议；SIGTERM/SIGKILL 各一次；SIGKILL 后非 exited 即终态
  if (state.stage === 'exiting') return exitingEval(state)

  // 4) starting：spawn 回执绑定 PID → 健康匹配绑定 → ready；一切失败进恢复流程
  if (state.stage === 'starting') return startingEval(state)
  if (state.stage === 'checking-health') return healthEval(state)

  // 5) restoring：只有 restore success 观测才 rolled-back；超期/失败保持 new-start-failed
  if (state.stage === 'restoring') return restoringEval(state)

  // 不可达（RestartStage 已穷举）；保守按 identity 阻断
  const unreachable = `未知阶段 ${String((state as { stage?: unknown }).stage)}；保守阻断`
  return out(terminalOf(state, 'blocked-identity', unreachable), 'blocked-identity', 'abort', unreachable)

  // ---- 阶段求值（函数声明提升，可在上方调用） ----

  function savingEval(current: RestartAttemptState): RestartStepResult {
    if (deadlinePassed(current.stageStartedAtMs, obs.timeouts.saveMs, obs.nowMs)
      || (obs.saveNewSource.kind !== 'success' && obs.saveNewSource.kind !== 'pending')) {
      const reason = '保存新来源失败、未知或已超期；保留旧配置，不重复保存'
      return out(terminalOf(current, 'blocked-save-failed', reason), 'blocked-save-failed', 'abort', reason)
    }
    if (obs.saveNewSource.kind === 'success') {
      if (!current.claimed.save) {
        const reason = '未认领本次保存却收到成功结果；不停止旧服务'
        return out(terminalOf(current, 'blocked-save-failed', reason), 'blocked-save-failed', 'abort', reason)
      }
      return drainingEval(enter(current, 'draining'))
    }
    if (!current.claimed.save) {
      return out({ ...current, claimed: { ...current.claimed, save: true } },
        'preflight', 'save-new-source', '首次允许保存；执行前持久化下一状态')
    }
    return out(current, 'preflight', 'wait-save', '保存已认领，限时等待结果，不重复保存')
  }

  function drainingEval(current: RestartAttemptState): RestartStepResult {
    if (obs.drain.kind !== 'success' && obs.drain.kind !== 'pending') {
      const reason = 'drain 失败、未知或超时：放弃本轮重启，保留旧状态'
      return out(terminalOf(current, 'drain-timeout', reason), 'drain-timeout', 'keep-old-state', reason)
    }
    if (deadlinePassed(current.stageStartedAtMs, obs.timeouts.drainMs, obs.nowMs)) {
      const reason = 'drain 超过有限时限仍未确认完成：放弃本轮重启，保留旧状态'
      return out(terminalOf(current, 'drain-timeout', reason), 'drain-timeout', 'keep-old-state', reason)
    }
    if (obs.drain.kind === 'pending') {
      return out(current, 'draining', 'wait-drain', 'drain 尚未确认完成：继续等待在途请求排空')
    }
    return exitingEval(enter(current, 'exiting'))
  }

  function exitingEval(current: RestartAttemptState): RestartStepResult {
    // unknown 先于所有信号建议：保守不推定副作用
    if (obs.oldExit.kind === 'unknown') {
      const reason = `退出探测无结论（${obs.oldExit.detail}）：不发信号、不启动新服务，保留旧状态`
      return out(terminalOf(current, 'old-exit-unconfirmed', reason),
        'old-exit-unconfirmed', 'keep-old-state', reason)
    }
    if (!current.claimed.sigterm
      && deadlinePassed(current.stageStartedAtMs, obs.timeouts.sigtermMs, obs.nowMs)) {
      const reason = '首次退出探测期限已到；迟到观测不得重置期限或触发信号'
      return out(terminalOf(current, 'old-exit-unconfirmed', reason), 'old-exit-unconfirmed', 'keep-old-state', reason)
    }
    // SIGKILL 已派发后旧服务未明确 exited：不循环杀进程，直接终态（不被 pending/deadline 分支遮蔽）
    if (current.claimed.sigkill && obs.oldExit.kind !== 'exited') {
      const reason = 'SIGKILL fallback 已派发且旧服务未确认退出：不循环杀进程，保留旧状态'
      return out(terminalOf(current, 'old-exit-unconfirmed', reason),
        'old-exit-unconfirmed', 'keep-old-state', reason)
    }
    if (obs.oldExit.kind === 'exited') {
      return startingEval(enter(current, 'starting'))
    }
    if (obs.oldExit.kind === 'alive') {
      if (!current.claimed.sigterm) {
        return out(
          { ...current, claimed: { ...current.claimed, sigterm: true }, stageStartedAtMs: obs.nowMs },
          'send-sigterm', 'send-sigterm',
          '旧服务确认仍在且 drain 已完成：本轮允许发送 SIGTERM（仅首次建议；执行前请持久化下一状态）')
      }
      if (!deadlinePassed(current.stageStartedAtMs, obs.timeouts.sigtermMs, obs.nowMs)) {
        return out(current, 'sigterm-wait', 'await-old-exit', 'SIGTERM 已派发且限时未到：等待旧服务退出探测')
      }
      return out(
        { ...current, claimed: { ...current.claimed, sigkill: true } },
        'sigterm-deadline', 'send-sigkill-once',
        'SIGTERM 限时已到且旧服务确认仍在：本轮允许执行一次 SIGKILL fallback（仅建议；未执行）')
    }
    // oldExit pending：未确认 alive 不得发信号；限时内等待，超期保守终态
    if (!current.claimed.sigterm) {
      return out(current, 'sigterm-wait', 'await-old-exit',
        '旧服务退出探测尚未返回且未确认存活：继续等待（不发信号）')
    }
    if (!deadlinePassed(current.stageStartedAtMs, obs.timeouts.sigtermMs, obs.nowMs)) {
      return out(current, 'sigterm-wait', 'await-old-exit', 'SIGTERM 已派发且退出探测尚未返回：限时内继续等待')
    }
    const reason = 'SIGTERM 限时已到而退出探测仍无结论：保守终止，保留旧状态'
    return out(terminalOf(current, 'old-exit-unconfirmed', reason),
      'old-exit-unconfirmed', 'keep-old-state', reason)
  }

  function startingEval(current: RestartAttemptState): RestartStepResult {
    const fail = (why: string): RestartStepResult => failingEval(current, why)
    if (!current.claimed.start) {
      if (obs.spawn.kind !== 'pending') return fail('未请求启动便收到回执或未知结果，不能绑定进程')
      return out(
        { ...current, claimed: { ...current.claimed, start: true }, stageStartedAtMs: obs.nowMs },
        'new-start', 'start-new-server',
        '旧服务已确认退出：本轮允许启动新服务（仅首次建议；执行前请持久化下一状态）')
    }
    if (deadlinePassed(current.stageStartedAtMs, obs.timeouts.spawnMs, obs.nowMs)) {
      return fail('spawn 限时已到；迟到回执不能越过期限')
    }
    if (obs.spawn.kind !== 'success' && obs.spawn.kind !== 'pending') return fail('spawn 失败或结果未知')
    if (obs.spawn.kind === 'pending') {
      return out(current, 'new-start', 'await-spawn-receipt', '启动已派发且回执未到：等待 spawn 回执，不重复启动')
    }
    if (!isPositiveSafeInt(obs.spawn.pid)) return fail('spawn 回执 PID 非法（必须为正安全整数）')
    if (obs.spawn.runId !== current.context?.target.runId) return fail('spawn 回执不属于本次目标 runId')
    // 绑定 PID：迟到回执不得覆盖既有绑定
    return healthEval(enter({ ...current, boundNewPid: obs.spawn.pid }, 'checking-health'))
  }

  function healthEval(current: RestartAttemptState): RestartStepResult {
    const fail = (why: string): RestartStepResult => failingEval(current, why)
    if (deadlinePassed(current.stageStartedAtMs, obs.timeouts.healthMs, obs.nowMs)) {
      return fail('健康探测限时已到；迟到成功不能越过期限')
    }
    if (obs.health.kind === 'pending') {
      return out(current, 'new-start', 'await-health', '等待健康探测确认：不重复启动、不提前宣称成功')
    }
    if (obs.health.kind === 'unknown') return fail(`健康探测无结论（${obs.health.detail}）`)
    // health success：必须匹配 spawn 回执绑定与目标 runId；不能自证
    if (current.boundNewPid === null) {
      return fail('健康观测到达时尚无 spawn 回执绑定 PID；不能自证身份')
    }
    if (obs.health.runId !== obs.target.runId || obs.health.pid !== current.boundNewPid) {
      return fail(`健康身份与目标/绑定不一致（health=${obs.health.runId}/${obs.health.pid}，bound=${current.boundNewPid}）`)
    }
    const reason = `受控重启完成：新来源已生效，健康身份 ${obs.health.runId}/${obs.health.pid} 与目标及 spawn 回执一致`
    return out(terminalOf(current, 'ready', reason), 'ready', 'new-source-effective', reason)
  }

  function failingEval(current: RestartAttemptState, why: string): RestartStepResult {
    if (!current.claimed.restore) {
      return out(
        enter({ ...current, claimed: { ...current.claimed, restore: true } }, 'restoring'),
        'new-start-failed', 'restore-old-config',
        `${why}；本轮允许恢复旧配置（仅首次建议；恢复确认前不称已回滚）`)
    }
    return out(current, 'new-start-failed', 'keep-old-state', `${why}；恢复已派发，保留失败与旧证据`)
  }

  function restoringEval(current: RestartAttemptState): RestartStepResult {
    if (deadlinePassed(current.stageStartedAtMs, obs.timeouts.restoreMs, obs.nowMs)
      || (obs.restore.kind !== 'success' && obs.restore.kind !== 'pending')) {
      const reason = '恢复旧配置失败、未知或超期；保留失败与旧证据，不重复恢复'
      return out(terminalOf(current, 'restore-failed', reason), 'new-start-failed', 'keep-old-state', reason)
    }
    if (obs.restore.kind === 'success') {
      const reason = '已确认恢复旧配置完成：rolled-back（终态，迟到观测不回退）'
      return out(terminalOf(current, 'rolled-back', reason), 'rolled-back', 'keep-old-state', reason)
    }
    return out(current, 'new-start-failed', 'await-restore', '恢复旧配置已派发且尚未确认：等待恢复结果')
  }
}
