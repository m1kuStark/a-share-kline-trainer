import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import type { HistoryItem, HistoryReportPayload, RankingGroups, RankingItem } from '../web/src/api'
import { evidencePath } from './runtime'

// UIUX-REFINE-01: frozen presentation fixtures; no assertion about persistence is inferred.
const historyItems: HistoryItem[] = [1, 2, 3].map(id => ({
  id: 9200 + id, code: '600519', name: '贵州茅台长名称与训练记录比较样本', tier: '1M',
  rangeMode: 'preset', classification: id === 1 ? 'early-settled' : 'complete',
  startDate: '2026-04-15', settleDate: '2026-05-15', initialCash: 1_000_000,
  finalEquity: 1_234_567.89, returnRate: .23456789, tradeCount: 123, integrity: 'ok',
}))

const compactViewports = [{ width: 1024, height: 680 }, { width: 1008, height: 641 }]
const rankingItem: RankingItem = { ...historyItems[0]!, classification: 'complete', finalEquity: 1_234_567.89,
  returnRate: .23456789, actualDays: 21, maxDrawdown: .02, winRate: .5, profitLossRatio: 2,
  benchmarkExcess: null, benchmarkExcessReason: '样本无基准' }

// Existing v2 import contract, consumed through the real file input and repository.
function recordingFile(sessionId: string, trainingKey: string) {
  return {
    format: 'trainer-session', schemaVersion: 2, sessionId, createdAt: '2026-10-03T00:00:00.000Z',
    app: { version: 'test', gitCommit: 'test', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 800 }, dpr: 1 },
    trainingKey, events: [], checkpoints: [], gaps: [], complete: true,
    resources: { series: [], drawings: [], trainingMeta: [], accounts: [], trades: [], contexts: [] },
  }
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  const toggle = page.getByRole('button', { name: theme === 'dark' ? '切换到深色主题' : '切换到浅色主题', exact: true })
  if (await toggle.count()) await toggle.click()
  await expect.poll(() => page.locator('body').evaluate(el => el.classList.contains('dark'))).toBe(theme === 'dark')
}

async function openLibrary(page: Page) {
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  const library = page.getByRole('region', { name: '训练录像库', exact: true })
  await expect(library).toBeVisible()
  await expect(library.getByLabel('导入录制', { exact: true })).toBeEnabled({ timeout: 15_000 })
  return library
}

async function importOne(page: Page, id: string, trainingKey: string, name = `${id}.json`) {
  await page.getByLabel('导入录制', { exact: true }).setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recordingFile(id, trainingKey))),
  })
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭回放', exact: true }).click()
  await expect(page.getByRole('region', { name: '训练录像库', exact: true })).toBeVisible()
}

async function hitPoint(target: Locator) {
  await expect(target).toBeVisible()
  await expect(target).toBeEnabled()
  await expect(target).toBeInViewport({ ratio: 1 })
  const point = await target.evaluate(el => {
    const rect = el.getBoundingClientRect()
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
    const hit = document.elementFromPoint(x, y)
    return { x, y, owns: hit === el || el.contains(hit) }
  })
  expect(point.owns, 'the visible control owns its center point').toBe(true)
  return point
}

async function clickAtCenter(page: Page, target: Locator) {
  const point = await hitPoint(target)
  await page.mouse.click(point.x, point.y)
}

async function wheelHistory(page: Page, end: 'first' | 'last') {
  const panel = page.locator('.history-page')
  expect(await panel.evaluate(el => el.scrollHeight - el.clientHeight), 'history actually overflows vertically').toBeGreaterThan(0)
  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.wheel(0, end === 'first' ? -10_000 : 10_000)
  if (end === 'first') await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBe(0)
  else await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await expect(page.locator('.history-row')[end]()).toBeInViewport({ ratio: 1 })
}

