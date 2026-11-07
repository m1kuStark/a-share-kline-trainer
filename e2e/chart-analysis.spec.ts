import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

test.setTimeout(240_000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })
async function openChart(page: Page, phase = false): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 1_000_000, ...(phase ? { clock_mode: 'open_close' } : {}) } })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
}
const quote = (page: Page) => page.getByRole('group', { name: 'K线行情', exact: true })
const bars = (page: Page) => page.evaluate(() => (window as any).__trainerChart.bars() as Array<{ timestamp: number; date: string; open: number; high: number; low: number; close: number; volume: number; amount: number }>)
async function visibleStart(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as any).__trainerChart, list = hook.bars(), range = hook.visibleRange()
    const width = hook.viewportMetrics().width
    for (let index = Math.max(1, Math.ceil(range.from)); index < Math.min(range.to, list.length); index++) {
      const point = hook.pointToPixel(list[index].timestamp, list[index].close)
      if (point.x >= 100 && point.x <= width - 240) return index
    }
    throw Error('No real visible bar available for selection')
  })
}
async function position(page: Page, index: number): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(index => {
    const hook = (window as any).__trainerChart
    const bar = hook.bars()[index]
    return hook.pointToPixel(bar.timestamp, bar.close)
  }, index)
  const host = (await page.locator('.chart-host').boundingBox())!
  // A constant main-pane y avoids overlay values outside the pane after price changes.
  return { x: host.x + point.x, y: host.y + 100 }
}
async function drag(page: Page, from: number, to: number, button: 'right' | 'left' = 'right'): Promise<void> {
  const a = await position(page, from), b = await position(page, to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down({ button })
  await page.mouse.move(b.x, b.y + 20, { steps: 10 })
  if (from !== to) await expect(page.locator('.statistics-selection')).toBeVisible()
  await page.mouse.up({ button })
  if (button === 'right') {
    await expect(page.getByRole('menu', { name: '图表区间菜单' })).toBeVisible()
    await page.getByRole('menuitem', { name: /区间统计/ }).click()
  }
  await expect(page.getByRole('dialog', { name: /区间统计/ })).toBeVisible()
}
const field = (page: Page, name: string) => page.getByRole('dialog', { name: /区间统计/ }).locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${name}$`) }) }).locator('dd')
const measurementCard = (page: Page) => page.getByRole('group', { name: '两点测量', exact: true })
async function quickMeasure(page: Page, from: number, to: number): Promise<void> {
  const a = await position(page, from), b = await position(page, to)
  await page.keyboard.down('Shift')
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y + 30, { steps: 8 })
  await expect(measurementCard(page)).toBeVisible()
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(measurementCard(page)).toBeVisible()
}

test('shift-left measures the actual two prices live, preserves direction and keeps a compact result', async ({ page }) => {
  await openChart(page)
  const from = await visibleStart(page), to = from + 18, list = await bars(page)
  const coordinates = async (index: number, value: number) => {
    const point = await page.evaluate(({ index, value }) => {
      const hook = (window as any).__trainerChart
      return hook.pointToPixel(hook.bars()[index].timestamp, value)
    }, { index, value })
    const host = (await page.locator('.chart-host').boundingBox())!
    return { x: host.x + point.x, y: host.y + point.y }
  }
  const low = list[from]!.low, high = list[to]!.high
  const a = await coordinates(from, low), b = await coordinates(to, high)
  // The pinned chart rounds price->pixel to integer pixels. Measure the actual
  // picked pixel's price, independently from the axis range and pane height;
  // a projected candle high/low is not an exact inverse at arbitrary zoom.
  const axis = await page.evaluate(() => {
    const hook = (window as any).__trainerChart
    return { range: hook.yRange(), pane: hook.panes().find((pane: any) => pane.id === 'candle_pane') }
  })
  const host = (await page.locator('.chart-host').boundingBox())!
  const priceAt = (point: { y: number }) => Number((axis.range.realFrom + (1 - (point.y - host.y - axis.pane.top) / axis.pane.height) * axis.range.realRange).toFixed(2))
  const pickedLow = priceAt(a), pickedHigh = priceAt(b)
  const card = page.getByRole('group', { name: '两点测量', exact: true })
  const metric = (label: string) => card.locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
  const before = await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/bars?') || request.method() !== 'GET') requests.push(request.url()) })
  for (const [start, end, startPrice, endPrice] of [[a, b, pickedLow, pickedHigh], [b, a, pickedHigh, pickedLow], [a, { ...a, y: b.y }, pickedLow, pickedHigh]] as const) {
    await page.keyboard.down('Shift')
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 10 })
    await expect(card).toBeVisible()
    await expect(card.locator('dl > div')).toHaveCount(5)
    await expect(page.locator('.point-measure-guide')).toBeVisible()
    await expect(metric('K线数量')).toHaveText(`${start.x === end.x ? 1 : 19} 根`)
    expect(parseFloat(await metric('涨跌幅').innerText())).toBeCloseTo((endPrice / startPrice - 1) * 100, 1)
    expect(parseFloat(await metric('价差').innerText())).toBeCloseTo(endPrice - startPrice, 1)
    expect(parseFloat(await metric('起点价').innerText())).toBeCloseTo(startPrice, 1)
    expect(parseFloat(await metric('终点价').innerText())).toBeCloseTo(endPrice, 1)
    await page.keyboard.press('Space'); await page.keyboard.press('b'); await page.keyboard.press('Delete')
    await page.keyboard.up('Shift') // Releasing Shift must not hand an active drag back to zoom/drawing.
    await page.mouse.up()
    await expect(card).toBeVisible()
    const result = await card.innerText()
    await page.mouse.move(20, 20)
    expect(await card.innerText()).toBe(result)
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await page.keyboard.press('Escape')
    await expect(card).not.toBeVisible()
  }
  expect(await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))).toEqual(before)
  expect(requests).toEqual([])
})

test('shift-left ownership, cancellation and boundaries preserve drawings and existing modes', async ({ page }) => {
  await openChart(page)
  const from = await visibleStart(page), a = await position(page, from), b = await position(page, from + 8)
  const tool = page.locator('[data-tool-name="segment"]')
  if (!await tool.isVisible()) await page.locator('.other-tools-toggle').click()
  await tool.click()
  await page.keyboard.down('Shift')
  await page.mouse.click(a.x, a.y)
  await page.waitForTimeout(560)
  await page.mouse.click(b.x, b.y)
  await page.keyboard.up('Shift')
  await expect(measurementCard(page)).not.toBeVisible()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.drawings().length)).toBe(1)
  const before = await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))
  await quickMeasure(page, from, from + 8) // Explicit Shift also measures over an existing line, without grabbing it.
  await page.keyboard.press('Escape')
  await page.keyboard.down('Shift')
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y + 30, { steps: 5 })
  await expect(measurementCard(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.move(b.x + 30, b.y + 60)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(measurementCard(page)).not.toBeVisible()
  expect(await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))).toEqual(before)
  await page.keyboard.down('Control'); await page.keyboard.down('Shift')
  await page.mouse.click(a.x, a.y)
  await page.keyboard.up('Shift'); await page.keyboard.up('Control')
  await expect(measurementCard(page)).not.toBeVisible()
  await page.locator('.draw-toolbar').getByRole('button', { name: '多选', exact: true }).click()
  await page.keyboard.down('Shift'); await page.mouse.click(b.x, b.y); await page.keyboard.up('Shift')
  await expect(measurementCard(page)).not.toBeVisible()
  await page.locator('.draw-toolbar').getByRole('button', { name: '多选', exact: true }).click()
  const host = (await page.locator('.chart-host').boundingBox())!
  const width = await page.evaluate(() => (window as any).__trainerChart.viewportMetrics().width)
  await page.keyboard.down('Shift')
  await page.mouse.click(host.x + width + 12, a.y) // Price axis owns its own gestures.
  await page.keyboard.up('Shift')
  await expect(measurementCard(page)).not.toBeVisible()
  await page.keyboard.down('Shift'); await page.mouse.move(a.x, a.y); await page.mouse.down()
  await page.mouse.move(host.x + host.width + 100, host.y - 50, { steps: 8 })
  await page.mouse.up(); await page.keyboard.up('Shift')
  await expect(measurementCard(page)).toBeVisible()
  expect(Number(await page.locator('.point-measure-guide circle').last().getAttribute('cx'))).toBeLessThanOrEqual(width)
  expect(Number(await page.locator('.point-measure-guide circle').last().getAttribute('cy'))).toBe(0)
  const count = Number.parseInt(await measurementCard(page).locator('dd').last().innerText())
  expect(count).toBeLessThanOrEqual((await bars(page)).length)
  await page.mouse.click(20, 20)
  await expect(measurementCard(page)).not.toBeVisible()
  await quickMeasure(page, from, from + 8)
  await page.mouse.move(a.x, a.y); await page.mouse.wheel(0, -50)
  await expect(measurementCard(page)).not.toBeVisible()
  await quickMeasure(page, await visibleStart(page), (await visibleStart(page)) + 5)
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(measurementCard(page)).not.toBeVisible()
  await quickMeasure(page, await visibleStart(page), (await visibleStart(page)) + 5)
  await page.getByRole('tab', { name: '周K', exact: true }).click()
  await expect(measurementCard(page)).not.toBeVisible()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  const other = await page.context().newPage()
  // Playwright emulates focus for every tab. Disable that browser emulation,
  // then switch real tabs so the application receives a genuine window blur.
  for (const tab of [page, other]) {
    const session = await page.context().newCDPSession(tab)
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  }
  await page.bringToFront()
  expect(await page.evaluate(() => document.hasFocus())).toBe(true)
  const point = await position(page, await visibleStart(page))
  await page.keyboard.down('Shift'); await page.mouse.move(point.x, point.y); await page.mouse.down()
  await page.mouse.move(point.x + 30, point.y + 20)
  await expect(measurementCard(page)).toBeVisible()
  await other.bringToFront()
  expect(await page.evaluate(() => document.hasFocus())).toBe(false)
  await expect(measurementCard(page)).not.toBeVisible()
  await other.close(); await page.bringToFront()
  await page.mouse.up(); await page.keyboard.up('Shift')
})

test('quote is visible without dwell, tracks mouse/keyboard and never exposes unknown open-phase OHLC', async ({ page }) => {
  await openChart(page, true)
  const list = await bars(page), latest = list.at(-1)!
  await expect(quote(page).locator('[data-field="收"] b')).toHaveText(latest.close.toFixed(2))
  await expect(quote(page)).toContainText(latest.date)
  const currentDate = await page.locator('.training-current-date').innerText()
  expect(currentDate).not.toContain(latest.date)
  const range = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  const index = await visibleStart(page), point = await position(page, index)
  await page.mouse.move(point.x, point.y)
  await expect(quote(page).locator('[data-field="收"] b')).toHaveText(list[index]!.close.toFixed(2))
  await expect(quote(page)).toContainText('光标K线')
  const pct = (list[index]!.close / list[index - 1]!.close - 1) * 100
  expect(parseFloat((await quote(page).locator('[data-field="涨幅"] b').innerText()))).toBeCloseTo(pct, 2)
  await page.mouse.move(20, 20)
  await expect(quote(page).locator('[data-field="收"] b')).toHaveText(latest.close.toFixed(2))
  await page.keyboard.press('ArrowLeft')
  await expect(quote(page)).toContainText('光标K线')
  for (const label of ['周K', '月K', '日K']) {
    await page.getByRole('tab', { name: label, exact: true }).click()
    await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
    await expect(quote(page)).toContainText(label)
    const latestBar = (await bars(page)).at(-1)!
    await expect(quote(page).locator('[data-field="收"] b')).toHaveText(latestBar.close.toFixed(2))
  }
})

test('right drag and menu selection calculate inclusive ranges without requests or viewport/drawing changes', async ({ page }) => {
  await openChart(page)
  const range = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  const from = await visibleStart(page), to = from + 25
  const list = await bars(page), selected = list.slice(from, to + 1)
  // Finish a real drawing across the right-drag endpoint. Statistics must not
  // forward a right-click deletion to that drawing or change its coordinates.
  const tool = page.locator('[data-tool-name="segment"]')
  if (!await tool.isVisible()) await page.locator('.other-tools-toggle').click()
  await tool.click()
  const lineA = await position(page, to - 2), lineB = await position(page, to + 2)
  await page.mouse.click(lineA.x, lineA.y + 20)
  await page.waitForTimeout(560)
  await page.mouse.click(lineB.x, lineB.y + 20)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.mode().draw)).toBeNull()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.drawings().length)).toBe(1)
  const before = await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/bars?') || request.method() !== 'GET') requests.push(request.url()) })
  for (const [a, b] of [[from, to], [to, from]]) {
    await drag(page, a!, b!)
    await expect(page.getByRole('dialog')).toContainText('26 根 K 线')
    await expect(field(page, '起始开盘价')).toHaveText(selected[0]!.open.toFixed(2))
    await expect(field(page, '结束收盘价')).toHaveText(selected.at(-1)!.close.toFixed(2))
    await expect(field(page, '区间最高价')).toContainText(Math.max(...selected.map(bar => bar.high)).toFixed(2))
    await expect(field(page, '总成交量（手）')).toHaveText((selected.reduce((sum, bar) => sum + bar.volume, 0) / 100).toFixed(2))
    await expect(field(page, '总成交额（万元）')).toHaveText((selected.reduce((sum, bar) => sum + bar.amount, 0) / 10000).toFixed(2))
    const date = await page.locator('.training-current-date').innerText()
    await page.keyboard.press('Space'); await page.keyboard.press('b'); await page.keyboard.press('Delete')
    expect(await page.locator('.training-current-date').innerText()).toBe(date)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.locator('.statistics-selection')).not.toBeVisible()
  }
  const point = await position(page, from)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await page.getByRole('menuitem', { name: /区间统计/ }).click()
  await expect(page.locator('.statistics-hint')).toBeVisible()
  await drag(page, from, from, 'left')
  await expect(page.getByRole('dialog')).toContainText('1 根 K 线')
  await page.getByRole('button', { name: '关闭区间统计' }).click()
  expect(await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))).toEqual(before)
  expect(requests).toEqual([])
})

test('statistics and persistent quote fit both themes and desktop sizes; drawing right-click retains priority', async ({ page }) => {
  await openChart(page)
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size)
    for (const mode of ['dark', 'light']) {
      if (await page.locator('body').evaluate(body => body.classList.contains('dark')) !== (mode === 'dark')) await page.locator('.theme-toggle').click()
      const range = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
      const from = await visibleStart(page)
      await drag(page, from, from + 20)
      const dialog = page.getByRole('dialog'), box = (await dialog.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width); expect(box.y + box.height).toBeLessThanOrEqual(size.height)
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await quote(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: evidencePath(`chart-analysis-${mode}-${size.width}.png`) })
      await page.keyboard.press('Escape')
      await page.mouse.move(20, 20)
      await page.screenshot({ path: evidencePath(`chart-quote-${mode}-${size.width}.png`) })
      await quickMeasure(page, from, from + 20)
      const card = measurementCard(page), bounds = (await card.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height)
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expect(card.locator('dl > div')).toHaveCount(5)
      await page.screenshot({ path: evidencePath(`point-measure-${mode}-${size.width}.png`) })
      await page.keyboard.press('Escape')
    }
  }
  const tool = page.locator('[data-tool-name="segment"]')
  if (!await tool.isVisible()) await page.locator('.other-tools-toggle').click()
  await tool.click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.mode().draw)).toBe('segment')
  const point = await position(page, await visibleStart(page))
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(page.getByRole('menu', { name: '图表区间菜单' })).not.toBeVisible()
})

test('recording replay supports statistics with no training writes', async ({ page }) => {
  await openChart(page)
  await page.getByRole('button', { name: '推进下一日', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await page.waitForTimeout(600)
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  await expect(page.getByPlaceholder('股票代码，如 600519')).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '训练录像', exact: true })).toBeEnabled({ timeout: 30_000 })
  await page.locator('[data-recording-source="local"] .recording-history-open').first().click()
  await expect(page.getByRole('button', { name: '关闭回放' })).toBeVisible()
  const requests: string[] = []
  page.on('request', request => { if (request.method() !== 'GET' || request.url().includes('/bars?')) requests.push(request.url()) })
  const range = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  const from = await visibleStart(page)
  await drag(page, from, from + 10)
  await expect(quote(page)).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('11 根 K 线')
  await page.keyboard.press('Escape')
  await quickMeasure(page, from, from + 10)
  await expect(measurementCard(page).locator('dd').last()).toHaveText('11 根')
  await page.keyboard.press('Escape')
  expect(requests).toEqual([])
})

test('random-time quote and range statistics keep dates concealed', async ({ page }) => {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings/random', { data: { dimension: 'random_time', code: '600519', window_bars: 40, initial_cash: 1_000_000 } })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await expect(quote(page).locator('.chart-quote-date')).toContainText('*')
  const from = await visibleStart(page)
  await drag(page, from, from + 12)
  await expect(page.getByRole('dialog').locator('.range-stat-dates')).toContainText('*')
  expect(await page.getByRole('dialog').innerText()).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  await page.keyboard.press('Escape')
  await quickMeasure(page, from, from + 12)
  expect(await measurementCard(page).innerText()).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  await page.keyboard.press('Escape')
})
