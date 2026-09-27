// 受控重启安全计划（SETUP-RESTART-PLAN-01 冻结合同 v2，control-handoff-20260927-24 限定返修）：
// 纯函数，无副作用——不启动进程、不发信号、不写配置、不碰用户数据库、不读时钟/环境/文件。
// 观测区分 pending/success/failure/unknown（pending≠失败，unknown≠成功）；动作只描述
// 接下来允许做什么，不凭 deadline 或 pending 断言副作用已完成；终态只能由相应确认导出。
// 除 ready 外一律 retainOldState=true（保留旧配置/状态供恢复，不表示旧进程必存活）。
// 遵守 glm-failure-patterns FM-001/004/005/006/007/008。

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
  /** 新运行 tdxRoot 来源：explicit-env 可继承；recalculate 指重新解析（不继承自动发现/ saved-choice） */
  source: SourceInheritance
}

// ---------- 观测四态（每一项相互独立，禁止用单布尔压缩语义） ----------

/** 新来源保存：pending=尚未保存；success=已确认写入；failure=已确认失败 */
export type SaveObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'success' }
  | { readonly kind: 'failure'; readonly detail: string }

/** drain：pending=进行中/未完成；timeout=有限时限内未完成；success=已确认排空 */
export type DrainObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'success' }

/** 旧服务进程退出探测：pending=尚未探测/等待；unknown=探测无结论；alive=确认仍在；exited=确认退出 */
export type ExitObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'unknown'; readonly detail: string }
  | { readonly kind: 'alive' }
  | { readonly kind: 'exited' }

/** 新服务进程启动：pending=尚未启动/等待中；success=进程已起；failure=已确认启动失败 */
export type StartProcessObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'success' }
  | { readonly kind: 'failure'; readonly detail: string }

/** 新服务健康探测：pending=未探测；unknown=探测无结论；success=附探测到的身份 */
export type HealthObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'unknown'; readonly detail: string }
  | { readonly kind: 'success'; readonly runId: string; readonly pid: number }

/** 旧配置恢复：pending=未开始/进行中；success=已确认恢复完成（rolled-back 的唯一凭据） */
export type RestoreObservation =
  | { readonly kind: 'pending' }
  | { readonly kind: 'success' }

/** 本轮要启动的新目标身份（对它做合法性校验 + 与 planned 边界逐字比对） */
export interface NewTargetIdentity {
  readonly runId: string
  readonly pid: number
  readonly port: number
  readonly origin: string
}

export interface RestartPlanInput {
  /** 活动训练：仅 null 放行 */
  readonly activeTrainingId: number | null
  /** 委托方在启动旧服务时记录的身份 */
  readonly oldRecorded: RunIdentity
  /** 独立观测到的旧服务身份；null=观测缺失（按 unknown 阻断，不能用 recorded 自洽代替归属确认） */
  readonly oldObserved: RunIdentity | null
  /** 计划的新来源运行时（dataDir/databasePath/port/origin 必须与旧运行一致） */
  readonly planned: PlannedRuntime
  /** 新来源保存观测 */
  readonly saveNewSource: SaveObservation
  readonly stop: {
    readonly drain: DrainObservation
    /** SIGTERM 是否已实际派发（true 后永不再建议发送） */
    readonly sigtermSent: boolean
    /** SIGTERM 有限正 deadline 是否已到期 */
    readonly sigtermDeadlineExceeded: boolean
    readonly oldExit: ExitObservation
    /** SIGKILL fallback 是否已派发（true 后永不再建议发送，不循环杀进程） */
    readonly sigkillSent: boolean
  }
  readonly start: {
    readonly process: StartProcessObservation
    readonly health: HealthObservation
    readonly target: NewTargetIdentity
  }
  /** 恢复旧配置观测 */
  readonly rollback: { readonly restore: RestoreObservation }
}

