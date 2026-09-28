// SETUP-DRAIN-01（control-handoff-20260927-30）：drain-controller 单元测试。
// 覆盖：gate 开关与 503 语义、在途租约真实等待、排空预算超时、同 attempt 重复 prepare
// 不延长租约、活动训练同步复查、cancel 幂等与竞态（迟到事件不复活）、prepared 租约到期、
// closing 终态稳定、后台任务来源纳入排空。定时预算用短真实毫秒，避免假时钟失步。
import { describe, expect, it } from 'vitest'
import { createDrainController } from '../src/setup/drain-controller.js'

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function make(overrides: Parameters<typeof createDrainController>[0] = {}): ReturnType<typeof createDrainController> {
  return createDrainController({ drainBudgetMs: 60, preparedLeaseMs: 120, ...overrides })
}

describe('drain controller: gate 与 prepare', () => {
  it('gate 初始开放；prepared 后关闭，业务 admit 被拒', async () => {
    const controller = make()
    expect(controller.gate.isOpen()).toBe(true)
    const probe = controller.gate.admit()
    expect(probe.ok).toBe(true)
    if (probe.ok) probe.release()
    const outcome = await controller.prepare('a1')
    expect(outcome.kind).toBe('prepared')
    expect(controller.gate.isOpen()).toBe(false)
    expect(controller.gate.admit().ok).toBe(false)
    controller.gate.close()
  })

  it('在途 handler 未释放时 prepare 等待真实完成；释放后才 prepared', async () => {
    const controller = make()
    const lease = controller.gate.admit()
    expect(lease.ok).toBe(true)
    let settled = false
    const pending = controller.prepare('a1').then(o => { settled = true; return o })
    await delay(30)
    expect(settled).toBe(false)
    if (lease.ok) lease.release()
    const outcome = await pending
    expect(outcome.kind).toBe('prepared')
    controller.gate.close()
  })

  it('排空预算到期 → drain-timeout，gate 重新开放；迟到 release 不复活；同 id 重放同结果', async () => {
    const controller = make({ drainBudgetMs: 40 })
    const lease = controller.gate.admit()
    const pending = controller.prepare('a1')
    await delay(120)
    const outcome = await pending
    expect(outcome.kind).toBe('drain-timeout')
    expect(controller.gate.isOpen()).toBe(true)
    if (lease.ok) lease.release()
    await delay(10)
    const replay = await controller.prepare('a1')
    expect(replay.kind).toBe('drain-timeout')
    expect(controller.gate.isOpen()).toBe(true)
  })

  it('同 attempt 重复 prepare 共用结果且不延长租约', async () => {
    const controller = make({ preparedLeaseMs: 5_000 })
    const first = await controller.prepare('a1')
    expect(first.kind).toBe('prepared')
    const expiresAt = first.kind === 'prepared' ? first.leaseExpiresAtMs : 0
    await delay(20)
    const again = await controller.prepare('a1')
    expect(again.kind).toBe('prepared')
    expect(again.kind === 'prepared' ? again.leaseExpiresAtMs : -1).toBe(expiresAt)
    controller.gate.close()
  })

  it('draining 中重复 prepare 加入等待并得到相同结果', async () => {
    const controller = make()
    const lease = controller.gate.admit()
    const first = controller.prepare('a1')
    const second = controller.prepare('a1')
    await delay(20)
    if (lease.ok) lease.release()
    const o1 = await first
    const o2 = await second
    expect(o1.kind).toBe('prepared')
    expect(o2.kind).toBe('prepared')
    expect(o1.kind === 'prepared' && o2.kind === 'prepared'
      ? o1.leaseExpiresAtMs === o2.leaseExpiresAtMs
      : false).toBe(true)
    controller.gate.close()
  })

  it('其他 attempt 在排空期 → busy', async () => {
    const controller = make()
    const lease = controller.gate.admit()
    void controller.prepare('a1')
    await delay(10)
    const other = await controller.prepare('b2')
    expect(other.kind).toBe('busy')
    controller.cancel('a1')
    controller.gate.close()
  })

  it('活动训练存在时 prepare → active-training 且 gate 保持开放', async () => {
    const controller = make({ getActiveTraining: () => ({ id: 7 }) })
    const outcome = await controller.prepare('a1')
    expect(outcome.kind).toBe('active-training')
    expect(controller.gate.isOpen()).toBe(true)
    const probe = controller.gate.admit()
    expect(probe.ok).toBe(true)
    if (probe.ok) probe.release()
  })

  it('排空期间出现活动训练 → 撤销接纳并 active-training；同 id 重放该结果', async () => {
    let active: { id: number } | null = null
    const controller = make({ getActiveTraining: () => active })
    const lease = controller.gate.admit()
    const pending = controller.prepare('a1')
    await delay(10)
    active = { id: 3 }
    if (lease.ok) lease.release()
    const outcome = await pending
    expect(outcome.kind).toBe('active-training')
    expect(controller.gate.isOpen()).toBe(true)
    const replay = await controller.prepare('a1')
    expect(replay.kind).toBe('active-training')
  })
})

