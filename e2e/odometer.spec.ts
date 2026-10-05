import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// M6-05 账户权益/收益率 Odometer 数字滚动（account-odometer 矩阵，用户 2026-10-05 验收拍板）真实浏览器回归：
// ① 快速推进 5 根（ODO-RAPID-CATCHUP 的 e2e 面）：买入建仓后连续 Space 推进，
//    期间动画视觉层确实出现（MutationObserver 全程见证 .equity-block .odo-roll 挂载），
//    停稳后终值精确＝服务端账面值（终文本用冻结公式在测试侧独立计算，不读页面实现），
//    且视觉层已卸下（无残留错位）；
// ② 作用域（ODO-SCOPE-ONLY-TWO）：可用资金/持仓市值等 .account-stats 与结算弹窗全程不出现 odo 结构；
// ③ prefers-reduced-motion（ODO-REDUCED-MOTION）：reduce 模式下数值变化不播动画（视觉层零挂载）、直显终值。
// 中断重定向的纯逻辑断言（无排队、时长封顶）由 server/test/odometer.test.ts 锁定；
// 终值格式口径（¥/千分位/±/两位小数%）与既有文本断言共存策略（真实文本恒终值）也由该套件＋契约锁定。

const INITIAL_CASH = 100_000_000
const errors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

/** 冻结公式（与面板现状一致，测试侧独立计算）：¥ + zh-CN 千分位（至多两位小数） */
function oracleEquityText(equity: number): string {
  return `¥${equity.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

/** 冻结公式：≥0 补 '+'，toFixed(2)，负号自带 */
function oracleReturnPctText(equity: number): string {
  const pct = ((equity - INITIAL_CASH) / INITIAL_CASH) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

async function createTraining(page: Page): Promise<number> {
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  const response = await page.request.post('/api/trainings', {
    data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: INITIAL_CASH },
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { training: { id: number } }).training.id
}

async function openTraining(page: Page): Promise<number> {
  const id = await createTraining(page)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(page.locator('.loading-dot')).not.toBeVisible()
  return id
}

/** 全程见证探针：动画视觉层是否出现过（equity 处）；越界动画结构是否出现（account-stats/结算弹窗） */
async function installOdometerProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = { equity: false, returnPct: false, others: false }
    ;(window as unknown as { __odoProbe: typeof seen }).__odoProbe = seen
    new MutationObserver(() => {
      if (document.querySelector('.equity-block strong .odo-roll')) seen.equity = true
      if (document.querySelector('.equity-block em .odo-roll')) seen.returnPct = true
      if (document.querySelector('.account-stats .odo-roll, .account-stats .odo-wrap, .settle-grid .odo-roll, .settle-grid .odo-wrap')) seen.others = true
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

/** 服务端账面值（独立 oracle 来源：不经页面实现） */
async function bookEquity(page: Page, id: number): Promise<number> {
  const response = await page.request.get(`/api/trainings/${id}/bars?tf=1D`)
  expect(response.status()).toBe(200)
  return ((await response.json()) as { account: { equity: number } }).account.equity
}

/** 停稳断言：真实文本（恒终值）＝冻结公式独立计算；视觉层已卸下 */
async function expectSettledNumbers(page: Page, equity: number): Promise<void> {
  expect(equity).not.toBe(INITIAL_CASH) // 建仓＋推进后权益确已变化（动画断言非空转）
  await expect(page.locator('.equity-block strong')).toHaveText(oracleEquityText(equity))
  await expect(page.locator('.equity-block em')).toHaveText(oracleReturnPctText(equity))
  await expect(page.locator('.equity-block .odo-roll')).toHaveCount(0)
}

test('rapid five-bar advance rolls the two numbers and settles on exact book values (ODO-RAPID-CATCHUP e2e)', async ({ page }) => {
  test.setTimeout(180_000)
  const id = await openTraining(page)
  await installOdometerProbe(page)
  await buyHalfPosition(page)
  // 连续快速推进 5 根：每次等上根完成即按下一根（与用户连按空格同节奏）
  for (let i = 0; i < 5; i++) await advanceOnce(page)
  // 收尾：最长一次滚动 600ms＋卸层 120ms，等视觉层完全收口
  await page.waitForTimeout(900)
  const equity = await bookEquity(page, id)
  await expectSettledNumbers(page, equity)
  // 动画确实播过（两处数字都出现过视觉层）且越界处从未出现（作用域）
  const probe = await page.evaluate(() => (window as unknown as { __odoProbe: { equity: boolean; returnPct: boolean; others: boolean } }).__odoProbe)
  expect(probe.equity, '账户权益动画播放过').toBe(true)
  expect(probe.returnPct, '收益率动画播放过').toBe(true)
  expect(probe.others, '可用资金/持仓市值/结算弹窗无动画结构').toBe(false)
  await page.screenshot({ path: evidencePath('odometer-settled.png') })
})

test('prefers-reduced-motion skips the animation entirely and still shows exact final text (ODO-REDUCED-MOTION)', async ({ page }) => {
  test.setTimeout(180_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const id = await openTraining(page)
  await installOdometerProbe(page)
  await buyHalfPosition(page)
  for (let i = 0; i < 3; i++) await advanceOnce(page)
  await page.waitForTimeout(400)
  const equity = await bookEquity(page, id)
  await expectSettledNumbers(page, equity)
  // reduce 模式全程零动画视觉层（直显终值）
  const probe = await page.evaluate(() => (window as unknown as { __odoProbe: { equity: boolean; returnPct: boolean; others: boolean } }).__odoProbe)
  expect(probe.equity).toBe(false)
  expect(probe.returnPct).toBe(false)
  expect(probe.others).toBe(false)
})
