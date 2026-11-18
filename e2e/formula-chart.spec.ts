import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// M9-04C 公式图表挂载真实浏览器回归：
// ① 启用公式在训练图渲染——主图公式挂 candle_pane，副图公式各占独立 pane（与 VOL/MACD/KDJ 同机制）；
// ② 推进与周/月周期切换后公式指标仍在且重算；
// ③ 只读回放页按回放 bars 渲染公式；
// ④ 随机训练不旁路 M7-01：不注入 StockContext，上下文函数给中文人话提示，不泄露名称/代码；
// ⑤ 截图证据（深浅主题/图形可读）。

test.setTimeout(240_000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(async ({ page }) => {
  try {
    expect(errors.get(page)).toEqual([])
  } finally {
    await cleanFormulas(page)
    const response = await page.request.get('/api/formulas')
    expect(response.status()).toBe(200)
    const payload = (await response.json()) as { formulas: Array<{ name: string }> }
    const leakedNames = payload.formulas.filter(formula => FORMULA_NAMES.includes(formula.name)).map(formula => formula.name)
    expect(leakedNames, 'formula-chart 夹具必须在每个用例后全部清理').toEqual([])
  }
})

const FORMULA_NAMES = ['CHART_MAIN', 'CHART_SUB', 'CHART_MACD', 'CHART_CTX', 'CHART_RANDOM_SUB']

async function cleanFormulas(page: Page): Promise<void> {
  const response = await page.request.get('/api/formulas')
  expect(response.status()).toBe(200)
  const payload = (await response.json()) as { formulas: Array<{ id: number; name: string; builtin: boolean }> }
  for (const formula of payload.formulas) {
    if (!formula.builtin && FORMULA_NAMES.includes(formula.name)) {
      const deleted = await page.request.delete('/api/formulas/' + formula.id)
      expect(deleted.status()).toBe(204)
    }
  }
}

async function createFormula(page: Page, name: string, source: string, placement: 'main' | 'sub'): Promise<void> {
  const response = await page.request.post('/api/formulas', { data: { name, description: 'M9-04C e2e', placement, source } })
  expect(response.status()).toBe(201)
}

async function abandonActive(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post('/api/trainings/' + active.id + '/abandon')
}

async function openTraining(page: Page): Promise<void> {
  await abandonActive(page)
  const response = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 1_000_000 } })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
}

type FormulaProbe = { name: string; paneId: string; hasResult: boolean }
async function formulaProbe(page: Page): Promise<FormulaProbe[]> {
  return page.evaluate(() => {
    const hook = (window as any).__trainerChart
    if (!hook?.formulaIndicators) throw new Error('formulaIndicators probe missing')
    return hook.formulaIndicators() as FormulaProbe[]
  })
}

async function waitForFormula(page: Page, name: string): Promise<void> {
  await expect.poll(async () => (await formulaProbe(page)).some(item => item.name.startsWith(name)), { timeout: 30_000 }).toBe(true)
}

