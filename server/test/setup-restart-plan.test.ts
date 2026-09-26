// 受控重启安全计划（SETUP-RESTART-PLAN-01 冻结合同）：纯函数，无副作用——
// 不启动进程、不发信号、不写配置、不碰用户数据库；只产出不可变的阶段/动作/
// 原因与是否保留旧状态。未知测量一律不算成功。
import { describe, expect, it } from 'vitest'
import {
  planControlledRestart,
  type RestartPlanInput,
  type RestartPlanResult,
} from '../src/setup/restart-plan'

function baseInput(overrides: Partial<RestartPlanInput> = {}): RestartPlanInput {
  return {
    activeTrainingId: null,
    saveSucceeded: true,
    oldRun: {
      runId: 'run-aaaa',
      pid: 4242,
      port: 8787,
      databasePath: 'C:\\data\\trainer.sqlite',
      origin: 'http://127.0.0.1:8787',
      dataDir: 'C:\\data',
    },
    planned: {
      dataDir: 'C:\\data',
      databasePath: 'C:\\data\\trainer.sqlite',
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      tdxRoot: 'D:\\new_tdx',
      source: 'explicit-env',
    },
    stop: { drainCompleted: true, sigtermDeadlineExceeded: false, oldExitConfirmed: true },
    start: { started: true, healthRunId: 'run-bbbb', healthPid: 5151 },
    newRun: { runId: 'run-bbbb', pid: 5151, port: 8787, origin: 'http://127.0.0.1:8787' },
    ...overrides,
  }
}

describe('planControlledRestart: guards', () => {
  it('blocks with retained old state while a training is active', () => {
    const result: RestartPlanResult = planControlledRestart(
      baseInput({ activeTrainingId: 7 }),
    )
    expect(result.phase).toBe('blocked-active-training')
    expect(result.retainOldState).toBe(true)
    expect(result.action).toBe('abort')
  })

  it('blocks on incomplete or mismatched old-run identity', () => {
    for (const oldRun of [
      { ...baseInput({}).oldRun!, runId: '' },
      { ...baseInput({}).oldRun!, pid: 0 },
      { ...baseInput({}).oldRun!, pid: -1 },
      { ...baseInput({}).oldRun!, pid: 1.5 },
      { ...baseInput({}).oldRun!, port: 0 },
      { ...baseInput({}).oldRun!, databasePath: '' },
      { ...baseInput({}).oldRun!, origin: 'http://127.0.0.1:9999' },
    ]) {
      const result = planControlledRestart(baseInput({ oldRun }))
      expect(result.phase).toBe('blocked-identity')
      expect(result.retainOldState).toBe(true)
    }
  })

  it('blocks when planned runtime deviates from the old run', () => {
    const base = baseInput({})
    for (const planned of [
      { ...base.planned, dataDir: 'C:\\other' },
      { ...base.planned, databasePath: 'C:\\other\\trainer.sqlite' },
      { ...base.planned, port: 8788 },
      { ...base.planned, origin: 'http://127.0.0.1:8788' },
    ]) {
      const result = planControlledRestart(baseInput({ planned }))
      expect(result.phase).toBe('blocked-runtime-mismatch')
      expect(result.retainOldState).toBe(true)
    }
  })

  it('blocks with retained old state when saving the new source failed', () => {
    const result = planControlledRestart(baseInput({ saveSucceeded: false }))
    expect(result.phase).toBe('blocked-save-failed')
    expect(result.retainOldState).toBe(true)
    expect(result.action).toBe('abort')
  })
})

