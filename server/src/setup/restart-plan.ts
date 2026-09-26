// 受控重启安全计划（SETUP-RESTART-PLAN-01 冻结合同）：纯函数，无副作用——
// 不启动进程、不发信号、不写配置、不碰用户数据库；只产出不可变的阶段/动作/
// 原因与是否保留旧状态。未知测量一律不算成功。遵守 glm-failure-patterns
// FM-001（结论必须可复核）/ FM-005（每个边界都有行为反例）。
export type TdxInheritance = 'explicit-env' | 'recalculate'

export interface PlannedRuntime {
  dataDir: string
  databasePath: string
  port: number
  origin: string
  tdxRoot: string | null
  /** 新运行 tdxRoot 的来源：explicit-env 可继承；recalculate 指重新解析（不继承自动发现） */
  source: 'explicit-env' | 'recalculate'
}

export interface OldRunIdentity {
  runId: string
  pid: number
  port: number
  databasePath: string
  origin: string
  dataDir: string
}

export interface StopObservation {
  drainCompleted: boolean
  sigtermDeadlineExceeded: boolean
  oldExitConfirmed: boolean
}

export interface StartObservation {
  started: boolean
  healthRunId: string | null
  healthPid: number | null
}

export interface RestartPlanInput {
  oldRun: OldRunIdentity
  planned: PlannedRuntime
  activeTrainingId: number | null
  saveSucceeded: boolean
  stop: StopObservation
  start: StartObservation
  newRun: { runId: string; pid: number; port: number; origin: string }
}

export type RestartPhase =
  | 'blocked-active-training'
  | 'blocked-identity'
  | 'blocked-runtime-mismatch'
  | 'blocked-save-failed'
  | 'drain'
  | 'sigterm-deadline'
  | 'sigkill-fallback'
  | 'old-exit-confirmation'
  | 'old-exit-unconfirmed'
  | 'new-start'
  | 'new-start-health'
  | 'new-start-failed'
  | 'rolled-back'
  | 'ready'