export type RestartPhase =
  | 'blocked-active-training'
  | 'blocked-identity'
  | 'blocked-runtime-mismatch'
  | 'blocked-save-failed'
  | 'validate'
  | 'drain'
  | 'drain-timeout'
  | 'send-sigterm'
  | 'sigterm-wait'
  | 'sigterm-deadline'
  | 'old-exit-unconfirmed'
  | 'new-start'
  | 'new-start-failed'
  | 'rolled-back'
  | 'ready'

/** 动作只描述接下来允许做什么；终态只保留 keep-old-state / abort / new-source-effective */
export type RestartAction =
  | 'abort'
  | 'save-new-source'
  | 'wait-drain'
  | 'send-sigterm'
  | 'await-old-exit'
  | 'send-sigkill-once'
  | 'start-new-server'
  | 'await-new-health'
  | 'restore-old-config'
  | 'keep-old-state'
  | 'new-source-effective'

export interface RestartPlanResult {
  readonly phase: RestartPhase
  readonly action: RestartAction
  readonly reason: string
  readonly retainOldState: boolean
  readonly tdxInheritance: SourceInheritance
  /** 到达当前阶段为止的有序阶段列表（不可变） */
  readonly steps: readonly string[]
}

// ---------- 校验助手 ----------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isValidTcpPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 65535
}

function originFor(port: number): string {
  return `http://127.0.0.1:${port}`
}

/** 身份字段合法性（不用字段自洽代替归属确认，归属由独立观测比对保证） */
function identityShapeReason(id: RunIdentity, label: string, requireDataDir: boolean): string | null {
  if (!isNonEmptyString(id.runId)) return `${label} runId 非空字符串`
  if (!isPositiveSafeInt(id.pid)) return `${label} pid 不是正安全整数`
  if (!isValidTcpPort(id.port)) return `${label} port 不是合法 TCP 端口`
  if (!isNonEmptyString(id.databasePath)) return `${label} databasePath 非空字符串`
  if (id.origin !== originFor(id.port)) return `${label} origin 与端口不一致`
  if (requireDataDir && !isNonEmptyString(id.dataDir)) return `${label} dataDir 非空字符串`
  return null
}

function recordedVsObservedMismatch(
  recorded: RunIdentity,
  observed: RunIdentity,
): string | null {
  if (observed.runId !== recorded.runId) return '观测 runId 与记录不一致'
  if (observed.pid !== recorded.pid) return '观测 pid 与记录不一致'
  if (observed.port !== recorded.port) return '观测 port 与记录不一致'
  if (observed.databasePath !== recorded.databasePath) return '观测 databasePath 与记录不一致'
  if (observed.origin !== recorded.origin) return '观测 origin 与记录不一致'
  return null
}

/** 稳定运行边界：planned 与旧运行 dataDir/databasePath/port/origin 逐字一致 */
function plannedBoundaryReason(recorded: RunIdentity, planned: PlannedRuntime): string | null {
  if (planned.dataDir !== recorded.dataDir) return 'planned dataDir 与旧运行不一致'
  if (planned.databasePath !== recorded.databasePath) return 'planned databasePath 与旧运行不一致'
  if (planned.port !== recorded.port) return 'planned port 与旧运行不一致'
  if (planned.origin !== recorded.origin) return 'planned origin 与旧运行不一致'
  return null
}

/** 新目标：端口/origin 漂移=运行边界破坏；身份非法或与旧 runId 相同=身份阻断 */
function targetBoundaryReason(target: NewTargetIdentity, planned: PlannedRuntime): string | null {
  if (target.port !== planned.port) return '新目标 port 与 planned 不一致（目标漂移）'
  if (target.origin !== planned.origin) return '新目标 origin 与 planned 不一致（目标漂移）'
  return null
}

