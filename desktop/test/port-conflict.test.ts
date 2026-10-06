// PACK-02（DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK / DESKTOP-PORT-CONFLICT-TRAINER-ASK）：
// 端口决策层。oracle 独立性：全部期望手写自 scripts/release/launcher.cjs 冻结语义
// （isTrainerHealth 三字段身份、findFallbackPort preferred+1 起向上 40 次、reuse 复核不启
// 第二进程、restart 复核 pid 一致才杀、--conflict-answer 可注入）＋PACK-02 派发简报决策③
// （新增 cancel 应答）；探测全部注入桩，不依赖真实网络。
import { describe, expect, it } from 'vitest'
import {
  isTrainerHealthBody,
  parseConflictAnswerEnv,
  pickFallbackPort,
  portFallbackEnvValue,
  portUnavailableReason,
  resolvePortPlan,
  type BindState,
  type HealthProbe,
  type PortPlanDeps,
} from '../src/port-conflict.js'

const TRAINER_OK = { status: 'ok', runId: 'run-occupant', pid: 4321 }

function trainerProbe(json: unknown = TRAINER_OK): HealthProbe {
  return { responded: true, refused: false, status: 200, json }
}

function refusedProbe(): HealthProbe {
  return { responded: false, refused: true, status: null, json: null }
}

function bindOk(): BindState {
  return { ok: true }
}

function bindBusy(code = 'EADDRINUSE'): BindState {
  return { ok: false, code }
}

interface DepOverrides extends Partial<PortPlanDeps> {
  health?: HealthProbe
  rechecks?: HealthProbe[]
  bindResults?: Map<number, BindState> | BindState
}

/** 组装注入桩 deps：health 首探＋rechecks 序列、bindResults 按端口映射或单值。 */
function makeDeps(overrides: DepOverrides = {}): PortPlanDeps & { boundPorts: number[]; asked: number } {
  const { health = refusedProbe(), rechecks = [], bindResults = bindOk() } = overrides
  const probeQueue = [health, ...rechecks]
  const boundPorts: number[] = []
  let asked = 0
  const deps: PortPlanDeps & { boundPorts: number[]; asked: number } = {
    boundPorts,
    asked,
    probeHealth: async () => probeQueue.shift() ?? refusedProbe(),
    bindCheck: async (port: number) => {
      boundPorts.push(port)
      if (bindResults instanceof Map) return bindResults.get(port) ?? bindOk()
      return bindResults
    },
    askConflict: async occupant => {
      deps.asked += 1
      return overrides.askConflict ? overrides.askConflict(occupant) : 'cancel'
    },
    killOccupant: overrides.killOccupant ?? (async () => ({ exited: true })),
  }
  return deps
}

