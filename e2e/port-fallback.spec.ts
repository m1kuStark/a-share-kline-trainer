// PORT-01（REL-LAUNCH-UX-01 增量）：默认端口被系统保留/占用时启动器自动改用邻近端口，
// 页面必须常驻提示实际端口（含"录像按访问地址存放"的如实说明与固定端口方法）；
// 未发生回退时不得出现提示条。全部走路由 mock，不依赖真实后端与真实端口。
// 端口选择/报错文案的服务端行为见 server/test/release-launcher.test.ts PORT-01 组。
import { expect, test } from '@playwright/test'

function envBody(launcher: Record<string, unknown> | null) {
  return JSON.stringify({
    status: 'ok',
    tdx: { connected: true, source: 'saved-choice' },
    ...(launcher === null ? {} : { launcher }),
    dataCutoff: '2026-09-28',
    stockCount: 5321,
    capabilities: {},
    activeTrainingId: null,
  })
}

async function installMocks(page: import('@playwright/test').Page, env: string) {
  await page.route('**/api/env', route => route.fulfill({ status: 200, contentType: 'application/json', body: env }))
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
      freshness: { state: 'current', expectedDate: '2026-09-28', sourceMaxDate: '2026-09-28', checkedAt: '2026-09-30T01:00:00.000Z', reason: '' },
      calendar: null,
    }),
  }))
  await page.route('**/api/lifecycle/session', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessionId: 'session-port-1', exitToken: 'token-port-1', heartbeatIntervalMs: 15_000, freshWindowMs: 90_000 }),
  }))
  await page.route('**/api/lifecycle/heartbeat', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, phase: 'idle', pendingExit: null }),
  }))
}

test('a) 发生回退：常驻提示实际端口、原因与固定端口方法', async ({ page }) => {
  await installMocks(page, envBody({ port: 8789, fallbackFrom: 8787, fallbackReason: 'reserved' }))
  await page.goto('/')
  const note = page.locator('.port-fallback-note')
  await expect(note).toBeVisible()
  await expect(note).toContainText('端口 8789')
  await expect(note).toContainText('默认端口 8787')
  await expect(note).toContainText('被系统保留')
  // 如实说明录像按访问地址存放，不谎称完全不受影响
  await expect(note).toContainText('按访问地址存放')
  await expect(note).toContainText('trainer.config.json')
})

test('b) 发生回退（被占用原因）：文案区分"被其他程序占用"', async ({ page }) => {
  await installMocks(page, envBody({ port: 8790, fallbackFrom: 8787, fallbackReason: 'occupied' }))
  await page.goto('/')
  const note = page.locator('.port-fallback-note')
  await expect(note).toBeVisible()
  await expect(note).toContainText('端口 8790')
  await expect(note).toContainText('被其他程序占用')
})

test('c) 未发生回退：不出现端口提示条', async ({ page }) => {
  await installMocks(page, envBody({ port: 8787, fallbackFrom: null, fallbackReason: null }))
  await page.goto('/')
  await expect(page.locator('.port-fallback-note')).toHaveCount(0)
})
