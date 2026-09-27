// 受控重启安全计划 v3 测试（SETUP-RESTART-PLAN-01，control-handoff-20260927-26）。
// 序列测试把前一步 nextState 传入下一步（不重置历史）；GPT review-26 四反例
// （回滚迟到 health、unknown 先于信号、fallback+pending、启动重复建议）逐一命名回归；
// 时间边界含恰好 deadline；PID 由 spawn 回执绑定、迟到回执不覆盖。
// 旧 v1/v2 断言修改理由见 docs/work-items/tasks/SETUP-RESTART-PLAN-01.md。
import { describe, expect, it } from 'vitest'
import {
  initialRestartState,
  planRestartStep,
  type RestartAttemptState,
  type RestartObservations,
} from '../src/setup/restart-plan'

const NOW = 1_000_000
const TIMEOUTS = {
  saveMs: 5_000,
  drainMs: 5_000,
  sigtermMs: 5_000,
  spawnMs: 5_000,
  healthMs: 5_000,
  restoreMs: 5_000,
}
const OLD = {
  runId: 'run-old',
  pid: 4242,
  port: 8787,
  databasePath: 'C:\\data\\trainer.sqlite',
  origin: 'http://127.0.0.1:8787',
  dataDir: 'C:\\data',
}
const TARGET = { runId: 'run-new', port: 8787, origin: 'http://127.0.0.1:8787' }

function baseObs(overrides: Partial<RestartObservations> = {}): RestartObservations {
  return {
    nowMs: NOW,
    activeTrainingId: null,
    oldRecorded: { ...OLD },
    oldObserved: { ...OLD },
    planned: {
      dataDir: 'C:\\data',
      databasePath: 'C:\\data\\trainer.sqlite',
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      tdxRoot: 'D:\\new_tdx',
      source: 'explicit-env',
    },
    target: { ...TARGET },
    saveNewSource: { kind: 'success' },
    drain: { kind: 'success' },
    oldExit: { kind: 'exited' },
    spawn: { kind: 'pending' },
    health: { kind: 'pending' },
    restore: { kind: 'pending' },
    timeouts: { ...TIMEOUTS },
    ...overrides,
  }
}

/** 后续阶段夹具先真实认领保存再给成功回执；保存自身的反例直接调用 planRestartStep。 */
function step(state: RestartAttemptState, overrides: Partial<RestartObservations> = {}) {
  if (state.stage === 'preflight' && overrides.saveNewSource === undefined) {
    state = planRestartStep(state, baseObs({ ...overrides, saveNewSource: { kind: 'pending' } })).nextState
  }
  return planRestartStep(state, baseObs(overrides))
}

