// TRAIN-01 训练规则 e2e：真实隔离服务＋真实样本数据（300857）。
// 覆盖冻结合同 RULES-defaults-current-next（默认设置→A冻结→改默认A不变→B采用新值）、
// 设置弹层保存/取消/失败语义、热键隔离、本局规则展示、legacy raw 只读警示与 pageerror。
import { expect, test, type Page } from '@playwright/test'

const SAMPLE = { code: '300857', startDate: '2026-04-15' }

async function resetDefaults(page: Page): Promise<void> {
  const response = await page.request.put('/api/settings/training', { data: { feesEnabled: false, tPlusOne: true } })
  expect(response.status()).toBe(200)
}

async function abandonActive(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
}

async function createSampleTraining(page: Page): Promise<number> {
  const created = await page.request.post('/api/trainings', {
    data: { code: SAMPLE.code, tier: '1M', start_date: SAMPLE.startDate, initial_cash: 1_000_000, blind: false },
  })
  expect(created.status()).toBe(201)
  return (await created.json()).training.id
}

async function openTrainingPage(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.training-topbar .workspace-title')).toContainText(SAMPLE.code)
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存', { timeout: 15_000 })
}

async function openRulesDetails(page: Page): Promise<void> {
  await page.getByLabel('训练详情').click()
}

test('设置默认→创建A冻结→运行中改默认A不变→B采用新值（费用手算/T+1）', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetDefaults(page)
  await abandonActive(page)
  const idA = await createSampleTraining(page)
  await openTrainingPage(page)

  // 本局规则展示：费用关、T+1 开（本局冻结）
  await openRulesDetails(page)
  await expect(page.getByText('费用 关 · T+1 开', { exact: false })).toBeVisible()
  await page.keyboard.press('Escape')

  // 买入后 T+1 冻结：当日可卖 0，卖出拒单
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect.poll(async () => (await (await page.request.get(`/api/trainings/${idA}/bars?tf=1D`)).json()).account.availableShares).toBe(0)
  await page.getByRole('button', { name: '卖出', exact: true }).click()
  await expect(page.locator('.status-strip')).toContainText('没有可卖持仓')

  // 运行中通过设置弹层修改默认：费用开、T+1 关
  let putBody: Record<string, unknown> | null = null
  await page.route('**/api/settings/training', async route => {
    if (route.request().method() === 'PUT') {
      putBody = JSON.parse(route.request().postData() ?? '{}')
    }
    await route.continue()
  })
  await page.getByTitle('训练默认设置').click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('默认只影响新训练')
  await dialog.getByLabel('新训练收取手续费（佣金/印花税）').check()
  await dialog.getByLabel('新训练启用 T+1（当日买入次日可卖）').uncheck()
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog).toContainText('已保存')
  // M5-DEFAULTS：设置面板四字段一起保存（资金/复权为此刻未编辑的默认值）
  expect(putBody).toEqual({ feesEnabled: true, tPlusOne: false, initialCash: 1000000, adjustMode: 'forward' })
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).not.toBeVisible()
  expect((await (await page.request.get('/api/settings/training')).json())).toMatchObject({ feesEnabled: true, tPlusOne: false })

  // A 局不漂移：规则快照、可卖数量、录制状态都不变
  const snapshotA = (await (await page.request.get(`/api/trainings/${idA}/bars?tf=1D`)).json())
  expect(snapshotA.training.rules).toMatchObject({ feesEnabled: false, tPlusOne: true, origin: 'created' })
  expect(snapshotA.account.availableShares).toBe(0)
  await expect(page.locator('.recording-strip')).toContainText('正在记录')
  await openRulesDetails(page)
  await expect(page.getByText('费用 关 · T+1 开', { exact: false })).toBeVisible()

  // 结束 A，创建 B：B 立即采用新默认（费用开、T+1 关）
  await page.getByRole('button', { name: '提前结算' }).click()
  await page.getByRole('button', { name: '确认结算' }).click()
  await expect(page.getByRole('button', { name: '完成，返回首页' })).toBeVisible()
  await page.getByRole('button', { name: '完成，返回首页' }).click()
  await abandonActive(page)
  const idB = await createSampleTraining(page)
  await openTrainingPage(page)
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  const snapshotB = (await (await page.request.get(`/api/trainings/${idB}/bars?tf=1D`)).json())
  expect(snapshotB.training.rules).toMatchObject({ feesEnabled: true, tPlusOne: false })
  // T+1 关：当日买入即可卖并可卖出
  expect(snapshotB.account.availableShares).toBe(snapshotB.account.shares)
  // 费用手算核对：fee = amount × 0.00025（买入佣金，amount ≥ 20000 时高于最低 5 元）
  const trade = snapshotB.trades.at(-1)
  expect(trade.fee).toBeGreaterThan(5)
  expect(trade.fee).toBeCloseTo(trade.amount * 0.00025, 6)
  await page.getByRole('button', { name: '卖出', exact: true }).click()
  await expect(page.locator('.status-strip')).toContainText('卖出成交')
  // e2e 约定：套件收尾不残留活动训练（后续套件与重试不再依赖隐式状态）
  await abandonActive(page)
  expect(errors).toEqual([])
})