describe('DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK：非训练器占用自动换端口（PORT-01）', () => {
  it('DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK: a free port starts on the desired port with no fallback', async () => {
    const deps = makeDeps({ health: refusedProbe(), bindResults: bindOk() })
    const plan = await resolvePortPlan(8787, deps)
    expect(plan).toEqual({ action: 'start', port: 8787, fallback: null })
    expect(deps.boundPorts).toEqual([8787])
  })

  it('DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK: a foreign occupant auto-picks the first bindable nearby port (PORT-01)', async () => {
    // 8787 被非训练器占用（health 应答非训练器身份），8788 也忙，8789 可用
    const busy = new Map<number, BindState>([[8787, bindBusy()], [8788, bindBusy('EACCES')], [8789, bindOk()]])
    const deps = makeDeps({
      health: { responded: true, refused: false, status: 200, json: { status: 'ok' } }, // 无 runId/pid：非训练器
      bindResults: busy,
    })
    const plan = await resolvePortPlan(8787, deps)
    expect(plan).toEqual({ action: 'start', port: 8789, fallback: { from: 8787, reason: 'occupied' } })
    expect(deps.boundPorts[0]).toBe(8787)
  })

  it('DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK: an EACCES bind failure is reported as reason reserved', async () => {
    const deps = makeDeps({ bindResults: new Map([[8787, bindBusy('EACCES')], [8788, bindOk()]]) })
    const plan = await resolvePortPlan(8787, deps)
    expect(plan).toEqual({ action: 'start', port: 8788, fallback: { from: 8787, reason: 'reserved' } })
  })

  it('DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK: exhausted fallback attempts quit with an actionable reason', async () => {
    // 3 次窗口内：8788/8789 忙、8790 可用 → 选中 8790（扫描窗口受 attempts 限制）
    const busy = new Map<number, BindState>([
      [8787, bindBusy()],
      [8788, bindBusy()],
      [8789, bindBusy()],
      [8790, bindOk()],
      [8791, bindOk()],
    ])
    const deps = makeDeps({ bindResults: busy })
    const plan = await resolvePortPlan(8787, { ...deps, fallbackAttempts: 3 })
    expect(plan).toEqual({ action: 'start', port: 8790, fallback: { from: 8787, reason: 'occupied' } })
    // 3 次尝试全忙 → quit，且原因可读（含起始端口）
    const exhausted = makeDeps({ bindResults: bindBusy() })
    const quitPlan = await resolvePortPlan(9000, { ...exhausted, fallbackAttempts: 3 })
    expect(quitPlan).toMatchObject({ action: 'quit' })
    expect((quitPlan as { reason: string }).reason).toContain('9000')
  })

  it('DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK: pickFallbackPort scans preferred+1 upward and stops at the ceiling', async () => {
    // 纯函数档：preferred 自身从不在候选内；越界 65535 停
    const busyBelow = new Set([9001, 9002])
    const picked = await pickFallbackPort(9000, async port => ({ ok: !busyBelow.has(port) }), 5)
    expect(picked).toBe(9003)
    expect(await pickFallbackPort(65535, async () => ({ ok: false }), 5)).toBeNull()
    expect(await pickFallbackPort(9000, async () => ({ ok: false }), 3)).toBeNull()
  })

  it('DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK: portFallbackEnvValue emits the strict from,reason format or empty string', () => {
    expect(portFallbackEnvValue({ from: 8787, reason: 'occupied' })).toBe('8787,occupied')
    expect(portFallbackEnvValue({ from: 8787, reason: 'reserved' })).toBe('8787,reserved')
    expect(portFallbackEnvValue(null)).toBe('')
  })

  it('DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK: portUnavailableReason maps EACCES to reserved and everything else to occupied', () => {
    expect(portUnavailableReason('EACCES')).toBe('reserved')
    expect(portUnavailableReason('EADDRINUSE')).toBe('occupied')
    expect(portUnavailableReason(undefined)).toBe('occupied')
  })
})

