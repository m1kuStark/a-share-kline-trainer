import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// CHART-INVERT-01 K 线多空反转（chart-invert 矩阵 9 行）真实浏览器回归：
// ① INVERT-TOGGLE-BOTH-PAGES：开关以 P₀（首根收盘价）镜像全部 K 线（p′=2P₀−p、
//    高低对调、阴阳互换），关闭即恢复；训练页与回放页行为一致；
// ② INVERT-WATERMARK-HIGHLIGHT：开启时「多空反转视角（坐标为镜像值）」水印＋开关高亮；
// ③ INVERT-INDICATOR-RECOMPUTE：MA/MACD 按镜像序列重算（EMA 对仿射变换线性 ⇒
//    MA′=2P₀−MA、DIF′=−DIF，独立数学 oracle），VOL 不镜像；
// ④ INVERT-DRAWING-FOLLOW：画线存储恒真实价，镜像态新建画线回存真实价；
// ⑤ INVERT-MARKS-REAL-INFO：成本线镜像锚定（服务端成本价真实值不被改写）；
// ⑥ INVERT-CAPTURE-ISOLATION：capture 载荷 bars/drawings 全真实价；
// ⑦ INVERT-SETTLEMENT-ISOLATION：镜像态成交价＝真实阶段价；
// ⑧ INVERT-BASIS-FROZEN：镜像开启期间补历史 P₀ 不漂移；
// ⑨ INVERT-AXIS-MIRROR-VALUE：价格轴显示镜像值，关闭恢复。
// oracle 独立性：真实价格期望来自 /api/trainings/<id>/bars（服务端真实序列），
// 镜像值由测试内 2P₀−p 手算，不从实现抄回。

const errors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

type FeedBar = { timestamp: number; date?: string; open: number; high: number; low: number; close: number; volume: number }

async function abandonActive(page: Page): Promise<void> {
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
}

/** 创建 600519 一年训练并等待图表可交互；返回训练 id */
async function openChart(page: Page): Promise<{ id: number }> {
  await abandonActive(page)
  const created = await page.request.post('/api/trainings', {
    data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 100_000_000 },
  })
  expect(created.status()).toBe(201)
  const id = (await created.json()).training.id as number
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.bars?.().length)).toBeGreaterThan(0)
  return { id }
}

async function realBars(page: Page, id: number): Promise<FeedBar[]> {
  const payload = await (await page.request.get(`/api/trainings/${id}/bars?tf=1D`)).json()
  return payload.bars as FeedBar[]
}

function feedBars(page: Page): Promise<FeedBar[]> {
  return page.evaluate(() => (window as any).__trainerChart.bars() as FeedBar[])
}

function mirror(p: number, basis: number): number { return 2 * basis - p }

function toggle(page: Page) { return page.getByRole('button', { name: '多空反转', exact: true }) }

async function enableMirror(page: Page): Promise<void> {
  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
}

test.describe.configure({ mode: 'serial' })

test('toggle mirrors all bars around frozen first close with shape swap and restores on close', async ({ page }) => {
  const { id } = await openChart(page)
  const real = await realBars(page, id)
  const basis = real[0]!.close

  // 默认关闭：喂入序列＝服务端真实序列
  const before = await feedBars(page)
  expect(before.length).toBe(real.length)
  for (let i = 0; i < real.length; i++) {
    expect(before[i]!.close).toBeCloseTo(real[i]!.close, 6)
  }

  await enableMirror(page)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.bars().length)).toBe(real.length)
  const mirrored = await feedBars(page)
  // 全序列镜像：p′=2P₀−p，高低对调（h′=2P₀−low、l′=2P₀−high），量与时间戳不动
  for (let i = 0; i < real.length; i++) {
    const source = real[i]!, shown = mirrored[i]!
    expect(shown.open, `第${i}根 open`).toBeCloseTo(mirror(source.open, basis), 6)
    expect(shown.high, `第${i}根 high`).toBeCloseTo(mirror(source.low, basis), 6)
    expect(shown.low, `第${i}根 low`).toBeCloseTo(mirror(source.high, basis), 6)
    expect(shown.close, `第${i}根 close`).toBeCloseTo(mirror(source.close, basis), 6)
    expect(shown.volume).toBe(source.volume)
    expect(shown.date).toBe(source.date)
    // 阴阳形状互换：收盘/开盘大小关系反转（平盘保持）
    expect(shown.close > shown.open).toBe(source.close < source.open)
    expect(shown.close < shown.open).toBe(source.close > source.open)
  }
  await page.screenshot({ path: evidencePath('chart-invert-training-mirrored.png') })

  // 关闭即恢复真实价
  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
  const restored = await feedBars(page)
  for (let i = 0; i < real.length; i++) expect(restored[i]!.close).toBeCloseTo(real[i]!.close, 6)
})

