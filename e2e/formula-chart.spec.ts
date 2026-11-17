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
  await page.screenshot({ path: evidencePath('formula-chart-replay.png') })
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