async function expectHistoryGeometry(page: Page, row: Locator) {
  await expect(row).toBeInViewport({ ratio: 1 })
  const geometry = await row.evaluate(el => {
    const children = Array.from(el.children).map(child => {
      const r = child.getBoundingClientRect()
      return { name: child.className, x: r.x, y: r.y, right: r.right, bottom: r.bottom }
    })
    const bounds = el.getBoundingClientRect()
    return { children, bounds: { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom }, width: innerWidth, height: innerHeight }
  })
  for (const child of geometry.children) {
    expect(child.x, child.name).toBeGreaterThanOrEqual(geometry.bounds.x)
    expect(child.right, child.name).toBeLessThanOrEqual(geometry.bounds.right)
    expect(child.y, child.name).toBeGreaterThanOrEqual(0)
    expect(child.bottom, child.name).toBeLessThanOrEqual(geometry.height)
  }
  for (let a = 0; a < geometry.children.length; a++) for (let b = a + 1; b < geometry.children.length; b++) {
    const one = geometry.children[a]!, two = geometry.children[b]!
    const xOverlap = Math.min(one.right, two.right) - Math.max(one.x, two.x)
    const yOverlap = Math.min(one.bottom, two.bottom) - Math.max(one.y, two.y)
    expect(xOverlap > 1 && yOverlap > 1, `${one.name} overlaps ${two.name}`).toBe(false)
  }
  for (const [selector, label] of [['.history-row-money', '最终权益'], ['.history-row-return', '收益率']]) {
    const field = row.locator(selector!)
    await expect(field).toHaveAttribute('data-label', label!)
    const before = await field.evaluate(el => ({ content: getComputedStyle(el, '::before').content, display: getComputedStyle(el, '::before').display }))
    expect(before.content).toContain(label)
    expect(before.display).not.toBe('none')
  }
  await expect(row).toContainText('¥1,234,567.89')
  await expect(row).toContainText('+23.46%')
  await expect(row).toContainText('123 笔')
  for (const selector of ['.history-report-entry', '.history-row-check', '.history-row-replay', '.history-row-export', '.history-row-delete']) await hitPoint(row.locator(selector))
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(geometry.width)
}

async function reset(page: Page) {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  // A fresh isolated runtime scans the TDX snapshot before exposing the launcher.
  await expect(page.getByRole('button', { name: '开始训练', exact: true })).toBeVisible({ timeout: 15_000 })
}

async function seedReportResponse(page: Page) {
  const created = await page.request.post('/api/trainings', { data: { code: '300857', tier: '1M', start_date: '2026-04-15' } })
  expect(created.status()).toBe(201)
  const id = (await created.json()).training.id
  expect((await page.request.post(`/api/trainings/${id}/settle`)).status()).toBe(200)
  const response = await page.request.get(`/api/trainings/${id}/report`)
  expect(response.status()).toBe(200)
  const producedReport = await response.json() as HistoryReportPayload
  // Adapt only the presentation identity; financial facts and rules remain producer data.
  const report: HistoryReportPayload = { ...producedReport, training: {
    ...producedReport.training, id: 9201, code: '600519', name: '贵州茅台长名称与训练记录比较样本',
  } }
  await page.route('**/api/trainings/9201/report', route => route.fulfill({ status: 200, json: report }))
}

