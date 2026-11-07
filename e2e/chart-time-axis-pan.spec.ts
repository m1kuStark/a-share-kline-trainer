import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// CHART-PAN-01（Issue #8-D M 半，计划拍板：时间轴拖动平移）真浏览器回归：
// 底部时间轴普通左键左右拖动＝平移（拖右看更早、拖左看更新）；拖拽中抓手光标；
// 图表区左键框选、Shift 测量、Ctrl 多选、分隔条/轴缩放优先级不被抢占；只读回放沿用同一路径。
test.setTimeout(180_000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function openChart(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02' } })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  // 图表初始 feed/reset 有异步收敛：等可见范围连续两次稳定后再操作
  await expect.poll(async () => {
    const a = await viewport(page)
    await page.waitForTimeout(250)
    const b = await viewport(page)
    return a.realFrom === b.realFrom && a.realTo === b.realTo
  }).toBe(true)
}

async function viewport(page: Page): Promise<{ realFrom: number; realTo: number; count: number }> {
  return page.evaluate(() => {
    const range = (window as any).__trainerChart.visibleRange()
    return { realFrom: range.realFrom, realTo: range.realTo, count: range.to - range.from }
  })
}

async function axisPoint(page: Page): Promise<{ x: number; y: number }> {
  const host = (await page.locator('.chart-host').boundingBox())!
  const rects = await page.evaluate(() => (window as any).__trainerChart.paneRects())
  const axis = rects.xAxis
  return { x: host.x + axis.left + axis.width * 0.5, y: host.y + axis.top + axis.height * 0.5 }
}

test('时间轴左右拖动平移：方向/同屏根数/抓手态/手势仲裁；图表区框选不受影响', async ({ page }: { page: Page }) => {
  await openChart(page)
  const host = (await page.locator('.chart-host').boundingBox())!
  const axis = await axisPoint(page)

  // ① 悬停时间轴：抓手光标；拖动中 grabbing
  await page.mouse.move(axis.x, axis.y)
  await page.waitForTimeout(120)
  let cursor = await page.locator('.chart-host').evaluate(el => (el as HTMLElement).style.cursor)
  expect(cursor).toBe('grab')

  // ② 拖右＝看更早：realTo 减小、同屏根数不变
  const beforeRight = await viewport(page)
  await page.mouse.move(axis.x, axis.y)
  await page.mouse.down()
  await page.mouse.move(axis.x + 90, axis.y, { steps: 8 })
  cursor = await page.locator('.chart-host').evaluate(el => (el as HTMLElement).style.cursor)
  expect(cursor).toBe('grabbing')
  await page.mouse.up()
  await expect.poll(async () => (await viewport(page)).realTo).toBeLessThan(beforeRight.realTo)
  const afterRight = await viewport(page)
  expect(Math.abs(afterRight.count - beforeRight.count)).toBeLessThanOrEqual(1)

  // ③ 拖左＝看更新：realTo 增大（回到更接近最新）
  await page.mouse.move(axis.x + 90, axis.y)
  await page.mouse.down()
  await page.mouse.move(axis.x, axis.y, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await viewport(page)).realTo).toBeGreaterThan(afterRight.realTo)
  const afterLeft = await viewport(page)
  expect(Math.abs(afterLeft.count - afterRight.count)).toBeLessThanOrEqual(1)

  // ④ Shift+左键在时间轴不启动平移（测量只在绘图区启动；时间轴不响应）
  await page.keyboard.down('Shift')
  const beforeShift = await viewport(page)
  await page.mouse.move(axis.x, axis.y)
  await page.mouse.down()
  await page.mouse.move(axis.x + 60, axis.y, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  expect((await viewport(page)).realTo).toBe(beforeShift.realTo)

  // ⑤ 图表区左键拖动仍是框选缩放（不被时间轴平移抢占）：拖动中 select-rect 可见
  const candleY = host.y + 160
  const dragStart = host.x + 300
  await page.mouse.move(dragStart, candleY)
  await page.mouse.down()
  await page.mouse.move(dragStart + 120, candleY, { steps: 6 })
  await expect(page.locator('.select-rect')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.select-rect')).not.toBeVisible()

  // ⑥ 1440/1280 截图与横向溢出红线
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(350)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow, `${size.width}px 宽出现横向溢出`).toBe(false)
    await page.screenshot({ path: evidencePath(`time-axis-pan-${size.width}.png`) })
  }
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
})

test('只读回放：时间轴拖动同样可平移（不改数据/画线，无 pageerror）', async ({ page }: { page: Page }) => {
  test.setTimeout(180_000)
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const created = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02' } })
  expect(created.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出录制', exact: true }).click()
  const download = await pending
  const output = evidencePath('time-axis-pan-replay.json.gz')
  await download.saveAs(output)
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await page.getByLabel('导入录制', { exact: true }).setInputFiles(output)
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
  await page.waitForFunction(() => { const bars = (window as any).__trainerChart?.bars?.(); return !!bars && bars.length > 2 })
  const host = (await page.locator('.chart-host').boundingBox())!
  const rects = await page.evaluate(() => (window as any).__trainerChart.paneRects())
  const axis = rects.xAxis
  const x = host.x + axis.left + axis.width * 0.5, y = host.y + axis.top + axis.height * 0.5
  const before = await viewport(page)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 90, y, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await viewport(page)).realTo).toBeLessThan(before.realTo)
  expect(Math.abs((await viewport(page)).count - before.count)).toBeLessThanOrEqual(1)
  // 回放只读：画线保存按钮/编辑入口不存在，平移不触发任何写请求（pageerror 由 afterEach 断言）
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
})
