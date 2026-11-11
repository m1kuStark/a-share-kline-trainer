import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// CHART-MEASURE-04：可发现的测量工具（顶栏「测量」入口＋拖动/两次点击建立）。
// 独立 oracle：起止收盘/K线数/区间高低全部用 __trainerChart.bars()（图表真实数据）手算，
// 并对比同区间 Shift 两点测量的数据窗口字段（既有冻结口径），不从被测实现反推预期。
test.setTimeout(240_000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function openChart(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 1_000_000 } })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
}
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
  return { x: host.x + point.x, y: host.y + 100 }
}
const measureButton = (page: Page) => page.getByRole('button', { name: '测量', exact: true })
const measureHint = (page: Page) => page.locator('.measure-hint')
const measurementCard = (page: Page) => page.getByRole('group', { name: '两点测量', exact: true })
const mode = (page: Page) => page.evaluate(() => (window as any).__trainerChart.mode() as { draw: string | null; multiSelect: boolean; measure: boolean })
const measurementTool = (page: Page) => page.evaluate(() => (window as any).__trainerChart.measurementTool() as {
  mode: boolean; anchor: number | null; range: { from: number; to: number; count: number } | null
})
const metric = (page: Page, label: string) => measurementCard(page).locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
async function cardFields(page: Page): Promise<Array<[string, string]>> {
  const rows = measurementCard(page).locator('dl > div'), count = await rows.count(), fields: Array<[string, string]> = []
  for (let index = 0; index < count; index++) fields.push([await rows.nth(index).locator('dt').innerText(), await rows.nth(index).locator('dd').innerText()])
  return fields
}
function watchWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', request => {
    const url = request.url()
    if (request.method() !== 'GET' && !/\/api\/diagnostics\/events$/.test(url)) writes.push(`${request.method()} ${url}`)
  })
  return writes
}
async function enterMeasure(page: Page): Promise<void> {
  await measureButton(page).click()
  await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(measureHint(page)).toBeVisible()
}
// 拖动建立：按住左键从起点 K 线拖到终点 K 线。拖动期间只显示 Select Box 预览，松手才出数据窗口。
async function dragCreate(page: Page, from: number, to: number): Promise<void> {
  const a = await position(page, from), b = await position(page, to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await expect(page.locator('.range-measure-preview')).toBeVisible()
  await expect(measurementCard(page)).not.toBeVisible()
  await page.mouse.up()
  await expect(measurementCard(page)).toBeVisible()
}

test('测量入口在顶栏可见、可键盘切换，1024×680 深浅主题下顶栏不溢出', async ({ page }) => {
  await openChart(page)
  await page.setViewportSize({ width: 1024, height: 680 })
  await page.waitForTimeout(300)
  const button = measureButton(page)
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  // 可发现入口：中文名称/title＋尺子类图标（lucide SVG）
  expect(await button.locator('svg').count()).toBeGreaterThan(0)
  expect((await button.getAttribute('title')) ?? '').toContain('测量')
  // 顶栏与文档不横向溢出，入口完整落在 1024 视口内
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
  expect(await page.locator('.training-topbar').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  const box = (await button.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(1024)
  for (const theme of ['dark', 'light'] as const) {
    if (await page.locator('body').evaluate(body => body.classList.contains('dark')) !== (theme === 'dark')) await page.locator('.theme-toggle').click()
    await expect(button).toBeVisible()
    await page.screenshot({ path: evidencePath(`measure-tool-entry-${theme}-1024.png`) })
  }
  // 键盘聚焦并回车切换
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(measureHint(page)).toHaveText('测量模式：拖动或两次点击选择起止K线，Esc 退出')
  expect((await mode(page)).measure).toBe(true)
  await page.keyboard.press('Escape')
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect(measureHint(page)).not.toBeVisible()
  expect((await mode(page)).measure).toBe(false)
  // 再次点击入口进入，再点一次退出并清除
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
})

test('拖动建立区间测量：实时预览、松手出窗口、反向归一、边界可拖、字段与 Shift 完全一致且不写数据', async ({ page }) => {
  await openChart(page)
  const from = await visibleStart(page), to = from + 18
  const list = await bars(page)
  const before = await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))
  const requests: string[] = []
  const writes = watchWrites(page)
  page.on('request', request => { const url = request.url(); if (url.includes('/bars?') && !/\/api\/diagnostics\/events$/.test(url)) requests.push(url) })
  await enterMeasure(page)
  await dragCreate(page, from, to)
  const card = measurementCard(page)
  // 独立 oracle：起止收盘/价差/涨跌幅/区间高低按图表真实 bars 手算
  const startClose = list[from]!.close, endClose = list[to]!.close
  const selected = list.slice(from, to + 1)
  expect(await metric(page, 'K线数量')).toHaveText('19 根')
  expect(parseFloat(await metric(page, '起点收盘价').innerText())).toBeCloseTo(startClose, 1)
  expect(parseFloat(await metric(page, '终点收盘价').innerText())).toBeCloseTo(endClose, 1)
  expect(parseFloat(await metric(page, '价差').innerText())).toBeCloseTo(endClose - startClose, 1)
  expect(parseFloat(await metric(page, '涨跌幅').innerText())).toBeCloseTo((endClose / startClose - 1) * 100, 1)
  expect(parseFloat(await metric(page, '区间最高价').innerText())).toBeCloseTo(Math.max(...selected.map(bar => bar.high)), 1)
  expect(parseFloat(await metric(page, '区间最低价').innerText())).toBeCloseTo(Math.min(...selected.map(bar => bar.low)), 1)
  expect(await measurementTool(page)).toMatchObject({ mode: true, anchor: null, range: { from, to, count: 19 } })
  await expect(page.locator('.range-measure-handle[data-edge="start"]')).toBeVisible()
  await expect(page.locator('.range-measure-handle[data-edge="end"]')).toBeVisible()
  const forwardFields = await cardFields(page)
  // 模式保持激活：可继续建立新测量
  expect((await mode(page)).measure).toBe(true)
  // 反向拖动（终点→起点）归一为同一区间与同一窗口。已建立测量的边界手柄拥有从起止 K 线上
  // 起拖的手势（既有 CHART-MEASURE-03 边界调整），因此先 Esc 退出清除、再重新进入做反向建立。
  await page.keyboard.press('Escape')
  await expect(card).not.toBeVisible()
  await enterMeasure(page)
  await dragCreate(page, to, from)
  expect(await measurementTool(page)).toMatchObject({ mode: true, range: { from, to, count: 19 } })
  expect(await cardFields(page)).toEqual(forwardFields)
  // 边界仍可拖动：右边界 +5 根，数据窗口实时更新
  const handle = await page.locator('.range-measure-handle[data-edge="end"]').boundingBox()
  const target = await position(page, to + 5)
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, handle!.y + handle!.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(metric(page, 'K线数量')).toHaveText('24 根')
  expect(await measurementTool(page)).toMatchObject({ mode: true, range: { from, to: to + 5, count: 24 } })
  expect(parseFloat(await metric(page, '终点收盘价').innerText())).toBeCloseTo(list[to + 5]!.close, 1)
  const measureModeFields = await cardFields(page)
  // Esc 退出模式并清除，再以既有 Shift 两次点击测量同一区间：数据窗口字段必须完全一致
  await page.keyboard.press('Escape')
  await expect(card).not.toBeVisible()
  await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'false')
  const a = await position(page, from), b = await position(page, to + 5)
  await page.keyboard.down('Shift')
  await page.mouse.click(a.x, a.y)
  await page.mouse.click(b.x, b.y)
  await page.keyboard.up('Shift')
  await expect(measurementCard(page)).toBeVisible()
  expect(await cardFields(page)).toEqual(measureModeFields)
  await page.keyboard.press('Escape')
  await expect(measurementCard(page)).not.toBeVisible()
  // 不写训练/画线/录像、不重载 bars、视窗不变
  expect(writes).toEqual([])
  expect(requests).toEqual([])
  expect(await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))).toEqual(before)
})

