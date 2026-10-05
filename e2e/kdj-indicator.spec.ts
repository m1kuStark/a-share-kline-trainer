import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// M6-01 KDJ 副图（通达信口径）真实浏览器回归：
// ① 默认偏好开启时 KDJ 副图随 VOL/MACD 同等挂载（窗格语义名/几何）；
// ② 开关（M6-04 起迁至训练页周期按钮行 .indicator-toggles）立即增删窗格并持久化
//    （localStorage + 刷新后保持；按钮可寻址名不变，断言无需随位置改写）；
// ③ KDJ 副图与既有窗格交互语义同等：框选缩放可从 KDJ 窗格启动、双击最大化/还原、
//    画线可落在 KDJ 窗格并以语义名 'KDJ' 保存/恢复。
// 数值口径（RSV/SMA 平滑/种子 50）由 server/test/kdj-indicator.test.ts 的独立 oracle 锁定，
// 本套件不重复数值断言。真实鼠标事件驱动；__trainerChart 只读。

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
  // 默认偏好（开）：candle/VOL/MACD/KDJ 四个绘图窗格
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.panes().length)).toBe(4)
}

function kdjButton(page: Page) { return page.getByRole('button', { name: 'KDJ', exact: true }) }

async function panes(page: Page): Promise<Pane[]> {
  return page.evaluate(() => (window as any).__trainerChart.panes())
}

async function kdjPane(page: Page): Promise<Pane> {
  const pane = (await panes(page)).find(item => item.name === 'KDJ')
  expect(pane, 'KDJ 副图窗格').toBeTruthy()
  return pane!
}

test('KDJ subchart mounts by default with the VOL/MACD panes intact', async ({ page }) => {
  await openChart(page)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.indicatorPanes()))
    .toEqual(['candle_pane', 'VOL', 'MACD', 'KDJ'])
  const [candle, vol, macd, kdj] = await panes(page)
  expect(candle.height).toBeGreaterThan(0)
  expect(vol.height).toBeGreaterThan(0)
  expect(macd.height).toBeGreaterThan(0)
  // 副图高度同量级（KDJ 与 VOL/MACD 等高带），主图仍占大头
  expect(kdj.height).toBeGreaterThan(40)
  expect(candle.height).toBeGreaterThan(kdj.height)
  await expect(kdjButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(kdjButton(page)).not.toHaveClass(/off/)
  await page.screenshot({ path: evidencePath('kdj-subchart-default.png') })
})

test('toggling KDJ off/on takes effect immediately and persists across reload', async ({ page }) => {
  await openChart(page)
  const expectedWithoutKdj = ['candle_pane', 'VOL', 'MACD']
  // 关闭：立即生效（窗格移除）＋持久化
  await kdjButton(page).click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.indicatorPanes())).toEqual(expectedWithoutKdj)
  await expect(kdjButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(kdjButton(page)).toHaveClass(/off/)
  expect(await page.evaluate(() => localStorage.getItem('trainer_kdj_subchart'))).toBe('0')
  // 刷新：偏好保持关闭（不属于录像布局，按当前开关渲染）
  await page.reload()
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.indicatorPanes?.() ?? null)).toEqual(expectedWithoutKdj)
  // 重新开启：窗格回来，偏好写回 '1'
  await kdjButton(page).click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.indicatorPanes()))
    .toEqual(['candle_pane', 'VOL', 'MACD', 'KDJ'])
  expect(await page.evaluate(() => localStorage.getItem('trainer_kdj_subchart'))).toBe('1')
  await page.screenshot({ path: evidencePath('kdj-subchart-toggled-back-on.png') })
})

test('KDJ pane participates in box select, dbl-click maximize and drawing like other panes', async ({ page }) => {
  await openChart(page)
  const host = await page.locator('.chart-host').boundingBox()
  expect(host).not.toBeNull()

  // ① 框选缩放从 KDJ 窗格启动（绘图 pane 同权）：选中框 DOM 可见，松手后可见根数变少
  const before = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  const kdj = await kdjPane(page)
  const y = host!.y + kdj.top + kdj.height / 2
  await page.mouse.move(host!.x + kdj.width * .45, y)
  await page.mouse.down()
  await page.mouse.move(host!.x + kdj.width * .8, y, { steps: 12 })
  await expect(page.locator('.select-rect')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.select-rect')).not.toBeVisible()
  await expect.poll(() => {
    const range = page.evaluate(() => (window as any).__trainerChart.visibleRange())
    return range
  }).not.toEqual(before)
  const after = await page.evaluate(() => (window as any).__trainerChart.visibleRange())
  expect(after.to - after.from).toBeLessThan(before.to - before.from)

  // ② 双击 KDJ 窗格：最大化（其余窗格高度归零），再双击还原
  await page.mouse.dblclick(host!.x + kdj.width * .45, host!.y + kdj.top + kdj.height * .5)
  await expect.poll(async () => (await panes(page))[0].height).toBe(0)
  await page.mouse.dblclick(host!.x + kdj.width * .45, host!.y + 100)
  await expect.poll(async () => (await panes(page))[0].height).toBeGreaterThan(0)

  // ③ 画线落在 KDJ 窗格：语义 paneId='KDJ'，保存刷新后按语义名恢复回 KDJ 窗格
  const button = page.locator('[data-tool-name="segment"]')
  if (!await button.isVisible()) await page.locator('.other-tools-toggle').click()
  await button.click()
  const pane = await kdjPane(page)
  await page.mouse.click(host!.x + pane.width * .25, host!.y + pane.top + pane.height * .3)
  await page.waitForTimeout(560)
  await page.mouse.click(host!.x + pane.width * .65, host!.y + pane.top + pane.height * .7)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.drawings().length)).toBe(1)
  const saved = await page.evaluate(() => (window as any).__trainerChart.drawings())
  expect(saved[0].paneId).toBe('KDJ')
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await page.reload()
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.drawings?.().length)).toBe(1)
  const restored = await page.evaluate(() => (window as any).__trainerChart.drawings())
  expect(restored[0].paneId).toBe('KDJ')
  await page.screenshot({ path: evidencePath('kdj-subchart-drawing-restored.png') })
})
