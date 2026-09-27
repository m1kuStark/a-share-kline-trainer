// SETUP-DRAIN-01（control-handoff-20260927-30 冻结合同）：受保护排空控制器。
// 职责：业务接纳 gate（关闭后新业务 503）、在途 handler/后台任务租约跟踪、
// prepare（排空→同步复查活动训练→prepared 租约）、cancel（幂等）、shutdown 前置状态
// （closing 由 control-api 在 202 回包后调用注入的真实 shutdown；本模块不发信号不关 DB）。
// 时间：显式注入 now 与正有限预算；定时器属于本实例，close() 全部清理。
// 竞态不变量：取消/超时/关闭后，迟到的排空完成或重复 prepare 不得复活、重置或改写结果；
// 同 attempt 重复 prepare 共用同一结果与原 deadline（不延长租约）。

export interface DrainControllerOptions {
  /** 排空预算（毫秒，正有限）；到期撤销接纳并返回 drain-timeout，默认 10_000 */
  drainBudgetMs?: number
  /** prepared 租约时长（毫秒，正有限）；到期自动撤销接纳，默认 30_000 */
  preparedLeaseMs?: number
  /** 显式时钟；默认 Date.now */
  now?: () => number
  /** 活动训练查询（服务注入真实 DB 查询）；null=无活动训练 */
  getActiveTraining?: () => { id: number } | null
}

export type PrepareOutcome =
  | { kind: 'prepared'; leaseExpiresAtMs: number }
  | { kind: 'cancelled' }
  | { kind: 'drain-timeout' }
  | { kind: 'active-training' }
  | { kind: 'expired' }
  | { kind: 'closing' }
  | { kind: 'busy' }

export type CancelOutcome =
  | { kind: 'cancelled' }
  | { kind: 'closing' }
  | { kind: 'mismatch' }

export type ShutdownOutcome =
  | { kind: 'closing' }
  | { kind: 'not-prepared' }
  | { kind: 'active-training' }

export interface DrainGate {
  /** gate 是否开放接纳新业务 */
  isOpen(): boolean
  /** 业务路由进入前调用：开放则返回租约句柄（handler Promise 结束后必须 release），关闭则拒绝 */
  admit(): { ok: true; release: () => void } | { ok: false }
  /** 后台任务来源注册（如数据刷新的在途任务 Promise 快照），排空时一并等待 */
  registerTaskSource(source: () => readonly Promise<unknown>[]): void
  /** Fastify 实例关闭时清理全部定时器 */
  close(): void
}

export interface DrainController {
  readonly gate: DrainGate
  prepare(attemptId: string): Promise<PrepareOutcome>
  cancel(attemptId: string): CancelOutcome
  /** 仅状态迁移到 closing；真实 shutdown 由 control-api 在 202 回包后调用注入的函数 */
  beginShutdown(attemptId: string): ShutdownOutcome
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

interface AttemptRecord {
  id: string
  state: 'draining' | 'prepared'
  drainDeadlineMs: number
  leaseExpiresAtMs: number | null
  settle?: (outcome: PrepareOutcome) => void
  waiters: Array<(outcome: PrepareOutcome) => void>
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>(res => { resolve = res })
  return { promise, resolve }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

export function createDrainController(options: DrainControllerOptions = {}): DrainController {
  const drainBudgetMs = options.drainBudgetMs ?? 10_000
  const preparedLeaseMs = options.preparedLeaseMs ?? 30_000
  if (!Number.isFinite(drainBudgetMs) || drainBudgetMs <= 0
    || !Number.isFinite(preparedLeaseMs) || preparedLeaseMs <= 0) {
    throw new Error('drainBudgetMs / preparedLeaseMs 必须为正有限数')
  }
  const now = options.now ?? Date.now
  const getActiveTraining = options.getActiveTraining ?? (() => null)

  let gateOpen = true
  let closingStarted = false
  let closed = false
  let current: AttemptRecord | null = null
  const finished = new Map<string, PrepareOutcome>()
  const leases = new Set<Promise<void>>()
  const taskSources: Array<() => readonly Promise<unknown>[]> = []
  const timers = new Set<ReturnType<typeof setTimeout>>()

  function armTimer(delayMs: number, fn: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, Math.max(0, delayMs))
    timers.add(timer)
    return timer
  }

  function disarmTimer(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer)
    timers.delete(timer)
  }

  function finish(record: AttemptRecord, outcome: PrepareOutcome): void {
    finished.set(record.id, outcome)
    if (current === record) current = null
    if (outcome.kind === 'prepared') {
      gateOpen = false
    } else if (!closingStarted) {
      gateOpen = true
    }
    record.settle?.(outcome)
    for (const waiter of record.waiters.splice(0)) waiter(outcome)
  }