test('两次点击建立区间测量：首次点击虚线锚点提示、反向归一、再次建立替换旧值', async ({ page }) => {
  await openChart(page)
  const from = await visibleStart(page), to = from + 12
  const writes = watchWrites(page)
  await enterMeasure(page)
  const a = await position(page, from), b = await position(page, to)
  // 第一次点击＝起点虚线竖线提示（复用既有 measurementAnchor 视觉），尚未出窗口
  await page.mouse.click(a.x, a.y)
  await expect(page.locator('.range-measure-anchor')).toBeVisible()
  await expect(measurementCard(page)).not.toBeVisible()
  expect(await measurementTool(page)).toMatchObject({ mode: true, anchor: from, range: null })
  // 锚点竖线落在该 K 线中心（浏览器真实几何测量）
  const center = await page.evaluate(index => {
    const hook = (window as any).__trainerChart, bar = hook.bars()[index]
    return hook.pointToPixel(bar.timestamp, bar.close).x
  }, from)
  const host = (await page.locator('.chart-host').boundingBox())!
  const anchorBox = (await page.locator('.range-measure-anchor').boundingBox())!
  expect(Math.abs(anchorBox.x + anchorBox.width / 2 - (host.x + center))).toBeLessThanOrEqual(2)
  // 第二次点击＝终点，建立区间
  await page.mouse.click(b.x, b.y)
  await expect(measurementCard(page)).toBeVisible()
  expect(await measurementTool(page)).toMatchObject({ mode: true, anchor: null, range: { from, to, count: 13 } })
  // 反向两次点击（先终点再起点）归一为同一区间；同理先退出清除再重新进入（起止 K 线位置已被边界手柄占用）
  await page.keyboard.press('Escape')
  await expect(measurementCard(page)).not.toBeVisible()
  await enterMeasure(page)
  await page.mouse.click(b.x, b.y)
  expect(await measurementTool(page)).toMatchObject({ mode: true, anchor: to, range: null })
  await page.mouse.click(a.x, a.y)
  expect(await measurementTool(page)).toMatchObject({ range: { from, to, count: 13 } })
  // 再次点击两下建立新测量（替换旧值）：点在既有 Select Box 左侧空白（数据窗口在右侧、边界手柄在起止 K 线上）
  const c = await position(page, from - 8), d = await position(page, from - 3)
  await page.mouse.click(c.x, c.y)
  expect(await measurementTool(page)).toMatchObject({ anchor: from - 8, range: null })
  await expect(measurementCard(page)).not.toBeVisible()
  await page.mouse.click(d.x, d.y)
  expect(await measurementTool(page)).toMatchObject({ range: { from: from - 8, to: from - 3, count: 6 } })
  expect(await metric(page, 'K线数量')).toHaveText('6 根')
  await page.screenshot({ path: evidencePath('measure-tool-window-1440.png') })
  await page.keyboard.press('Escape')
  await expect(measurementCard(page)).not.toBeVisible()
  await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'false')
  expect(writes).toEqual([])
})

