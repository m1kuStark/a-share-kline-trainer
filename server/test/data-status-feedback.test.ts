import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataStatus } from '../../web/src/api'

const { fetchMock, postMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), postMock: vi.fn() }))

vi.mock('../../web/src/api', () => ({
  fetchDataStatus: fetchMock,
  postDataRefresh: postMock,
}))

function statusBody(overrides: Partial<DataStatus> = {}): DataStatus {
  return {
    state: 'unchanged', needsUpdate: true, reason: '本地日线数据仍待确认',
    source: { kind: 'tdx', name: '测试来源', available: true },
    tdx: { available: true }, online: { configured: false, provider: null },
    sourceMaxDate: '2026-09-24', lastCheckedAt: '2026-09-25T01:00:00.000Z',
    lastResult: {
      finishedAt: '2026-09-25T01:00:00.000Z', outcome: 'unchanged',
      added: 0, removed: 0, revised: 0,
      message: '检查完成：与上次快照一致，暂无新数据',
    },
    revisionWarning: null,
    freshness: {
      state: 'stale', expectedDate: '2026-09-28', sourceMaxDate: '2026-09-24',
      checkedAt: '2026-09-28T07:00:00.000Z',
      reason: '本地日线数据截至 2026-09-24，落后应收收盘日 2026-09-28。',
    },
    calendar: null, ...overrides,
  }
}

async function freshStore(): Promise<typeof import('../../web/src/dataStatus')> {
  vi.resetModules()
  return await import('../../web/src/dataStatus')
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

describe('dataStatus 手动更新反馈', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    postMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('服务端直接返回终态时也发布扫描结果和 freshness 提示', async () => {
    const store = await freshStore()
    postMock.mockResolvedValue({ taskId: 'direct', state: 'unchanged', joined: false })
    fetchMock.mockResolvedValue(statusBody())

    await store.refreshDataNow()
    await flush()

    expect(store.dataOutcomeSeq.value).toBe(1)
    expect(store.dataRefreshOutcome.value).toBe('unchanged')
    expect(store.dataRefreshMessage.value).toContain('检查完成')
    expect(store.dataRefreshMessage.value).toContain('请先在通达信完成盘后数据下载')
    expect(store.dataRefreshError.value).toBe('')
  })

  it('手动 POST 失败时清理旧反馈并保留服务端中文错误', async () => {
    const store = await freshStore()
    store.dataRefreshMessage.value = '上一轮完成'
    postMock.mockRejectedValue(new Error('未检测到可用的日线数据来源'))

    await store.refreshDataNow()

    expect(store.dataRefreshMessage.value).toBe('')
    expect(store.dataRefreshError.value).toBe('未检测到可用的日线数据来源')
    expect(store.dataOutcomeSeq.value).toBe(0)
  })

  it('直接终态后的结果同步失败也向手动操作透出错误', async () => {
    const store = await freshStore()
    postMock.mockResolvedValue({ taskId: 'direct', state: 'updated', joined: false })
    fetchMock.mockRejectedValue(new Error('状态接口无法连接'))

    await store.refreshDataNow()
    await flush()

    expect(store.dataRefreshError.value).toContain('状态接口无法连接')
    expect(store.dataUpdating.value).toBe(false)
  })

  it('直接终态同步遇到 running 时转入轮询，后续普通状态检查不重复发布结果', async () => {
    const store = await freshStore()
    postMock.mockResolvedValue({ taskId: 'direct', state: 'updated', joined: false })
    fetchMock.mockResolvedValueOnce(statusBody({ state: 'running', lastResult: null }))
      .mockResolvedValue(statusBody())

    await store.refreshDataNow()
    await flush()
    expect(store.dataPolling.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(store.dataOutcomeSeq.value).toBe(1)
    await store.checkDataStatus({ force: true })
    expect(store.dataOutcomeSeq.value).toBe(1)
    store.cancelDataWatchers()
  })

  it('后台扫描失败终态将原因暴露为错误反馈', async () => {
    const store = await freshStore()
    postMock.mockResolvedValue({ taskId: 'scan', state: 'running', joined: false })
    fetchMock.mockResolvedValue(statusBody({
      state: 'failed',
      lastResult: {
        finishedAt: '2026-09-28T08:00:00.000Z', outcome: 'failed',
        added: 0, removed: 0, revised: 0, message: '扫描失败：日线文件不可读',
      },
    }))

    await store.refreshDataNow()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(store.dataRefreshOutcome.value).toBe('failed')
    expect(store.dataRefreshError.value).toBe('扫描失败：日线文件不可读')
    expect(store.dataUpdating.value).toBe(false)
    store.cancelDataWatchers()
  })

  it('自动检查关闭时，首次轮询前隐藏的手动任务回前台继续轮询', async () => {
    const visibility = { visibilityState: 'visible' }
    vi.stubGlobal('document', visibility)
    const store = await freshStore()
    const settings = await import('../../web/src/appSettings')
    settings.appAutoDataCheck.value = false
    fetchMock.mockResolvedValue(statusBody())
    await store.checkDataStatus({ force: true, manual: true })
    expect(store.dataStatus.value?.state).toBe('unchanged')

    postMock.mockResolvedValue({ taskId: 'hidden-manual', state: 'running', joined: false })
    await store.refreshDataNow()
    visibility.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.dataPolling.value).toBe(true)

    visibility.visibilityState = 'visible'
    store.onDataActive()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(store.dataPolling.value).toBe(false)
    expect(store.dataOutcomeSeq.value).toBe(1)
    expect(store.dataRefreshMessage.value).toContain('检查完成')
    store.cancelDataWatchers()
  })

  it('直接终态同步被隐藏打断时，回前台仍补读并发布反馈', async () => {
    const visibility = { visibilityState: 'visible' }
    vi.stubGlobal('document', visibility)
    const store = await freshStore()
    const settings = await import('../../web/src/appSettings')
    settings.appAutoDataCheck.value = false
    postMock.mockResolvedValue({ taskId: 'hidden-terminal', state: 'updated', joined: false })
    fetchMock.mockResolvedValue(statusBody({ state: 'updated', lastResult: { ...statusBody().lastResult!, outcome: 'updated', message: '更新完成' } }))
    visibility.visibilityState = 'hidden'
    const pending = store.refreshDataNow()
    await flush()
    await pending
    expect(fetchMock).not.toHaveBeenCalled()
    visibility.visibilityState = 'visible'
    store.onDataActive()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.dataRefreshMessage.value).toContain('更新完成')
    expect(store.dataOutcomeSeq.value).toBe(1)
    store.cancelDataWatchers()
  })
})
