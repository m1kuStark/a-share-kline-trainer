import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// First training initializes the frozen real-data adjustment/name caches on slower Windows hosts.
test.setTimeout(240_000)

const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function openChart(page: Page, startDate = '2025-01-02'): Promise<void> {
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  const created = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: startDate, initial_cash: 100_000_000 } })
  expect(created.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.loading-dot')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.ma()?.periods)).toEqual([25, 60, 144])
}
const period = (page: Page, index: number) => page.getByRole('spinbutton', { name: `第 ${index} 条均线周期`, exact: true })
const ma = (page: Page) => page.evaluate(() => (window as any).__trainerChart.ma())

test('MA drafts validate and cancel; presets, colors and shared preferences apply without changing the viewport or drawings', async ({ page }) => {
  await openChart(page)
  // A real user-created drawing must survive settings application.
  const tool = page.locator('[data-tool-name="segment"]')
  if (!await tool.isVisible()) await page.locator('.other-tools-toggle').click()
  await tool.click()
  const host = (await page.locator('.chart-host').boundingBox())!
  await expect(page.getByRole('button', { name: '设置均线' })).toBeDisabled()
  await page.mouse.click(host.x + host.width * .25, host.y + 140)
  await page.waitForTimeout(560)
  await page.mouse.click(host.x + host.width * .55, host.y + 190)
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const before = await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))
  await page.getByRole('button', { name: '设置均线' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(period(page, 1)).toBeFocused()
  await period(page, 1).fill('60')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('重复')
  await period(page, 1).fill('')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('整数')
  await page.getByRole('button', { name: '常用 5/10/20/60' }).click()
  expect((await ma(page)).periods).toEqual([25, 60, 144])
  const date = await page.locator('.training-current-date').innerText()
  await period(page, 1).press('Space')
  await period(page, 1).press('b')
  await period(page, 1).press('Delete')
  expect(await page.locator('.training-current-date').innerText()).toBe(date)
  expect(await page.evaluate(() => (window as any).__trainerChart.drawings())).toEqual(before.drawings)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: '设置均线' })).toBeFocused()
  expect((await ma(page)).periods).toEqual([25, 60, 144])
  await page.getByRole('button', { name: '设置均线' }).click()
  await page.getByRole('button', { name: '常用 5/10/20/60' }).click()
  // HTML color control input through its public DOM value, not chart internals.
  await page.getByLabel('第 1 条均线颜色', { exact: true }).fill('#123456')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect.poll(async () => (await ma(page)).periods).toEqual([5, 10, 20, 60])
  expect((await ma(page)).colors[0]).toBe('#123456')
  expect(await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))).toEqual(before)
  for (const name of ['周K', '月K', '日K']) {
    await page.getByRole('tab', { name, exact: true }).click()
    await expect(page.locator('.loading-dot')).not.toBeVisible()
    expect((await ma(page)).periods).toEqual([5, 10, 20, 60])
  }
  await page.reload()
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect.poll(async () => (await ma(page))?.periods).toEqual([5, 10, 20, 60])
  expect((await ma(page)).colors[0]).toBe('#123456')
})

test('1000-period MA uses extended history; all-zero hides and restoring defaults re-enables it', async ({ page }) => {
  const requests: URL[] = []
  page.on('request', request => { const url = new URL(request.url()); if (/\/api\/trainings\/\d+\/bars$/.test(url.pathname)) requests.push(url) })
  await openChart(page, '2026-01-02')
  expect(requests.some(url => url.searchParams.get('warmup') === '200')).toBe(true)
  expect(requests.some(url => url.searchParams.get('warmup') === '999')).toBe(false)
  expect(await page.evaluate(() => (window as any).__trainerChart.bars().length)).toBe(1040)
  const tool = page.locator('[data-tool-name="segment"]')
  if (!await tool.isVisible()) await page.locator('.other-tools-toggle').click()
  await tool.click()
  const host = (await page.locator('.chart-host').boundingBox())!
  await page.mouse.click(host.x + host.width * .25, host.y + 140)
  await page.waitForTimeout(560)
  await page.mouse.click(host.x + host.width * .55, host.y + 190)
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const view = () => page.evaluate(() => {
    const chart = (window as any).__trainerChart, range = chart.visibleRange(), data = chart.bars()
    return { dates: data.slice(range.from, range.to).map((bar: { date: string }) => bar.date), bar: chart.viewportMetrics().bar, drawings: chart.drawings() }
  })
  const before = await view()
  let failOnce = true
  await page.route('**/api/trainings/*/bars?**', async route => {
    if (new URL(route.request().url()).searchParams.has('before') && failOnce) { failOnce = false; await route.fulfill({ status: 503, body: '{}' }); return }
    await route.continue()
  })
  await page.getByRole('button', { name: '设置均线' }).click()
  for (let i = 1; i <= 8; i++) await period(page, i).fill(i === 1 ? '1000' : '0')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect.poll(async () => (await ma(page)).periods).toEqual([1000])
  await expect(page.getByRole('alert')).toContainText('均线历史加载失败')
  expect(requests.filter(url => url.searchParams.has('before'))).toHaveLength(1)
  expect(await view()).toEqual(before)
  await page.getByRole('alert').click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.bars().length)).toBeGreaterThan(1040)
  await expect(page.getByRole('alert')).not.toBeVisible()
  expect(requests.filter(url => url.searchParams.has('before')).every(url => url.searchParams.get('count') === '799')).toBe(true)
  expect(await view()).toEqual(before)
  await expect.poll(async () => (await ma(page)).result.at(-1)?.ma1).not.toBeUndefined()
  const bars = await page.evaluate(() => (window as any).__trainerChart.bars())
  expect(bars.length).toBeGreaterThanOrEqual(1000)
  expect(bars.length).toBeLessThanOrEqual(1839)
  expect(bars.every((bar: { date: string }) => bar.date <= '2026-01-02')).toBe(true)
  const expected = bars.slice(-1000).reduce((sum: number, bar: { close: number }) => sum + bar.close, 0) / 1000
  expect((await ma(page)).result.at(-1).ma1).toBeCloseTo(expected, 8)
  expect((await ma(page)).result[998].ma1).toBeUndefined()
  const count = requests.length
  await page.getByRole('button', { name: '设置均线' }).click()
  await period(page, 1).fill('0')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect.poll(async () => (await ma(page)).visible).toBe(false)
  await page.getByRole('button', { name: '设置均线' }).click()
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect.poll(async () => (await ma(page)).periods).toEqual([25, 60, 144])
  expect((await ma(page)).visible).toBe(true)
  expect(requests).toHaveLength(count)
})

test('MA panel fits both themes and desktop sizes with keyboard focus and no overflow', async ({ page }) => {
  await openChart(page)
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size)
    for (const theme of ['dark', 'light']) {
      if (await page.locator('body').evaluate(body => body.classList.contains('dark')) !== (theme === 'dark')) await page.locator('.theme-toggle').click()
      await page.getByRole('button', { name: '设置均线' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('button', { name: '应用', exact: true })).toBeVisible()
      const box = (await page.getByRole('dialog').boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width); expect(box.y + box.height).toBeLessThanOrEqual(size.height)
      expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: evidencePath(`ma-settings-${theme}-${size.width}.png`) })
      await page.getByRole('button', { name: '取消', exact: true }).click()
    }
  }
})