describe('GPT Direct：已冻结身份与等待边界不能被后续观测绕过', () => {
  it('未认领保存时的成功回执不能直接停止旧服务', () => {
    const unsolicited = planRestartStep(initialRestartState(), baseObs({ oldExit: { kind: 'alive' } }))
    expect(unsolicited.phase).toBe('blocked-save-failed')
    expect(unsolicited.nextState.claimed.sigterm).toBe(false)
  })
  it('spawn 成功回执必须属于本次目标 runId', () => {
    const started = step(initialRestartState())
    const wrongRun = step(started.nextState, {
      spawn: { kind: 'success', runId: 'another-attempt', pid: 5151 } as never,
      health: { kind: 'success', runId: TARGET.runId, pid: 5151 },
    })
    expect(wrongRun.phase).toBe('new-start-failed')
    expect(wrongRun.nextState.boundNewPid).toBeNull()
  })

  it('首次退出探测超期才返回 alive 不能重置等待期限并发 SIGTERM', () => {
    const first = step(initialRestartState(), { oldExit: { kind: 'pending' } })
    const late = step(first.nextState, { oldExit: { kind: 'alive' }, nowMs: NOW + TIMEOUTS.sigtermMs })
    expect(late.phase).toBe('old-exit-unconfirmed')
    expect(late.nextState.claimed.sigterm).toBe(false)
  })
  it('preflight 之后不能替换目标、运行配置或期限', () => {
    const first = step(initialRestartState())
    for (const change of [
      { target: { ...TARGET, runId: 'another-run' } },
      { target: { ...TARGET, port: 9999, origin: 'http://127.0.0.1:9999' } },
      { planned: { ...baseObs().planned, databasePath: 'C:\\other\\db' } },
      { oldRecorded: { ...OLD, pid: 999 } },
      { timeouts: { ...TIMEOUTS, spawnMs: 900_000 } },
    ]) {
      const drifted = step(first.nextState, {
        ...change, spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 },
        health: { kind: 'success', runId: change.target?.runId ?? TARGET.runId, pid: 5151 },
      })
      expect(drifted.phase).toBe('blocked-runtime-mismatch')
      expect(drifted.retainOldState).toBe(true)
    }
  })

  it('已派发保存的 pending 有有限出口，deadline 到达不重复保存', () => {
    const first = step(initialRestartState(), { saveNewSource: { kind: 'pending' } })
    const before = step(first.nextState, { saveNewSource: { kind: 'pending' }, nowMs: NOW + TIMEOUTS.saveMs - 1 })
    expect(before.action).toBe('wait-save')
    const expired = step(before.nextState, { saveNewSource: { kind: 'pending' }, nowMs: NOW + TIMEOUTS.saveMs })
    expect(expired.phase).toBe('blocked-save-failed')
    expect(expired.action).toBe('abort')
  })

  it('SIGTERM 未派发前的退出探测 pending 也必须在期限内结束', () => {
    const first = step(initialRestartState(), { oldExit: { kind: 'pending' } })
    expect(first.action).toBe('await-old-exit')
    const expired = step(first.nextState, { oldExit: { kind: 'pending' }, nowMs: NOW + TIMEOUTS.sigtermMs })
    expect(expired.phase).toBe('old-exit-unconfirmed')
    expect(expired.nextState.claimed.sigterm).toBe(false)
  })

  it('超期才收到的 spawn 或 health 成功回执不能越过 deadline', () => {
    const started = step(initialRestartState())
    const lateSpawn = step(started.nextState, {
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 }, health: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      nowMs: NOW + TIMEOUTS.spawnMs,
    })
    expect(lateSpawn.phase).toBe('new-start-failed')
    const bound = step(started.nextState, { spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 }, nowMs: NOW + 10 })
    const lateHealth = step(bound.nextState, {
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 }, health: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      nowMs: NOW + 10 + TIMEOUTS.healthMs,
    })
    expect(lateHealth.phase).toBe('new-start-failed')
  })

  it('健康期限从绑定 spawn 回执开始，不能消耗在等待 spawn 上', () => {
    const started = step(initialRestartState())
    const bound = step(started.nextState, { spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 }, nowMs: NOW + 4999 })
    const waiting = step(bound.nextState, { nowMs: NOW + 5001 })
    expect(waiting.action).toBe('await-health')
    const done = step(waiting.nextState, { health: { kind: 'success', runId: TARGET.runId, pid: 5151 }, nowMs: NOW + 5002 })
    expect(done.phase).toBe('ready')
  })

  it('未派发启动不能接纳预先出现的成功回执', () => {
    const unsolicited = step(initialRestartState(), {
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 }, health: { kind: 'success', runId: TARGET.runId, pid: 5151 },
    })
    expect(unsolicited.phase).toBe('new-start-failed')
    expect(unsolicited.nextState.boundNewPid).toBeNull()
  })

  it('未知保存、drain、spawn、恢复都不能推定成功或继续派发', () => {
    const unknown = { kind: 'unknown', detail: 'outcome unknown' } as never
    expect(step(initialRestartState(), { saveNewSource: unknown }).phase).toBe('blocked-save-failed')
    expect(step(initialRestartState(), { drain: unknown }).action).toBe('keep-old-state')
    const starting = step(initialRestartState())
    const failed = step(starting.nextState, { spawn: unknown })
    expect(failed.phase).toBe('new-start-failed')
    const restoreUnknown = step(failed.nextState, { restore: unknown })
    expect(restoreUnknown.action).toBe('keep-old-state')
    expect(step(restoreUnknown.nextState, { restore: { kind: 'pending' } }).action).toBe('keep-old-state')
  })

  it('恢复失败成为稳定失败，之后 pending 不再进入等待', () => {
    const failed = step(initialRestartState(), { spawn: { kind: 'failure', detail: 'failed' } })
    const restoreFailed = step(failed.nextState, { restore: { kind: 'failure', detail: 'disk unavailable' } })
    expect(step(restoreFailed.nextState, { restore: { kind: 'pending' } }).action).toBe('keep-old-state')
    const expired = step(failed.nextState, { nowMs: NOW + TIMEOUTS.restoreMs })
    expect(step(expired.nextState, { restore: { kind: 'success' }, nowMs: NOW + TIMEOUTS.restoreMs + 1 }).phase).toBe('new-start-failed')
  })

  it('有限数相加溢出或时间倒退不能延长等待', () => {
    expect(step(initialRestartState(), { nowMs: Number.MAX_VALUE,
      timeouts: { ...TIMEOUTS, spawnMs: Number.MAX_VALUE } }).phase).toBe('blocked-runtime-mismatch')
    const started = step(initialRestartState())
    expect(step(started.nextState, { nowMs: NOW - 1 }).phase).toBe('blocked-runtime-mismatch')
  })

  it('终态来源继承保持原计划，不被迟到观测改写', () => {
    const started = step(initialRestartState())
    const done = step(started.nextState, { spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 }, health: { kind: 'success', runId: TARGET.runId, pid: 5151 } })
    expect(done.phase).toBe('ready')
    const late = step(done.nextState, { planned: { ...baseObs().planned, source: 'recalculate', tdxRoot: null } })
    expect(late.tdxInheritance).toBe('explicit-env')
  })
})