  const gate: DrainGate = {
    isOpen: () => gateOpen,
    admit(): { ok: true; release: () => void } | { ok: false } {
      if (!gateOpen) return { ok: false }
      const lease = deferred()
      leases.add(lease.promise)
      return {
        ok: true,
        release: () => {
          leases.delete(lease.promise)
          lease.resolve()
        },
      }
    },
    registerTaskSource(source: () => readonly Promise<unknown>[]): void {
      taskSources.push(source)
    },
    close(): void {
      closed = true
      for (const timer of [...timers]) disarmTimer(timer)
    },
  }

  function settleDrain(record: AttemptRecord, deadlineHit: boolean): void {
    if (current !== record || record.state !== 'draining') return
    // 双保险：定时器未先触发时，排空完成晚于预算同样按超时收敛（保守有限出口）
    if (deadlineHit || now() >= record.drainDeadlineMs) {
      finish(record, { kind: 'drain-timeout' })
      return
    }
    // 排空完成后无 await 同步复查活动训练：在途创建刚提交则撤销接纳，绝不能 prepared 后出现新 running
    if (getActiveTraining() !== null) {
      finish(record, { kind: 'active-training' })
      return
    }
    const leaseExpiresAtMs = now() + preparedLeaseMs
    record.state = 'prepared'
    record.leaseExpiresAtMs = leaseExpiresAtMs
    const outcome: PrepareOutcome = { kind: 'prepared', leaseExpiresAtMs }
    finished.set(record.id, outcome)
    gateOpen = false
    armTimer(preparedLeaseMs, () => {
      if (current === record && record.state === 'prepared') {
        finish(record, { kind: 'expired' })
      }
    })
    record.settle?.(outcome)
    for (const waiter of record.waiters.splice(0)) waiter({ ...outcome })
  }

  function runDrain(record: AttemptRecord): void {
    let deadlineHit = false
    const timer = armTimer(drainBudgetMs, () => {
      deadlineHit = true
      settleDrain(record, true)
    })
    void Promise.allSettled(collectOutstanding()).then(() => {
      disarmTimer(timer)
      settleDrain(record, deadlineHit)
    })
  }

  function collectOutstanding(): Promise<unknown>[] {
    return [...leases, ...taskSources.flatMap(source => source())]
  }

  function beginShutdown(attemptId: string): ShutdownOutcome {
    if (closingStarted || finished.get(attemptId)?.kind === 'closing') {
      return { kind: 'closing' }
    }
    if (current?.id === attemptId && current.state === 'prepared') {
      if (now() >= (current.leaseExpiresAtMs ?? Number.POSITIVE_INFINITY)) {
        finish(current, { kind: 'expired' })
        return { kind: 'not-prepared' }
      }
      if (getActiveTraining() !== null) return { kind: 'active-training' }
      const record = current
      finished.set(record.id, { kind: 'closing' })
      current = null
      closingStarted = true
      for (const timer of [...timers]) disarmTimer(timer)
      return { kind: 'closing' }
    }
    return { kind: 'not-prepared' }
  }

  return {
    gate,
    prepare(attemptId: string): Promise<PrepareOutcome> {
      if (!isNonEmptyString(attemptId)) return Promise.resolve({ kind: 'busy' })
      if (closed || closingStarted) return Promise.resolve({ kind: 'closing' })
      if (finished.has(attemptId)) return Promise.resolve(finished.get(attemptId)!)
      if (current?.id === attemptId) {
        if (current.state === 'draining') {
          return new Promise<PrepareOutcome>(resolve => { current?.waiters.push(resolve) })
        }
        const outcome = finished.get(attemptId)
        return outcome ? Promise.resolve(outcome) : Promise.resolve({ kind: 'busy' })
      }
      if (current) return Promise.resolve({ kind: 'busy' })
      // 同步检查活动训练：存在则 409 且 gate 保持 open（该次尝试未启动动作，不记入结果）
      if (getActiveTraining() !== null) return Promise.resolve({ kind: 'active-training' })
      gateOpen = false
      const record: AttemptRecord = {
        id: attemptId,
        state: 'draining',
        drainDeadlineMs: now() + drainBudgetMs,
        leaseExpiresAtMs: null,
        waiters: [],
      }
      current = record
      const promise = new Promise<PrepareOutcome>(resolve => { record.settle = resolve })
      runDrain(record)
      return promise
    },
    cancel(attemptId: string): CancelOutcome {
      if (closingStarted || finished.get(attemptId)?.kind === 'closing') return { kind: 'closing' }
      if (current?.id === attemptId && (current.state === 'draining' || current.state === 'prepared')) {
        for (const timer of [...timers]) disarmTimer(timer)
        gateOpen = true
        const record = current
        current = null
        const outcome: PrepareOutcome = { kind: 'cancelled' }
        finished.set(record.id, outcome)
        record.settle?.(outcome)
        for (const waiter of record.waiters.splice(0)) waiter({ kind: 'cancelled' })
        return { kind: 'cancelled' }
      }
      if (finished.get(attemptId)?.kind === 'cancelled') return { kind: 'cancelled' }
      return { kind: 'mismatch' }
    },
    beginShutdown,
  }
}