test('设置弹层：取消不保存、非法载荷失败反馈、打开期间空格不推进', async ({ page }: { page: Page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetDefaults(page)
  await abandonActive(page)

  let advanceCalls = 0
  await page.route('**/api/trainings/*/next', async route => {
    advanceCalls += 1
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByText('创建训练').first()).toBeVisible()

  // 打开设置：读取当前默认
  await page.getByTitle('训练默认设置').click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('新训练收取手续费（佣金/印花税）')).not.toBeChecked()
  await expect(dialog.getByLabel('新训练启用 T+1（当日买入次日可卖）')).toBeChecked()

  // 打开期间热键隔离：空格不得触发推进
  await dialog.getByLabel('新训练收取手续费（佣金/印花税）').check()
  await page.keyboard.press('Space')
  await page.waitForTimeout(500)
  expect(advanceCalls).toBe(0)

  // 取消：不做任何保存，设置保持原值
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).not.toBeVisible()
  expect((await (await page.request.get('/api/settings/training')).json())).toMatchObject({ feesEnabled: false, tPlusOne: true })

  // 保存失败：服务端 400，界面给出错误反馈且不假称保存
  await page.getByTitle('训练默认设置').click()
  await expect(dialog).toBeVisible()
  await page.route('**/api/settings/training', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'feesEnabled 与 tPlusOne 必须是布尔值' }) })
  })
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog.getByRole('alert')).toContainText('必须是布尔值')
  await expect(dialog).not.toContainText('已保存')
  await page.unroute('**/api/settings/training')
  expect(errors).toEqual([])
})