describe('preflight：守卫与保存派发分离', () => {
  it('活动训练非 null 即阻断，且终态稳定', () => {
    const first = step(initialRestartState(), { activeTrainingId: 7 })
    expect(first.phase).toBe('blocked-active-training')
    const again = planRestartStep(first.nextState, baseObs({ activeTrainingId: null, oldObserved: null }))
    expect(again.phase).toBe('blocked-active-training')
    expect(again.action).toBe('abort')
  })

  it('记录/观测身份与运行边界/目标漂移逐项阻断（终态可重复）', () => {
    const cases: Array<[Partial<RestartObservations>, string]> = [
      [{ oldObserved: null }, 'blocked-identity'],
      [{ oldObserved: { ...OLD, pid: 1111 } }, 'blocked-identity'],
      [{ oldRecorded: { ...OLD, runId: '' } }, 'blocked-identity'],
      [{ planned: { ...baseObs().planned, port: 8788, origin: 'http://127.0.0.1:8788' } }, 'blocked-runtime-mismatch'],
      [{ target: { runId: 'run-new', port: 9999, origin: 'http://127.0.0.1:9999' } }, 'blocked-runtime-mismatch'],
      [{ target: { runId: 'run-old', port: 8787, origin: 'http://127.0.0.1:8787' } }, 'blocked-identity'],
      [{ target: { runId: '', port: 8787, origin: 'http://127.0.0.1:8787' } }, 'blocked-identity'],
      [{ saveNewSource: { kind: 'failure', detail: '磁盘写入失败' } }, 'blocked-save-failed'],
    ]
    for (const [overrides, expected] of cases) {
      const first = step(initialRestartState(), overrides)
      expect(first.phase).toBe(expected)
      const again = planRestartStep(first.nextState, baseObs())
      expect(again.phase).toBe(expected)
      expect(again.retainOldState).toBe(true)
    }
  })

  it('保存 pending 首次建议 save-new-source，回传后仍 pending 只等待不重复保存', () => {
    const first = step(initialRestartState(), { saveNewSource: { kind: 'pending' } })
    expect(first.phase).toBe('preflight')
    expect(first.action).toBe('save-new-source')
    expect(first.nextState.claimed.save).toBe(true)
    const second = planRestartStep(first.nextState, baseObs({ saveNewSource: { kind: 'pending' } }))
    expect(second.action).toBe('wait-save')
    expect(second.nextState.claimed.save).toBe(true)
  })
})