async function expectTargetReport(page: Page, activate: () => Promise<unknown>) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/trainings/9201/report'
    && response.request().method() === 'GET')
  await activate()
  const response = await pending
  expect(response.status(), 'the selected record report request succeeds').toBe(200)
  const payload = await response.json() as HistoryReportPayload
  expect(payload.training).toMatchObject({ id: 9201, code: '600519', name: '贵州茅台长名称与训练记录比较样本' })
  const report = page.getByRole('dialog', { name: '成绩单', exact: true })
  await expect(report.locator('.report-header p')).toContainText('600519 贵州茅台长名称与训练记录比较样本')
  await expect(report.locator('.report-grid')).toBeVisible()
  await expect(report.getByText('加载中…', { exact: true })).toHaveCount(0)
  // Consumer display consistency only; valuation remains covered by independent server oracles.
  const finalEquity = `¥${payload.finalEquity.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  await expect(report.locator('.report-grid > div').filter({ has: page.getByText('最终权益', { exact: true }) }).locator('strong')).toHaveText(finalEquity)
  await expect(report.locator('.report-grid > div').filter({ has: page.getByText('交易笔数', { exact: true }) }).locator('strong')).toHaveText(String(payload.tradeCount))
}

async function openHistory(page: Page) {
  await page.route(url => url.pathname === '/api/trainings/history', route => route.fulfill({
    json: { items: historyItems, total: historyItems.length, limit: 20, offset: 0 },
  }))
  await reset(page)
  await seedReportResponse(page)
  await page.getByRole('button', { name: '历史训练', exact: true }).click()
  await expect(page.locator('.history-row')).toHaveCount(3)
}

test('history keeps every fact and action within the desktop viewport at compact and wide sizes', async ({ page }) => {
  await openHistory(page)
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: width === 1024 ? 680 : 900 })
    for (const theme of ['dark', 'light']) {
      const toggle = page.getByRole('button', { name: theme === 'dark' ? '切换到深色主题' : '切换到浅色主题', exact: true })
      if (await toggle.count()) await toggle.click()
      const history = page.locator('.history-page')
      expect(await history.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      const row = page.locator('.history-row').first()
      for (const selector of ['.history-row-title', '.history-row-dates', '.history-row-classification', '.history-row-money', '.history-row-return', '.history-row-count', '.history-row-replay', '.history-row-export', '.history-row-delete']) {
        const box = await row.locator(selector).boundingBox()
        expect(box, selector).not.toBeNull()
        expect(box!.x, selector).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width, selector).toBeLessThanOrEqual(width)
      }
      await expect(row).toContainText('¥1,234,567.89')
      await expect(row).toContainText('+23.46%')
      await expect(row).toContainText('123 笔')
      const deletion = row.getByRole('button', { name: '删除训练记录', exact: true })
      await deletion.focus()
      await expect(deletion).toBeFocused()
      await page.screenshot({ path: evidencePath(`uiux-history-${theme}-${width}.png`) })
    }
  }
})

test('history has an explicit keyboard report action and child keys never open a report', async ({ page }) => {
  await openHistory(page)
  const row = page.locator('.history-row').first()
  await expect(row).not.toHaveAttribute('role', 'button')
  const reportButton = row.locator('.history-report-entry')
  await expect(reportButton).toBeVisible()
  // Independent label-in-name oracle: the visible code and stock name must remain discoverable.
  await expect(reportButton).toHaveAccessibleName(/600519.*贵州茅台长名称与训练记录比较样本/)
  const check = row.getByRole('checkbox')
  await check.focus()
  await page.keyboard.press('Space')
  await expect(check).toBeChecked()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '成绩单', exact: true })).toHaveCount(0)
  await reportButton.focus()
  await expectTargetReport(page, () => page.keyboard.press('Enter'))
  await page.getByRole('button', { name: '关闭成绩单', exact: true }).click()
  await expectTargetReport(page, () => row.locator('.history-row-money').click())
})

test('rankings expose keyboard report entries while empty records explain the next action', async ({ page }) => {
  const item: RankingItem = { ...historyItems[0]!, classification: 'complete', finalEquity: 1_234_567.89,
    returnRate: .23456789, actualDays: 21, maxDrawdown: .02, winRate: .5, profitLossRatio: 2,
    benchmarkExcess: null, benchmarkExcessReason: '样本无基准' }
  let empty = false
  await page.route('**/api/rankings?*', route => route.fulfill({ json: {
    tier: '1M', view: 'tier', complete: empty ? [] : [item], earlySettled: [], excludedUnavailable: 0,
    benchmark: { status: 'unavailable', reason: '样本无基准' },
  } satisfies RankingGroups }))
  await reset(page)
  await seedReportResponse(page)
  await page.getByRole('button', { name: '历史排行', exact: true }).click()
  const entry = page.locator('.rankings-row .ranking-report-entry')
  await expect(entry).toBeVisible()
  await expect(entry).toHaveAccessibleName(/600519.*贵州茅台长名称与训练记录比较样本/)
  await entry.focus()
  await expectTargetReport(page, () => page.keyboard.press('Space'))
  await page.getByRole('button', { name: '关闭成绩单', exact: true }).click()
  empty = true
  await page.getByRole('button', { name: '3个月', exact: true }).click()
  const emptyState = page.locator('.rankings-page .history-empty')
  await expect(emptyState).toHaveAttribute('role', 'status')
  await expect(emptyState).toContainText('切换周期')
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  const library = page.getByRole('region', { name: '训练录像库', exact: true })
  await expect(library.locator('.recording-library-empty').first()).toContainText('记录操作')
  const upload = library.getByLabel('导入录制', { exact: true })
  await upload.focus()
  await expect(upload).toBeFocused()
  expect(await upload.evaluate(el => getComputedStyle(el.parentElement!).outlineStyle)).not.toBe('none')
  await page.screenshot({ path: evidencePath('uiux-recording-empty.png') })
})

test('recording library waits for real namespace readiness before enabling imports', async ({ page }) => {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const environment = await (await page.request.get('/api/env')).json()
  let releaseEnvironment!: () => void
  const environmentGate = new Promise<void>(resolve => { releaseEnvironment = resolve })
  let intercepted = 0
  await page.route('**/api/env', async route => {
    intercepted++
    await environmentGate
    await route.fulfill({ json: environment })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  const library = page.getByRole('region', { name: '训练录像库', exact: true })
  const upload = library.getByLabel('导入录制', { exact: true })
  try {
    await expect(library).toBeVisible()
    await expect.poll(() => intercepted).toBeGreaterThan(0)
    // This deliberately exceeds the existing 3-second repository retry window.
    await page.waitForTimeout(3_500)
    await expect(upload).toBeDisabled()
    await expect(library.getByRole('status').filter({ hasText: '正在准备录像库' })).toBeVisible()
  } finally { releaseEnvironment() }
  await expect(upload).toBeEnabled({ timeout: 15_000 })
  await expect(library.getByRole('status').filter({ hasText: '正在准备录像库' })).toHaveCount(0)
  const recording = {
    format: 'trainer-session', schemaVersion: 2, sessionId: 'ready-import', createdAt: '2026-10-03T00:00:00.000Z',
    app: { version: 'test', gitCommit: 'test', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 800 }, dpr: 1 },
    trainingKey: 'ready-import.key', events: [], checkpoints: [], gaps: [], complete: true,
    resources: { series: [], drawings: [], trainingMeta: [], accounts: [], trades: [], contexts: [] },
  }
  await upload.setInputFiles([
    { name: 'ready.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recording)) },
    { name: 'corrupt.json', mimeType: 'application/json', buffer: Buffer.from('{oops') },
  ])
  await expect(library.getByRole('alert').filter({ hasText: '批量导入完成：成功 1 / 失败 1' })).toBeVisible()
  await expect(library.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(1)
})

test('stock rankings keep the visible period in the accessible report name and open by keyboard', async ({ page }) => {
  await page.route('**/api/stocks?*', route => route.fulfill({ json: {
    items: [{ code: '600519', market: 'sh', name: '贵州茅台', bars: 2000, lastDate: '2026-05-15' }], total: 1,
  } }))
  await page.route('**/api/rankings?*', route => {
    const isStock = new URL(route.request().url()).searchParams.get('view') === 'stock'
    return route.fulfill({ json: {
      tier: '1M', view: isStock ? 'stock' : 'tier', complete: isStock ? [] : [rankingItem], earlySettled: [],
      excludedUnavailable: 0, benchmark: { status: 'unavailable', reason: '样本无基准' },
      ...(isStock ? { stock: { status: 'ok', code: '600519', name: '贵州茅台', complete: [rankingItem], earlySettled: [] } } : {}),
    } satisfies RankingGroups })
  })
  await reset(page)
  await seedReportResponse(page)
  await page.getByRole('button', { name: '历史排行', exact: true }).click()
  await page.getByRole('button', { name: '单只股票', exact: true }).click()
  await page.getByLabel('选择股票', { exact: true }).fill('600519')
  await page.locator('.ranking-stock-suggestions').getByRole('button', { name: /600519.*贵州茅台/ }).click()
  const entry = page.locator('.rankings-row .ranking-report-entry')
  await expect(entry).toHaveText('1M 成绩单')
  await expect(entry).toHaveAccessibleName(/1M\s*成绩单/)
  await entry.focus()
  await expectTargetReport(page, () => page.keyboard.press('Enter'))
})

test('recording library recovers from environment failure through reconnect before a real import', async ({ page }) => {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.get('/api/env')
  expect(response.ok()).toBe(true)
  const environment = await response.json()
  let recover = false, failedRequests = 0, recoveredRequests = 0
  await page.route('**/api/env', route => {
    if (!recover) {
      failedRequests++
      return route.fulfill({ status: 503, json: { code: 'UIUX_ENV_UNAVAILABLE', message: '测试环境暂不可连接，请重新连接' } })
    }
    recoveredRequests++
    return route.fulfill({ json: environment })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  const library = page.getByRole('region', { name: '训练录像库', exact: true })
  await expect.poll(() => failedRequests).toBeGreaterThan(0)
  await expect(page.locator('.env-error')).toContainText('测试环境暂不可连接，请重新连接')
  await expect(library).toBeVisible()
  await expect(library.getByLabel('导入录制', { exact: true })).toBeDisabled()
  await expect(library.getByRole('status').filter({ hasText: '正在准备录像库' })).toBeVisible()
  expect(recoveredRequests).toBe(0)
  recover = true
  await page.getByRole('button', { name: '重新连接', exact: true }).click()
  await expect.poll(() => recoveredRequests).toBeGreaterThan(0)
  await expect(page.locator('.env-error')).toHaveCount(0)
  // Existing refresh returns an inactive session to creation; use the same navigation again.
  await expect(page.getByRole('button', { name: '开始训练', exact: true })).toBeVisible({ timeout: 15_000 })
  await openLibrary(page)
  await expect(library.getByRole('status').filter({ hasText: '正在准备录像库' })).toHaveCount(0)
  await importOne(page, 'reconnected-import', 'reconnected-import.key')
  await expect(library.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(1)
  await page.reload()
  await openLibrary(page)
  await expect(library.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(1)
})

test('compact history exposes first and last row facts and linked actions in both themes at supported content sizes', async ({ page }) => {
  test.setTimeout(60_000)
  let rows = Array.from({ length: 6 }, (_, index) => ({ ...historyItems[index % historyItems.length]!, id: 9201 + index }))
  await page.route(url => url.pathname === '/api/trainings/history', route => route.fulfill({
    json: { items: rows, total: rows.length, limit: 20, offset: 0 },
  }))
  let deletedId: number | null = null
  await page.route('**/api/trainings/9206', route => {
    if (route.request().method() !== 'DELETE') return route.continue()
    deletedId = 9206
    rows = rows.filter(item => item.id !== 9206)
    return route.fulfill({ json: { deleted: [9206] } })
  })
  await reset(page)
  await openLibrary(page)
  await importOne(page, 'compact-first', '9201.2026-10-03T00:00:00.000Z')
  await importOne(page, 'compact-last', '9206.2026-10-03T00:00:00.000Z')
  await page.getByRole('button', { name: '历史训练', exact: true }).click()
  await expect(page.locator('.history-row')).toHaveCount(6)
  await expect(page.locator('.history-link-status')).toContainText('2/6')
  for (const size of compactViewports) {
    await page.setViewportSize(size)
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme)
      await wheelHistory(page, 'first')
      await expectHistoryGeometry(page, page.locator('.history-row').first())
      await wheelHistory(page, 'last')
      await expectHistoryGeometry(page, page.locator('.history-row').last())
      await page.screenshot({ path: evidencePath(`uiux-history-last-${theme}-${size.width}.png`) })
      const check = page.locator('.history-row').last().getByRole('checkbox')
      await clickAtCenter(page, check)
      await expect(check).toBeChecked()
      await clickAtCenter(page, check)
      await expect(check).not.toBeChecked()
      await clickAtCenter(page, page.locator('.history-row').last().locator('.history-row-replay'))
      await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '关闭回放', exact: true }).click()
      await expect(page.locator('.history-row')).toHaveCount(6)
    }
  }
  await wheelHistory(page, 'first')
  const pendingDownload = page.waitForEvent('download')
  await clickAtCenter(page, page.locator('.history-row').first().locator('.history-row-export'))
  const download = await pendingDownload
  expect(download.suggestedFilename()).toBe('历史训练-9201-录像.trainer-session.json.gz')
  const exportPath = evidencePath('uiux-history-linked-export.trainer-session.json.gz')
  await download.saveAs(exportPath)
  const exported = JSON.parse(gunzipSync(await readFile(exportPath)).toString('utf8'))
  expect(exported.trainingKey).toBe('9201.2026-10-03T00:00:00.000Z')
  await wheelHistory(page, 'last')
  page.once('dialog', dialog => dialog.accept())
  await clickAtCenter(page, page.locator('.history-row').last().locator('.history-row-delete'))
  await expect.poll(() => deletedId).toBe(9206)
  await expect(page.locator('.history-row')).toHaveCount(5)
  // The delete endpoint is a presentation stub; this does not assert backend deletion integrity.
  await expect(page.getByRole('dialog', { name: '成绩单', exact: true })).toHaveCount(0)
})

test('compact rankings scroll locally to the final column in both themes at supported content sizes', async ({ page }, testInfo) => {
  // Supported-domain presentation pressure, justified in records-followup.md before this edit.
  // It does not stand in for an executed two-year financial calculation.
  const pressureItem: RankingItem = { ...rankingItem, tier: '2Y', startDate: '2024-05-15',
    initialCash: 1_000_000_000, finalEquity: 13_345_678_900, returnRate: 12.3456789,
    actualDays: 480, maxDrawdown: .1234, winRate: 67 / 118, profitLossRatio: 1234.56, tradeCount: 1234 }
  await page.route('**/api/rankings?*', route => route.fulfill({ json: {
    tier: '2Y', view: 'tier', complete: new URL(route.request().url()).searchParams.get('tier') === '2Y' ? [pressureItem] : [],
    earlySettled: [], excludedUnavailable: 0,
    benchmark: { status: 'unavailable', reason: '样本无基准' },
  } satisfies RankingGroups }))
  await reset(page)
  await page.getByRole('button', { name: '历史排行', exact: true }).click()
  await page.getByRole('button', { name: '2年', exact: true }).click()
  const rankingsUrl = page.url()
  const table = page.getByRole('region', { name: '完整周期排行', exact: true }).locator('.rankings-table')
  const normalTokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'].map(key => ({ key, value: parseFloat(style.getPropertyValue(`--font-size-${key}`)) }))
  })
  for (const size of compactViewports) {
    await page.setViewportSize(size)
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme)
      await page.evaluate(tokens => {
        for (const { key, value } of tokens) document.documentElement.style.setProperty(`--font-size-${key}`, `${value}px`)
      }, normalTokens)
      await expect(table).toBeVisible()
      await expect(table.locator('tbody tr')).toHaveCount(1)
      await expect(table.locator('.ranking-report-entry')).toContainText(pressureItem.name)
      await expect(table.locator('tbody td')).toHaveText([
        '1', /600519.*贵州茅台长名称与训练记录比较样本/, '2024-05-15 ~ 2026-05-15', '+1234.57%', '12.34%', '56.78%', '1234.56', '1234', '--', '2026-05-15',
      ])
      const normalMetrics = await table.evaluate(el => ({
        scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
        bodyFont: parseFloat(getComputedStyle(el.querySelector('td')!).fontSize),
        headerFont: parseFloat(getComputedStyle(el.querySelector('th')!).fontSize),
      }))
      // All three fixed scales run in every size/theme. Only font tokens change;
      // the 200% scope comes from UIUX text resizing guidance, not browser zoom.
      for (const scale of [1, 1.25, 2]) {
        await page.evaluate(({ tokens, scale }) => {
          for (const { key, value } of tokens) document.documentElement.style.setProperty(`--font-size-${key}`, `${value * scale}px`)
        }, { tokens: normalTokens, scale })
        // At enlarged text the document grows; the measured scrolling owner
        // is the root, while .rankings-page itself has no vertical travel.
        const rankingPage = page.locator('html')
        expect(await rankingPage.evaluate(el => el === document.scrollingElement)).toBe(true)
        const previousTop = await rankingPage.evaluate(el => el.scrollTop)
        if (previousTop > 0) {
          await page.mouse.move(size.width / 2, size.height / 2)
          await page.mouse.wheel(0, -previousTop)
          await expect.poll(() => rankingPage.evaluate(el => el.scrollTop)).toBe(0)
        }
        const metrics = await table.evaluate(el => ({
          scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          visualWidth: el.getBoundingClientRect().width,
          bodyFont: parseFloat(getComputedStyle(el.querySelector('td')!).fontSize),
          headerFont: parseFloat(getComputedStyle(el.querySelector('th')!).fontSize),
          viewport: { width: innerWidth, height: innerHeight }, outer: { width: outerWidth, height: outerHeight }, dpr: devicePixelRatio,
        }))
        await testInfo.attach(`ranking-text-metrics-${scale * 100}-${size.width}-${theme}`, {
          body: JSON.stringify({ theme, normalMetrics, metrics, textScale: scale, browserZoomChanged: false }), contentType: 'application/json',
        })
        expect(metrics.bodyFont).toBeCloseTo(normalMetrics.bodyFont * scale, 2)
        expect(metrics.headerFont).toBeCloseTo(normalMetrics.headerFont * scale, 2)
        if (scale === 2) expect(metrics.scrollWidth - metrics.clientWidth, '200 percent text fixture actually overflows horizontally').toBeGreaterThan(0)
        if (scale === 2) expect(metrics.scrollWidth - metrics.visualWidth, '200 percent content exceeds the visible table, not just its reserved gutter').toBeGreaterThan(0)
        // The enlarged table can start below the viewport. Use real vertical
        // input to expose it before assessing horizontal reachability.
        const verticalBox = await table.boundingBox()
        expect(verticalBox).not.toBeNull()
        expect(verticalBox!.height).toBeLessThan(size.height)
        if (verticalBox!.y + verticalBox!.height > size.height) {
          expect(await rankingPage.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(0)
          await page.mouse.move(verticalBox!.x + verticalBox!.width / 2, Math.min(size.height - 20, verticalBox!.y + 20))
          await page.mouse.wheel(0, verticalBox!.y + verticalBox!.height - size.height + 12)
          await expect.poll(async () => { const b = await table.boundingBox(); return b!.y + b!.height }).toBeLessThanOrEqual(size.height)
        }
        const box = await table.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.y).toBeGreaterThanOrEqual(0)
        expect(box!.y + box!.height).toBeLessThanOrEqual(size.height)
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
        const remainingLeft = await table.evaluate(el => el.scrollLeft)
        if (remainingLeft > 0) await page.mouse.wheel(-remainingLeft, 0)
        await expect(page).toHaveURL(rankingsUrl)
        await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBe(0)
        await hitPoint(table.locator('.ranking-report-entry'))
        // Default/125% may fit: full reachability is required in either case.
        // 200% has already proved genuine overflow; it cannot take a no-scroll pass.
        // Chromium's block table can count the reserved scrollbar gutter in
        // scrollWidth-clientWidth although its contents still fit visually.
        if (metrics.scrollWidth > metrics.visualWidth) {
          await page.mouse.wheel(metrics.scrollWidth - metrics.clientWidth, 0)
          await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
          await expect(page).toHaveURL(rankingsUrl)
        } else {
          for (const cell of await table.locator('th, td').all()) await expect(cell).toBeInViewport({ ratio: 1 })
        }
        const lastHeader = table.locator('th').last(), lastValue = table.locator('tbody tr').first().locator('td').last()
        await expect(lastHeader).toHaveText('结算日')
        await expect(lastValue).toHaveText('2026-05-15')
        for (const cell of [lastHeader, lastValue]) {
          await expect(cell).toBeVisible()
          const geometry = await cell.evaluate(el => {
            const bounds = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
            const range = document.createRange(); range.selectNodeContents(el)
            return { cell: bounds(el.getBoundingClientRect()), text: bounds(range.getBoundingClientRect()),
              table: bounds(el.closest('table')!.getBoundingClientRect()), width: innerWidth, height: innerHeight }
          })
          // Collapsed table borders can end at a fractional CSS pixel after
          // integer scroll rounding. Text itself must remain wholly visible.
          expect(geometry.cell.right).toBeLessThanOrEqual(Math.min(geometry.table.right, geometry.width) + .5)
          expect(geometry.cell.left).toBeGreaterThanOrEqual(Math.max(geometry.table.left, 0) - .5)
          expect(geometry.cell.top).toBeGreaterThanOrEqual(0)
          expect(geometry.cell.bottom).toBeLessThanOrEqual(geometry.height)
          expect(geometry.text.right).toBeLessThanOrEqual(Math.min(geometry.table.right, geometry.width))
          expect(geometry.text.left).toBeGreaterThanOrEqual(Math.max(geometry.table.left, 0))
          expect(geometry.text.top).toBeGreaterThanOrEqual(0)
          expect(geometry.text.bottom).toBeLessThanOrEqual(geometry.height)
        }
        expect(await lastValue.evaluate(el => {
          const rect = el.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return hit === el || el.contains(hit)
        })).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
        await page.screenshot({ path: evidencePath(`uiux-ranking-last-text${scale * 100}-${theme}-${size.width}.png`) })
      }
    }
  }
})

test('nonempty recording library exports and deletes real imported files at compact content sizes in both themes', async ({ page }) => {
  test.setTimeout(60_000)
  await reset(page)
  await openLibrary(page)
  for (const size of compactViewports) {
    await page.setViewportSize(size)
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme)
      const id = `compact-library-${size.width}-${theme}`
      const filename = `用于检查中文长名称换行与删除按钮的分享录像-${size.width}-${theme}.json`
      await importOne(page, id, `${id}.key`, filename)
      const library = page.getByRole('region', { name: '训练录像库', exact: true })
      const row = library.locator('[data-recording-source="imported"] .recording-history-item')
      await expect(row).toHaveCount(1)
      await expect(row).toContainText(filename)
      const open = row.locator('.recording-history-open'), deletion = row.getByRole('button', { name: '删除录像', exact: true })
      await hitPoint(open)
      await hitPoint(deletion)
      const openBox = await open.boundingBox(), deleteBox = await deletion.boundingBox()
      expect(openBox!.x + openBox!.width).toBeLessThanOrEqual(deleteBox!.x)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
      const pending = page.waitForEvent('download')
      await clickAtCenter(page, library.getByRole('button', { name: '全部导出', exact: true }))
      const download = await pending
      expect(download.suggestedFilename()).toContain('.trainer-recordings.json')
      const output = evidencePath(`uiux-library-export-${size.width}-${theme}.trainer-recordings.json`)
      await download.saveAs(output)
      const bundle = JSON.parse(await readFile(output, 'utf8'))
      expect(bundle.format).toBe('trainer-recordings-bundle')
      expect(bundle.items).toHaveLength(1)
      expect(bundle.items[0].trainingKey).toBe(`${id}.key`)
      await page.screenshot({ path: evidencePath(`uiux-library-populated-${theme}-${size.width}.png`) })
      await clickAtCenter(page, deletion)
      const confirmation = page.getByRole('alertdialog', { name: '确认删除录像', exact: true })
      await expect(confirmation).toBeVisible()
      await clickAtCenter(page, confirmation.getByRole('button', { name: '确认删除', exact: true }))
      await expect(row).toHaveCount(0)
      await page.reload()
      await openLibrary(page)
      await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(0)
    }
  }
})