describe('drain controller: cancel 幂等与竞态', () => {
  it('cancel 排空中 → cancelled；gate 重开；迟到 release 不复活；同 id 重放 cancelled', async () => {
    const controller = make()
    const lease = controller.gate.admit()
    const pending = controller.prepare('a1')
    await delay(10)
    expect(controller.cancel('a1').kind).toBe('cancelled')
    const outcome = await pending
    expect(outcome.kind).toBe('cancelled')
    expect(controller.gate.isOpen()).toBe(true)
    if (lease.ok) lease.release()
    await delay(10)
    const replay = await controller.prepare('a1')
    expect(replay.kind).toBe('cancelled')
  })

  it('cancel prepared → cancelled；重复 cancel 幂等', async () => {
    const controller = make()
    await controller.prepare('a1')
    expect(controller.cancel('a1').kind).toBe('cancelled')
    expect(controller.gate.isOpen()).toBe(true)
    expect(controller.cancel('a1').kind).toBe('cancelled')
  })

  it('cancel 未知 id 或其他 attempt → mismatch', async () => {
    const controller = make()
    expect(controller.cancel('nope').kind).toBe('mismatch')
    const lease = controller.gate.admit()
    void controller.prepare('a1')
    await delay(10)
    expect(controller.cancel('b2').kind).toBe('mismatch')
    controller.cancel('a1')
    controller.gate.close()
  })
})

describe('drain controller: prepared 租约与 closing 终态', () => {
  it('租约到期自动撤销 → expired；gate 重开；shutdown → not-prepared；cancel → mismatch', async () => {
    const controller = make({ preparedLeaseMs: 60 })
    const outcome = await controller.prepare('a1')
    expect(outcome.kind).toBe('prepared')
    await delay(120)
    expect(controller.gate.isOpen()).toBe(true)
    expect(controller.beginShutdown('a1').kind).toBe('not-prepared')
    expect(controller.cancel('a1').kind).toBe('mismatch')
  })

  it('shutdown prepared → closing；gate 保持关闭；cancel → closing；重复 shutdown → closing；prepare → closing', async () => {
    const controller = make()
    await controller.prepare('a1')
    expect(controller.gate.isOpen()).toBe(false)
    expect(controller.beginShutdown('a1').kind).toBe('closing')
    expect(controller.gate.isOpen()).toBe(false)
    expect(controller.cancel('a1').kind).toBe('closing')
    expect(controller.beginShutdown('a1').kind).toBe('closing')
    expect(await controller.prepare('a1')).toMatchObject({ kind: 'closing' })
  })

  it('shutdown draining → not-prepared', async () => {
    const controller = make()
    const lease = controller.gate.admit()
    void controller.prepare('a1')
    await delay(10)
    expect(controller.beginShutdown('a1').kind).toBe('not-prepared')
    controller.cancel('a1')
    controller.gate.close()
  })

  it('close() 清理定时器：prepared 后实例关闭，租约到期不再触发撤销', async () => {
    const controller = make({ preparedLeaseMs: 60 })
    await controller.prepare('a1')
    controller.gate.close()
    await delay(140)
    expect(controller.gate.isOpen()).toBe(false)
  })
})

describe('drain controller: 后台任务来源纳入排空', () => {
  it('已返回 202 的后台刷新任务未完成时不能 prepared；完成后才放行', async () => {
    const controller = make()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    controller.gate.registerTaskSource(() => [gate])
    let settled = false
    const pending = controller.prepare('a1').then(o => { settled = true; return o })
    await delay(30)
    expect(settled).toBe(false)
    release()
    const outcome = await pending
    expect(outcome.kind).toBe('prepared')
    controller.gate.close()
  })
})