describe('planControlledRestart: stop phases', () => {
  it('plans drain then SIGTERM while the deadline has not been exceeded', () => {
    const result = planControlledRestart(baseInput({
      stop: { drainCompleted: false, sigtermDeadlineExceeded: false, oldExitConfirmed: true },
    }))
    expect(result.phase).toBe('drain')
    expect(result.action).toBe('send-sigterm-after-drain')
    expect(result.retainOldState).toBe(false)
  })

  it('plans SIGKILL fallback only after the SIGTERM deadline', () => {
    const result = planControlledRestart(baseInput({
      // deadline 期旧服务退出尚未确认：此刻计划 SIGKILL fallback，确认前保留旧状态
      stop: { drainCompleted: true, sigtermDeadlineExceeded: true, oldExitConfirmed: false },
    }))
    expect(result.phase).toBe('sigterm-deadline')
    expect(result.action).toBe('send-sigkill-fallback')
    // deadline 期 SIGKILL 尚未确认旧服务退出：保留旧状态直至确认
    expect(result.retainOldState).toBe(true)
  })

  it('reports old-exit-unconfirmed and retains old state when exit cannot be confirmed', () => {
    const result = planControlledRestart(baseInput({
      stop: { drainCompleted: true, sigtermDeadlineExceeded: false, oldExitConfirmed: false },
    }))
    expect(result.phase).toBe('old-exit-unconfirmed')
    expect(result.retainOldState).toBe(true)
    expect(result.action).toBe('keep-old-state')
  })
})

describe('planControlledRestart: start phases and success', () => {
  it('marks new-start-failed when the new server started but its health runId does not match', () => {
    const result = planControlledRestart(baseInput({
      start: { started: true, healthRunId: 'run-other', healthPid: 5151 },
    }))
    expect(result.phase).toBe('new-start-failed')
    expect(result.retainOldState).toBe(true)
  })

  it('marks new-start-failed when the new server health pid does not match', () => {
    const result = planControlledRestart(baseInput({
      start: { started: true, healthRunId: 'run-bbbb', healthPid: 9999 },
    }))
    expect(result.phase).toBe('new-start-failed')
    expect(result.retainOldState).toBe(true)
  })

  it('reaches ready on the full success path', () => {
    const result = planControlledRestart(baseInput({}))
    expect(result.phase).toBe('ready')
    expect(result.retainOldState).toBe(false)
    expect(result.action).toBe('new-source-effective')
  })

  it('rolls back to the old source when the new server did not start after the old exit was confirmed', () => {
    const result = planControlledRestart(baseInput({
      start: { started: false, healthRunId: null, healthPid: null },
    }))
    expect(result.phase).toBe('rolled-back')
    expect(result.retainOldState).toBe(true)
    expect(result.action).toBe('keep-old-state')
  })

  it('proceeds to ready when the SIGKILL fallback completed and the new server is healthy', () => {
    const result = planControlledRestart(baseInput({
      stop: { drainCompleted: true, sigtermDeadlineExceeded: true, oldExitConfirmed: true },
    }))
    expect(result.phase).toBe('ready')
    expect(result.retainOldState).toBe(false)
  })
})

describe('planControlledRestart: tdx source inheritance', () => {
  it('does not inherit auto-discovered sources; they are recalculated for the new run', () => {
    const result = planControlledRestart(baseInput({
      planned: {
        dataDir: 'C:\\data',
        databasePath: 'C:\\data\\trainer.sqlite',
        port: 8787,
        origin: 'http://127.0.0.1:8787',
        tdxRoot: null,
        source: 'recalculate',
      },
    }))
    expect(result.phase).toBe('ready')
    expect(result.tdxInheritance).toBe('recalculate')
  })

  it('inherits only the explicit-env source', () => {
    const result = planControlledRestart(baseInput({
      planned: {
        dataDir: 'C:\\data',
        databasePath: 'C:\\data\\trainer.sqlite',
        port: 8787,
        origin: 'http://127.0.0.1:8787',
        tdxRoot: 'D:\\env_tdx',
        source: 'explicit-env',
      },
    }))
    expect(result.phase).toBe('ready')
    expect(result.tdxInheritance).toBe('explicit-env')
    expect(result.steps).not.toContain('blocked-runtime-mismatch')
  })
})
