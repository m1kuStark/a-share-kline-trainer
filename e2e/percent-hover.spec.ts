import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// M6-03 悬浮信息卡（candle-percent-hover 矩阵 v2，用户 2026-10-05 验收拍板）真实浏览器回归：
// ① 训练页停留触发：指针停在同一根 K 线 800ms 不可见、≥1100ms 可见（CARD-DWELL-DELAY）；
//    卡内 日期＋开/高/低/收（两位小数）＋涨幅（红涨/绿跌/零灰，冻结公式独立计算）六项键值行
//    （CARD-CONTENTS-OHLC / PCT-VALUE-CORRECT / PCT-COLOR-CONVENTION），卡在十字线交点右下方、
//    与指针热点区（±12px）不相交、不遮价格轴/时间轴（CARD-POSITION-NO-OCCLUDE），
//    pointer-events:none，localStorage 全程不变（PCT-NO-INTERFERE）；移到另一根立即隐藏并重计时；
//    指针离开图表立即隐藏；
// ② 键盘十字线（←/→）立即显示（无 1000ms 延时，CARD-KEYBOARD-INSTANT）；
//    卡可见期间框选缩放照常（交互不受干扰）；
// ③ 录像回放视图：导出→导入录制后，卡按回放数据序列同样计算（PCT-REPLAY-PARITY），
//    并缩小＋左滚到回放序列首根验证无前收占位 "--"（灰）——回放无动态补历史，首根可达。
// 数值口径由 server/test/percent-hover.test.ts 的架构师 oracle 表锁定；本套件用同一冻结公式
// 对实时数据独立计算期望（oracleCard 不调用页面实现）。
// 注意：库的 visibleRange().from 会低估实际屏上首根（左侧柱像素可能为负），悬停目标
// 一律按 pointToPixel 的屏内像素挑选，不直接用 range.from 当作屏上首根。

type Bar = { timestamp: number; open: number; high: number; low: number; close: number; date?: string }
type HoverTarget = { index: number; x: number; y: number }
type CardOracle = { date: string; rows: string[]; pct: { text: string; cls: string } }

const errors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

/** 冻结公式（任务卡 2026-10-05）：pct=(close−prev)/prev×100 两位小数带符号；红涨/绿跌/零灰/首根"--" */
function oraclePct(close: number | null | undefined, previousClose: number | null | undefined): { text: string; cls: string } {
  const hasClose = typeof close === 'number' && Number.isFinite(close)
  const hasPrev = typeof previousClose === 'number' && Number.isFinite(previousClose) && previousClose !== 0
  if (!hasClose || !hasPrev) return { text: '--', cls: 'pct-flat' }
  const pct = ((close - previousClose) / previousClose) * 100
  const rounded = Math.round(pct * 100) / 100
  if (rounded === 0) return { text: '0.00%', cls: 'pct-flat' }
  return { text: `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`, cls: rounded > 0 ? 'pct-up' : 'pct-down' }
}