test('测量模式的互斥与仲裁：画线/多选互斥、热键被吞、滚轮/价格轴/时间轴/切周期按既有路径清理', async ({ page }) => {
  await openChart(page)
  const from = await visibleStart(page), to = from + 10
  const before = await page.evaluate(() => ({ range: (window as any).__trainerChart.visibleRange(), drawings: (window as any).__trainerChart.drawings() }))
  const writes = watchWrites(page)
  // 先进入画线工具，再点「测量」：进入测量清除 drawTool
  const tool = page.locator('[data-tool-name="segment"]')
  if (!await tool.isVisible()) await page.locator('.other-tools-toggle').click()
  await tool.click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.mode().draw)).toBe('segment')
  await measureButton(page).click()
  expect(await mode(page)).toMatchObject({ measure: true, draw: null })
  // 选画线工具退出测量
  await tool.click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.mode().measure)).toBe(false)
  await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.mode().draw)).toBe(null)
  // 多选模式与测量互斥
  await page.locator('.draw-toolbar').getByRole('button', { name: '多选', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.mode().multiSelect)).toBe(true)
  await measureButton(page).click()
  expect(await mode(page)).toMatchObject({ measure: true, multiSelect: false })
  await measureButton(page).click()
  // 建立测量后交易/推进/删除热键被吞，画线不变
  await enterMeasure(page)
  await dragCreate(page, from, to)
  const date = await page.locator('.training-current-date').innerText()
  await page.keyboard.press('Space'); await page.keyboard.press('b'); await page.keyboard.press('Delete')
  expect(await page.locator('.training-current-date').innerText()).toBe(date)
  await expect(measurementCard(page)).toBeVisible()
  expect(await page.evaluate(() => (window as any).__trainerChart.drawings())).toEqual(before.drawings)
  // 滚轮：清除当前测量但保留测量模式，且不留下陈旧 Select Box
  const a = await position(page, from)
  await page.mouse.move(a.x, a.y)
  await page.mouse.wheel(0, -50)
  await expect(measurementCard(page)).not.toBeVisible()
  expect((await mode(page)).measure).toBe(true)
  await expect(page.locator('.range-measure-preview')).toHaveCount(0)
  // 价格轴：轴手势优先，不建立测量（模式保留）
  const width = await page.evaluate(() => (window as any).__trainerChart.viewportMetrics().width)
  const hostBox = (await page.locator('.chart-host').boundingBox())!
  await page.mouse.click(hostBox.x + width + 12, a.y)
  expect(await measurementTool(page)).toMatchObject({ mode: true, range: null, anchor: null })
  // 时间轴：拖动平移优先（CHART-PAN-01），不建立测量
  const paneRects = await page.evaluate(() => (window as any).__trainerChart.paneRects())
  const timeY = hostBox.y + paneRects.xAxis.top + paneRects.xAxis.height / 2
  await page.mouse.move(hostBox.x + 320, timeY)
  await page.mouse.down()
  await page.mouse.move(hostBox.x + 260, timeY, { steps: 6 })
  await page.mouse.up()
  expect(await measurementTool(page)).toMatchObject({ mode: true, range: null, anchor: null })
  // 模式内主图空白左拖不再触发框选缩放：建立测量不改变视窗
  const afterAxis = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  const from2 = await visibleStart(page), to2 = from2 + 6
  await dragCreate(page, from2, to2)
  expect(await page.evaluate(() => (window as any).__trainerChart.visibleRange())).toEqual(afterAxis)
  // 切周期：退出测量模式并清除
  await page.getByRole('tab', { name: '周K', exact: true }).click()
  await expect(measureButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(measurementCard(page)).not.toBeVisible()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await page.getByRole('tab', { name: '日K', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__trainerChart.drawings())).toEqual(before.drawings)
  expect(writes).toEqual([])
})

