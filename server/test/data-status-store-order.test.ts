import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataStatus } from '../../web/src/api'

// 真实异步乱序行为测试（GPT-WAKE-02 修复项1）：dataStatus store 的 60s ticker（廉价检查）
// 与 running 轮询共用 checkSeq。任何一个"更新"的检查先返回终态时，必须终止轮询循环并
// 触发一次轻提示；旧 poll 响应过期被丢弃时必须补排程继续循环——否则 UI 永久卡在"更新中"。
// 用受控 deferred promise 模拟响应乱序与假定时器驱动真实代码路径，不依赖源码正则。

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock('../../web/src/api', () => ({
  fetchDataStatus: fetchMock,
  postDataRefresh: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(innerResolve => { resolve = innerResolve })
  return { promise, resolve }
}

type Pending = ReturnType<typeof deferred<DataStatus>>

function statusBody(overrides: Partial<DataStatus> = {}): DataStatus {
  return {
    state: 'unchanged',
    needsUpdate: false,
    reason: '测试状态',
    source: { kind: 'tdx', name: '测试来源', available: true },
    tdx: { available: true },
    online: { configured: false, provider: null },
    sourceMaxDate: '2026-09-24',
    lastCheckedAt: '2026-09-25T01:00:00.000Z',
    lastResult: { finishedAt: '2026-09-25T01:00:00.000Z', outcome: 'unchanged', added: 0, removed: 0, revised: 0, message: '检查完成' },
    revisionWarning: null,
    freshness: { state: 'current', expectedDate: '2026-09-24', sourceMaxDate: '2026-09-24', checkedAt: '2026-09-25T01:00:00.000Z', reason: '测试' },
    calendar: null,
    ...overrides,
  }
}

function runningStatus(): DataStatus {
  return statusBody({ state: 'running', lastResult: null })
}

/** 排空微任务队列：让被 resolve 的 fetch 响应走完 store 内的后续处理 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

async function freshStore(): Promise<typeof import('../../web/src/dataStatus')> {
  vi.resetModules()
  return await import('../../web/src/dataStatus')
}

/** 场景基座：启动检查返回 running → 进入轮询；再驱动出一个在途 poll 与一个在途 ticker 检查 */
async function seedPollingWithOverlap(): Promise<{ store: Awaited<ReturnType<typeof freshStore>>; queue: Pending[] }> {
  const store = await freshStore()
  store.startStatusTicker()
  const queue: Pending[] = []
  fetchMock.mockImplementation(() => {
    const pending = deferred<DataStatus>()
    queue.push(pending)
    return pending.promise
  })
  void store.checkDataStatus({ force: true })
  await flush()
  queue[0]!.resolve(runningStatus())
  await flush()
  expect(store.dataPolling.value).toBe(true)
  vi.advanceTimersByTime(1_000) // poll 请求（在途）
  vi.advanceTimersByTime(60_000) // ticker 请求（在途）
  expect(fetchMock).toHaveBeenCalledTimes(3)
  return { store, queue }
}

describe('dataStatus store 乱序行为（GPT-WAKE-02）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticker 终态先到、旧 poll 响应后到：轮询循环必须终止并触发一次轻提示（不卡"更新中"）', async () => {
    const { store, queue } = await seedPollingWithOverlap()
    // ticker（更新 seq）先返回终态
    queue[2]!.resolve(statusBody())
    await flush()
    expect(store.dataPolling.value).toBe(false)
    expect(store.dataUpdating.value).toBe(false)
    expect(store.dataOutcomeSeq.value).toBe(1)
    // 旧 poll 响应后到（已过期）：不得二次触发轻提示、不得复活轮询
    queue[1]!.resolve(statusBody())
    await flush()
    expect(store.dataOutcomeSeq.value).toBe(1)
    expect(store.dataPolling.value).toBe(false)
    expect(store.dataUpdating.value).toBe(false)
    store.cancelDataWatchers()
  })

  it('poll 终态先到（正常路径）触发一次轻提示；其后到达的 ticker 响应不重复触发', async () => {
    const { store, queue } = await seedPollingWithOverlap()
    // 旧 poll 响应已被 ticker 检查取代（seq 过期，循环交给 ticker 结算）
    queue[1]!.resolve(statusBody())
    await flush()
    // ticker（更新 seq）返回终态：终止轮询并恰好触发一次轻提示
    queue[2]!.resolve(statusBody())
    await flush()
    expect(store.dataPolling.value).toBe(false)
    expect(store.dataUpdating.value).toBe(false)
    expect(store.dataOutcomeSeq.value).toBe(1)
    store.cancelDataWatchers()
  })

  it('ticker 先返回 running 而旧 poll 在途：旧 poll 过期后必须补排程继续循环，最终终态落地', async () => {
    const { store, queue } = await seedPollingWithOverlap()
    queue[2]!.resolve(runningStatus())
    await flush()
    // ticker 报 running，轮询循环仍标记激活
    expect(store.dataPolling.value).toBe(true)
    // 旧 poll 过期返回 running：必须补排程，循环继续而不是卡死
    queue[1]!.resolve(runningStatus())
    await flush()
    vi.advanceTimersByTime(1_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    queue[3]!.resolve(statusBody())
    await flush()
    expect(store.dataPolling.value).toBe(false)
    expect(store.dataOutcomeSeq.value).toBe(1)
    expect(store.dataUpdating.value).toBe(false)
    store.cancelDataWatchers()
  })

  it('普通廉价检查（无轮询在跑）到达终态：不触发轻提示序号', async () => {
    const store = await freshStore()
    store.startStatusTicker()
    fetchMock.mockResolvedValue(statusBody())
    void store.checkDataStatus({ force: true })
    await flush()
    expect(store.dataPolling.value).toBe(false)
    expect(store.dataOutcomeSeq.value).toBe(0)
    expect(store.dataChecking.value).toBe(false)
    store.cancelDataWatchers()
  })
})