describe('DESKTOP-PORT-CONFLICT-TRAINER-ASK：训练器占用三应答（PORT-02 桌面版）', () => {
  it('DESKTOP-PORT-CONFLICT-TRAINER-ASK: isTrainerHealthBody matches launcher identity criteria and tolerates extra fields', () => {
    expect(isTrainerHealthBody(TRAINER_OK)).toBe(true)
    // UPD-01 接线后 health 含 currentVersion——身份判定不受附加字段破坏
    expect(isTrainerHealthBody({ ...TRAINER_OK, currentVersion: '1.2.7', extra: null })).toBe(true)
    expect(isTrainerHealthBody({ status: 'ok', runId: 'r', pid: 1.5 })).toBe(false)
    expect(isTrainerHealthBody({ status: 'ok', pid: 1 })).toBe(false)
    expect(isTrainerHealthBody({ status: 'error', runId: 'r', pid: 1 })).toBe(false)
    expect(isTrainerHealthBody(null)).toBe(false)
    expect(isTrainerHealthBody('ok')).toBe(false)
  })

  it('DESKTOP-PORT-CONFLICT-TRAINER-ASK: parseConflictAnswerEnv accepts reuse|restart|cancel, rejects anything else, null when unset', () => {
    expect(parseConflictAnswerEnv({})).toBeNull()
    expect(parseConflictAnswerEnv({ TRAINER_DESKTOP_CONFLICT_ANSWER: '  ' })).toBeNull()
    expect(parseConflictAnswerEnv({ TRAINER_DESKTOP_CONFLICT_ANSWER: 'reuse' })).toBe('reuse')
    expect(parseConflictAnswerEnv({ TRAINER_DESKTOP_CONFLICT_ANSWER: 'restart' })).toBe('restart')
    expect(parseConflictAnswerEnv({ TRAINER_DESKTOP_CONFLICT_ANSWER: 'cancel' })).toBe('cancel')
    expect(() => parseConflictAnswerEnv({ TRAINER_DESKTOP_CONFLICT_ANSWER: 'yes' })).toThrow(/TRAINER_DESKTOP_CONFLICT_ANSWER/)
  })

  it('DESKTOP-PORT-CONFLICT-TRAINER-ASK: cancel quits without killing the occupant or binding', async () => {
    const deps = makeDeps({ health: trainerProbe(), askConflict: async () => 'cancel' })
    const plan = await resolvePortPlan(8787, deps)
    expect(plan).toMatchObject({ action: 'quit' })
    expect(deps.boundPorts).toEqual([])
    expect(deps.asked).toBe(1)
  })

  it('DESKTOP-PORT-CONFLICT-TRAINER-ASK: reuse with a live occupant loads its URL and never starts a second server', async () => {
    const deps = makeDeps({
      health: trainerProbe(),
      rechecks: [trainerProbe({ status: 'ok', runId: 'run-occupant', pid: 4321 })],
      askConflict: async () => 'reuse',
    })
    const plan = await resolvePortPlan(8787, deps)
    expect(plan).toEqual({
      action: 'reuse',
      port: 8787,
      url: 'http://127.0.0.1:8787',
      occupant: { pid: 4321, port: 8787, runId: 'run-occupant' },
    })
    // reuse＝不启第二个服务：bind 探测（启动前裁决）绝不能被调用
    expect(deps.boundPorts).toEqual([])
  })

  it('DESKTOP-PORT-CONFLICT-TRAINER-ASK: reuse falls back to bind arbitration when the occupant vanished after the answer', async () => {
    const deps = makeDeps({
      health: trainerProbe(),
      rechecks: [refusedProbe()], // 应答期间占用者退出
      askConflict: async () => 'reuse',
      bindResults: bindOk(),
    })
    const plan = await resolvePortPlan(8787, deps)
    expect(plan).toEqual({ action: 'start', port: 8787, fallback: null })
  })

  it('DESKTOP-PORT-CONFLICT-TRAINER-ASK: restart kills a re-verified trainer then starts on the freed port', async () => {
    const killed: number[] = []
    const deps = makeDeps({
      health: trainerProbe(),
      rechecks: [trainerProbe()], // 复核：身份一致（pid 相同）
      askConflict: async () => 'restart',
      killOccupant: async occupant => { killed.push(occupant.pid); return { exited: true } },
      bindResults: bindOk(),
    })
    const plan = await resolvePortPlan(8787, deps)
    expect(killed).toEqual([4321])
    expect(plan).toEqual({ action: 'start', port: 8787, fallback: null })
  })

  it('DESKTOP-PORT-CONFLICT-TRAINER-ASK: restart aborts to quit when the kill fails or the occupant survives', async () => {
    for (const outcome of [{ exited: false, error: 'signal failed' }, { exited: false }]) {
      const deps = makeDeps({
        health: trainerProbe(),
        rechecks: [trainerProbe()],
        askConflict: async () => 'restart',
        killOccupant: async () => outcome,
      })
      const plan = await resolvePortPlan(8787, deps)
      expect(plan).toMatchObject({ action: 'quit' })
      expect(deps.boundPorts).toEqual([])
    }
  })

  it('DESKTOP-PORT-CONFLICT-TRAINER-ASK: restart spares a vanished or identity-changed occupant and binds instead', async () => {
    // 复核发现占用者已消失
    const vanished = makeDeps({
      health: trainerProbe(),
      rechecks: [refusedProbe()],
      askConflict: async () => 'restart',
      bindResults: bindOk(),
    })
    const vanishedPlan = await resolvePortPlan(8787, vanished)
    expect(vanishedPlan).toEqual({ action: 'start', port: 8787, fallback: null })

    // 复核发现身份变化（pid 不同）：绝不杀，落 bind 裁决
    let killCalled = 0
    const changed = makeDeps({
      health: trainerProbe(),
      rechecks: [trainerProbe({ status: 'ok', runId: 'run-other', pid: 9999 })],
      askConflict: async () => 'restart',
      killOccupant: async () => { killCalled += 1; return { exited: true } },
      bindResults: bindOk(),
    })
    const changedPlan = await resolvePortPlan(8787, changed)
    expect(killCalled).toBe(0)
    expect(changedPlan).toEqual({ action: 'start', port: 8787, fallback: null })
  })

  it('DESKTOP-PORT-CONFLICT-TRAINER-ASK: a non-200 or non-trainer health answer never triggers the ask path', async () => {
    // 503 应答（有监听者但非训练器身份）→ 直接 bind 裁决（PORT-01）
    const deps = makeDeps({
      health: { responded: true, refused: false, status: 503, json: { status: 'degraded' } },
      bindResults: new Map([[8787, bindBusy()], [8788, bindOk()]]),
    })
    const plan = await resolvePortPlan(8787, deps)
    expect(plan).toEqual({ action: 'start', port: 8788, fallback: { from: 8787, reason: 'occupied' } })
    expect(deps.asked).toBe(0)
  })
})