test('多空反转开启时测量模式仍按真实价计算与显示', async ({ page }) => {
  await openChart(page)
  const from = await visibleStart(page), to = from + 14
  const real = await bars(page)
  const toggle = page.getByRole('button', { name: '多空反转', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.bars()[5].close)).not.toBeCloseTo(real[5]!.close, 2)
  await enterMeasure(page)
  await dragCreate(page, from, to)
  expect(parseFloat(await metric(page, '起点收盘价').innerText())).toBeCloseTo(real[from]!.close, 1)
  expect(parseFloat(await metric(page, '终点收盘价').innerText())).toBeCloseTo(real[to]!.close, 1)
  expect(parseFloat(await metric(page, '价差').innerText())).toBeCloseTo(real[to]!.close - real[from]!.close, 1)
  expect(parseFloat(await metric(page, '涨跌幅').innerText())).toBeCloseTo((real[to]!.close / real[from]!.close - 1) * 100, 1)
  await page.screenshot({ path: evidencePath('measure-tool-mirror-1440.png') })
  await page.keyboard.press('Escape')
  await expect(measurementCard(page)).not.toBeVisible()
})

test('只读回放：新模式不启用且零报错，既有 Shift 测量仍只读可用', async ({ page }) => {
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
  const writes = watchWrites(page)
  const from = await visibleStart(page), a = await position(page, from), b = await position(page, from + 10)
  expect((await mode(page)).measure).toBe(false)
  await page.keyboard.down('Shift')
  await page.mouse.click(a.x, a.y)
  await page.mouse.click(b.x, b.y)
  await page.keyboard.up('Shift')
  await expect(measurementCard(page)).toBeVisible()
  await expect(metric(page, 'K线数量')).toHaveText('11 根')
  await page.keyboard.press('Escape')
  await expect(measurementCard(page)).not.toBeVisible()
  expect(writes).toEqual([])
})