test('公式图表：主图叠加与副图窗格可见，周期切换与推进后仍存在', async ({ page }) => {
  await cleanFormulas(page)
  await createFormula(page, 'CHART_MAIN', 'MAINLINE:MA(CLOSE,5);', 'main')
  await createFormula(page, 'CHART_SUB', 'SUB1:MA(CLOSE,10); SUB2:MA(CLOSE,20);', 'sub')
  await openTraining(page)

  const mainName = 'FORMULA_'
  await expect.poll(async () => (await formulaProbe(page)).length, { timeout: 30_000 }).toBeGreaterThan(0)
  const probes = await formulaProbe(page)
  const main = probes.filter(item => item.paneId === 'candle_pane')
  const sub = probes.filter(item => item.paneId !== 'candle_pane')
  expect(main.length).toBeGreaterThan(0)
  expect(sub.length).toBeGreaterThan(0)
  expect(main.every(item => item.name.startsWith(mainName))).toBe(true)
  // 副图公式输出共用一个 pane（两个输出线同窗格）
  expect(new Set(sub.map(item => item.paneId)).size).toBe(1)
  expect(sub.every(item => item.hasResult)).toBe(true)
  // 收起悬浮画线工具面板，避免遮挡公式窗格图例（视觉证据清晰）
  await page.getByRole('button', { name: '划线', exact: true }).click()
  await page.screenshot({ path: evidencePath('formula-chart-training.png') })

  // 推进后仍存在且结果刷新
  const beforeAdvance = await page.evaluate(() => (window as any).__trainerChart.bars().at(-1).date as string)
  await page.getByRole('button', { name: '推进下一日', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.bars().at(-1).date as string), { timeout: 30_000 }).not.toBe(beforeAdvance)
  await waitForFormula(page, 'FORMULA_')

  // 周期切换（周K）后公式指标按新 bars 重建
  await page.getByRole('tab', { name: '周K', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await waitForFormula(page, 'FORMULA_')
  const weekly = await formulaProbe(page)
  expect(weekly.some(item => item.paneId === 'candle_pane')).toBe(true)
  expect(weekly.some(item => item.paneId !== 'candle_pane')).toBe(true)
  await page.screenshot({ path: evidencePath('formula-chart-weekly.png') })
})

test('公式图表：随机训练不泄露隐藏信息（上下文函数人话提示）', async ({ page }) => {
  await cleanFormulas(page)
  await createFormula(page, 'CHART_RANDOM_SUB', 'RSUB:MA(CLOSE,5);', 'sub')
  await createFormula(page, 'CHART_CTX', "CTX:NAMELIKE('贵');", 'main')
  await abandonActive(page)
  const response = await page.request.post('/api/trainings/random', {
    data: { dimension: 'random_stock', window_months: 1, initial_cash: 1_000_000 },
  })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()

  // 普通 MA 公式照常渲染；上下文函数公式给出人话错误，不崩溃
  await waitForFormula(page, 'FORMULA_')
  const status = page.locator('.formula-chart-status')
  await expect(status).toBeVisible({ timeout: 30_000 })
  await expect(status).toContainText('上下文')
  // 隐藏名称/代码不得出现在页面文本（M7-01 不旁路）
  const body = await page.locator('body').innerText()
  expect(body).not.toContain('贵州茅台')
  expect(body).not.toContain('600519')
  await page.screenshot({ path: evidencePath('formula-chart-random.png') })
})

test('公式图表：只读回放页按录像 bars 渲染公式', async ({ page }) => {
  test.setTimeout(180_000)
  await cleanFormulas(page)
  await createFormula(page, 'CHART_SUB', 'SUB1:MA(CLOSE,10);', 'sub')
  await createFormula(page, 'CHART_MACD', 'B:MA(CLOSE,20);', 'sub')
  await createFormula(page, 'CHART_RANDOM_SUB', 'C:MA(CLOSE,30);', 'sub')
  await abandonActive(page)
  const response = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1M', start_date: '2025-01-02', initial_cash: 1_000_000 } })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(page.getByRole('status').filter({ hasText: '正在记录' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '推进下一日', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  // 放弃并保留录像 → 从录像库进入只读回放
  await page.getByRole('button', { name: '放弃训练', exact: true }).click()
  const end = page.getByRole('dialog', { name: '结束训练', exact: true })
  await expect(end).toBeVisible()
  await expect(end.getByLabel('保留到本机训练历史', { exact: true })).toBeChecked()
  await end.getByRole('button', { name: '确认放弃', exact: true }).click()
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  const item = page.locator('.recording-history-item').first()
  await expect(item).toBeVisible({ timeout: 30_000 })
  await item.click()
  await expect(page.locator('.chart-host')).toBeVisible({ timeout: 60_000 })
  await expect.poll(async () => (await formulaProbe(page)).length, { timeout: 60_000 }).toBeGreaterThan(0)
  const replay = await formulaProbe(page)
  expect(replay.some(probe => probe.paneId !== 'candle_pane')).toBe(true)
  expect(new Set(replay.map(probe => probe.paneId)).size).toBe(3)
  await page.screenshot({ path: evidencePath('formula-chart-replay.png') })
  // The same dense-pane contract applies after replay restores recorded native pane heights.
  for (const theme of ['dark', 'light']) {
    const dark = await page.locator('body').evaluate(body => body.classList.contains('dark'))
    if (dark !== (theme === 'dark')) await page.locator('.theme-toggle').click()
    for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 1008, height: 641 }]) {
      await page.setViewportSize(size)
      await expect.poll(() => page.evaluate(() => {
        const panes = (window as any).__trainerChart.panes() as Array<{ id: string; height: number }>
        return panes.length === 7 && panes.every(pane => pane.height > 0)
      })).toBe(true)
      const canvasSizes = await page.locator('.chart-host canvas').evaluateAll(canvases => canvases.map(canvas => ({
        width: (canvas as HTMLCanvasElement).width, height: (canvas as HTMLCanvasElement).height,
      })))
      expect(canvasSizes.length).toBeGreaterThan(0)
      expect(canvasSizes.every(size => size.width > 0 && size.height > 0)).toBe(true)
      await page.screenshot({ path: evidencePath(`formula-dense-replay-${size.width}x${size.height}-${theme}.png`) })
    }
  }
})

