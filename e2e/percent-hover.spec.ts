import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// M6-02 涨幅百分比随指针显示（candle-percent-hover 矩阵）真实浏览器回归：
// ① 训练页悬停：徽标随指针出现，文本/配色（红涨绿跌零灰）按冻结公式独立计算，不遮价格轴，
//    pointer-events:none，localStorage 全程不变（不写任何持久层）；指针离开即隐藏；
// ② 键盘十字线（←/→）同样驱动徽标；徽标可见期间框选缩放照常（交互不受干扰）；
// ③ 录像回放视图：导出→导入录制后，徽标按回放数据序列同样计算（PCT-REPLAY-PARITY），
//    并缩小＋左滚到回放序列首根验证无前收占位 "--"（灰）——回放无动态补历史，首根可达。
// 数值口径由 server/test/percent-hover.test.ts 的架构师 oracle 表锁定；本套件用同一冻结公式
// 对实时数据独立计算期望（oracleBadge 不调用页面实现）。
// 注意：库的 visibleRange().from 会低估实际屏上首根（左侧柱像素可能为负），悬停目标
// 一律按 pointToPixel 的屏内像素挑选，不直接用 range.from 当作屏上首根。

type Bar = { timestamp: number; close: number }
type HoverTarget = { index: number; x: number; y: number }

const errors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

/** 冻结公式（任务卡 2026-10-05）：pct=(close−prev)/prev×100 两位小数带符号；红涨/绿跌/零灰/首根"--" */
function oracleBadge(close: number | null | undefined, previousClose: number | null | undefined): { text: string; cls: string } {
  const hasClose = typeof close === 'number' && Number.isFinite(close)
  const hasPrev = typeof previousClose === 'number' && Number.isFinite(previousClose) && previousClose !== 0
  if (!hasClose || !hasPrev) return { text: '--', cls: 'pct-flat' }
  const pct = ((close - previousClose) / previousClose) * 100
  const rounded = Math.round(pct * 100) / 100
  if (rounded === 0) return { text: '0.00%', cls: 'pct-flat' }
  return { text: `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`, cls: rounded > 0 ? 'pct-up' : 'pct-down' }
}

async function createTraining(page: Page): Promise<void> {
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  const response = await page.request.post('/api/trainings', {
    data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 100_000_000 },
  })
  expect(response.status()).toBe(201)
}

async function openChart(page: Page): Promise<void> {
  await createTraining(page)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(page.locator('.loading-dot')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.bars?.().length ?? 0)).toBeGreaterThan(2)
}

function badge(page: Page) { return page.locator('[data-testid="pct-badge"]') }

async function chartBars(page: Page): Promise<Bar[]> {
  return page.evaluate(() => (window as any).__trainerChart.bars())
}

/** 按屏内像素挑可见悬停目标（上涨/下跌/居中各一，均在主图绘图区内且离边缘有余量） */
async function pickHoverTargets(page: Page): Promise<{ up: HoverTarget; down: HoverTarget; mid: HoverTarget }> {
  const picked = await page.evaluate(() => {
    const t = (window as any).__trainerChart
    const bars = t.bars()
    const range = t.visibleRange()
    const pane = t.panes().find((item: { name: string }) => item.name === 'candle_pane')
    const usable = (i: number): { index: number; x: number; y: number } | null => {
      const px = t.pointToPixel(bars[i].timestamp, bars[i].close)
      if (!px || typeof px.x !== 'number' || typeof px.y !== 'number') return null
      if (px.x < 30 || px.x > pane.width - 60) return null
      if (px.y < pane.top + 20 || px.y > pane.top + pane.height - 20) return null
      return { index: i, x: px.x, y: px.y }
    }
    let up: { index: number; x: number; y: number } | null = null
    let down: { index: number; x: number; y: number } | null = null
    const mids: Array<{ index: number; x: number; y: number }> = []
    for (let i = Math.max(1, Math.ceil(range.from)); i < Math.min(range.to, bars.length); i++) {
      const target = usable(i)
      if (!target) continue
      if (!up && bars[i].close > bars[i - 1].close) up = target
      if (!down && bars[i].close < bars[i - 1].close) down = target
      mids.push(target)
    }
    return { up, down, mid: mids[Math.floor(mids.length / 2)] ?? null }
  })
  expect(picked.up, '可见窗口内存在可悬停的上涨 K 线').toBeTruthy()
  expect(picked.down, '可见窗口内存在可悬停的下跌 K 线').toBeTruthy()
  expect(picked.mid, '可见窗口内存在可悬停的居中 K 线').toBeTruthy()
  return picked
}

/** 把鼠标移动到已挑好的悬停目标（宿主坐标系像素）；返回宿主 boundingBox 供后续步骤复用 */
async function hoverTarget(page: Page, target: HoverTarget): Promise<{ x: number; y: number; width: number; height: number }> {
  const host = (await page.locator('.chart-host').boundingBox())!
  await page.mouse.move(host.x + target.x, host.y + target.y, { steps: 4 })
  return host
}

/** 指针离开图表宿主（徽标必须隐藏） */
async function leaveChart(page: Page, host: { x: number; y: number }): Promise<void> {
  await page.mouse.move(host.x - 30, host.y - 30, { steps: 4 })
}