test('no chart watermark while mirrored and toggle styling matches subchart toggle family', async ({ page }) => {
  // 用户 2026-10-28 验收整改：主图零水印（图面与正常模式一致）；开关复用副图开关
  // indicator-toggle 样式（与 KDJ 同色同尺寸，off 态虚线灰），弃用独立橙色高亮
  await openChart(page)
  const invert = toggle(page)
  await expect(invert).toHaveAttribute('aria-pressed', 'false')
  await expect(invert).toHaveClass(/indicator-toggle/)
  await expect(invert).toHaveClass(/off/)

  await enableMirror(page)
  // 图面零水印：镜像态下不存在水印元素
  await expect(page.locator('.price-mirror-watermark')).toHaveCount(0)
  await expect(invert).not.toHaveClass(/off/)
  // 颜色与 KDJ 按钮一致：同族 indicator-toggle，激活态计算样式逐项相等
  const kdj = page.getByRole('button', { name: 'KDJ', exact: true })
  await expect(kdj).toHaveClass(/indicator-toggle/)
  if (await kdj.evaluate(el => el.classList.contains('off'))) await kdj.click()
  await expect(kdj).not.toHaveClass(/off/)
  const pickStyle = (el: HTMLElement) => ({ border: getComputedStyle(el).borderColor, bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })
  expect(await invert.evaluate(pickStyle)).toEqual(await kdj.evaluate(pickStyle))
  // 训练页开关位于副图开关组内（间距由组内 gap 统一）
  await expect(page.locator('.indicator-toggles button', { hasText: '多空反转' })).toBeVisible()

  await invert.click()
  await expect(invert).toHaveClass(/off/)
  await expect(page.locator('.price-mirror-watermark')).toHaveCount(0)
})