test('公式图表：桌面尺寸与深浅主题可读（视觉证据）', async ({ page }) => {
  await cleanFormulas(page)
  await createFormula(page, 'CHART_MAIN', 'MAINLINE:MA(CLOSE,5);', 'main')
  await createFormula(page, 'CHART_SUB', 'SUB1:MA(CLOSE,10); SUB2:MA(CLOSE,20);', 'sub')
  await openTraining(page)
  const presets = [
    { width: 1440, height: 900, theme: 'light' },
    { width: 1366, height: 705, theme: 'light' },
    { width: 1024, height: 680, theme: 'light' },
    { width: 1440, height: 900, theme: 'dark' },
  ]
  for (const preset of presets) {
    // 不重载页面（避免打断进行中的录制会话）：只改视口与主题，主题经顶栏切换按钮同步
    const themeButton = page.locator('.theme-toggle')
    const aria = await themeButton.getAttribute('aria-label')
    const isDark = aria === '切换到浅色主题'
    if ((preset.theme === 'dark') !== isDark) await themeButton.click()
    await page.setViewportSize({ width: preset.width, height: preset.height })
    await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
    await expect.poll(async () => (await formulaProbe(page)).length, { timeout: 30_000 }).toBeGreaterThan(0)
    const probes = await formulaProbe(page)
    expect(probes.some(item => item.paneId === 'candle_pane')).toBe(true)
    expect(probes.some(item => item.paneId !== 'candle_pane')).toBe(true)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    // 收起悬浮划线工具面板，避免遮挡下侧公式窗格（视觉证据清晰）
    const toolbarToggle = page.locator('.draw-toolbar-toggle')
    if (await toolbarToggle.getAttribute('aria-pressed') === 'true') await toolbarToggle.click()
    await expect(page.locator('.draw-toolbar')).toBeHidden()
    await page.screenshot({ path: evidencePath('formula-chart-' + preset.width + 'x' + preset.height + '-' + preset.theme + '.png') })
  }
})

