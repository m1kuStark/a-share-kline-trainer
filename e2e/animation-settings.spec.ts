import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// M6-07 设置面板"动画效果"分栏（用户 2026-10-05 验收拍板）真实浏览器回归：
// ① 顶栏"滚动"胶囊按钮移除（其余顶栏元素不动，负向断言）；
// ② 训练中 ⚙ 设置可达"动画效果"分栏，首项"数字滚动动效"开关默认开；
// ③ 即改即生效双向：关→推进零滚动直显终值；重开→推进滚动层出现且终值精确；
// ④ 持久化键沿用 trainer_odo_motion（'0'/'1'，不换键）；
// ⑤ 设置弹层既有键盘/焦点语义（M5 已验收）不回归：Esc 关闭并还焦点至设置入口。
// 终值口径复用 odometer.spec 的冻结公式（测试侧独立计算，不读页面实现）。

const INITIAL_CASH = 100_000_000
const errors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function openTraining(page: Page): Promise<number> {
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  const response = await page.request.post('/api/trainings', {
    data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: INITIAL_CASH },
  })
  expect(response.status()).toBe(201)
  const id = ((await response.json()) as { training: { id: number } }).training.id
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(page.locator('.loading-dot')).not.toBeVisible()
  return id
}

/** 全程见证探针：视觉层是否出现过（同 odometer.spec 口径） */
async function installOdometerProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = { equity: false }
    ;(window as unknown as { __odoProbe: typeof seen }).__odoProbe = seen
    new MutationObserver(() => {
      if (document.querySelector('.equity-block strong .odo-roll')) seen.equity = true
    }).observe(document.body, { childList: true, subtree: true })
  })
}

async function buyHalfPosition(page: Page): Promise<void> {
  await page.keyboard.press('b')
  await expect(page.locator('.status-message')).toContainText('买入成交', { timeout: 30_000 })
  await expect(page.locator('.loading-dot')).not.toBeVisible()
}

async function advanceOnce(page: Page): Promise<void> {
  const date = page.locator('.training-current-date strong')
  const before = await date.innerText()
  await page.keyboard.press('Space')
  await expect.poll(() => date.innerText(), { timeout: 30_000 }).not.toBe(before)
  await expect(page.locator('.loading-dot')).not.toBeVisible()
}

/** 冻结公式（与面板现状一致，测试侧独立计算）：¥ + zh-CN 千分位（至多两位小数） */
function oracleEquityText(equity: number): string {
  return `¥${equity.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

test('animation settings section owns the odometer motion switch: instant effect, persisted key, topbar capsule removed (M6-07)', async ({ page }) => {
  test.setTimeout(180_000)
  const id = await openTraining(page)
  // ① 顶栏胶囊按钮移除（负向）；周期/副图等其余顶栏元素仍在
  await expect(page.locator('.motion-toggle')).toHaveCount(0)
  await expect(page.locator('.timeframe-tabs')).toBeVisible()
  await expect(page.locator('.indicator-toggles').first()).toBeVisible()

  // ② 设置面板 →"动画效果"分栏：首项"数字滚动动效"默认开
  await page.getByRole('button', { name: '训练默认设置' }).click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '动画效果' }).click()
  const odoSwitch = dialog.getByLabel('数字滚动动效')
  await expect(odoSwitch).toBeChecked()

  // ③a 关闭：即改即生效（localStorage 同步落 '0'，键沿用不换）
  await odoSwitch.uncheck()
  await expect(odoSwitch).not.toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('trainer_odo_motion'))).toBe('0')

  // ⑤ Esc 关闭弹层（M5 键盘语义）并还焦点至设置入口
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label'))).toBe('训练默认设置')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  // ③a 续：关闭态下买入＋推进——零滚动层、直显终值
  await installOdometerProbe(page)
  await buyHalfPosition(page)
  for (let i = 0; i < 2; i++) await advanceOnce(page)
  await expect(page.locator('.equity-block .odo-roll')).toHaveCount(0)
  let equity = await (await page.request.get(`/api/trainings/${id}/bars?tf=1D`)).json()
  await expect(page.locator('.equity-block strong')).toHaveText(oracleEquityText(equity.account.equity as number))
  expect(await page.evaluate(() => (window as unknown as { __odoProbe: { equity: boolean } }).__odoProbe.equity)).toBe(false)

  // ③b 重开：重进设置开关仍为关（本会话持久），打开后推进——滚动层出现且收尾终值精确
  await page.getByRole('button', { name: '训练默认设置' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '动画效果' }).click()
  await expect(odoSwitch).not.toBeChecked()
  await odoSwitch.check()
  await expect(odoSwitch).toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('trainer_odo_motion'))).toBe('1')
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).not.toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  await advanceOnce(page)
  await page.waitForTimeout(900) // 滚动（≤600ms）＋卸层（120ms）收口
  equity = await (await page.request.get(`/api/trainings/${id}/bars?tf=1D`)).json()
  await expect(page.locator('.equity-block strong')).toHaveText(oracleEquityText(equity.account.equity as number))
  await expect(page.locator('.equity-block .odo-roll')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __odoProbe: { equity: boolean } }).__odoProbe.equity), '重开后滚动层出现过').toBe(true)
  await page.screenshot({ path: evidencePath('animation-settings-reenabled.png') })
})
