import { expect, test, type Locator, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// UIUX-REFINE-01 oracle: desktop configuration uses two task regions, with a
// reachable start action; these relationships are specified before the redesign.
const CURRENT_DATA_STATUS = {
  state: 'unchanged', needsUpdate: false, reason: '本地数据与数据源一致',
  source: { kind: 'tdx', name: '通达信本地数据', available: true },
  tdx: { available: true, root: 'C:/fixture_tdx' },
  online: { configured: false, provider: null },
  sourceMaxDate: '2026-09-24', lastCheckedAt: '2026-09-25T01:00:00.000Z', lastResult: null, revisionWarning: null,
  freshness: { state: 'current', expectedDate: '2026-09-24', sourceMaxDate: '2026-09-24', checkedAt: '2026-09-25T01:00:00.000Z', reason: '测试只隔离数据新鲜度提示' },
  calendar: { id: 'sse-2026-annual', from: '2026-01-01', through: '2026-12-31', version: 'e2e' },
}

async function openLauncher(page: Page): Promise<void> {
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  await page.route('**/api/data/status**', route => route.fulfill({ json: CURRENT_DATA_STATUS }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: '开始训练', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect(page.getByText('正在读取训练默认设置…')).toHaveCount(0)
}

async function box(locator: Locator) {
  const value = await locator.boundingBox()
  expect(value, '几何观测元素必须存在').toBeTruthy()
  return value!
}

function field(page: Page, label: string): Locator {
  return page.locator('.launcher-form .form-field').filter({ has: page.locator('label').filter({ hasText: label }) }).first()
}

test('desktop creation separates rules from the training subject and keeps start in the first viewport', async ({ page }) => {
  await openLauncher(page)
  for (const viewport of [{ width: 1008, height: 641 }, { width: 1024, height: 680 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    const subject = await box(page.getByRole('textbox', { name: '股票代码', exact: true }))
    const rules = await box(field(page, '复权方式'))
    const start = await box(page.getByRole('button', { name: '开始训练', exact: true }))
    expect.soft(rules.x, `${viewport.width} 的规则区应位于标的区右侧`).toBeGreaterThan(subject.x + subject.width)
    expect.soft(rules.y, '规则区应与配置起始区域并列').toBeLessThan(subject.y + 80)
    expect.soft(start.y + start.height, `${viewport.width} 的开始按钮应在首屏内`).toBeLessThanOrEqual(viewport.height - 8)
    expect.soft(start.y).toBeGreaterThan(0)
    const form = await box(page.locator('.launcher-form'))
    expect.soft(form.width, '工作台使用桌面可用宽度').toBeGreaterThan((viewport.width - 76) * 0.78)
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: evidencePath(`uiux-launcher-${viewport.width}.png`) })
  }
})

test('random dimension changes retain common control positions and the classic cash row', async ({ page }) => {
  for (const size of [{ width: 1008, height: 641 }, { width: 1024, height: 680 }]) {
  await page.setViewportSize(size)
  await openLauncher(page)
  const date = await box(page.locator('input[type=date]'))
  const cash = await box(field(page, '初始资金').locator('input'))
  expect(Math.abs(date.y - cash.y)).toBeLessThanOrEqual(2)
  await page.getByRole('tab', { name: '随机模式' }).click()
  const anchors: number[][] = []
  for (const dimension of ['随机股票 · 我选时间段', '随机时间段 · 我选股票', '全随机']) {
    await page.getByRole('button', { name: dimension, exact: true }).click()
    const period = await box(field(page, '训练周期'))
    const money = await box(field(page, '初始资金').locator('input'))
    const submit = await box(page.getByRole('button', { name: '开始训练', exact: true }))
    anchors.push([period.y, money.y, submit.y])
    expect.soft(submit.y + submit.height).toBeLessThanOrEqual(size.height - 8)
  }
  for (const values of anchors) for (let i = 0; i < values.length; i++) {
    expect(Math.abs(values[i] - anchors[0][i]), '维度切换不能移动公共控件').toBeLessThanOrEqual(2)
  }
  }
})

test('reorganized creation preserves selected options in the real create request', async ({ page }) => {
  await openLauncher(page)
  await page.getByRole('textbox', { name: '股票代码', exact: true }).fill('600519')
  await page.locator('.suggestions button').filter({ hasText: '600519' }).first().click()
  await field(page, '训练周期').getByRole('button', { name: '3个月', exact: true }).click()
  await page.locator('input[type=date]').fill('2025-01-02')
  await field(page, '初始资金').locator('input').fill('200000')
  await page.getByRole('button', { name: '不复权', exact: true }).click()
  await page.getByRole('button', { name: '开盘 + 收盘', exact: true }).click()
  await page.getByLabel('启用条件单').check()
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/trainings') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '开始训练', exact: true }).click()
  const response = await responsePromise
  expect(response.status()).toBe(201)
  expect(response.request().postDataJSON()).toMatchObject({ code: '600519', tier: '3M', start_date: '2025-01-02', initial_cash: 200000, adjust_mode: 'raw', clock_mode: 'open_close', orders_enabled: true })
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 30_000 })
})

test('launcher keeps random fields and the start action usable with 125 percent text in both themes', async ({ page }) => {
  for (const size of [{ width: 1008, height: 641 }, { width: 1024, height: 680 }]) {
  await page.setViewportSize(size)
  await openLauncher(page)
  // Deliberate text-token stress, not a claim of browser or operating-system zoom.
  await page.evaluate(() => {
    const root = document.documentElement
    const styles = getComputedStyle(root)
    const sizes = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'].map(key => [key, parseFloat(styles.getPropertyValue(`--font-size-${key}`))] as const)
    for (const [key, size] of sizes) root.style.setProperty(`--font-size-${key}`, `${size * 1.25}px`)
  })
  await page.getByRole('tab', { name: '随机模式' }).click()
  for (const theme of ['light', 'dark']) {
    if (await page.locator('body').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark')) await page.locator('.theme-toggle').click()
    const positions: number[][] = []
    for (const dimension of ['随机股票 · 我选时间段', '随机时间段 · 我选股票', '全随机']) {
      await page.getByRole('button', { name: dimension, exact: true }).click()
      await page.locator('.launcher-subject').evaluate(element => { element.scrollTop = 0 })
      const slot = page.getByTestId('random-dimension-slot')
      const slotBounds = await box(slot)
      const hintBounds = await box(slot.locator('.form-hint').last())
      expect.soft(hintBounds.y + hintBounds.height, '125% 说明不得溢出条件槽并覆盖下一个字段').toBeLessThanOrEqual(slotBounds.y + slotBounds.height + 2)
      const period = await box(field(page, '训练周期'))
      const cash = await box(field(page, '初始资金').locator('input'))
      positions.push([period.y, cash.y])
      const start = await box(page.getByRole('button', { name: '开始训练', exact: true }))
      expect.soft(start.y + start.height).toBeLessThanOrEqual(size.height - 8)
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    for (const position of positions) for (let i = 0; i < position.length; i++) expect.soft(Math.abs(position[i] - positions[0][i])).toBeLessThanOrEqual(2)
    const cash = field(page, '初始资金').locator('input')
    await cash.scrollIntoViewIfNeeded()
    const cashBounds = await box(cash)
    expect.soft(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x: cashBounds.x + 20, y: cashBounds.y + cashBounds.height / 2 })).toBe('INPUT')
    await page.screenshot({ path: evidencePath(`uiux-launcher-text125-${theme}-${size.width}.png`) })
  }
  }
})