describe('draining：有限时限', () => {
  /** 进入 draining 且尚未确认完成（第一步 drain pending → wait-drain） */
  function inDraining() {
    const entered = step(initialRestartState(), { drain: { kind: 'pending' } })
    expect(entered.phase).toBe('draining')
    return { state: entered.nextState, startedAt: entered.nextState.stageStartedAtMs ?? NOW }
  }

  it('drain pending 等待；恰好 deadline 视为超期；差 1ms 未超期', () => {
    const { state, startedAt } = inDraining()
    const before = planRestartStep(state, baseObs({ drain: { kind: 'pending' }, nowMs: startedAt + TIMEOUTS.drainMs - 1 }))
    expect(before.phase).toBe('draining')
    expect(before.action).toBe('wait-drain')
    const atDeadline = planRestartStep(state, baseObs({ drain: { kind: 'pending' }, nowMs: startedAt + TIMEOUTS.drainMs }))
    expect(atDeadline.phase).toBe('drain-timeout')
    expect(atDeadline.action).toBe('keep-old-state')
    expect(atDeadline.retainOldState).toBe(true)
  })

  it('drain 观测 timeout 直接终态', () => {
    const { state } = inDraining()
    const result = planRestartStep(state, baseObs({ drain: { kind: 'timeout' } }))
    expect(result.phase).toBe('drain-timeout')
    expect(result.nextState.stage).toBe('drain-timeout')
  })
})

describe('exiting：unknown 保守优先，SIGTERM/SIGKILL 有限一次', () => {
  it('unknown 先于一切信号建议：未发 SIGTERM 也不建议信号（探针 old-exit-unknown-before-term）', () => {
    const r = step(initialRestartState(), { oldExit: { kind: 'unknown', detail: 'probe failed' } })
    expect(r.phase).toBe('old-exit-unconfirmed')
    expect(r.action).toBe('keep-old-state')
    expect(r.nextState.claimed.sigterm).toBe(false)
    expect(r.nextState.claimed.sigkill).toBe(false)
    expect(r.nextState.stage).toBe('old-exit-unconfirmed')
  })

  it('SIGTERM 仅在明确 alive 时建议；pending 只等待不发信号', () => {
    const pending = step(initialRestartState(), { oldExit: { kind: 'pending' } })
    expect(pending.phase).toBe('sigterm-wait')
    expect(pending.action).toBe('await-old-exit')
    expect(pending.nextState.claimed.sigterm).toBe(false)

    const alive = step(initialRestartState(), { oldExit: { kind: 'alive' } })
    expect(alive.phase).toBe('send-sigterm')
    expect(alive.reason).not.toContain('已执行')
    expect(alive.nextState.claimed.sigterm).toBe(true)
    expect(alive.nextState.stage).toBe('exiting')
  })

  it('SIGTERM 限时内等待；恰好 deadline 且仍 alive 才一次 SIGKILL（reason 不含「已执行」）', () => {
    const sent = step(initialRestartState(), { oldExit: { kind: 'alive' } })
    const sentAt = sent.nextState.stageStartedAtMs ?? NOW
    const within = planRestartStep(sent.nextState, baseObs({ oldExit: { kind: 'alive' }, nowMs: sentAt + TIMEOUTS.sigtermMs - 1 }))
    expect(within.phase).toBe('sigterm-wait')
    const atDeadline = planRestartStep(sent.nextState, baseObs({ oldExit: { kind: 'alive' }, nowMs: sentAt + TIMEOUTS.sigtermMs }))
    expect(atDeadline.phase).toBe('sigterm-deadline')
    expect(atDeadline.action).toBe('send-sigkill-once')
    expect(atDeadline.reason).not.toContain('已执行')
    expect(atDeadline.nextState.claimed.sigkill).toBe(true)
  })

  it('SIGTERM 超期而探测 pending：保守 old-exit-unconfirmed（有限出口）', () => {
    const sent = step(initialRestartState(), { oldExit: { kind: 'alive' } })
    const sentAt = sent.nextState.stageStartedAtMs ?? NOW
    const stuck = planRestartStep(sent.nextState, baseObs({ oldExit: { kind: 'pending' }, nowMs: sentAt + TIMEOUTS.sigtermMs }))
    expect(stuck.phase).toBe('old-exit-unconfirmed')
  })

  it('SIGKILL 派发后未明确 exited（pending/alive/unknown）一律 old-exit-unconfirmed（探针 fallback-sent-pending-exit）', () => {
    const sent = step(initialRestartState(), { oldExit: { kind: 'alive' } })
    const sentAt = sent.nextState.stageStartedAtMs ?? NOW
    const killed = planRestartStep(sent.nextState, baseObs({ oldExit: { kind: 'alive' }, nowMs: sentAt + TIMEOUTS.sigtermMs }))
    expect(killed.nextState.claimed.sigkill).toBe(true)
    for (const oldExit of [
      { kind: 'pending' },
      { kind: 'alive' },
      { kind: 'unknown', detail: 'x' },
    ] as const) {
      const r = planRestartStep(killed.nextState, baseObs({ oldExit: oldExit as never, nowMs: sentAt + TIMEOUTS.sigtermMs + 1 }))
      expect(r.phase).toBe('old-exit-unconfirmed')
      expect(r.action).toBe('keep-old-state')
    }
  })

  it('旧服务自然退出（未发任何信号）：直接进入启动，不建议 kill', () => {
    const r = step(initialRestartState(), { oldExit: { kind: 'exited' } })
    expect(r.phase).toBe('new-start')
    expect(r.action).toBe('start-new-server')
    expect(r.nextState.claimed.sigterm).toBe(false)
    expect(r.nextState.claimed.sigkill).toBe(false)
  })
})