test('percent badge follows the pointer with oracle text, CN colors, no persistence, and hides on leave', async ({ page }) => {
  await openChart(page)
  const bars = await chartBars(page)
  const targets = await pickHoverTargets(page)

  // 悬停上涨 K 线：文本＝冻结公式独立计算；红涨色＋不拦截指针事件
  const host = await hoverTarget(page, targets.up)
  await expect(badge(page)).toBeVisible()
  await expect(badge(page)).toHaveText(oracleBadge(bars[targets.up.index].close, bars[targets.up.index - 1].close).text)
  await expect(badge(page)).toHaveClass(/pct-up/)
  expect(await badge(page).evaluate(el => getComputedStyle(el).color)).toBe('rgb(239, 68, 68)')
  expect(await badge(page).evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')

  // 徽标不遮价格轴：右缘不得越过主图绘图区右缘（主图 pane 宽度＝价格轴左缘）
  const box = await badge(page).boundingBox()
  const paneWidth = await page.evaluate(() => (window as any).__trainerChart.panes().find((item: { name: string }) => item.name === 'candle_pane').width)
  expect(box!.x + box!.width).toBeLessThanOrEqual(host.x + paneWidth + 2)

  // 悬停下跌 K 线：徽标跟随指针并转绿
  await hoverTarget(page, targets.down)
  await expect(badge(page)).toHaveText(oracleBadge(bars[targets.down.index].close, bars[targets.down.index - 1].close).text)
  await expect(badge(page)).toHaveClass(/pct-down/)
  expect(await badge(page).evaluate(el => getComputedStyle(el).color)).toBe('rgb(22, 163, 74)')
  await page.screenshot({ path: evidencePath('percent-hover-down-bar.png') })

  // 徽标状态不写任何持久层：悬停＋离开全程 localStorage 逐字节不变
  const storageBefore = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  await leaveChart(page, host)
  await expect(badge(page)).toHaveCount(0)
  await hoverTarget(page, targets.up)
  await expect(badge(page)).toBeVisible()
  await leaveChart(page, host)
  await expect(badge(page)).toHaveCount(0)
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(storageBefore)
})

test('keyboard crosshair drives the badge and box select still zooms while it shows', async ({ page }) => {
  await openChart(page)
  const bars = await chartBars(page)
  // 键盘十字线（→）：定位最后一根，徽标随十字线锚点出现
  await page.keyboard.press('ArrowRight')
  const last = await page.evaluate(() => {
    const range = (window as any).__trainerChart.visibleRange()
    return Math.min(range.to - 1, (window as any).__trainerChart.bars().length - 1)
  })
  await expect(badge(page)).toBeVisible()
  await expect(badge(page)).toHaveText(oracleBadge(bars[last].close, bars[last - 1].close).text)
  // （←）：移到前一根，文本按前一根相对其前收重算
  await page.keyboard.press('ArrowLeft')
  await expect(badge(page)).toHaveText(oracleBadge(bars[last - 1].close, bars[last - 2].close).text)

  // 徽标可见期间框选缩放照常（pointer-events:none 不吞框选手势）
  const host = (await page.locator('.chart-host').boundingBox())!
  const before = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  await page.mouse.move(host.x + host.width * .3, host.y + 150)
  await page.mouse.down()
  await page.mouse.move(host.x + host.width * .7, host.y + 150, { steps: 10 })
  await expect(page.locator('.select-rect')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.select-rect')).not.toBeVisible()
  const after = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  expect(after.to - after.from).toBeLessThan(before.to - before.from)
})

test('replay view computes the badge from the replayed series, first bar shows the gray placeholder', async ({ page }) => {
  // 建训练（默认开录制）→ 导出录制文件 → 训练录像页导入 → 只读回放
  await createTraining(page)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出录制', exact: true }).click()
  const download = await pending
  const output = evidencePath('percent-hover-replay.json.gz')
  await download.saveAs(output)
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await page.getByLabel('导入录制', { exact: true }).setInputFiles(output)
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
  await page.waitForFunction(() => { const bars = (window as any).__trainerChart?.bars?.(); return !!bars && bars.length > 2 })

  // 悬停回放序列的可见 K 线：文本＝同一冻结公式按回放数据序列计算（PCT-REPLAY-PARITY）
  const bars = await chartBars(page)
  const targets = await pickHoverTargets(page)
  const host = await hoverTarget(page, targets.mid)
  await expect(badge(page)).toBeVisible()
  await expect(badge(page)).toHaveText(oracleBadge(bars[targets.mid.index].close, bars[targets.mid.index - 1].close).text)
  // 指针离开图表即隐藏
  await leaveChart(page, host)
  await expect(badge(page)).toHaveCount(0)

  // 缩小（框选左滑）＋滚轮平移到回放序列最左（滚轮向下＝向更早 K 线平移）：回放无动态补历史，首根可达
  await page.mouse.move(host.x + host.width * .7, host.y + 150)
  await page.mouse.down()
  await page.mouse.move(host.x + host.width * .3, host.y + 150, { steps: 10 })
  await page.mouse.up()
  await page.mouse.move(host.x + host.width * .4, host.y + 150)
  await page.mouse.wheel(0, 4000)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.visibleRange().from)).toBe(0)

  // 首根（无前收）：占位 "--"（灰），绝不显示错误数值
  const firstPixel = await page.evaluate(() => {
    const t = (window as any).__trainerChart
    const bar = t.bars()[0]
    return t.pointToPixel(bar.timestamp, bar.close)
  })
  expect(typeof firstPixel?.x === 'number' && firstPixel.x >= 0, '首根已在屏内').toBe(true)
  await page.mouse.move(host.x + firstPixel.x, host.y + firstPixel.y, { steps: 4 })
  await expect(badge(page)).toBeVisible()
  await expect(badge(page)).toHaveText('--')
  await expect(badge(page)).toHaveClass(/pct-flat/)
  expect(await badge(page).evaluate(el => getComputedStyle(el).color)).toBe('rgb(148, 163, 184)')
  await page.screenshot({ path: evidencePath('percent-hover-replay-first-bar.png') })
})