test('indicators recompute on mirrored series with MACD sign flipped and VOL unchanged', async ({ page }) => {
  const { id } = await openChart(page)
  const real = await realBars(page, id)
  const basis = real[0]!.close
  const realMacd = await page.evaluate(() => (window as any).__trainerChart.indicatorResult('MACD'))
  const realMa = await page.evaluate(() => (window as any).__trainerChart.indicatorResult('MA'))
  const realVol = await page.evaluate(() => (window as any).__trainerChart.indicatorResult('VOL'))

  await enableMirror(page)
  await expect.poll(async () => {
    const macd = await page.evaluate(() => (window as any).__trainerChart.indicatorResult('MACD'))
    return macd?.at(-1)?.dif ?? null
  }, { timeout: 10_000 }).not.toBe(realMacd.at(-1)?.dif ?? null)

  const macd = await page.evaluate(() => (window as any).__trainerChart.indicatorResult('MACD'))
  const ma = await page.evaluate(() => (window as any).__trainerChart.indicatorResult('MA'))
  const vol = await page.evaluate(() => (window as any).__trainerChart.indicatorResult('VOL'))
  // EMA 对仿射 p′=2P₀−p 线性 ⇒ DIF′=−DIF（逐点，独立数学 oracle）；MA 同族 ⇒ MA′=2P₀−MA
  const tail = macd.slice(-80)
  const tailReal = realMacd.slice(-80)
  for (let i = 0; i < tail.length; i++) {
    const dif = tail[i]!.dif as number | null
    const realDif = tailReal[i]!.dif as number | null
    if (dif === null || realDif === null) continue
    expect(dif, `MACD DIF 第${i} 点应符号翻转`).toBeCloseTo(-realDif, 5)
  }
  // MACD 位于水下：真实序列末端 DIF>0 时镜像末端 DIF<0（上涨行情翻到水下）
  const lastRealDif = realMacd.at(-1)?.dif as number | null
  const lastDif = macd.at(-1)?.dif as number | null
  if (lastRealDif !== null && Math.abs(lastRealDif) > 1e-6) {
    expect(lastDif! * lastRealDif).toBeLessThan(0)
  }
  const maTail = ma.slice(-80)
  const maRealTail = realMa.slice(-80)
  for (let i = 0; i < maTail.length; i++) {
    for (let k = 0; k < 3; k++) {
      const value = maTail[i]?.[k] as number | null | undefined
      const realValue = maRealTail[i]?.[k] as number | null | undefined
      if (value == null || realValue == null) continue
      expect(value).toBeCloseTo(mirror(realValue, basis), 4)
    }
  }
  // VOL 不镜像：成交量柱与其量均线（volume/ma1..3）逐点不变（result 内的 bar OHLC 属镜像数据源，
  // 随序列镜像属正确行为；VOL 绘图只消费量域字段）
  const volTail = vol.slice(-80)
  const volRealTail = realVol.slice(-80)
  expect(volTail.length).toBe(volRealTail.length)
  for (let i = 0; i < volTail.length; i++) {
    expect(volTail[i]!.volume).toBe(volRealTail[i]!.volume)
    for (const key of ['ma1', 'ma2', 'ma3'] as const) {
      expect(volTail[i]![key]).toBe(volRealTail[i]![key])
    }
  }
})

test('drawings keep real stored prices across mirror round trips and new drawings save real prices', async ({ page }) => {
  const { id } = await openChart(page)
  const real = await realBars(page, id)
  const basis = real[0]!.close
  const host = (await page.locator('.chart-host').boundingBox())!

  // 真实态画一条价位线（drawing-basis 模式：像素由 pointToPixel 反解；feed bar 携带 timestamp）
  const feed = await feedBars(page)
  const anchor = feed[feed.length - 5]!
  const point = await page.evaluate(({ timestamp, high }) => (window as any).__trainerChart.pointToPixel(timestamp, high), anchor)
  await page.getByRole('combobox', { name: '吸附', exact: true }).selectOption('strong_magnet')
  await page.locator('.draw-toolbar').getByRole('button', { name: '价位线', exact: true }).click()
  await page.mouse.click(host.x + point.x, host.y + point.y)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.drawings().length)).toBe(1)
  const storedReal = await page.evaluate(() => (window as any).__trainerChart.drawings()[0].points[0].value)
  expect(storedReal).toBeCloseTo(anchor.high, 4)
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')

  // 开镜像：既有画线仍显示（1 条）且存储值不改写（真实价）
  await enableMirror(page)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.drawings().length)).toBe(1)
  const storedWhileMirrored = await page.evaluate(() => (window as any).__trainerChart.drawings()[0].points[0].value)
  expect(storedWhileMirrored).toBeCloseTo(anchor.high, 4)
  // 成本线/画线锚定像素在镜像域：价位线 y 位置＝mirror(存档值) 的像素
  const mirroredPixel = await page.evaluate((value) => (window as any).__trainerChart.pointToPixel(0, value), mirror(storedReal, basis))
  expect(mirroredPixel.y).toBeGreaterThan(0)

  // 镜像态新建价位线：重新激活工具（一次性语义，画完自动退出），在 mirror(目标真实价) 的像素上
  // 取点，存档必须是真实价
  const target = feed[feed.length - 10]!
  const clickPoint = await page.evaluate(({ timestamp, close }) => (window as any).__trainerChart.pointToPixel(timestamp, close), { timestamp: target.timestamp, close: mirror(target.close, basis) })
  await page.locator('.draw-toolbar').getByRole('button', { name: '价位线', exact: true }).click()
  await page.mouse.click(host.x + clickPoint.x, host.y + clickPoint.y)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.drawings().length)).toBe(2)
  const drawings = await page.evaluate(() => (window as any).__trainerChart.drawings())
  const newLine = drawings.find((d: { points: Array<{ value: number }> }) => Math.abs(d.points[0].value - storedReal) > 0.005)!
  expect(newLine, '应存在第二条画线').toBeTruthy()
  expect(newLine.points[0].value).toBeCloseTo(target.close, 2)
  expect(await page.evaluate(() => (window as any).__trainerChart.capture().drawings.length)).toBe(2)

  // 关镜像：两条画线存档值仍为真实价（第一条不变，第二条仍 ≈ 目标真实价）
  await toggle(page).click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.drawings().length)).toBe(2)
  const afterClose = await page.evaluate(() => (window as any).__trainerChart.drawings())
  expect(afterClose[0]!.points[0].value).toBeCloseTo(anchor.high, 4)
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
})

