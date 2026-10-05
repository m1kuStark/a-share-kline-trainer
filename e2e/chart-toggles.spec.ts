import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// M6-04 指标开关迁移（chart-toggles 矩阵，用户 2026-10-05 验收拍板）真实浏览器回归：
// ① 三个开关（VOL/MACD/KDJ）与周期按钮（日K/周K/月K）同行同区（股票信息条），
//    aria-pressed 语义保留；顶栏不再出现 KDJ 按钮（TOG-PERIOD-ROW-PLACEMENT）；
// ② 任一开关关闭＝对应副图立即移除＋独立 localStorage 键持久化，刷新后保持，
//    重开＝副图回来；默认全开（TOG-EACH-INDICATOR）；
// ③ 部分副图关闭时其余窗格的框选/双击最大化/画线保存恢复语义不变（TOG-OFF-COMPAT，
//    沿用 KDJ 关闭机制；回放 paneHeights 守卫的源码契约见 frontend-contract M6-01/M6-04 块）。
// KDJ 数值口径由 server/test/kdj-indicator.test.ts 的独立 oracle 锁定，此处不重复数值断言。

type Pane = { id: string; name: string; top: number; height: number; width: number; left: number }
const errors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function openChart(page: Page): Promise<void> {
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  const response = await page.request.post('/api/trainings', {
    data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 100_000_000 },
  })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(page.locator('.loading-dot')).not.toBeVisible()
  // 默认偏好（全开）：candle/VOL/MACD/KDJ 四个绘图窗格
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.panes().length)).toBe(4)
}

function toggle(page: Page, name: string) { return page.locator('.indicator-toggles').getByRole('button', { name, exact: true }) }

async function panes(page: Page): Promise<Pane[]> {
  return page.evaluate(() => (window as any).__trainerChart.panes())
}

async function paneNames(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__trainerChart.indicatorPanes())
}

test('the three indicator toggles sit in the period row with aria-pressed and no topbar KDJ button', async ({ page }) => {
  await openChart(page)
  // 三开关与周期按钮同区渲染（同一股票信息行 .training-context 内），默认全开（aria-pressed=true）
  const row = page.locator('.training-context')
  for (const name of ['VOL', 'MACD', 'KDJ']) {
    await expect(row.getByRole('button', { name, exact: true })).toBeVisible()
    await expect(toggle(page, name)).toHaveAttribute('aria-pressed', 'true')
  }
  // 与周期按钮同一行：开关纵向带与周期按钮组纵向带相交（同行同区）
  const tabsBox = (await page.locator('.timeframe-tabs').boundingBox())!
  for (const name of ['VOL', 'MACD', 'KDJ']) {
    const box = (await toggle(page, name).boundingBox())!
    expect(box.y + box.height, `${name} 与周期按钮同行`).toBeGreaterThan(tabsBox.y)
    expect(box.y, `${name} 与周期按钮同行`).toBeLessThan(tabsBox.y + tabsBox.height)
  }
  // 顶栏不再出现 KDJ 按钮（"记录操作/导出录制/TD 状态"等顶栏元素不动——仍可见）
  await expect(page.locator('.top-actions').getByRole('button', { name: 'KDJ', exact: true })).toHaveCount(0)
  await expect(page.locator('.theme-toggle')).toBeVisible()
  await page.screenshot({ path: evidencePath('chart-toggles-period-row.png') })
})