/** 卡内容独立期望：日期原样＋开/高/低/收两位小数＋涨幅（冻结公式），不调用页面实现 */
function oracleCard(bar: Bar, previousClose: number | null): CardOracle {
  return {
    date: bar.date ?? '',
    rows: [`开${bar.open.toFixed(2)}`, `高${bar.high.toFixed(2)}`, `低${bar.low.toFixed(2)}`, `收${bar.close.toFixed(2)}`],
    pct: oraclePct(bar.close, previousClose),
  }
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

function card(page: Page) { return page.locator('[data-testid="hover-card"]') }

async function chartBars(page: Page): Promise<Bar[]> {
  return page.evaluate(() => (window as any).__trainerChart.bars())
}

/**
 * 按屏内像素挑可见悬停目标（上涨/下跌/居中各一，均在主图绘图区内）。
 * 纵向留底部余量：信息卡在指针下方约 14px 处展开（高约 120px），目标须离绘图区底缘足够远，
 * 卡才不会被底缘钳位上抬（钳位时"右下方＋避让指针"几何退化，属轴保护的优先口径，不在本测断言）。
 */
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
      if (px.y < pane.top + 20 || px.y > pane.top + pane.height - 170) return null
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

/** 指针离开图表宿主（信息卡必须立即隐藏） */
async function leaveChart(page: Page, host: { x: number; y: number }): Promise<void> {
  await page.mouse.move(host.x - 30, host.y - 30, { steps: 4 })
}

/** 断言卡内容与独立期望一致（日期行＋开/高/低/收/涨幅五行＋涨幅配色档与计算色） */
async function expectCardContents(page: Page, expected: CardOracle): Promise<void> {
  await expect(page.locator('.hover-card-date')).toHaveText(expected.date)
  await expect(page.locator('[data-testid="hover-card"] .hover-card-row')).toHaveText([...expected.rows, `涨幅${expected.pct.text}`])
  const pctValue = page.locator('[data-testid="hover-card"] .hover-card-row').last().locator('.hover-card-value')
  await expect(pctValue).toHaveClass(new RegExp(expected.pct.cls))
  const rgb = expected.pct.cls === 'pct-up' ? 'rgb(239, 68, 68)' : expected.pct.cls === 'pct-down' ? 'rgb(22, 163, 74)' : 'rgb(148, 163, 184)'
  expect(await pctValue.evaluate(el => getComputedStyle(el).color)).toBe(rgb)
}

test('hover card appears after a 1s dwell with oracle rows and CN colors, clears on bar change and chart leave, no persistence', async ({ page }) => {
  await openChart(page)
  const bars = await chartBars(page)
  const targets = await pickHoverTargets(page)
  const storageBefore = await page.evaluate(() => JSON.stringify({ ...localStorage }))

  // 停留 800ms：不可见（CARD-DWELL-DELAY：未满 1000ms）
  const host = await hoverTarget(page, targets.up)
  await page.waitForTimeout(800)
  await expect(card(page)).toHaveCount(0)
  // 继续停留到 ≥1100ms：可见（同一根内未移动，计时未重置）
  await page.waitForTimeout(400)
  await expect(card(page)).toBeVisible()

  // 卡内容＝冻结公式独立计算（日期＋开/高/低/收＋涨幅，红涨色）＋纯信息层不拦截指针
  await expectCardContents(page, oracleCard(bars[targets.up.index], bars[targets.up.index - 1].close))
  expect(await card(page).evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')

  // 位置（CARD-POSITION-NO-OCCLUDE）：① 与指针热点区（±12px）不相交；② 不遮价格轴/时间轴
  const box = (await card(page).boundingBox())!
  const pointerX = host.x + targets.up.x, pointerY = host.y + targets.up.y
  const HOTSPOT = 12
  const disjoint = box.x + box.width <= pointerX - HOTSPOT || box.x >= pointerX + HOTSPOT
    || box.y + box.height <= pointerY - HOTSPOT || box.y >= pointerY + HOTSPOT
  expect(disjoint, '信息卡与指针热点区不相交').toBe(true)
  const metrics = await page.evaluate(() => {
    const t = (window as any).__trainerChart
    const pane = t.panes().find((item: { name: string }) => item.name === 'candle_pane')
    const last = t.panes().at(-1)
    return { plotRight: pane.width, plotBottom: last.top + last.height }
  })
  expect(box.x + box.width).toBeLessThanOrEqual(host.x + metrics.plotRight + 2)
  expect(box.x).toBeGreaterThanOrEqual(host.x)
  expect(box.y + box.height).toBeLessThanOrEqual(host.y + metrics.plotBottom + 2)
  await page.screenshot({ path: evidencePath('hover-card-dwell-up.png') })

  // 移到另一根 K 线：立即隐藏（重计时），停满后按新 K 线数据重现（绿跌色）
  await hoverTarget(page, targets.down)
  await expect(card(page)).toHaveCount(0)
  await page.waitForTimeout(1150)
  await expect(card(page)).toBeVisible()
  await expectCardContents(page, oracleCard(bars[targets.down.index], bars[targets.down.index - 1].close))
  await page.screenshot({ path: evidencePath('hover-card-dwell-down.png') })

  // 指针离开图表：立即隐藏；再次悬停可重现
  await leaveChart(page, host)
  await expect(card(page)).toHaveCount(0)
  await hoverTarget(page, targets.up)
  await expect(card(page)).toHaveCount(0)
  await leaveChart(page, host)
  await expect(card(page)).toHaveCount(0)
  // 信息卡状态不写任何持久层：悬停＋切换＋离开全程 localStorage 逐字节不变
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(storageBefore)
})

test('keyboard crosshair shows the card instantly (no dwell) and box select still zooms while it shows', async ({ page }) => {
  await openChart(page)
  const bars = await chartBars(page)
  // 键盘十字线（→）：定位最后一根，600ms 内可见——证明无 1000ms 停留延时（CARD-KEYBOARD-INSTANT）
  await page.keyboard.press('ArrowRight')
  const last = await page.evaluate(() => {
    const range = (window as any).__trainerChart.visibleRange()
    return Math.min(range.to - 1, (window as any).__trainerChart.bars().length - 1)
  })
  await expect(card(page)).toBeVisible({ timeout: 600 })
  await expectCardContents(page, oracleCard(bars[last], bars[last - 1].close))
  // （←）：移到前一根，内容按前一根相对其前收重算
  await page.keyboard.press('ArrowLeft')
  await expectCardContents(page, oracleCard(bars[last - 1], bars[last - 2].close))

  // 卡可见期间框选缩放照常（pointer-events:none 不吞框选手势）
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

test('replay view computes the card from the replayed series, first bar shows the gray placeholder', async ({ page }) => {
  // 建训练（默认开录制）→ 导出录制文件 → 训练录像页导入 → 只读回放
  await createTraining(page)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出录制', exact: true }).click()
  const download = await pending
  const output = evidencePath('hover-card-replay.json.gz')
  await download.saveAs(output)
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await page.getByLabel('导入录制', { exact: true }).setInputFiles(output)
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
  await page.waitForFunction(() => { const bars = (window as any).__trainerChart?.bars?.(); return !!bars && bars.length > 2 })

  // 悬停回放序列的可见 K 线（停留 ≥1s）：内容＝同一冻结公式按回放数据序列计算（PCT-REPLAY-PARITY）
  const bars = await chartBars(page)
  const targets = await pickHoverTargets(page)
  const host = await hoverTarget(page, targets.mid)
  await page.waitForTimeout(1150)
  await expect(card(page)).toBeVisible()
  await expectCardContents(page, oracleCard(bars[targets.mid.index], bars[targets.mid.index - 1].close))
  // 指针离开图表即隐藏
  await leaveChart(page, host)
  await expect(card(page)).toHaveCount(0)

  // 缩小（框选左滑）＋滚轮平移到回放序列最左（滚轮向下＝向更早 K 线平移）：回放无动态补历史，首根可达
  await page.mouse.move(host.x + host.width * .7, host.y + 150)
  await page.mouse.down()
  await page.mouse.move(host.x + host.width * .3, host.y + 150, { steps: 10 })
  await page.mouse.up()
  await page.mouse.move(host.x + host.width * .4, host.y + 150)
  await page.mouse.wheel(0, 4000)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.visibleRange().from)).toBe(0)

  // 首根（无前收）：停留后涨幅位占位 "--"（灰），开/高/低/收照常，绝不显示错误数值
  const firstPixel = await page.evaluate(() => {
    const t = (window as any).__trainerChart
    const bar = t.bars()[0]
    return t.pointToPixel(bar.timestamp, bar.close)
  })
  expect(typeof firstPixel?.x === 'number' && firstPixel.x >= 0, '首根已在屏内').toBe(true)
  await page.mouse.move(host.x + firstPixel.x, host.y + firstPixel.y, { steps: 4 })
  await page.waitForTimeout(1150)
  await expect(card(page)).toBeVisible()
  await expectCardContents(page, oracleCard(bars[0], null))
  await page.screenshot({ path: evidencePath('hover-card-replay-first-bar.png') })
})
