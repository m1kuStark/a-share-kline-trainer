// 受控重启安全计划（SETUP-RESTART-PLAN-01 v2，control-handoff-20260927-24 限定返修）。
// 每个 GPT 探针缺口都有命名回归（new-runtime-drift / invalid-new-identity /
// not-started-is-not-rolled-back / drain-pending-retains-state /
// grace-expired-does-not-prove-kill），另覆盖完整成功序列与失败→恢复序列。
// 旧 v1 测试断言修改理由记录于 docs/work-items/tasks/SETUP-RESTART-PLAN-01.md。
import { describe, expect, it } from 'vitest'
import {
  planControlledRestart,
  type RestartPlanInput,
  type RestartPlanResult,
} from '../src/setup/restart-plan'

const OLD_IDENTITY = {
  runId: 'run-old',
  pid: 4242,
  port: 8787,
  databasePath: 'C:\\data\\trainer.sqlite',
  origin: 'http://127.0.0.1:8787',
  dataDir: 'C:\\data',
}

function baseInput(overrides: Partial<RestartPlanInput> = {}): RestartPlanInput {
  return {
    activeTrainingId: null,
    oldRecorded: { ...OLD_IDENTITY },
    oldObserved: { ...OLD_IDENTITY },
    planned: {
      dataDir: 'C:\\data',
      databasePath: 'C:\\data\\trainer.sqlite',
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      tdxRoot: 'D:\\new_tdx',
      source: 'explicit-env',
    },
    saveNewSource: { kind: 'success' },
    stop: {
      drain: { kind: 'success' },
      sigtermSent: true,
      sigtermDeadlineExceeded: false,
      oldExit: { kind: 'exited' },
      sigkillSent: false,
    },
    start: {
      process: { kind: 'success' },
      health: { kind: 'success', runId: 'run-new', pid: 5151 },
      target: { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' },
    },
    rollback: { restore: { kind: 'pending' } },
    ...overrides,
  }
}

describe('planControlledRestart: 前置守卫', () => {
  it('活动训练非 null 即阻断，保留旧状态', () => {
    const result: RestartPlanResult = planControlledRestart(baseInput({ activeTrainingId: 7 }))
    expect(result.phase).toBe('blocked-active-training')
    expect(result.action).toBe('abort')
    expect(result.retainOldState).toBe(true)
  })

  it('记录身份形状非法逐项阻断（runId/pid/port/databasePath/origin/dataDir）', () => {
    for (const partial of [
      { runId: '' },
      { pid: 0 },
      { pid: -1 },
      { pid: 1.5 },
      { port: 0 },
      { port: 65536 },
      { port: 1.5 },
      { databasePath: '' },
      { origin: 'http://127.0.0.1:9999' },
      { dataDir: '' },
    ]) {
      const result = planControlledRestart(
        baseInput({ oldRecorded: { ...OLD_IDENTITY, ...partial } }),
      )
      expect(result.phase).toBe('blocked-identity')
      expect(result.retainOldState).toBe(true)
    }
  })

  it('旧服务无独立观测值即阻断：不能用记录自洽代替归属确认', () => {
    const result = planControlledRestart(baseInput({ oldObserved: null }))
    expect(result.phase).toBe('blocked-identity')
    expect(result.reason).toContain('观测')
  })

  it('独立观测与记录任一字段不一致即阻断', () => {
    for (const partial of [
      { runId: 'run-other' },
      { pid: 1111 },
      { port: 8788, origin: 'http://127.0.0.1:8788' },
      { databasePath: 'C:\\other\\db' },
    ]) {
      const result = planControlledRestart(
        baseInput({ oldObserved: { ...OLD_IDENTITY, ...partial } }),
      )
      expect(result.phase).toBe('blocked-identity')
    }
  })

  it('planned 边界漂移（dataDir/databasePath/port/origin）阻断', () => {
    const base = baseInput({})
    for (const planned of [
      { ...base.planned, dataDir: 'C:\\other' },
      { ...base.planned, databasePath: 'C:\\other\\trainer.sqlite' },
      { ...base.planned, port: 8788, origin: 'http://127.0.0.1:8788' },
      { ...base.planned, origin: 'http://127.0.0.1:8788' },
    ]) {
      const result = planControlledRestart(baseInput({ planned }))
      expect(result.phase).toBe('blocked-runtime-mismatch')
      expect(result.retainOldState).toBe(true)
    }
  })

  it('新目标端口/origin 漂移=运行边界破坏，绝不 ready（探针 new-runtime-drift）', () => {
    const result = planControlledRestart(baseInput({
      start: {
        process: { kind: 'success' },
        health: { kind: 'success', runId: 'run-new', pid: 5151 },
        target: { runId: 'run-new', pid: 5151, port: 9999, origin: 'http://127.0.0.1:9999' },
      },
    }))
    expect(result.phase).toBe('blocked-runtime-mismatch')
    expect(result.phase).not.toBe('ready')
  })

  it('新目标身份非法（空 runId/PID=0/端口 0）阻断，绝不 ready（探针 invalid-new-identity）', () => {
    for (const target of [
      { runId: '', pid: 0, port: 8787, origin: 'http://127.0.0.1:8787' },
      { runId: 'run-new', pid: 0, port: 8787, origin: 'http://127.0.0.1:8787' },
      { runId: 'run-new', pid: 5151, port: 0, origin: 'http://127.0.0.1:0' },
      { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:9999' },
    ]) {
      const result = planControlledRestart(baseInput({
        start: {
          process: { kind: 'success' },
          health: { kind: 'success', runId: target.runId, pid: target.pid },
          target,
        },
      }))
      expect(result.phase).not.toBe('ready')
    }
  })

  it('新目标 runId 必须不同于旧 runId', () => {
    const result = planControlledRestart(baseInput({
      start: {
        process: { kind: 'success' },
        health: { kind: 'success', runId: 'run-old', pid: 5151 },
        target: { runId: 'run-old', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' },
      },
    }))
    expect(result.phase).toBe('blocked-identity')
    expect(result.reason).toContain('不同于旧 runId')
  })

  it('保存 pending 只是未完成（不进入停止阶段）；failure 保留旧配置阻断', () => {
    const pending = planControlledRestart(baseInput({ saveNewSource: { kind: 'pending' } }))
    expect(pending.phase).toBe('validate')
    expect(pending.action).toBe('save-new-source')
    expect(pending.retainOldState).toBe(true)

    const failed = planControlledRestart(
      baseInput({ saveNewSource: { kind: 'failure', detail: '磁盘写入失败' } }),
    )
    expect(failed.phase).toBe('blocked-save-failed')
    expect(failed.action).toBe('abort')
  })
})

describe('planControlledRestart: 停止阶段（drain/SIGTERM/SIGKILL 有限生命周期）', () => {
  it('drain pending 保留旧状态，绝不提前放弃（探针 drain-pending-retains-state）', () => {
    const result = planControlledRestart(baseInput({
      stop: {
        drain: { kind: 'pending' },
        sigtermSent: false,
        sigtermDeadlineExceeded: false,
        oldExit: { kind: 'pending' },
        sigkillSent: false,
      },
      start: { process: { kind: 'pending' }, health: { kind: 'pending' }, target: { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' } },
    }))
    expect(result.phase).toBe('drain')
    expect(result.action).toBe('wait-drain')
    expect(result.retainOldState).toBe(true)
  })

  it('drain 超期是终态：放弃本轮重启并保留旧状态', () => {
    const result = planControlledRestart(baseInput({
      stop: {
        drain: { kind: 'timeout' },
        sigtermSent: false,
        sigtermDeadlineExceeded: false,
        oldExit: { kind: 'alive' },
        sigkillSent: false,
      },
    }))
    expect(result.phase).toBe('drain-timeout')
    expect(result.action).toBe('keep-old-state')
    expect(result.retainOldState).toBe(true)
  })

  it('drain 完成但 SIGTERM 未发：只建议发送，不声称已发', () => {
    const result = planControlledRestart(baseInput({
      stop: {
        drain: { kind: 'success' },
        sigtermSent: false,
        sigtermDeadlineExceeded: false,
        oldExit: { kind: 'alive' },
        sigkillSent: false,
      },
    }))
    expect(result.phase).toBe('send-sigterm')
    expect(result.action).toBe('send-sigterm')
    expect(result.reason).not.toContain('已执行')
  })

  it('SIGTERM 已发且 deadline 未到：等待退出探测', () => {
    const result = planControlledRestart(baseInput({
      stop: {
        drain: { kind: 'success' },
        sigtermSent: true,
        sigtermDeadlineExceeded: false,
        oldExit: { kind: 'alive' },
        sigkillSent: false,
      },
    }))
    expect(result.phase).toBe('sigterm-wait')
    expect(result.action).toBe('await-old-exit')
    expect(result.retainOldState).toBe(true)
  })

  it('SIGTERM 超期但探测 pending：继续等待，不推断 SIGKILL 已执行', () => {
    const result = planControlledRestart(baseInput({
      stop: {
        drain: { kind: 'success' },
        sigtermSent: true,
        sigtermDeadlineExceeded: true,
        oldExit: { kind: 'pending' },
        sigkillSent: false,
      },
    }))
    expect(result.phase).toBe('sigterm-wait')
    expect(result.retainOldState).toBe(true)
  })

  it('SIGTERM 超期且探测 unknown：old-exit-unconfirmed 终态，不发信号不启动', () => {
    const result = planControlledRestart(baseInput({
      stop: {
        drain: { kind: 'success' },
        sigtermSent: true,
        sigtermDeadlineExceeded: true,
        oldExit: { kind: 'unknown', detail: '进程查询失败' },
        sigkillSent: false,
      },
    }))
    expect(result.phase).toBe('old-exit-unconfirmed')
    expect(result.action).toBe('keep-old-state')
  })

  it('deadline 到期且旧服务确认仍在：仅允许一次 SIGKILL，且不声称已执行（探针 grace-expired-does-not-prove-kill）', () => {
    const result = planControlledRestart(baseInput({
      stop: {
        drain: { kind: 'success' },
        sigtermSent: true,
        sigtermDeadlineExceeded: true,
        oldExit: { kind: 'alive' },
        sigkillSent: false,
      },
      start: { process: { kind: 'pending' }, health: { kind: 'pending' }, target: { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' } },
    }))
    expect(result.phase).toBe('sigterm-deadline')
    expect(result.action).toBe('send-sigkill-once')
    expect(result.reason).toContain('允许执行一次')
    expect(result.reason).not.toContain('已执行')
  })

  it('SIGKILL 已发仍存活：old-exit-unconfirmed，不循环杀进程', () => {
    const result = planControlledRestart(baseInput({
      stop: {
        drain: { kind: 'success' },
        sigtermSent: true,
        sigtermDeadlineExceeded: true,
        oldExit: { kind: 'alive' },
        sigkillSent: true,
      },
    }))
    expect(result.phase).toBe('old-exit-unconfirmed')
    expect(result.action).toBe('keep-old-state')
  })

  it('旧服务在 drain 后自行退出（未发 SIGTERM）：直接进入启动计划', () => {
    const result = planControlledRestart(baseInput({
      stop: {
        drain: { kind: 'success' },
        sigtermSent: false,
        sigtermDeadlineExceeded: false,
        oldExit: { kind: 'exited' },
        sigkillSent: false,
      },
      start: {
        process: { kind: 'pending' },
        health: { kind: 'pending' },
        target: { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' },
      },
    }))
    expect(result.phase).toBe('new-start')
  })
})

describe('planControlledRestart: 启动、健康与回滚', () => {
  it('启动 pending 只是等待：绝不 rolled-back、绝不 new-start-failed（探针 not-started-is-not-rolled-back）', () => {
    const result = planControlledRestart(baseInput({
      start: {
        process: { kind: 'pending' },
        health: { kind: 'pending' },
        target: { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' },
      },
    }))
    expect(result.phase).toBe('new-start')
    expect(result.action).toBe('start-new-server')
    expect(result.phase).not.toBe('rolled-back')
    expect(result.phase).not.toBe('new-start-failed')
    expect(result.retainOldState).toBe(true)
  })

  it('启动确认失败：new-start-failed + 恢复旧配置建议，但不自称已回滚', () => {
    const result = planControlledRestart(baseInput({
      start: {
        process: { kind: 'failure', detail: '端口绑定失败' },
        health: { kind: 'pending' },
        target: { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' },
      },
    }))
    expect(result.phase).toBe('new-start-failed')
    expect(result.action).toBe('restore-old-config')
    expect(result.reason).toContain('尚未确认恢复完成')
  })

  it('健康探测 pending 是等待；unknown/非法/不匹配 都 new-start-failed，绝不 ready', () => {
    const target = { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' }
    const awaiting = planControlledRestart(baseInput({
      start: { process: { kind: 'success' }, health: { kind: 'pending' }, target },
    }))
    expect(awaiting.phase).toBe('new-start')
    expect(awaiting.action).toBe('await-new-health')
    for (const health of [
      { kind: 'unknown', detail: '健康端点超时' },
      { kind: 'success', runId: '', pid: 0 },
      { kind: 'success', runId: 'run-other', pid: 5151 },
      { kind: 'success', runId: 'run-new', pid: 9999 },
    ] as const) {
      const result = planControlledRestart(baseInput({
        start: { process: { kind: 'success' }, health: health as never, target },
      }))
      expect(result.phase).toBe('new-start-failed')
      expect(result.retainOldState).toBe(true)
    }
  })

  it('仅 restore 确认成功后才可 rolled-back，否则保留 new-start-failed', () => {
    const failed = baseInput({
      start: {
        process: { kind: 'failure', detail: '端口绑定失败' },
        health: { kind: 'pending' },
        target: { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' },
      },
    })
    const before = planControlledRestart(failed)
    expect(before.phase).toBe('new-start-failed')
    expect(before.phase).not.toBe('rolled-back')

    const after = planControlledRestart({
      ...failed,
      rollback: { restore: { kind: 'success' } },
    })
    expect(after.phase).toBe('rolled-back')
    expect(after.action).toBe('keep-old-state')
    expect(after.reason).toContain('已确认恢复旧配置完成')
    expect(after.retainOldState).toBe(true)
  })
})

describe('planControlledRestart: 连续序列与 tdx 继承', () => {
  it('完整成功序列：drain→SIGTERM→超期 SIGKILL→退出确认→启动→健康→ready', () => {
    const target = { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' }
    const seq: RestartPlanResult[] = []
    seq.push(planControlledRestart(baseInput({
      saveNewSource: { kind: 'pending' },
      stop: { drain: { kind: 'pending' }, sigtermSent: false, sigtermDeadlineExceeded: false, oldExit: { kind: 'alive' }, sigkillSent: false },
      start: { process: { kind: 'pending' }, health: { kind: 'pending' }, target },
    })))
    seq.push(planControlledRestart(baseInput({
      stop: { drain: { kind: 'success' }, sigtermSent: false, sigtermDeadlineExceeded: false, oldExit: { kind: 'alive' }, sigkillSent: false },
      start: { process: { kind: 'pending' }, health: { kind: 'pending' }, target },
    })))
    seq.push(planControlledRestart(baseInput({
      stop: { drain: { kind: 'success' }, sigtermSent: true, sigtermDeadlineExceeded: true, oldExit: { kind: 'alive' }, sigkillSent: false },
      start: { process: { kind: 'pending' }, health: { kind: 'pending' }, target },
    })))
    seq.push(planControlledRestart(baseInput({
      stop: { drain: { kind: 'success' }, sigtermSent: true, sigtermDeadlineExceeded: true, oldExit: { kind: 'exited' }, sigkillSent: true },
      start: { process: { kind: 'pending' }, health: { kind: 'pending' }, target },
    })))
    seq.push(planControlledRestart(baseInput({
      stop: { drain: { kind: 'success' }, sigtermSent: true, sigtermDeadlineExceeded: true, oldExit: { kind: 'exited' }, sigkillSent: true },
      start: { process: { kind: 'success' }, health: { kind: 'pending' }, target },
    })))
    seq.push(planControlledRestart(baseInput({
      stop: { drain: { kind: 'success' }, sigtermSent: true, sigtermDeadlineExceeded: true, oldExit: { kind: 'exited' }, sigkillSent: true },
      start: { process: { kind: 'success' }, health: { kind: 'success', runId: 'run-new', pid: 5151 }, target },
    })))
    expect(seq.map(r => r.phase)).toEqual([
      'validate', 'send-sigterm', 'sigterm-deadline', 'new-start', 'new-start', 'ready',
    ])
    for (const r of seq.slice(0, 5)) expect(r.retainOldState).toBe(true)
    expect(seq[5].phase).toBe('ready')
    expect(seq[5].action).toBe('new-source-effective')
    expect(seq[5].retainOldState).toBe(false)
    expect(seq[5].steps[seq[5].steps.length - 1]).toBe('ready')
  })

  it('失败→恢复序列：new-start-failed 后 restore 确认才 rolled-back', () => {
    const target = { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' }
    const first = planControlledRestart(baseInput({
      start: { process: { kind: 'failure', detail: '端口被占用' }, health: { kind: 'pending' }, target },
      rollback: { restore: { kind: 'pending' } },
    }))
    expect(first.phase).toBe('new-start-failed')
    expect(first.action).toBe('restore-old-config')
    const second = planControlledRestart({
      ...baseInput({
        start: { process: { kind: 'failure', detail: '端口被占用' }, health: { kind: 'pending' }, target },
      }),
      rollback: { restore: { kind: 'success' } },
    })
    expect(second.phase).toBe('rolled-back')
    expect(second.retainOldState).toBe(true)
  })

  it('tdx 来源继承：仅 explicit-env 可继承，recalculate 重解析', () => {
    const inherit = planControlledRestart(baseInput({}))
    expect(inherit.tdxInheritance).toBe('explicit-env')
    const recalc = planControlledRestart(baseInput({
      planned: {
        dataDir: 'C:\\data',
        databasePath: 'C:\\data\\trainer.sqlite',
        port: 8787,
        origin: 'http://127.0.0.1:8787',
        tdxRoot: null,
        source: 'recalculate',
      },
    }))
    expect(recalc.phase).toBe('ready')
    expect(recalc.tdxInheritance).toBe('recalculate')
  })

  it('除 ready 外所有相位 retainOldState=true', () => {
    const target = { runId: 'run-new', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' }
    const samples: RestartPlanResult[] = [
      planControlledRestart(baseInput({ activeTrainingId: 1 })),
      planControlledRestart(baseInput({ oldObserved: null })),
      planControlledRestart(baseInput({ saveNewSource: { kind: 'failure', detail: 'x' } })),
      planControlledRestart(baseInput({ saveNewSource: { kind: 'pending' } })),
      planControlledRestart(baseInput({ stop: { drain: { kind: 'pending' }, sigtermSent: false, sigtermDeadlineExceeded: false, oldExit: { kind: 'pending' }, sigkillSent: false } })),
      planControlledRestart(baseInput({ stop: { drain: { kind: 'timeout' }, sigtermSent: false, sigtermDeadlineExceeded: false, oldExit: { kind: 'alive' }, sigkillSent: false } })),
      planControlledRestart(baseInput({ stop: { drain: { kind: 'success' }, sigtermSent: false, sigtermDeadlineExceeded: false, oldExit: { kind: 'alive' }, sigkillSent: false } })),
      planControlledRestart(baseInput({ stop: { drain: { kind: 'success' }, sigtermSent: true, sigtermDeadlineExceeded: true, oldExit: { kind: 'alive' }, sigkillSent: true } })),
      planControlledRestart(baseInput({ start: { process: { kind: 'pending' }, health: { kind: 'pending' }, target } })),
      planControlledRestart(baseInput({ start: { process: { kind: 'failure', detail: 'x' }, health: { kind: 'pending' }, target } })),
    ]
    for (const r of samples) {
      expect(r.phase).not.toBe('ready')
      expect(r.retainOldState).toBe(true)
    }
  })
})