export interface RestartPlanResult {
  phase: RestartPhase
  action: string
  reason: string
  retainOldState: boolean
  tdxInheritance: TdxInheritance
  /** 到达当前阶段为止的有序阶段列表（不可变） */
  steps: readonly string[]
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** 身份守卫：旧运行身份字段齐备且 origin 与端口一致 */
function identityBlockReason(oldRun: OldRunIdentity): string | null {
  if (!isNonEmptyString(oldRun.runId)) return '旧运行缺少 runId'
  if (!isPositiveInt(oldRun.pid)) return '旧运行 pid 不是正整数'
  if (!isPositiveInt(oldRun.port)) return '旧运行端口不是正整数'
  if (!isNonEmptyString(oldRun.databasePath)) return '旧运行缺少 databasePath'
  if (oldRun.origin !== `http://127.0.0.1:${oldRun.port}`) return '旧运行 origin 与端口不一致'
  return null
}

/** 稳定运行边界：计划中的 dataDir/databasePath/port/origin 必须与旧运行一致 */
function runtimeMismatchReason(oldRun: OldRunIdentity, planned: PlannedRuntime): string | null {
  if (oldRun.dataDir !== planned.dataDir) return 'planned dataDir 与旧运行不一致'
  if (oldRun.databasePath !== planned.databasePath) return 'planned databasePath 与旧运行不一致'
  if (oldRun.port !== planned.port) return 'planned port 与旧运行不一致'
  if (oldRun.origin !== planned.origin) return 'planned origin 与旧运行不一致'
  return null
}

/** 产出受控重启的阶段/动作计划。失败与未知测量一律保留旧状态，不产生切换成功。 */
export function planControlledRestart(input: RestartPlanInput): RestartPlanResult {
  const inherit: TdxInheritance = input.planned.source === 'explicit-env' ? 'explicit-env' : 'recalculate'
  const retain: RestartPlanResult = {
    phase: 'ready', // 占位，下方逐一覆盖
    action: 'abort',
    reason: '',
    retainOldState: true,
    tdxInheritance: inherit,
    steps: [],
  }

  // 1) 活动训练守卫
  if (input.activeTrainingId !== null) {
    return {
      ...retain,
      phase: 'blocked-active-training',
      action: 'abort',
      reason: `活动训练 ${input.activeTrainingId} 进行中；受控重启被阻断，未停止旧服务、未保存新来源`,
      steps: ['blocked-active-training'],
    }
  }

  // 2) 身份守卫：旧运行身份齐备且与观测一致
  const identityReason = identityBlockReason(input.oldRun)
  if (identityReason !== null) {
    return {
      ...retain,
      phase: 'blocked-identity',
      action: 'abort',
      reason: identityReason,
      steps: ['blocked-identity'],
    }
  }

  // 3) 稳定运行边界
  const runtimeReason = runtimeMismatchReason(input.oldRun, input.planned)
  if (runtimeReason !== null) {
    return {
      ...retain,
      phase: 'blocked-runtime-mismatch',
      action: 'abort',
      reason: runtimeReason,
      steps: ['blocked-runtime-mismatch'],
    }
  }

  // 4) 保存新来源失败：保留旧配置，阻断
  if (!input.saveSucceeded) {
    return {
      ...retain,
      phase: 'blocked-save-failed',
      action: 'abort',
      reason: '保存新来源失败；保留旧配置与旧状态，未停止旧服务',
      steps: ['blocked-save-failed'],
    }
  }

  const steps: string[] = []

  // 5) 正常退出阶段：先 drain，再 SIGTERM；deadline 后才计划 SIGKILL fallback
  if (!input.stop.drainCompleted) {
    steps.push('drain')
    return {
      phase: 'drain',
      action: 'send-sigterm-after-drain',
      reason: 'drain 未完成：等待在途请求排空后发送 SIGTERM',
      retainOldState: false,
      tdxInheritance: inherit,
      steps,
    }
  }
  steps.push('drain')

  if (input.stop.sigtermDeadlineExceeded) {
    steps.push('sigterm-deadline', 'sigkill-fallback')
    if (!input.stop.oldExitConfirmed) {
      return {
        phase: 'sigterm-deadline',
        action: 'send-sigkill-fallback',
        reason: 'SIGTERM 已超期：计划 SIGKILL fallback，旧服务退出未确认前保留旧状态',
        retainOldState: true,
        tdxInheritance: inherit,
        steps,
      }
    }
    if (!input.start.started) {
      return {
        phase: 'sigkill-fallback',
        action: 'start-new-server-after-sigkill',
        reason: 'SIGKILL fallback 已执行；等待新服务启动',
        retainOldState: true,
        tdxInheritance: inherit,
        steps,
      }
    }
  }

  // 6) 旧服务退出确认
  if (!input.stop.oldExitConfirmed) {
    steps.push('old-exit-confirmation', 'old-exit-unconfirmed')
    return {
      phase: 'old-exit-unconfirmed',
      action: 'keep-old-state',
      reason: '旧服务退出未确认；保留旧状态，不进入新服务启动',
      retainOldState: true,
      tdxInheritance: inherit,
      steps,
    }
  }
  steps.push('old-exit-confirmation')

  // 7) 新服务启动与健康身份。走到这里时旧服务退出必已确认（未确认在上方被拦）：
  //    新服务未启动 → 回滚旧配置供人工恢复；已启动但身份不匹配 → 启动验证失败。
  if (!input.start.started) {
    steps.push('new-start', 'rolled-back')
    return {
      phase: 'rolled-back',
      action: 'keep-old-state',
      reason: '旧服务已退出且新服务未启动；已回滚到旧配置，等待人工恢复',
      retainOldState: true,
      tdxInheritance: inherit,
      steps,
    }
  }
  steps.push('new-start')

  const healthRunIdMatches = input.start.healthRunId !== null
    && input.start.healthRunId === input.newRun.runId
  const healthPidMatches = input.start.healthPid !== null
    && input.start.healthPid === input.newRun.pid
  if (!healthRunIdMatches || !healthPidMatches) {
    steps.push('new-start-health', 'new-start-failed')
    return {
      phase: 'new-start-failed',
      action: 'keep-old-state',
      reason: '新服务已启动但健康身份与目标 run 不匹配；保留旧状态，不切换来源',
      retainOldState: true,
      tdxInheritance: inherit,
      steps,
    }
  }
  steps.push('new-start-health', 'ready')

  return {
    phase: 'ready',
    action: 'new-source-effective',
    reason: '受控重启完成：新来源已生效，健康身份与目标 run 一致',
    retainOldState: false,
    tdxInheritance: inherit,
    steps,
  }
}