test('dense formula panes keep main K lines visible and restore roomy pane heights', async ({ page }) => {
  await cleanFormulas(page)
  await createFormula(page, 'CHART_SUB', 'A:MA(CLOSE,5);', 'sub')
  await createFormula(page, 'CHART_MACD', 'B:MA(CLOSE,10);', 'sub')
  await createFormula(page, 'CHART_RANDOM_SUB', 'C:MA(CLOSE,20);', 'sub')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openTraining(page)
  const toolbarToggle = page.locator('.draw-toolbar-toggle')
  if (await toolbarToggle.getAttribute('aria-pressed') === 'true') await toolbarToggle.click()
  await expect(page.locator('.draw-toolbar')).toBeHidden()
  type LayoutPane = { id: string; name: string; top: number; height: number; width: number }
  const readPanes = () => page.evaluate(() => (window as any).__trainerChart.panes() as LayoutPane[])
  await expect.poll(async () => (await readPanes()).length).toBe(7)
  const settlePanes = async () => {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    let previous = ''
    await expect.poll(async () => {
      const key = JSON.stringify((await readPanes()).map(pane => [pane.id, pane.top, pane.height]))
      const stable = previous === key
      previous = key
      return stable
    }, { timeout: 8_000, intervals: [120, 120, 120, 120] }).toBe(true)
  }
  await settlePanes()
  const preferred = await readPanes()
  const ids = preferred.map(pane => pane.id)
  const formulaIds = new Set((await formulaProbe(page)).filter(item => item.paneId !== 'candle_pane').map(item => item.paneId))
  expect(formulaIds.size).toBe(3)
  for (const pane of preferred.filter(item => item.id !== 'candle_pane')) expect(pane.height).toBeCloseTo(formulaIds.has(pane.id) ? 120 : 100, 1)
  const expectNormal = async () => {
    await settlePanes()
    await expect.poll(async () => (await readPanes()).find(pane => pane.id === 'candle_pane')!.height).toBeGreaterThanOrEqual(99.9)
    const current = await readPanes()
    expect(current.map(pane => pane.id)).toEqual(ids)
    for (const pane of current) expect(pane.height).toBeGreaterThan(0)
    for (const pane of current.filter(item => item.id !== 'candle_pane')) expect(pane.height).toBeGreaterThanOrEqual(formulaIds.has(pane.id) ? 89.9 : 29.9)
    const pageBox = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth, scrollHeight: document.documentElement.scrollHeight, height: innerHeight }))
    expect(pageBox.scrollWidth).toBeLessThanOrEqual(pageBox.width)
    expect(pageBox.scrollHeight).toBeLessThanOrEqual(pageBox.height)
  }
  // Main K lines must exist before evaluating the provisional 100px presentation reserve.
  await page.setViewportSize({ width: 1366, height: 768 })
  await settlePanes()
  const initialDensePanes = await readPanes()
  await test.info().attach('dense-main-visibility', { body: JSON.stringify(initialDensePanes, null, 2), contentType: 'application/json' })
  expect(initialDensePanes.find(pane => pane.id === 'candle_pane')!.height).toBeGreaterThan(0)
  for (const theme of ['dark', 'light']) {
    const dark = await page.locator('body').evaluate(body => body.classList.contains('dark'))
    if (dark !== (theme === 'dark')) await page.locator('.theme-toggle').click()
    for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(size)
      await expectNormal()
      await page.screenshot({ path: evidencePath(`formula-dense-${size.width}x${size.height}-${theme}.png`) })
    }
  }
  // Existing maximize behavior remains intentional: main zero until restoration.
  const host = (await page.locator('.chart-host').boundingBox())!
  const macd = (await readPanes()).find(pane => pane.name === 'MACD')!
  await page.mouse.dblclick(host.x + macd.width * .45, host.y + macd.top + macd.height * .5)
  await expect.poll(async () => (await readPanes()).find(pane => pane.id === 'candle_pane')!.height).toBe(0)
  await page.mouse.dblclick(host.x + host.width * .45, host.y + 100)
  await expectNormal()
  await page.setViewportSize({ width: 1600, height: 1000 })
  await expect.poll(async () => (await readPanes()).filter(pane => pane.id !== 'candle_pane').map(pane => Math.round(pane.height))).toEqual(preferred.filter(pane => pane.id !== 'candle_pane').map(pane => Math.round(pane.height)))
  await settlePanes()

  // Reuse pane-resize.spec.ts's actual seven-pixel separator hit band and 58% horizontal coordinate.
  // Separator 1 is VOL/MACD: both sides are subpanes and remain above their original minimum.
  const beforeDrag = await readPanes()
  const separator = page.locator('.chart-host div[style*="cursor: ns-resize"][style*="height: 7px"]').nth(1)
  const separatorBox = (await separator.boundingBox())!
  expect(separatorBox.height).toBeGreaterThanOrEqual(7)
  const dragX = separatorBox.x + separatorBox.width * .58
  const dragY = separatorBox.y + separatorBox.height / 2
  await page.mouse.move(dragX, dragY)
  expect(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, { x: dragX, y: dragY })).toBe('ns-resize')
  await page.mouse.down()
  await page.mouse.move(dragX, dragY + 15, { steps: 12 })
  await expect(page.locator('.select-rect')).not.toBeVisible()
  await expect(page.locator('.multi-rect')).not.toBeVisible()
  await expect.poll(async () => Math.abs((await readPanes())[1]!.height - beforeDrag[1]!.height)).toBeGreaterThan(10)
  await page.mouse.up()
  await settlePanes()
  const userPreferred = await readPanes()
  expect(userPreferred.map(pane => pane.id)).toEqual(ids)
  // These post-release assertions catch an allocator that immediately erases the user's drag.
  expect(Math.abs(userPreferred[1]!.height - beforeDrag[1]!.height)).toBeGreaterThan(10)
  expect(Math.abs(userPreferred[2]!.height - beforeDrag[2]!.height)).toBeGreaterThan(10)
  expect(userPreferred[1]!.height + userPreferred[2]!.height).toBeCloseTo(beforeDrag[1]!.height + beforeDrag[2]!.height, 5)
  let requestedHeights = userPreferred.filter(pane => pane.id !== 'candle_pane').map(pane => Math.round(pane.height))
  // Two cycles catch repeated rebalancing that progressively replaces preferred heights with compressed ones.
  for (const narrow of [{ width: 1024, height: 768 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(narrow)
    await expectNormal()
    await page.setViewportSize({ width: 1600, height: 1000 })
    await expect.poll(async () => (await readPanes()).filter(pane => pane.id !== 'candle_pane').map(pane => Math.round(pane.height))).toEqual(requestedHeights)
    await settlePanes()
  }

  // Regression killer: a separator drag while the panes are already compressed must not spring back.
  await page.setViewportSize({ width: 1366, height: 768 })
  await expectNormal()
  const compressedBefore = await readPanes()
  const compressedSeparatorBox = (await separator.boundingBox())!
  const compressedX = compressedSeparatorBox.x + compressedSeparatorBox.width * .58
  const compressedY = compressedSeparatorBox.y + compressedSeparatorBox.height / 2
  expect(compressedSeparatorBox.height).toBeGreaterThanOrEqual(7)
  await page.mouse.move(compressedX, compressedY)
  expect(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, { x: compressedX, y: compressedY })).toBe('ns-resize')
  await page.mouse.down()
  const compressedMouseDown = await readPanes()
  await page.mouse.move(compressedX, compressedY + 20, { steps: 12 })
  await expect.poll(async () => Math.abs((await readPanes())[1]!.height - compressedBefore[1]!.height)).toBeGreaterThan(15)
  const compressedMouseMove = await readPanes()
  await page.mouse.up()
  const compressedMouseUp = await readPanes()
  await settlePanes()
  const compressedSettled = await readPanes()
  // Attach all four observations before any no-bounce assertion can fail.
  await test.info().attach('dense-compressed-separator-drag', {
    body: JSON.stringify({ before: compressedBefore, mousedown: compressedMouseDown, mousemove: compressedMouseMove, mouseup: compressedMouseUp, settled: compressedSettled }, null, 2),
    contentType: 'application/json',
  })
  expect(Math.abs(compressedMouseMove[1]!.height - compressedMouseDown[1]!.height)).toBeGreaterThan(15)
  expect(Math.abs(compressedMouseMove[2]!.height - compressedMouseDown[2]!.height)).toBeGreaterThan(15)
  expect(compressedMouseMove[1]!.height + compressedMouseMove[2]!.height).toBeCloseTo(compressedMouseDown[1]!.height + compressedMouseDown[2]!.height, 5)
  for (const index of [1, 2]) {
    expect(compressedMouseUp[index]!.height, `compressed immediate pointerup pane ${index}`).toBeCloseTo(compressedMouseMove[index]!.height, 1)
    expect(compressedSettled[index]!.height, `compressed settled pointerup pane ${index}`).toBeCloseTo(compressedMouseMove[index]!.height, 1)
  }
  const compressedUserHeights = compressedMouseMove.filter(pane => pane.id !== 'candle_pane').map(pane => Math.round(pane.height))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await settlePanes()
  const wideAfterCompressedDrag = await readPanes()
  requestedHeights = wideAfterCompressedDrag.filter(pane => pane.id !== 'candle_pane').map(pane => Math.round(pane.height))
  // A drag in the compressed layout must survive decompression as a changed user request.
  expect(Math.abs(wideAfterCompressedDrag[1]!.height - userPreferred[1]!.height)).toBeGreaterThan(10)
  expect(Math.abs(wideAfterCompressedDrag[2]!.height - userPreferred[2]!.height)).toBeGreaterThan(10)

  // Actual minimum Electron content viewport: emergency compression may lower the effective floors.
  // This case locks visibility and identity only, not the 90px/100px normal-density thresholds.
  await page.setViewportSize({ width: 1008, height: 641 })
  await settlePanes()
  const minimumContent = await readPanes()
  expect(minimumContent.map(pane => pane.id)).toEqual(ids)
  expect(minimumContent).toHaveLength(7)
  for (const pane of minimumContent) expect(pane.height, `minimum-content:${pane.id}`).toBeGreaterThan(0)
  expect(minimumContent.find(pane => pane.id === 'candle_pane')!.height).toBeGreaterThan(0)
  await page.screenshot({ path: evidencePath('formula-dense-electron-content-1008x641.png') })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await expect.poll(async () => (await readPanes()).filter(pane => pane.id !== 'candle_pane').map(pane => Math.round(pane.height))).toEqual(requestedHeights)

  // Return to the exact compressed viewport: the native pre-release drag heights must reappear.
  await page.setViewportSize({ width: 1366, height: 768 })
  await expectNormal()
  await expect.poll(async () => (await readPanes()).filter(pane => pane.id !== 'candle_pane').map(pane => Math.round(pane.height))).toEqual(compressedUserHeights)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await expect.poll(async () => (await readPanes()).filter(pane => pane.id !== 'candle_pane').map(pane => Math.round(pane.height))).toEqual(requestedHeights)

  await page.setViewportSize({ width: 1366, height: 768 })
  await expectNormal()
  // A window resize during a held drag must not turn native reflow into a new preference.
  const interruptedBefore = await readPanes()
  // The preceding downward drag leaves MACD near its 30px minimum; donate VOL's remaining space instead.
  expect(interruptedBefore[1]!.height - 30, 'held-drag donor has room above its native minimum').toBeGreaterThan(15)
  const interruptedDelta = -15
  const interruptedBoundary = (await page.locator('.chart-host div[style*="cursor: ns-resize"][style*="height: 7px"]').nth(1).boundingBox())!
  const interruptedX = interruptedBoundary.x + interruptedBoundary.width * .58
  const interruptedY = interruptedBoundary.y + interruptedBoundary.height / 2
  await page.mouse.move(interruptedX, interruptedY)
  await page.mouse.down()
  await page.mouse.move(interruptedX, interruptedY + interruptedDelta, { steps: 12 })
  await page.waitForTimeout(25)
  await page.mouse.move(interruptedX, interruptedY + interruptedDelta)
  await settlePanes()
  expect(Math.abs((await readPanes())[1]!.height - interruptedBefore[1]!.height)).toBeGreaterThan(10)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await settlePanes()
  await page.mouse.up()
  await settlePanes()
  const interruptedRestored = await readPanes()
  expect(interruptedRestored.slice(1).map(pane => Math.round(pane.height))).toEqual(requestedHeights)
  await test.info().attach('dense-resize-during-held-drag', {
    body: JSON.stringify({ before: interruptedBefore, restored: interruptedRestored }, null, 2), contentType: 'application/json',
  })
  await page.setViewportSize({ width: 1366, height: 768 })
  await expectNormal()
  const mainBoundarySnapshots: unknown[] = []
  const dragMainBoundary = async (label: string, delta: number) => {
    await settlePanes()
    const before = await readPanes()
    const firstBoundary = page.locator('.chart-host div[style*="cursor: ns-resize"][style*="height: 7px"]').first()
    const box = (await firstBoundary.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(7)
    const x = box.x + box.width * .58
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    expect(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, { x, y })).toBe('ns-resize')
    await page.mouse.down()
    const mousedown = await readPanes()
    await page.mouse.move(x, y + delta, { steps: 12 })
    // 10.0.3 throttles separator moves at 20ms without a trailing call.
    // Deliver the endpoint again after that window; waiting for layout cannot replay a dropped move.
    await page.waitForTimeout(25)
    await page.mouse.move(x, y + delta)
    await expect(page.locator('.select-rect')).not.toBeVisible()
    await expect(page.locator('.multi-rect')).not.toBeVisible()
    // Let native measure/layout finish while the pointer is still down.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const mousemove = await readPanes()
    await page.mouse.up()
    const mouseup = await readPanes()
    await settlePanes()
    const settled = await readPanes()
    mainBoundarySnapshots.push({ label, delta, before, mousedown, mousemove, mouseup, settled })
    await test.info().attach(`dense-main-boundary-${label}`, {
      body: JSON.stringify(mainBoundarySnapshots, null, 2), contentType: 'application/json',
    })
    expect(mousemove.map(pane => pane.id)).toEqual(ids)
    expect(mousemove[0]!.height - mousedown[0]!.height, `${label}: native main change`).toBeCloseTo(delta, 0)
    expect(mousemove[1]!.height - mousedown[1]!.height, `${label}: native first sub change`).toBeCloseTo(-delta, 0)
    for (const index of [0, 1]) {
      expect(mouseup[index]!.height, `${label}: immediate mouseup pane ${index}`).toBeCloseTo(mousemove[index]!.height, 1)
      expect(settled[index]!.height, `${label}: settled mouseup pane ${index}`).toBeCloseTo(mousemove[index]!.height, 1)
    }
    return { before, mousemove, settled }
  }
  const mainBeforeRoundtrip = await readPanes()
  const growBy = Math.min(20, Math.floor((mainBeforeRoundtrip[1]!.height - 30) / 2))
  expect(growBy, 'first sub has room above its original minimum').toBeGreaterThanOrEqual(10)
  const grownMain = await dragMainBoundary('grow', growBy)
  expect(grownMain.settled[0]!.height).toBeGreaterThan(mainBeforeRoundtrip[0]!.height + 9)
  // Leave 2px above the initial floor so native equality/rounding is not the oracle.
  // A ratcheted main minHeight equal to the grown main prevents this reverse drag.
  const shrunkMain = await dragMainBoundary('shrink-back', -(growBy - 2))
  expect(shrunkMain.settled[0]!.height).toBeLessThan(grownMain.settled[0]!.height - 7)
  expect(shrunkMain.settled[0]!.height).toBeCloseTo(mainBeforeRoundtrip[0]!.height + 2, 0)
  const committedSubHeights = shrunkMain.settled.slice(1).map(pane => Math.round(pane.height))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await settlePanes()
  await expect.poll(async () => (await readPanes()).slice(1).map(pane => Math.round(pane.height))).toEqual(committedSubHeights)
  // The main-boundary gesture commits this visible layout for subsequent formula-free panes.
  const mainBoundaryCommittedWide = await readPanes()

  // Disable every custom formula through the real settings UI. No chart hook writes or hidden mutation APIs.
  await page.getByRole('button', { name: '训练默认设置' }).click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '公式指标' }).click()
  const section = dialog.getByRole('region', { name: '公式指标' })
  await expect(section).toBeVisible()
  for (const name of ['CHART_SUB', 'CHART_MACD', 'CHART_RANDOM_SUB']) {
    await section.getByLabel('公式列表').getByRole('button', { name: new RegExp(name) }).click()
    await expect(section.getByLabel('在图表启用', { exact: true })).toBeChecked()
    await section.getByLabel('在图表启用', { exact: true }).uncheck()
    const saved = page.waitForResponse(response => /\/api\/formulas\/\d+$/.test(response.url()) && response.request().method() === 'PUT')
    await section.getByRole('button', { name: '保存修改' }).click()
    expect((await saved).status()).toBe(200)
    await expect(section.locator('.settings-saved')).toHaveText('已保存修改')
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(async () => (await readPanes()).map(pane => pane.name)).toEqual(['candle_pane', 'VOL', 'MACD', 'KDJ'])
  await expect.poll(async () => (await formulaProbe(page)).length).toBe(0)
  await settlePanes()
  const nativePanes = await readPanes()
  expect(nativePanes).toHaveLength(4)
  for (const pane of nativePanes) expect(pane.height).toBeGreaterThan(0)
  // Formula-free native panes retain the manually requested heights after the last formula disappears.
  const nativeRequested = mainBoundaryCommittedWide.filter(pane => ['VOL', 'MACD', 'KDJ'].includes(pane.name))
  for (const pane of nativePanes.filter(pane => pane.id !== 'candle_pane')) expect(pane.height).toBeCloseTo(nativeRequested.find(request => request.name === pane.name)!.height, 1)
  await page.screenshot({ path: evidencePath('formula-dense-all-disabled-native-four-panes.png') })
})