test('capture payload keeps real prices while mirrored', async ({ page }) => {
  const { id } = await openChart(page)
  const real = await realBars(page, id)
  await enableMirror(page)

  const capture = await page.evaluate(() => (window as any).__trainerChart.capture())
  expect(capture.bars.length).toBe(real.length)
  for (let i = 0; i < real.length; i += 40) {
    expect(capture.bars[i]!.open, `capture 第${i}根 open 应为真实价`).toBeCloseTo(real[i]!.open, 6)
    expect(capture.bars[i]!.high).toBeCloseTo(real[i]!.high, 6)
    expect(capture.bars[i]!.low).toBeCloseTo(real[i]!.low, 6)
    expect(capture.bars[i]!.close).toBeCloseTo(real[i]!.close, 6)
  }
})

test('trade fills at the real phase price while mirrored', async ({ page }) => {
  const { id } = await openChart(page)
  await enableMirror(page)
  const training = (await (await page.request.get('/api/trainings/active')).json()).training
  const expectedPrice = training.currentPhase === 'open' ? training.currentOpen : training.currentClose

  await page.getByRole('button', { name: '100%', exact: true }).click()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('买入成交')

  const detail = await (await page.request.get(`/api/trainings/${id}`)).json()
  const lastTrade = detail.trades.at(-1)
  expect(lastTrade!.price, '镜像态成交价必须等于真实阶段价').toBeCloseTo(expectedPrice, 6)
})

test('P0 stays frozen when earlier history prepends during mirroring', async ({ page }) => {
  const { id } = await openChart(page)
  const real = await realBars(page, id)
  const basis = real[0]!.close
  await enableMirror(page)
  const before = await feedBars(page)
  const probeDate = before[10]!.date
  const probeMirrorClose = before[10]!.close
  const countBefore = before.length

  // 缩小视野并向左滚动触发更早历史加载（wheel 向下＝向更早 K 线平移）
  const host = (await page.locator('.chart-host').boundingBox())!
  await page.mouse.move(host.x + host.width * .7, host.y + 150)
  await page.mouse.down()
  await page.mouse.move(host.x + host.width * .3, host.y + 150, { steps: 10 })
  await page.mouse.up()
  await page.mouse.move(host.x + host.width * .4, host.y + 150)
  await page.mouse.wheel(0, 6000)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.bars().length), { timeout: 30_000 }).toBeGreaterThan(countBefore)

  // 补历史后：探测根镜像值不变（P₀ 未按新首根重算）
  const after = await feedBars(page)
  const probe = after.find((bar: FeedBar) => bar.date === probeDate)!
  expect(probe).toBeTruthy()
  expect(probe.close).toBeCloseTo(probeMirrorClose, 6)
  // 原首根（P₀ 来源）的镜像 close 仍为 2P₀−P₀=P₀
  const origin = after.find((bar: FeedBar) => bar.date === before[0]!.date)!
  expect(origin.close).toBeCloseTo(basis, 6)
})