function newTargetIdentityReason(target: NewTargetIdentity, oldRunId: string): string | null {
  if (!isNonEmptyString(target.runId)) return '新目标 runId 非空字符串'
  if (!isPositiveSafeInt(target.pid)) return '新目标 pid 不是正安全整数'
  if (!isValidTcpPort(target.port)) return '新目标 port 不是合法 TCP 端口'
  if (target.origin !== originFor(target.port)) return '新目标 origin 与端口不一致'
  if (target.runId === oldRunId) return '新目标 runId 必须不同于旧 runId'
  return null
}

// ---------- 主计划 ----------

interface Outcome {
  phase: RestartPhase
  action: RestartAction
  reason: string
  steps: string[]
}

const RETAIN = true
const RELEASE = false

function block(phase: RestartPhase, action: RestartAction, reason: string): Outcome {
  return { phase, action, reason, steps: [phase] }
}

/**
 * 产出受控重启的下一步计划。失败与未知测量一律保留旧状态，不产生切换成功；
 * 终态稳定：destructive 动作（SIGTERM/SIGKILL）只在对应前置观测成立时建议一次。
 */
export function planControlledRestart(input: RestartPlanInput): RestartPlanResult {
  const inherit: SourceInheritance =
    input.planned.source === 'explicit-env' ? 'explicit-env' : 'recalculate'
  const done = (o: Outcome): RestartPlanResult => ({
    phase: o.phase,
    action: o.action,
    reason: o.reason,
    retainOldState: o.phase !== 'ready',
    tdxInheritance: inherit,
    steps: Object.freeze([...o.steps]),
  })

  // 1) 活动训练守卫：仅明确 null 放行
  if (input.activeTrainingId !== null) {
    return done(block('blocked-active-training', 'abort',
      `活动训练 ${input.activeTrainingId} 进行中；受控重启被阻断，未停止旧服务、未保存新来源`))
  }

  // 2) 身份守卫：记录身份合法 + 独立观测存在且与记录逐字一致
  const recordedShape = identityShapeReason(input.oldRecorded, '旧运行记录', true)
  if (recordedShape !== null) {
    return done(block('blocked-identity', 'abort', recordedShape))
  }
  if (input.oldObserved === null) {
    return done(block('blocked-identity', 'abort',
      '旧服务身份无独立观测值（观测缺失按 unknown 处理）；阻断，不用记录自洽代替归属确认'))
  }
  const observedShape = identityShapeReason(input.oldObserved, '旧运行观测', false)
  if (observedShape !== null) {
    return done(block('blocked-identity', 'abort', observedShape))
  }
  const mismatch = recordedVsObservedMismatch(input.oldRecorded, input.oldObserved)
  if (mismatch !== null) {
    return done(block('blocked-identity', 'abort', `${mismatch}；阻断`))
  }

  // 3) 稳定运行边界：planned 与新目标都不许漂移
  const boundary = plannedBoundaryReason(input.oldRecorded, input.planned)
  if (boundary !== null) {
    return done(block('blocked-runtime-mismatch', 'abort', boundary))
  }
  const targetBoundary = targetBoundaryReason(input.start.target, input.planned)
  if (targetBoundary !== null) {
    return done(block('blocked-runtime-mismatch', 'abort', targetBoundary))
  }
  const targetIdentity = newTargetIdentityReason(input.start.target, input.oldRecorded.runId)
  if (targetIdentity !== null) {
    return done(block('blocked-identity', 'abort', targetIdentity))
  }

  // 4) 保存新来源：pending≠失败，继续等；failure 保留旧配置阻断
  if (input.saveNewSource.kind === 'pending') {
    return done(block('validate', 'save-new-source', '新来源尚未保存：先完成保存再进入停止阶段'))
  }
  if (input.saveNewSource.kind === 'failure') {
    return done(block('blocked-save-failed', 'abort',
      `保存新来源失败（${input.saveNewSource.detail}）；保留旧配置与旧状态，未停止旧服务`))
  }

  const steps: string[] = []
  const stop = input.stop

  // 5) drain：pending 继续等；有限时限内未完成 → drain-timeout 终态
  if (stop.drain.kind === 'pending') {
    steps.push('drain')
    return done({ phase: 'drain', action: 'wait-drain',
      reason: 'drain 未确认完成：等待在途请求排空', steps })
  }
  if (stop.drain.kind === 'timeout') {
    return done(block('drain-timeout', 'keep-old-state',
      'drain 超过有限时限仍未完成：放弃本轮重启，保留旧状态'))
  }
  steps.push('drain')

  // 6) 旧服务已确认退出 → 直接进入启动；否则先保证 SIGTERM 恰好派发一次
  if (stop.oldExit.kind !== 'exited') {
    if (!stop.sigtermSent) {
      return done({ phase: 'send-sigterm', action: 'send-sigterm',
        reason: 'drain 已确认完成：允许发送 SIGTERM（仅建议，未执行）', steps })
    }
    if (!stop.sigtermDeadlineExceeded) {
      steps.push('sigterm-wait')
      return done({ phase: 'sigterm-wait', action: 'await-old-exit',
        reason: 'SIGTERM 已派发且 deadline 未到：等待旧服务退出探测', steps })
    }
    if (stop.oldExit.kind === 'pending') {
      steps.push('sigterm-wait')
      return done({ phase: 'sigterm-wait', action: 'await-old-exit',
        reason: 'SIGTERM deadline 已到但退出探测尚未返回：继续等待探测结果', steps })
    }
    if (stop.oldExit.kind === 'unknown') {
      return done(block('old-exit-unconfirmed', 'keep-old-state',
        '退出探测无结论：保留旧状态，不进入新服务启动，不重复发信号'))
    }
    // alive：SIGTERM 超期且旧服务确认仍在——仅此时允许一次 SIGKILL fallback
    if (!stop.sigkillSent) {
      steps.push('sigterm-deadline')
      return done({ phase: 'sigterm-deadline', action: 'send-sigkill-once',
        reason: 'SIGTERM 限时已到且旧服务确认仍在：允许执行一次 SIGKILL fallback（仅建议，未执行）', steps })
    }
    return done(block('old-exit-unconfirmed', 'keep-old-state',
      'SIGKILL fallback 已派发后旧服务仍未确认退出：不循环杀进程，保留旧状态'))
  }
  steps.push('old-exit-confirmation')

  // 7) 新服务启动与健康身份（只有旧服务确认退出后才到达这里）
  const start = input.start
  if (start.process.kind === 'pending') {
    steps.push('new-start')
    return done({ phase: 'new-start', action: 'start-new-server',
      reason: '旧服务已确认退出：允许启动新服务（尚未启动，不推断失败或回滚）', steps })
  }
  if (start.process.kind === 'success') {
    if (start.health.kind === 'pending') {
      steps.push('new-start')
      return done({ phase: 'new-start', action: 'await-new-health',
        reason: '新服务进程已起但健康探测未返回：等待健康身份确认', steps })
    }
    if (start.health.kind === 'success') {
      const h = start.health
      const legal = isNonEmptyString(h.runId) && isPositiveSafeInt(h.pid)
      const match = legal && h.runId === start.target.runId && h.pid === start.target.pid
      if (match) {
        steps.push('new-start', 'new-start-health', 'ready')
        return done({ phase: 'ready', action: 'new-source-effective',
          reason: '受控重启完成：新来源已生效，健康身份与目标 run 逐字一致', steps })
      }
    }
  }

  // 8) 启动失败/健康不匹配或无结论：先给恢复建议；仅 restore 确认成功后才可自称 rolled-back
  steps.push('new-start', 'new-start-failed')
  if (input.rollback.restore.kind === 'success') {
    return done({ phase: 'rolled-back', action: 'keep-old-state',
      reason: '新服务未能健康接管，且已确认恢复旧配置完成：等待人工处置', steps })
  }
  return done({ phase: 'new-start-failed', action: 'restore-old-config',
    reason: '新服务启动失败或健康身份与目标不一致：建议恢复旧配置（尚未确认恢复完成，不称已回滚）', steps })
}
