import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

const SAMPLE = { code: '300857', startDate: '2026-04-15' }

function freshness(state: 'current' | 'stale'): Record<string, unknown> {
  return {
    state,
    expectedDate: state === 'current' ? '2026-09-24' : '2026-09-28',
    sourceMaxDate: '2026-09-24', checkedAt: '2026-09-28T07:00:00.000Z',
    reason: state === 'current'
      ? '官方日历确认当前数据已达到应收交易日。'
      : '本地日线数据截至 2026-09-24，落后应收收盘日 2026-09-28。',
  }
}

function statusPayload(overrides: Record<string, unknown> = {}, fresh = freshness('current')): string {
  return JSON.stringify({
    state: 'unchanged', needsUpdate: false, reason: '本地数据与数据源一致',
    source: { kind: 'tdx', name: '通达信本地数据', available: true },
    tdx: { available: true }, online: { configured: false, provider: null },
    sourceMaxDate: '2026-09-24', lastCheckedAt: '2026-09-28T07:00:00.000Z',
    lastResult: null, revisionWarning: null, freshness: fresh, calendar: null, ...overrides,
  })
}

async function createTraining(page: Page): Promise<void> {
  const active = await page.request.get('/api/trainings/active')
  const current = (await active.json()).training
  if (current) await page.request.post(`/api/trainings/${current.id}/abandon`)
  const created = await page.request.post('/api/trainings', {
    data: { code: SAMPLE.code, tier: '1M', start_date: SAMPLE.startDate, initial_cash: 1_000_000, blind: false, clock_mode: 'open_close', orders_enabled: true },
  })
  expect(created.status()).toBe(201)
}

async function installStatusRoute(page: Page, initial: string, done: string, postStatus = 202): Promise<{ finish: () => void; refreshCalls: () => number }> {
  let phase: 'initial' | 'running' | 'done' = 'initial'
  let refreshCalls = 0
  await page.route('**/api/data/status', route => {
    const body = phase === 'initial' ? initial : phase === 'running'
      ? statusPayload({ state: 'running', reason: '更新任务进行中' }, freshness('stale')) : done
    return route.fulfill({ status: 200, contentType: 'application/json', body })
  })
  await page.route('**/api/data/refresh', route => {
    refreshCalls += 1
    if (postStatus === 409) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '未检测到可用的日线数据来源' }) })
    phase = 'running'
    return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ taskId: 'feedback-1', state: 'running', joined: false }) })
  })
  return { finish: () => { phase = 'done' }, refreshCalls: () => refreshCalls }
}

test('训练页以 freshness 为准：current 即使 needsUpdate=true 也不显示黄色提醒', async ({ page }) => {
  await createTraining(page)
  const control = await installStatusRoute(
    page,
    statusPayload({ needsUpdate: true }, freshness('current')),
    statusPayload({ needsUpdate: true, lastResult: { finishedAt: '2026-09-28T08:00:00.000Z', outcome: 'unchanged', added: 0, removed: 0, revised: 0, message: '检查完成：与上次快照一致，暂无新数据' } }, freshness('current')),
  )
  await page.goto('/')
  await expect(page.locator('.training-topbar')).toBeVisible()
  await expect(page.locator('.data-refresh-btn')).toBeVisible()
  await expect(page.locator('.data-refresh-btn')).not.toHaveClass(/attention/)
  await page.locator('.data-refresh-btn').click()
  await expect.poll(control.refreshCalls).toBe(1)
  await expect(page.locator('.data-refresh-btn')).toBeDisabled()
  control.finish()
  await expect(page.locator('.mini-update-feedback[role="status"]')).toContainText('检查完成')
  await page.waitForTimeout(2_800)
  await expect(page.locator('.data-refresh-btn')).not.toHaveClass(/attention/)
  await expect(page.locator('.mini-update-feedback[role="status"]')).toContainText('检查完成')
  await page.screenshot({ path: evidencePath('data-update-current-unchanged.png') })
})