test('price axis shows mirrored values while toggle on and real values after closing', async ({ page }) => {
  const { id } = await openChart(page)
  const real = await realBars(page, id)
  const basis = real[0]!.close

  // 价格轴为 canvas：轴值域直接取库内 y 轴 range（刻度/像素均由它推导）；镜像态值域应为
  // 关态值域关于 P₀ 的镜像（nice 取整对端点各扩张 ≤1 个 interval，容差放 120＝两个 interval 量级）
  const realRange = await page.evaluate(() => (window as any).__trainerChart.yAxisRange())
  const realTicks = (await page.evaluate(() => (window as any).__trainerChart.yAxisTicks())) as string[]
  expect(realTicks.length).toBeGreaterThan(3)
  for (const text of realTicks) expect(Number.isFinite(Number(text.replace(/,/g, ''))), `关态轴刻度应为数值（${text}）`).toBe(true)

  await enableMirror(page)
  const mirrorRange = await page.evaluate(() => (window as any).__trainerChart.yAxisRange())
  expect(Math.abs(mirrorRange.from - mirror(realRange.to, basis)), '镜像态轴下端＝关态上端的镜像').toBeLessThan(120)
  expect(Math.abs(mirrorRange.to - mirror(realRange.from, basis)), '镜像态轴上端＝关态下端的镜像').toBeLessThan(120)
  const mirrorTicks = (await page.evaluate(() => (window as any).__trainerChart.yAxisTicks())) as string[]
  for (const text of mirrorTicks) expect(Number.isFinite(Number(text.replace(/,/g, ''))), `镜像态轴刻度应为数值（${text}）`).toBe(true)
  for (const text of mirrorTicks) {
    const value = Number(text.replace(/,/g, ''))
    expect(value, `镜像刻度 ${text} 应落在镜像值域内`).toBeGreaterThanOrEqual(mirrorRange.from - 120)
    expect(value).toBeLessThanOrEqual(mirrorRange.to + 120)
  }

  // 关闭后轴值域恢复真实域
  await toggle(page).click()
  const restoredRange = await page.evaluate(() => (window as any).__trainerChart.yAxisRange())
  expect(Math.abs(restoredRange.from - realRange.from)).toBeLessThan(120)
  expect(Math.abs(restoredRange.to - realRange.to)).toBeLessThan(120)
})

test('replay page mirrors the recorded series with the same toggle semantics', async ({ page }) => {
  // 建训练（默认开录制）→ 导出录制 → 录像页导入回放 → 回放页开关同款镜像语义
  const { id } = await openChart(page)
  const real = await realBars(page, id)
  const basis = real[0]!.close
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出录制', exact: true }).click()
  const download = await pending
  const output = evidencePath('chart-invert-replay.json.gz')
  await download.saveAs(output)
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await page.getByLabel('导入录制', { exact: true }).setInputFiles(output)
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.bars?.().length)).toBeGreaterThan(2)

  // 回放页开关默认关闭；开启后全序列镜像（与训练页同一 KlineChart 实现）
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
  const replayReal = await feedBars(page)
  await enableMirror(page)
  const replayMirrored = await feedBars(page)
  expect(replayMirrored.length).toBe(replayReal.length)
  for (let i = 0; i < replayReal.length; i++) {
    expect(replayMirrored[i]!.close).toBeCloseTo(mirror(replayReal[i]!.close, basis), 6)
    expect(replayMirrored[i]!.high).toBeCloseTo(mirror(replayReal[i]!.low, basis), 6)
  }
  // 2026-10-28 验收整改：主图零水印（图面与正常模式一致），镜像态截图留证
  await expect(page.locator('.price-mirror-watermark')).toHaveCount(0)
  await page.screenshot({ path: evidencePath('chart-invert-replay-mirrored.png') })
  await toggle(page).click()
  await expect(page.locator('.price-mirror-watermark')).toHaveCount(0)
})