describe('starting：spawn 回执绑定 PID，健康匹配绑定', () => {
  /** 进入 starting（旧服务已确认退出），spawn 尚未请求 */
  function inStarting() {
    const entered = step(initialRestartState(), { oldExit: { kind: 'exited' } })
    expect(entered.action).toBe('start-new-server')
    return { state: entered.nextState, startedAt: entered.nextState.stageStartedAtMs ?? NOW }
  }

  it('启动 pending 首次建议 start-new-server；回传后仍 pending 只等待回执（探针 start-pending-is-also-in-progress）', () => {
    const { state } = inStarting()
    const second = planRestartStep(state, baseObs({ spawn: { kind: 'pending' }, nowMs: NOW + 1 }))
    expect(second.phase).toBe('new-start')
    expect(second.action).toBe('await-spawn-receipt')
    expect(second.action).not.toBe('start-new-server')
  })

  it('spawn 限时超期仍无回执 → new-start-failed（进入恢复流程）', () => {
    const { state, startedAt } = inStarting()
    const expired = planRestartStep(state, baseObs({ spawn: { kind: 'pending' }, nowMs: startedAt + TIMEOUTS.spawnMs }))
    expect(expired.phase).toBe('new-start-failed')
    expect(expired.action).toBe('restore-old-config')
  })

  it('spawn 回执绑定 PID；健康匹配绑定与目标 → ready；不匹配 → 失败', () => {
    const { state, startedAt } = inStarting()
    const bound = planRestartStep(state, baseObs({
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      health: { kind: 'pending' },
      nowMs: startedAt + 10,
    }))
    expect(bound.action).toBe('await-health')
    expect(bound.nextState.boundNewPid).toBe(5151)
    const match = planRestartStep(bound.nextState, baseObs({
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      health: { kind: 'success', runId: 'run-new', pid: 5151 },
      nowMs: startedAt + 20,
    }))
    expect(match.phase).toBe('ready')
    expect(match.action).toBe('new-source-effective')
    expect(match.retainOldState).toBe(false)

    const mismatch = planRestartStep(bound.nextState, baseObs({
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      health: { kind: 'success', runId: 'run-new', pid: 9999 },
      nowMs: startedAt + 20,
    }))
    expect(mismatch.phase).toBe('new-start-failed')
  })

  it('迟到回执不同 PID 不覆盖绑定；健康按原绑定验证仍可 ready', () => {
    const { state, startedAt } = inStarting()
    const bound = planRestartStep(state, baseObs({
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      health: { kind: 'pending' },
      nowMs: startedAt + 10,
    }))
    const late = planRestartStep(bound.nextState, baseObs({
      spawn: { kind: 'success', runId: TARGET.runId, pid: 300 },
      health: { kind: 'success', runId: 'run-new', pid: 5151 },
      nowMs: startedAt + 20,
    }))
    expect(late.phase).toBe('ready')
    expect(late.nextState.boundNewPid).toBe(5151)
  })

  it('非法回执 PID 不放行；健康先于回执到达时只等待回执（健康不能自证）', () => {
    const { state, startedAt } = inStarting()
    const badReceipt = planRestartStep(state, baseObs({
      spawn: { kind: 'success', runId: TARGET.runId, pid: 0 },
      nowMs: startedAt + 10,
    }))
    expect(badReceipt.phase).toBe('new-start-failed')
    const unbound = planRestartStep(state, baseObs({
      spawn: { kind: 'pending' },
      health: { kind: 'success', runId: 'run-new', pid: 5151 },
      nowMs: startedAt + 10,
    }))
    expect(unbound.action).toBe('await-spawn-receipt')
  })

  it('健康探测 unknown/超期 → 失败；pending 限时内等待', () => {
    const { state, startedAt } = inStarting()
    const bound = planRestartStep(state, baseObs({
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      health: { kind: 'pending' },
      nowMs: startedAt + 10,
    }))
    const unknown = planRestartStep(bound.nextState, baseObs({
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      health: { kind: 'unknown', detail: '超时' },
      nowMs: startedAt + 20,
    }))
    expect(unknown.phase).toBe('new-start-failed')
    const expired = planRestartStep(bound.nextState, baseObs({
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      health: { kind: 'pending' },
      nowMs: startedAt + 10 + TIMEOUTS.healthMs,
    }))
    expect(expired.phase).toBe('new-start-failed')
  })
})

