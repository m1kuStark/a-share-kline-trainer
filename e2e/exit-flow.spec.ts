// REL-LAUNCH-UX-01 保存并退出：浏览器 journey（全部走路由 mock，不依赖真实后端）。
// 覆盖：单标签保存→排空→端口不可达判"已退出"；另一页面确认/拒绝；刷新不误停由
// 服务端会话续约语义保证（服务端回归见 server/test/api.test.ts lifecycle 组）。
import { expect, test, type Page } from '@playwright/test'

let sessionId = 0

function exitState(phase: string, extra: Record<string, unknown> = {}) {
  return { phase, ...extra }
}

async function installBaseMocks(page: Page) {
  sessionId += 1
  const sid = `session-${sessionId}`
  await page.route('**/api/env', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', tdx: { connected: true, source: 'saved-choice' }, dataCutoff: '2026-09-28', stockCount: 5321, capabilities: {}, activeTrainingId: null }),
  }))
  await page.route('**/api/trainings/active', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ training: null }),
  }))
  await page.route('**/api/data/status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      state: 'unchanged', needsUpdate: false, reason: '本地数据与数据源一致',
      source: { kind: 'tdx', name: '通达信本地数据', available: true },
      tdx: { available: true }, online: { configured: false, provider: null },
      sourceMaxDate: '2026-09-28', lastCheckedAt: null, lastResult: null,
      revisionWarning: null,
      freshness: { state: 'current', expectedDate: '2026-09-28', sourceMaxDate: '2026-09-28', checkedAt: '2026-09-29T01:00:00.000Z', reason: '' },
      calendar: null,
    }),
  }))
  await page.route('**/api/lifecycle/session', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessionId: sid, exitToken: `token-${sessionId}`, heartbeatIntervalMs: 15_000, freshWindowMs: 90_000 }),
  }))
  await page.route('**/api/lifecycle/heartbeat', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, phase: 'idle', pendingExit: null }),
  }))
  return sid
}

test('a) 单标签保存并退出：确认→排空轮询→健康端点失联→显示已退出页', async ({ page }) => {
  const sid = await installBaseMocks(page)
  await page.route('**/api/lifecycle/exit', route => route.fulfill({
    status: 202, contentType: 'application/json',
    body: JSON.stringify(exitState('draining', { requestId: 'req-1', remaining: 0 })),
  }))
  let statusCalls = 0
  await page.route('**/api/lifecycle/status', route => {
    statusCalls += 1
    // 第一次轮询仍 draining；随后模拟服务退出：拒绝连接
    if (statusCalls === 1) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(exitState('draining')) })
    }
    return route.abort('connectionrefused')
  })
  await page.route('**/api/health', route => route.abort('connectionrefused'))

  await page.goto('/')
  await page.getByRole('button', { name: '保存并退出训练器' }).click()
  await expect(page.getByRole('dialog', { name: '退出训练器' })).toBeVisible()
  // 对话框主按钮必须 exact：侧栏按钮的无障碍名是"保存并退出训练器"，子串匹配会同时命中两者
  await page.getByRole('button', { name: '保存并退出', exact: true }).click()
  await expect(page.getByText('正在退出…')).toBeVisible()
  await expect(page.getByText('训练器已退出')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('端口已释放')).toBeVisible()
  expect(sid).toBeTruthy()
})

test('b) 多标签：另一页面拒绝后发起方收到"退出未完成"，服务未停止', async ({ page }) => {
  await installBaseMocks(page)
  await page.route('**/api/lifecycle/exit', route => route.fulfill({
    status: 202, contentType: 'application/json',
    body: JSON.stringify(exitState('awaiting', { requestId: 'req-2', remaining: 1 })),
  }))
  await page.route('**/api/lifecycle/status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(exitState('cancelled', { reason: '有页面拒绝了退出，已停止本次退出（服务未停止）' })),
  }))

  await page.goto('/')
  await page.getByRole('button', { name: '保存并退出训练器' }).click()
  await page.getByRole('button', { name: '保存并退出', exact: true }).click()
  await expect(page.getByRole('heading', { name: '等待其他页面确认…' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '退出未完成' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('服务仍在运行，未保存的内容不会丢失。')).toBeVisible()
})

test('c) 其他页面发来退出请求：出现确认横幅，拒绝后横幅消失且不显示已退出页', async ({ page }) => {
  const sid = await installBaseMocks(page)
  await page.route('**/api/lifecycle/heartbeat', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, phase: 'awaiting', pendingExit: { requestId: 'req-3', requestedByMe: false } }),
  }))
  await page.route('**/api/lifecycle/cancel-exit', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'cancelled' }),
  }))

  await page.goto('/')
  await expect(page.getByRole('alertdialog', { name: '另一页面请求退出' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '拒绝' }).click()
  await expect(page.getByRole('alertdialog', { name: '另一页面请求退出' })).not.toBeVisible()
  await expect(page.getByText('训练器已退出')).not.toBeVisible()
  expect(sid).toBeTruthy()
})
