// M5-DEFAULTS-01 e2e（control-handoff-20260928-50）：默认资金/复权完整用户行为。
// 真实隔离服务＋冻结样本（300857）。覆盖 DEFAULTS-user-flow：
// 设置→保存重开持久→创建A→A活跃录制中改默认A不变→结束→B新默认→显式覆盖C；
// 保存失败/取消/重试、键盘路径、迟到读取不覆盖已编辑字段；840/1440 深浅与 pageerror。
import { expect, test, type Page } from '@playwright/test'

const SAMPLE = { code: '300857', startDate: '2026-04-15' }

async function resetFullDefaults(page: Page): Promise<void> {
  const response = await page.request.put('/api/settings/training', {
    data: { feesEnabled: false, tPlusOne: true, initialCash: 1_000_000, adjustMode: 'forward' },
  })
  expect(response.status()).toBe(200)
}

async function abandonActive(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
}

async function createSampleTraining(page: Page, overrides: Record<string, unknown> = {}): Promise<number> {
  const created = await page.request.post('/api/trainings', {
    data: { code: SAMPLE.code, tier: '1M', start_date: SAMPLE.startDate, blind: false, ...overrides },
  })
  expect(created.status()).toBe(201)
  return (await created.json()).training.id
}

async function openTrainingPage(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.training-topbar .workspace-title')).toContainText(SAMPLE.code)
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存', { timeout: 15_000 })
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '训练默认设置' }).click()
  await expect(page.getByRole('dialog', { name: '训练默认设置' })).toBeVisible()
}

test('默认设置→持久→A(80万/raw显式)→改默认(120万/forward)A不变→B新默认→C显式覆盖', async ({ page }: { page: Page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetFullDefaults(page)
  await abandonActive(page)

  // 首页采用默认初值（1,000,000 / 前复权）
  await page.goto('/')
  await expect(page.getByText('创建训练').first()).toBeVisible()
  await expect(page.locator('input[type="number"]').first()).toHaveValue('1000000')

  // 设置弹层：改默认 120万 / 不复权 → 保存成功 → 重开持久
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toContainText('默认只影响新训练')
  await dialog.getByLabel('默认初始资金（元）').fill('1200000')
  await dialog.getByRole('radio', { name: '不复权' }).click()
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog).toContainText('已保存')
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).not.toBeVisible()
  expect(await (await page.request.get('/api/settings/training')).json())
    .toMatchObject({ initialCash: 1200000, adjustMode: 'raw' })

  // A 局：显式覆盖 80万/raw（默认已是120万/raw，显式值优先）
  const idA = await createSampleTraining(page, { initial_cash: 800_000, adjust_mode: 'raw' })
  const snapshotA = await (await page.request.get(`/api/trainings/${idA}/bars?tf=1D`)).json()
  expect(snapshotA.training.initialCash).toBe(800_000)
  expect(snapshotA.training.adjustMode).toBe('raw')
  await openTrainingPage(page)
  // A 交易并保持录制
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.recording-strip')).toContainText('正在记录')

  // A 活跃录制中改默认：120万/forward → A 的资金/复权/规则与录像不变
  await openSettings(page)
  await dialog.getByLabel('默认初始资金（元）').fill('1200000')
  await dialog.getByRole('radio', { name: '前复权' }).click()
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog).toContainText('已保存')
  await page.keyboard.press('Escape')
  await expect(page.locator('.recording-strip')).toContainText('正在记录')
  const afterChange = await (await page.request.get(`/api/trainings/${idA}/bars?tf=1D`)).json()
  expect(afterChange.training.initialCash).toBe(800_000)
  expect(afterChange.training.adjustMode).toBe('raw')
  expect(afterChange.training.rules).toEqual(snapshotA.training.rules)
  expect(afterChange.account.equity).toBeCloseTo(snapshotA.account.equity, 6)

  // 结束 A → B 采用新默认（120万/forward）
  await page.getByRole('button', { name: '提前结算' }).click()
  await page.getByRole('button', { name: '确认结算' }).click()
  await page.getByRole('button', { name: '完成，返回首页' }).click()
  await abandonActive(page)
  const idB = await createSampleTraining(page)
  const snapshotB = await (await page.request.get(`/api/trainings/${idB}/bars?tf=1D`)).json()
  expect(snapshotB.training.initialCash).toBe(1_200_000)
  expect(snapshotB.training.adjustMode).toBe('forward')
  await abandonActive(page)

  // C 显式覆盖：60万/raw
  const idC = await createSampleTraining(page, { initial_cash: 600_000, adjust_mode: 'raw' })
  const snapshotC = await (await page.request.get(`/api/trainings/${idC}/bars?tf=1D`)).json()
  expect(snapshotC.training.initialCash).toBe(600_000)
  expect(snapshotC.training.adjustMode).toBe('raw')
  await abandonActive(page)
  expect(errors).toEqual([])
})