describe('恢复：new-start-failed 只进恢复流程，rolled-back 终态稳定', () => {
  function inRestoring() {
    const failed = step(initialRestartState(), {
      oldExit: { kind: 'exited' },
      spawn: { kind: 'failure', detail: '端口被占用' },
    })
    expect(failed.phase).toBe('new-start-failed')
    expect(failed.action).toBe('restore-old-config')
    return { state: failed.nextState, startedAt: failed.nextState.stageStartedAtMs ?? NOW }
  }

  it('restore pending 限时内等待；超期保持失败而非 rolled-back', () => {
    const { state, startedAt } = inRestoring()
    const waiting = planRestartStep(state, baseObs({ restore: { kind: 'pending' }, nowMs: startedAt + 1 }))
    expect(waiting.phase).toBe('new-start-failed')
    expect(waiting.action).toBe('await-restore')
    const expired = planRestartStep(state, baseObs({ restore: { kind: 'pending' }, nowMs: startedAt + TIMEOUTS.restoreMs }))
    expect(expired.phase).toBe('new-start-failed')
    expect(expired.action).toBe('keep-old-state')
    // 超期后锁定失败，不能由迟到 success 把失败覆盖成已回滚。
    expect(expired.nextState.stage).toBe('restore-failed')
  })

  it('restore 确认成功才 rolled-back；随后迟到健康成功仍 rolled-back（探针 rollback-terminal-late-health）', () => {
    const { state } = inRestoring()
    const confirmed = planRestartStep(state, baseObs({ restore: { kind: 'success' } }))
    expect(confirmed.phase).toBe('rolled-back')
    expect(confirmed.nextState.stage).toBe('rolled-back')
    const late = planRestartStep(confirmed.nextState, baseObs({
      oldExit: { kind: 'exited' },
      spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 },
      health: { kind: 'success', runId: 'run-new', pid: 5151 },
    }))
    expect(late.phase).toBe('rolled-back')
    expect(late.action).toBe('keep-old-state')
    expect(late.retainOldState).toBe(true)
  })

  it('restore 失败保留失败与旧证据，不重复恢复', () => {
    const { state } = inRestoring()
    const failedRestore = planRestartStep(state, baseObs({ restore: { kind: 'failure', detail: '旧配置文件缺失' } }))
    expect(failedRestore.phase).toBe('new-start-failed')
    expect(failedRestore.action).toBe('keep-old-state')
    const again = planRestartStep(failedRestore.nextState, baseObs({ restore: { kind: 'pending' } }))
    expect(again.action).not.toBe('restore-old-config')
  })
})

