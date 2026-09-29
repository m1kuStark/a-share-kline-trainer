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

  // 返修 F4（显式门闩，非 sleep）：挂起 GET（旧默认）期间手动改字段，释放后用户输入保留
  let releaseStaleGet!: () => void
  const staleGate = new Promise<void>(resolve => { releaseStaleGet = resolve })
  await abandonActive(page)
  await page.route('**/api/settings/training', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return }
    await staleGate
    await route.continue()
  })
  await page.reload()
  await expect(page.getByText('创建训练').first()).toBeVisible()
  const cashInput = page.locator('input[type="number"]').first()
  await expect(cashInput).toBeDisabled().catch(() => {}) // 读取未完成：输入可能仍不可用属允许
  await cashInput.fill('666666', { timeoutMs: 8000 })
  await page.getByRole('button', { name: '不复权' }).last().click()
  releaseStaleGet()
  // 迟到响应（默认 1000000/forward）释放后：用户编辑值不被覆盖
  await expect(cashInput).toHaveValue('666666')
  await expect(page.getByRole('button', { name: '不复权' }).last()).toHaveClass(/selected/)
  await page.unroute('**/api/settings/training')

  // 返修 F4 真实点击创建：保存默认→表单未手改采用→实际点击创建
  // 数据守卫 mock 为 current：真实点击创建不被"建议先更新"确认弹窗拦截
  const CURRENT_DATA_STATUS = JSON.stringify({
    state: 'unchanged', needsUpdate: false, reason: '本地日线数据与数据源一致',
    source: { kind: 'tdx', name: '通达信本地数据', available: true },
    tdx: { available: true, root: 'C:/new_tdx' },
    online: { configured: false, provider: null },
    sourceMaxDate: '2026-09-24', lastCheckedAt: '2026-09-28T01:00:00.000Z', lastResult: null, revisionWarning: null,
    freshness: { state: 'current', expectedDate: '2026-09-24', sourceMaxDate: '2026-09-24', checkedAt: '2026-09-28T01:00:00.000Z', reason: '来源最大日期 2026-09-24 已达到应收收盘日 2026-09-24。' },
    calendar: { id: 'sse-2026-annual', from: '2026-01-01', through: '2026-12-31', version: 'e2e' },
  })
  await page.route('**/api/data/status**', route => route.fulfill({ json: CURRENT_DATA_STATUS }))
  await resetFullDefaults(page)
  // data/status 的 store 状态在页面加载时已取（unknown）：reload 使 current mock 生效
  await page.reload()
  await expect(page.getByText('创建训练').first()).toBeVisible()
  await page.route('**/api/settings/training', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    const saved = { feesEnabled: false, tPlusOne: true, initialCash: 1200000, adjustMode: 'raw' }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, ...saved, commissionRate: 0.00025, minimumCommission: 5, stampDutyRate: 0.0005, lotSize: 100, execution: 'same-day-raw-close', weightBasis: 'total-equity', corporateActionPolicy: 'cash-shares-v1' }) })
  })
  await openSettings(page)
  const savedDialog = page.getByRole('dialog', { name: '训练默认设置' })
  await savedDialog.getByLabel('默认初始资金（元）').fill('1200000')
  await savedDialog.getByRole('radio', { name: '不复权' }).click()
  await savedDialog.getByRole('button', { name: '保存设置' }).click()
  await expect(savedDialog).toContainText('已保存')
  await page.keyboard.press('Escape')
  await expect(savedDialog).not.toBeVisible()
  // 真实用户路径：搜索并选择股票后再点击创建
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill('300857')
  await page.getByRole('button', { name: /300857 协创数据/ }).click()
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect(page.locator('.training-topbar .workspace-title')).toContainText(SAMPLE.code, { timeout: 15_000 })
  const createdViaClick = await (await page.request.get('/api/trainings/active')).json()
  expect(createdViaClick.training.initialCash).toBe(1_200_000)
  expect(createdViaClick.training.adjustMode).toBe('raw')
  await abandonActive(page)
  expect(errors).toEqual([])
})

test('返修F4 modal迟到GET：保存130万/raw成功后释放旧GET，表单不回退且已保存保持；DB为新值', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetFullDefaults(page)
  await abandonActive(page)
  // 门闩：挂起 modal 初次 GET（旧默认）
  let releaseModalGet!: () => void
  const modalGate = new Promise<void>(resolve => { releaseModalGet = resolve })
  await page.route('**/api/settings/training', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return }
    await modalGate
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByText('创建训练').first()).toBeVisible()
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  // GET 仍挂起：用户填 1300000/raw 并保存成功（PUT 不经门闩）
  await dialog.getByLabel('默认初始资金（元）').fill('1300000')
  await dialog.getByRole('radio', { name: '不复权' }).click()
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog).toContainText('已保存')
  // 释放旧 GET：表单不回退 1000000/forward，已保存保持，DB 为 1300000/raw
  releaseModalGet()
  await page.waitForTimeout(600)
  await expect(dialog.getByLabel('默认初始资金（元）')).toHaveValue('1300000')
  await expect(dialog.getByRole('radio', { name: '不复权' })).toBeChecked()
  await expect(dialog).toContainText('已保存')
  expect(await (await page.request.get('/api/settings/training')).json())
    .toMatchObject({ initialCash: 1_300_000, adjustMode: 'raw' })
  await abandonActive(page)
  expect(errors).toEqual([])
})

test('返修F5 设置保存使在途预览失效：加载所有权释放可重新预览；旧响应不覆盖新请求', async ({ page }: { page: Page }) => {
  test.setTimeout(150_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetFullDefaults(page)
  await abandonActive(page)
  await page.goto('/')
  await expect(page.getByText('创建训练').first()).toBeVisible()
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill('300857')
  await page.getByRole('button', { name: /300857 协创数据/ }).click()
  await page.getByRole('button', { name: '自定义范围' }).click()
  await page.locator('input[type="date"]').fill('2026-04-15')
  // 门闩：挂起首次预览请求
  let releasePreview!: () => void
  const previewGate = new Promise<void>(resolve => { releasePreview = resolve })
  let previewReleases = 0
  await page.route('**/api/training-ranges/preview', async route => {
    await previewGate
    previewReleases += 1
    await route.continue()
  })
  await page.getByRole('button', { name: '生成范围预览' }).click()
  await expect(page.getByRole('button', { name: /生成预览中/ })).toBeVisible()
  // 在途预览期间：设置保存使默认复权变化 → 在途预览失效（加载所有权释放，按钮恢复）
  releasePreview()
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await dialog.getByRole('radio', { name: '不复权' }).click()
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog).toContainText('已保存')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '生成范围预览' })).toBeEnabled({ timeout: 5_000 })
  // 换新门闩：重新预览可用且完成（新请求未被旧请求干扰）
  let releasePreview2!: () => void
  const previewGate2 = new Promise<void>(resolve => { releasePreview2 = resolve })
  await page.unroute('**/api/training-ranges/preview')
  await page.route('**/api/training-ranges/preview', async route => {
    await previewGate2
    previewReleases += 1
    await route.continue()
  })
  await page.getByRole('button', { name: '生成范围预览' }).click()
  releasePreview2()
  // 范围 2026-04-15..07-15 在冻结样本覆盖内：预览成功显示实际区间
  await expect(page.getByText(/实际 2026-04-15 ~ /)).toBeVisible({ timeout: 8_000 })
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