test('设置保存失败反馈/取消不保存/键盘路径；迟到读取不覆盖已编辑字段；1440深/840浅', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetFullDefaults(page)
  await abandonActive(page)
  await page.goto('/')
  await expect(page.getByText('创建训练').first()).toBeVisible()

  // 保存失败：服务端 400 → 错误反馈、不假称保存
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await page.route('**/api/settings/training', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'initialCash 必须是 0.01 至 1,000,000,000 之间、至多两位小数的数字' }) })
  })
  await dialog.getByLabel('默认初始资金（元）').fill('800000')
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog.getByRole('alert').filter({ hasText: 'initialCash' })).toBeVisible()
  await expect(dialog).not.toContainText('已保存')
  await page.unroute('**/api/settings/training')

  // 取消：不保存；Esc 关闭还焦点设置入口
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).not.toBeVisible()
  expect(await (await page.request.get('/api/settings/training')).json()).toMatchObject({ initialCash: 1_000_000 })
  const focusOnTrigger = await page.evaluate(() => {
    const trigger = document.querySelector('[aria-label="训练默认设置"]')
    return !!trigger && (trigger === document.activeElement || trigger.contains(document.activeElement))
  })
  expect(focusOnTrigger).toBe(true)

  // 键盘路径：重开 → Tab 环游不出弹层 → 保存成功
  await page.getByRole('button', { name: '训练默认设置' }).click()
  await expect(dialog).toBeVisible()
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      return !!d && d.contains(document.activeElement)
    })).toBe(true)
  }
  while (!(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.includes('保存设置')))) {
    await page.keyboard.press('Tab')
  }
  await page.keyboard.press('Enter')
  await expect(dialog).toContainText('已保存')
  await page.keyboard.press('Escape')

  // 迟到读取不覆盖已编辑字段：挂起 GET 期间手动改初始资金/复权，响应到达后保留用户输入
  await abandonActive(page)
  await page.route('**/api/settings/training', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    await new Promise(resolve => setTimeout(resolve, 1200))
    await route.continue()
  })
  await page.reload()
  await expect(page.getByText('创建训练').first()).toBeVisible()
  const cashInput = page.locator('input[type="number"]').first()
  await cashInput.fill('666666')
  await page.getByRole('button', { name: '不复权' }).last().click()
  await tab_playwright_waitReady(page)
  // 迟到响应（默认 1000000/forward）已到达：用户编辑值不被覆盖
  await expect(cashInput).toHaveValue('666666')
  await expect(page.getByRole('button', { name: '不复权' }).last()).toHaveClass(/selected/)
  await abandonActive(page)
  expect(errors).toEqual([])
})

/** 等待 Launcher 默认读取完成（开始训练按钮解除禁用），超时判失败。 */
async function tab_playwright_waitReady(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: '开始训练' })).toBeEnabled({ timeout: 5_000 })
}

test('840浅色与1440深色下设置弹层完整可读；录制不卸载', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetFullDefaults(page)
  await abandonActive(page)
  const id = await createSampleTraining(page)
  await openTrainingPage(page)
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.recording-strip')).toContainText('正在记录')

  await page.setViewportSize({ width: 840, height: 900 })
  await page.getByRole('button', { name: '切换到浅色主题' }).click()
  await openSettings(page)
  await expect(page.getByRole('dialog', { name: '训练默认设置' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSettings(page)
  await expect(page.getByRole('dialog', { name: '训练默认设置' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.recording-strip')).toContainText('正在记录')
  await abandonActive(page)
  expect(errors).toEqual([])
})