describe('完整序列（nextState 串联）与继承', () => {
  it('合法成功序列：save→drain→SIGTERM→退出→spawn 回执绑定→健康→ready（未分配 PID 起步）', () => {
    let state = initialRestartState()
    const phases: string[] = []
    const feed = (overrides: Partial<RestartObservations>, nowMs: number) => {
      const r = planRestartStep(state, baseObs({ ...overrides, nowMs }))
      phases.push(r.phase)
      state = r.nextState
      return r
    }
    feed({ saveNewSource: { kind: 'pending' } }, NOW)
    feed({ saveNewSource: { kind: 'pending' } }, NOW + 10)
    feed({ saveNewSource: { kind: 'success' }, drain: { kind: 'pending' }, oldExit: { kind: 'alive' } }, NOW + 20)
    feed({ drain: { kind: 'success' }, oldExit: { kind: 'alive' } }, NOW + 30)
    feed({ oldExit: { kind: 'alive' } }, NOW + 40)
    feed({ oldExit: { kind: 'alive' } }, NOW + 50)
    expect(state.boundNewPid).toBeNull()
    feed({ oldExit: { kind: 'exited' } }, NOW + 60)
    feed({ spawn: { kind: 'pending' } }, NOW + 70)
    feed({ spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 }, health: { kind: 'pending' } }, NOW + 80)
    const last = feed({ spawn: { kind: 'success', runId: TARGET.runId, pid: 5151 }, health: { kind: 'success', runId: 'run-new', pid: 5151 } }, NOW + 90)
    expect(phases).toEqual([
      'preflight', 'preflight', 'draining', 'send-sigterm', 'sigterm-wait', 'sigterm-wait',
      'new-start', 'new-start', 'new-start', 'ready',
    ])
    expect(last.phase).toBe('ready')
    expect(last.retainOldState).toBe(false)
    expect(state.boundNewPid).toBe(5151)
    expect(state.claimed).toEqual({ save: true, sigterm: true, sigkill: false, start: true, restore: false })
  })

  it('fallback 序列：alive→SIGTERM→超期 SIGKILL→确认退出→spawn 绑定→健康→ready', () => {
    let state = initialRestartState()
    const feed = (overrides: Partial<RestartObservations>, nowMs: number) => {
      const r = planRestartStep(state, baseObs({ ...overrides, nowMs }))
      state = r.nextState
      return r
    }
    feed({ saveNewSource: { kind: 'pending' } }, NOW)
    feed({ oldExit: { kind: 'alive' } }, NOW)
    feed({ oldExit: { kind: 'alive' } }, NOW + 10)
    const kill = feed({ oldExit: { kind: 'alive' } }, NOW + 10 + TIMEOUTS.sigtermMs)
    expect(kill.phase).toBe('sigterm-deadline')
    expect(kill.action).toBe('send-sigkill-once')
    const afterKill = feed({ oldExit: { kind: 'exited' } }, NOW + 10 + TIMEOUTS.sigtermMs + 10)
    expect(afterKill.phase).toBe('new-start')
    const bound = feed({ spawn: { kind: 'success', runId: TARGET.runId, pid: 600 }, health: { kind: 'pending' } }, NOW + 10 + TIMEOUTS.sigtermMs + 20)
    expect(bound.action).toBe('await-health')
    const done = feed({ spawn: { kind: 'success', runId: TARGET.runId, pid: 600 }, health: { kind: 'success', runId: 'run-new', pid: 600 } }, NOW + 10 + TIMEOUTS.sigtermMs + 30)
    expect(done.phase).toBe('ready')
    expect(state.boundNewPid).toBe(600)
  })

  it('ready 终态稳定：迟到异常观测不回退', () => {
    let state = initialRestartState()
    const feed = (overrides: Partial<RestartObservations>, nowMs: number) => {
      const r = planRestartStep(state, baseObs({ ...overrides, nowMs }))
      state = r.nextState
      return r
    }
    feed({ saveNewSource: { kind: 'pending' } }, NOW)
    feed({}, NOW)
    feed({ spawn: { kind: 'success', runId: TARGET.runId, pid: 700 }, health: { kind: 'success', runId: 'run-new', pid: 700 } }, NOW + 10)
    expect(state.stage).toBe('ready')
    const garbage = planRestartStep(state, baseObs({
      activeTrainingId: 9,
      oldObserved: null,
      spawn: { kind: 'failure', detail: '迟到失败' },
      health: { kind: 'unknown', detail: '迟到无结论' },
    }))
    expect(garbage.phase).toBe('ready')
    expect(garbage.retainOldState).toBe(false)
  })

  it('tdx 继承：explicit-env 可继承，recalculate 重解析', () => {
    const env = planRestartStep(initialRestartState(), baseObs({ saveNewSource: { kind: 'pending' } }))
    expect(env.tdxInheritance).toBe('explicit-env')
    const recalc = planRestartStep(initialRestartState(), baseObs({
      saveNewSource: { kind: 'pending' },
      planned: {
        dataDir: 'C:\\data',
        databasePath: 'C:\\data\\trainer.sqlite',
        port: 8787,
        origin: 'http://127.0.0.1:8787',
        tdxRoot: null,
        source: 'recalculate',
      },
    }))
    expect(recalc.tdxInheritance).toBe('recalculate')
  })

  it('非法时间输入（NaN/Infinity/负 timeout、非有限 nowMs）保守阻断，绝不 ready', () => {
    for (const overrides of [
      { timeouts: { ...TIMEOUTS, drainMs: Number.NaN } },
      { timeouts: { ...TIMEOUTS, sigtermMs: Number.POSITIVE_INFINITY } },
      { timeouts: { ...TIMEOUTS, spawnMs: -1 } },
      { nowMs: Number.NaN },
      { nowMs: Number.POSITIVE_INFINITY },
    ]) {
      const r = planRestartStep(initialRestartState(), baseObs(overrides))
      expect(r.phase).toBe('blocked-runtime-mismatch')
      expect(r.retainOldState).toBe(true)
    }
  })

  it('除 ready 外所有相位 retainOldState=true', () => {
    const samples: Array<[RestartAttemptState, Partial<RestartObservations>]> = [
      [initialRestartState(), { activeTrainingId: 1 }],
      [initialRestartState(), { oldObserved: null }],
      [initialRestartState(), { saveNewSource: { kind: 'pending' } }],
      [initialRestartState(), { saveNewSource: { kind: 'failure', detail: 'x' } }],
      [initialRestartState(), { drain: { kind: 'pending' } }],
      [initialRestartState(), { drain: { kind: 'timeout' } }],
      [initialRestartState(), { oldExit: { kind: 'alive' } }],
      [initialRestartState(), { oldExit: { kind: 'unknown', detail: 'x' } }],
      [initialRestartState(), { spawn: { kind: 'pending' } }],
      [initialRestartState(), { spawn: { kind: 'failure', detail: 'x' } }],
    ]
    for (const [state, overrides] of samples) {
      const r = planRestartStep(state, baseObs(overrides))
      expect(r.phase).not.toBe('ready')
      expect(r.retainOldState).toBe(true)
    }
  })
})