test('toggling each indicator removes and restores its pane immediately with independent persistence', async ({ page }) => {
  await openChart(page)
  await expect.poll(() => paneNames(page)).toEqual(['candle_pane', 'VOL', 'MACD', 'KDJ'])

  // 关 VOL：副图立即移除，独立键写 '0'（MACD/KDJ 键不受影响）
  await toggle(page, 'VOL').click()
  await expect.poll(() => paneNames(page)).toEqual(['candle_pane', 'MACD', 'KDJ'])
  await expect(toggle(page, 'VOL')).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle(page, 'MACD')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('trainer_vol_subchart'))).toBe('0')
  expect(await page.evaluate(() => localStorage.getItem('trainer_macd_subchart'))).toBeNull()

  // 关 MACD → 只剩主图＋KDJ
  await toggle(page, 'MACD').click()
  await expect.poll(() => paneNames(page)).toEqual(['candle_pane', 'KDJ'])
  expect(await page.evaluate(() => localStorage.getItem('trainer_macd_subchart'))).toBe('0')

  // 关 KDJ → 只剩主图
  await toggle(page, 'KDJ').click()
  await expect.poll(() => paneNames(page)).toEqual(['candle_pane'])
  expect(await page.evaluate(() => localStorage.getItem('trainer_kdj_subchart'))).toBe('0')

  // 刷新：三偏好保持关闭（不属于录像布局，按当前开关渲染）
  await page.reload()
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => paneNames(page)).toEqual(['candle_pane'])
  for (const name of ['VOL', 'MACD', 'KDJ']) await expect(toggle(page, name)).toHaveAttribute('aria-pressed', 'false')

  // 依次重开：三个副图全部回来（追加序），偏好写回 '1'
  await toggle(page, 'VOL').click()
  await expect.poll(() => paneNames(page)).toEqual(['candle_pane', 'VOL'])
  await toggle(page, 'MACD').click()
  await expect.poll(() => paneNames(page)).toEqual(['candle_pane', 'VOL', 'MACD'])
  await toggle(page, 'KDJ').click()
  await expect.poll(() => paneNames(page)).toEqual(['candle_pane', 'VOL', 'MACD', 'KDJ'])
  for (const name of ['VOL', 'MACD', 'KDJ']) {
    await expect(toggle(page, name)).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(key => localStorage.getItem(key), `trainer_${name.toLowerCase()}_subchart`)).toBe('1')
  }
  await page.screenshot({ path: evidencePath('chart-toggles-all-back-on.png') })
})

test('box select, dbl-click maximize and drawing save/restore keep their semantics with some subcharts off', async ({ page }) => {
  await openChart(page)
  // 关 KDJ 与 MACD：只剩主图＋VOL，其余窗格交互语义必须不变
  await toggle(page, 'KDJ').click()
  await toggle(page, 'MACD').click()
  await expect.poll(() => paneNames(page)).toEqual(['candle_pane', 'VOL'])
  const host = (await page.locator('.chart-host').boundingBox())!

  // 框选缩放从主图启动照常
  const before = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  await page.mouse.move(host.x + host.width * .3, host.y + 150)
  await page.mouse.down()
  await page.mouse.move(host.x + host.width * .7, host.y + 150, { steps: 10 })
  await expect(page.locator('.select-rect')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.select-rect')).not.toBeVisible()
  const after = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  expect(after.to - after.from).toBeLessThan(before.to - before.from)

  // 双击 VOL 窗格：最大化（主图高度归零），再双击还原
  const vol = (await panes(page)).find(pane => pane.name === 'VOL')!
  await page.mouse.dblclick(host.x + vol.width * .45, host.y + vol.top + vol.height * .5)
  await expect.poll(async () => (await panes(page))[0].height).toBe(0)
  await page.mouse.dblclick(host.x + vol.width * .45, host.y + 100)
  await expect.poll(async () => (await panes(page))[0].height).toBeGreaterThan(0)

  // 画线落在主图：保存刷新（KDJ/MACD 仍关）后按语义 paneId 恢复
  const button = page.locator('[data-tool-name="segment"]')
  if (!await button.isVisible()) await page.locator('.other-tools-toggle').click()
  await button.click()
  const candle = (await panes(page))[0]
  await page.mouse.click(host.x + candle.width * .25, host.y + candle.top + candle.height * .3)
  await page.waitForTimeout(560)
  await page.mouse.click(host.x + candle.width * .65, host.y + candle.top + candle.height * .7)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.drawings().length)).toBe(1)
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const saved = await page.evaluate(() => (window as any).__trainerChart.drawings())
  expect(saved[0].paneId).toBe('candle_pane')
  await page.reload()
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.drawings?.().length)).toBe(1)
  const restored = await page.evaluate(() => (window as any).__trainerChart.drawings())
  expect(restored[0].paneId).toBe('candle_pane')
  await page.screenshot({ path: evidencePath('chart-toggles-off-compat-drawing.png') })
})
