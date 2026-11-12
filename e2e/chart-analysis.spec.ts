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
async function twoPoint(page: Page, from: number, to: number): Promise<void> {
  const a = await position(page, from), b = await position(page, to)
  await page.keyboard.down('Shift')
  await page.mouse.click(a.x, a.y)
  await page.mouse.click(b.x, b.y)
  await page.keyboard.up('Shift')
  await expect(measurementCard(page)).toBeVisible()
}

test('Shift 两次点击 K 线形成区间测量：起止收盘/K线数/区间高低，拖动边界实时更新', async ({ page }) => {
  await openChart(page)
  const from = await visibleStart(page), to = from + 18, list = await bars(page)
  const before = await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))
  const requests: string[] = []
  page.on('request', request => {
    const url = request.url()
    if ((url.includes('/bars?') || request.method() !== 'GET') && !/\/api\/diagnostics\/events$/.test(url)) requests.push(url)
  })
  await twoPoint(page, from, to)
  const card = measurementCard(page)
  const metric = (label: string) => card.locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
  const startClose = list[from]!.close, endClose = list[to]!.close
  const highest = Math.max(...list.slice(from, to + 1).map(bar => bar.high)), lowest = Math.min(...list.slice(from, to + 1).map(bar => bar.low))
  expect(await metric('K线数量')).toHaveText('19 根')
  expect(parseFloat(await metric('起点收盘价').innerText())).toBeCloseTo(startClose, 1)
  expect(parseFloat(await metric('终点收盘价').innerText())).toBeCloseTo(endClose, 1)
  expect(parseFloat(await metric('价差').innerText())).toBeCloseTo(endClose - startClose, 1)
  expect(parseFloat(await metric('涨跌幅').innerText())).toBeCloseTo((endClose / startClose - 1) * 100, 1)
  expect(parseFloat(await metric('区间最高价').innerText())).toBeCloseTo(highest, 1)
  expect(parseFloat(await metric('区间最低价').innerText())).toBeCloseTo(lowest, 1)
  expect(await page.evaluate(() => (window as any).__trainerChart.measurement())).toMatchObject({ from, to, count: 19 })
  await expect(page.locator('.range-measure-handle[data-edge="start"]')).toBeVisible()
  await expect(page.locator('.range-measure-handle[data-edge="end"]')).toBeVisible()
  // 拖动右边界 +5 根：数据窗口实时更新（含新的起止收盘与 K 线数）
  const handle = await page.locator('.range-measure-handle[data-edge="end"]').boundingBox()
  const target = await position(page, to + 5)
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, handle!.y + handle!.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(metric('K线数量')).toHaveText('24 根')
  expect(await page.evaluate(() => (window as any).__trainerChart.measurement())).toMatchObject({ from, to: to + 5, count: 24 })
  expect(parseFloat(await metric('终点收盘价').innerText())).toBeCloseTo(list[to + 5]!.close, 1)
  // 测量激活期间训练热键被吞掉，不会误推进/误交易/误删画线
  await page.keyboard.press('Space'); await page.keyboard.press('b'); await page.keyboard.press('Delete')
  await expect(card).toBeVisible()
  expect(await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))).toEqual(before)
  expect(requests).toEqual([])
  await page.keyboard.press('Escape')
  await expect(card).not.toBeVisible()
})
test('两点测量的所有权与取消：画线/多选/价格轴/滚轮/周期切换/失焦均按既有仲裁', async ({ page }) => {
  await openChart(page)
  const from = await visibleStart(page), a = await position(page, from), b = await position(page, from + 8)
  // 画线模式激活时 Shift 点击属于取点链路，不启动测量
  const segment = page.locator('[data-tool-name="segment"]')
  if (!await segment.isVisible()) await page.locator('.other-tools-toggle').click()
  await segment.click()
  await page.keyboard.down('Shift'); await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y); await page.keyboard.up('Shift')
  await expect(measurementCard(page)).not.toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.mode().draw)).toBe(null)
  const before = await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))
  // 多选模式：Shift 点击属于多选，不启动测量
  await page.locator('.draw-toolbar').getByRole('button', { name: '多选', exact: true }).click()
  await page.keyboard.down('Shift'); await page.mouse.click(a.x, a.y); await page.keyboard.up('Shift')
  await expect(measurementCard(page)).not.toBeVisible()
  await page.locator('.draw-toolbar').getByRole('button', { name: '多选', exact: true }).click()
  // 价格轴仍归自身手势，不启动测量
  const host = (await page.locator('.chart-host').boundingBox())!, width = await page.evaluate(() => (window as any).__trainerChart.viewportMetrics().width)
  await page.keyboard.down('Shift'); await page.mouse.click(host.x + width + 12, a.y); await page.keyboard.up('Shift')
  await expect(measurementCard(page)).not.toBeVisible()
  // 正常两次点击建立区间；滚轮平移会取消测量
  await twoPoint(page, from, from + 8)
  await page.mouse.move(a.x, a.y); await page.mouse.wheel(0, -50)
  await expect(measurementCard(page)).not.toBeVisible()
  // 再次测量后切换周期取消
  await twoPoint(page, await visibleStart(page), (await visibleStart(page)) + 5)
  await page.getByRole('tab', { name: '周K', exact: true }).click()
  await expect(measurementCard(page)).not.toBeVisible()
  await page.getByRole('tab', { name: '日K', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  // 窗口失焦取消
  const other = await page.context().newPage()
  for (const tab of [page, other]) { const session = await page.context().newCDPSession(tab); await session.send('Emulation.setFocusEmulationEnabled', { enabled: false }) }
  await page.bringToFront()
  await twoPoint(page, await visibleStart(page), (await visibleStart(page)) + 4)
  await other.bringToFront()
  await expect(measurementCard(page)).not.toBeVisible()
  await other.close(); await page.bringToFront()
  // 测量不改视窗/画线；普通左键点击图表外区域同样取消
  await twoPoint(page, from, from + 8)
  await page.mouse.click(20, 20)
  await expect(measurementCard(page)).not.toBeVisible()
  expect(await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))).toEqual(before)
})
test('周K/月K 两点区间统计跟随当前周期 K 线，Select Box 边界落在 K 线中心', async ({ page }) => {
  await openChart(page)
  for (const label of ['周K', '月K'] as const) {
    await page.getByRole('tab', { name: label, exact: true }).click()
    await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
    await page.waitForTimeout(800)
    // 取可见窗口靠右（近期）的 K 线：早年前复权价可能为负，涨跌幅按设计显示 --，不适合做区间 oracle
    const range = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
    const from = Math.max(1, Math.floor(range.to) - 10), to = from + 5
    const chartBars = await page.evaluate(() => (window as any).__trainerChart.bars() as Array<{ timestamp: number; date: string; open: number; high: number; low: number; close: number }>)
    expect(chartBars[from]!.close).toBeGreaterThan(0)
    // 当前周期的 K 线数量必须与选中根数一致（此前后端已按 tf 聚合，库内 dataList 为唯一显示事实）
    expect(to).toBeLessThan(chartBars.length)
    await twoPoint(page, from, to)
    const card = measurementCard(page)
    const metric = (name: string) => card.locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${name}$`) }) }).locator('dd')
    expect(await metric('K线数量')).toHaveText('6 根')
    expect(parseFloat(await metric('起点收盘价').innerText())).toBeCloseTo(chartBars[from]!.close, 1)
    expect(parseFloat(await metric('终点收盘价').innerText())).toBeCloseTo(chartBars[to]!.close, 1)
    const selected = chartBars.slice(from, to + 1)
    expect(parseFloat(await metric('区间最高价').innerText())).toBeCloseTo(Math.max(...selected.map(bar => bar.high)), 1)
    expect(parseFloat(await metric('区间最低价').innerText())).toBeCloseTo(Math.min(...selected.map(bar => bar.low)), 1)
    const expectedChangePct = (chartBars[to]!.close / chartBars[from]!.close - 1) * 100
    expect(parseFloat(await metric('涨跌幅').innerText())).toBeCloseTo(expectedChangePct, 1)
    // Select Box 左右边界＝起止 K 线中心（与十字线竖线同一位置），不是相邻 K 线间隙
    const centers = await page.evaluate(({ from, to }) => {
      const hook = (window as any).__trainerChart, list = hook.bars()
      return { from: hook.pointToPixel(list[from].timestamp, list[from].close).x, to: hook.pointToPixel(list[to].timestamp, list[to].close).x }
    }, { from, to })
    const host = (await page.locator('.chart-host').boundingBox())!
    const box = (await page.locator('.range-measure-box').boundingBox())!
    expect(Math.abs(box.x - (host.x + centers.from))).toBeLessThanOrEqual(2)
    expect(Math.abs(box.x + box.width - (host.x + centers.to))).toBeLessThanOrEqual(2)
    const handleStart = (await page.locator('.range-measure-handle[data-edge="start"]').boundingBox())!
    const handleEnd = (await page.locator('.range-measure-handle[data-edge="end"]').boundingBox())!
    expect(Math.abs(handleStart.x + handleStart.width / 2 - (host.x + centers.from))).toBeLessThanOrEqual(2)
    expect(Math.abs(handleEnd.x + handleEnd.width / 2 - (host.x + centers.to))).toBeLessThanOrEqual(2)
    await page.keyboard.press('Escape')
    await expect(card).not.toBeVisible()
  }
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
  page.on('request', request => { const url = request.url(); if ((url.includes('/bars?') || request.method() !== 'GET') && !/\/api\/diagnostics\/events$/.test(url)) requests.push(url) })
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

test('range statistics and point measurement stay on real prices while the price mirror is on', async ({ page }) => {
  await openChart(page)
  const from = await visibleStart(page), to = from + 17
  const real = await bars(page), selected = real.slice(from, to + 1)
  const base = real[from - 1]?.close ?? selected[0]!.open
  const expected = {
    pct: (selected[selected.length - 1]!.close / base - 1) * 100,
    change: selected[selected.length - 1]!.close - base,
    high: Math.max(...selected.map(bar => bar.high)),
    low: Math.min(...selected.map(bar => bar.low)),
  }
  const readStats = async () => {
    const dialog = page.getByRole('dialog', { name: /区间统计/ })
    await expect(dialog).toBeVisible()
    const snapshot = {
      pct: parseFloat(await field(page, '区间涨跌幅').innerText()),
      change: parseFloat(await field(page, '区间涨跌额').innerText()),
      high: parseFloat(await field(page, '区间最高价').innerText()),
      low: parseFloat(await field(page, '区间最低价').innerText()),
    }
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    return snapshot
  }
  // 关闭镜像：统计＝真实序列手算值（既有基线）
  await drag(page, from, to, 'right')
  const plain = await readStats()
  expect(plain.pct).toBeCloseTo(expected.pct, 1)
  expect(plain.change).toBeCloseTo(expected.change, 1)
  expect(plain.high).toBeCloseTo(expected.high, 1)
  expect(plain.low).toBeCloseTo(expected.low, 1)

  // 开启多空反转：库内喂入镜像序列，统计仍必须以 loadedData 真实序列计算
  const toggle = page.getByRole('button', { name: '多空反转', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.bars()[5].close)).not.toBeCloseTo(real[5]!.close, 2)
  await drag(page, from, to, 'right')
  const mirrored = await readStats()
  expect(mirrored.pct).toBeCloseTo(expected.pct, 1)
  expect(mirrored.change).toBeCloseTo(expected.change, 1)
  expect(mirrored.high).toBeCloseTo(expected.high, 1)
  expect(mirrored.low).toBeCloseTo(expected.low, 1)

  // 两点测量：区间口径以真实 loadedData 收盘价计算（镜像态显示真实价，不撒谎）
  await twoPoint(page, from, to)
  const metric = (label: string) => measurementCard(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
  const readNumber = async (label: string) => parseFloat(await metric(label).innerText())
  expect(await readNumber('起点收盘价')).toBeCloseTo(real[from]!.close, 1)
  expect(await readNumber('终点收盘价')).toBeCloseTo(real[to]!.close, 1)
  expect(await readNumber('价差')).toBeCloseTo(real[to]!.close - real[from]!.close, 1)
  expect(await readNumber('涨跌幅')).toBeCloseTo((real[to]!.close / real[from]!.close - 1) * 100, 1)
  await page.keyboard.press('Escape')
  await expect(measurementCard(page)).not.toBeVisible()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
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
      await twoPoint(page, from, from + 20)
      const card = measurementCard(page), bounds = (await card.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height)
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expect(card.locator('dl > div')).toHaveCount(12)
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
  page.on('request', request => { const url = request.url(); if ((request.method() !== 'GET' || url.includes('/bars?')) && !/\/api\/diagnostics\/events$/.test(url)) requests.push(url) })
  const range = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  const from = await visibleStart(page)
  await drag(page, from, from + 10)
  await expect(quote(page)).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('11 根 K 线')
  await page.keyboard.press('Escape')
  await twoPoint(page, from, from + 10)
  await expect(measurementCard(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^K线数量$/ }) }).locator('dd')).toHaveText('11 根')
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
  await twoPoint(page, from, from + 12)
  expect(await measurementCard(page).innerText()).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  await page.keyboard.press('Escape')
})

// CHART-MEASURE-05（用户 2026-11-13 验收反馈）：顶栏不再提供测量入口，Shift 两次点击仍是唯一区间测量方式。
test('顶栏不再提供测量入口：Shift 两次点击仍是唯一区间测量方式', async ({ page }) => {
  await openChart(page)
  await expect(page.getByRole('button', { name: '测量', exact: true })).toHaveCount(0)
  const from = await visibleStart(page)
  await twoPoint(page, from, from + 10)
  await expect(measurementCard(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: /^K线数量/ }) }).locator('dd')).toHaveText('11 根')
  await page.keyboard.press('Escape')
  await expect(measurementCard(page)).not.toBeVisible()
})