test('训练页显示 unchanged 扫描完成及 stale 下一步提示', async ({ page }) => {
  await createTraining(page)
  const control = await installStatusRoute(
    page,
    statusPayload({ needsUpdate: true }, freshness('stale')),
    statusPayload({ state: 'unchanged', needsUpdate: true, lastResult: { finishedAt: '2026-09-28T08:00:00.000Z', outcome: 'unchanged', added: 0, removed: 0, revised: 0, message: '检查完成：与上次快照一致，暂无新数据' } }, freshness('stale')),
  )
  await page.goto('/')
  await expect(page.locator('.data-refresh-btn.attention')).toBeVisible()
  await page.locator('.data-refresh-btn').click()
  await expect.poll(control.refreshCalls).toBe(1)
  await expect(page.locator('.data-refresh-btn')).toBeDisabled()
  control.finish()
  await expect(page.locator('.mini-update-feedback[role="status"]')).toContainText('检查完成')
  await expect(page.locator('.mini-update-feedback[role="status"]')).toContainText('通达信完成盘后数据下载')
  await page.waitForTimeout(2_800)
  await expect(page.locator('.mini-update-feedback[role="status"]')).toBeVisible()
  await page.screenshot({ path: evidencePath('data-update-stale-unchanged.png') })
})

test('训练页将 409 更新失败展示在固定反馈区', async ({ page }) => {
  await createTraining(page)
  const control = await installStatusRoute(page, statusPayload({}, freshness('current')), statusPayload({}, freshness('current')), 409)
  await page.goto('/')
  await page.locator('.data-refresh-btn').click()
  await expect.poll(control.refreshCalls).toBe(1)
  await expect(page.locator('.mini-update-feedback[role="alert"]')).toHaveText('未检测到可用的日线数据来源')
  await page.screenshot({ path: evidencePath('data-update-409-error.png') })
})

test('无变化更新不改布局，随后推进恢复训练状态反馈', async ({ page }) => {
  await createTraining(page)
  const control = await installStatusRoute(
    page,
    statusPayload({}, freshness('current')),
    statusPayload({ lastResult: { finishedAt: '2026-09-28T08:00:00.000Z', outcome: 'unchanged', added: 0, removed: 0, revised: 0, message: '检查完成：与上次快照一致，暂无新数据' } }, freshness('current')),
  )
  await page.goto('/')
  await expect(page.locator('.phase-tag')).toHaveText('开盘阶段')
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const strip = page.locator('.status-strip')
  const chart = page.locator('.chart-host')
  const stripBefore = await strip.boundingBox()
  const chartBefore = await chart.boundingBox()
  expect(stripBefore).not.toBeNull()
  expect(chartBefore).not.toBeNull()

  await page.locator('.data-refresh-btn').click()
  await expect.poll(control.refreshCalls).toBe(1)
  await expect(page.locator('.data-refresh-btn')).toBeDisabled()
  control.finish()
  await expect(page.locator('.mini-update-feedback[role="status"]')).toContainText('检查完成')
  const stripAfter = await strip.boundingBox()
  const chartAfter = await chart.boundingBox()
  expect(stripAfter?.height).toBe(stripBefore?.height)
  expect(chartAfter).toEqual(chartBefore)
  await page.screenshot({ path: evidencePath('data-update-layout-preserved.png') })

  const advanced = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/next')
    && response.request().method() === 'POST')
  await page.getByRole('button', { name: '推进下一日' }).click()
  expect((await advanced).status()).toBe(200)
  await expect(page.locator('.phase-tag')).toHaveText('收盘阶段')
  await expect(strip).toContainText(/推进至 \d{4}-\d{2}-\d{2}，收盘 \d/)
  await expect(page.locator('.mini-update-feedback')).toHaveCount(0)
  await page.screenshot({ path: evidencePath('data-update-advance-status-restored.png') })
})