test('返修F3 设置弹层键盘隔离：Tab/Shift+Tab不出弹层、Enter/Space不触发背景业务写、关闭还焦点、保存/失败/取消', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetDefaults(page)
  await abandonActive(page)
  const id = await createSampleTraining(page)
  await openTrainingPage(page)

  // 背景：已有 1 笔成交；监听交易/推进业务写
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect.poll(async () => (await (await page.request.get(`/api/trainings/${id}/bars?tf=1D`)).json()).trades.length).toBe(1)
  let businessWrites = 0
  await page.route(/\/api\/trainings\/\d+\/(trade|next|settle|abandon)$/, async route => {
    businessWrites += 1
    await route.continue()
  })

  // 深色 1440：打开设置弹层
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByTitle('训练默认设置').click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()

  // 连续 Tab / Shift+Tab：焦点始终留在弹层内（背景买入/推进/录像开关不可达）
  const activeInDialog = () => page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    return !!dialog && dialog.contains(document.activeElement)
  })
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press('Tab')
    expect(await activeInDialog()).toBe(true)
  }
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press('Shift+Tab')
    expect(await activeInDialog()).toBe(true)
  }

  // 弹层内 Enter/Space 落在开关上：只切换本地勾选，不产生背景业务写
  const feesToggle = dialog.getByLabel('新训练收取手续费（佣金/印花税）')
  await feesToggle.click()
  await feesToggle.press('Enter')
  await page.waitForTimeout(300)
  expect(businessWrites).toBe(0)
  await feesToggle.press('Space')
  expect(businessWrites).toBe(0)
  await expect(page.locator('.panel-heading .live-mark')).toContainText('进行中')

  // 键盘走完保存路径：从开关 Tab 到「保存设置」并 Enter → 保存成功反馈
  while (!(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.includes('保存设置')))) {
    await page.keyboard.press('Tab')
    expect(await activeInDialog()).toBe(true)
  }
  await page.keyboard.press('Enter')
  await expect(dialog).toContainText('已保存')

  // Esc 关闭：弹层消失、焦点返还设置入口、训练与录像保持挂载
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.recording-strip')).toBeVisible()
  expect(businessWrites).toBe(0)
  const focusOnTrigger = await page.evaluate(() => {
    const trigger = document.querySelector('[title="训练默认设置"]')
    return !!trigger && (trigger === document.activeElement || trigger.contains(document.activeElement))
  })
  expect(focusOnTrigger).toBe(true)

  // 失败路径（键盘打开弹层后仍隔离）：注入 400 → 保存给出错误反馈且不假称保存
  await page.route('**/api/settings/training', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'feesEnabled 与 tPlusOne 必须是布尔值' }) })
  })
  await page.getByTitle('训练默认设置').click()
  await expect(dialog).toBeVisible()
  await expect(await activeInDialog()).toBe(true)
  await page.keyboard.press('Tab')
  await expect(await activeInDialog()).toBe(true)
  while (!(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.includes('保存设置')))) {
    await page.keyboard.press('Tab')
    expect(await activeInDialog()).toBe(true)
  }
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('alert')).toContainText('必须是布尔值')
  await expect(dialog).not.toContainText('已保存')
  await page.unroute('**/api/settings/training')

  // 取消路径：Esc 关闭无业务写、无 PUT 副作用；浅色 840 弹层可见
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await page.setViewportSize({ width: 840, height: 900 })
  await page.getByRole('button', { name: '切换到浅色主题' }).click()
  await page.getByTitle('训练默认设置').click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).not.toBeVisible()
  expect(businessWrites).toBe(0)
  expect((await (await page.request.get(`/api/trainings/${id}/bars?tf=1D`)).json()).trades.length).toBe(1)
  await abandonActive(page)
  expect(errors).toEqual([])
})

test('legacy raw 训练：只读警示、交易入口停用；浅色主题与 840 宽度弹层可见', async ({ page }: { page: Page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetDefaults(page)
  await abandonActive(page)
  const id = await createSampleTraining(page)

  // 真实响应上打补丁：把本局规则标为 legacy-raw-unverified（迁移产物形状）
  await page.route(`**/api/trainings/${id}/bars?**`, async route => {
    const response = await route.fetch()
    const payload = await response.json()
    payload.training.rules = { ...payload.training.rules, corporateActionPolicy: 'legacy-raw-unverified', origin: 'legacy-migration' }
    await route.fulfill({ response, json: payload })
  })
  await page.setViewportSize({ width: 840, height: 900 })
  await openTrainingPage(page)
  const banner = page.getByRole('alert').filter({ hasText: '旧版不复权训练缺少完整权息记录' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('请保留记录后新建训练')
  await expect(page.getByRole('button', { name: '买入', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '推进下一日' })).toBeDisabled()

  // 浅色主题下设置弹层仍然可用
  await page.getByRole('button', { name: '切换到浅色主题' }).click()
  await page.getByTitle('训练默认设置').click()
  await expect(page.getByRole('dialog', { name: '训练默认设置' })).toBeVisible()
  await abandonActive(page)
  expect(errors).toEqual([])
})
