// TRAIN-FEE-01（Issue #8-A，用户 2026-11-07 拍板）e2e：
// 设置页费率预设/手填→保存→重开持久→新训练冻结快照；非法输入拦截不写；旧客户端两布尔兼容。
import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

const DEFAULTS = {
  feesEnabled: true, tPlusOne: true, initialCash: 1_000_000, adjustMode: 'forward',
  commissionRate: 0.00025, minimumCommission: 5, stampDutyRate: 0.0005,
}

async function resetDefaults(page: Page): Promise<void> {
  const response = await page.request.put('/api/settings/training', { data: DEFAULTS })
  expect(response.status()).toBe(200)
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '训练默认设置' }).click()
  await expect(page.getByRole('dialog', { name: '训练默认设置' })).toBeVisible()
}

async function abandonActive(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
}

test('费率预设→保存→重开持久→新训练快照冻结；非法输入拦截；旧两布尔兼容', async ({ page }: { page: Page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetDefaults(page)
  await abandonActive(page)
  await page.goto('/')
  await expect(page.getByText('创建训练').first()).toBeVisible()
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })

  // 默认值呈现＝万 2.5 / 最低 5 / 印花万 5
  await expect(dialog.getByLabel('佣金率（万分之）')).toHaveValue('2.5')
  await expect(dialog.getByLabel('最低佣金（元）')).toHaveValue('5')
  await expect(dialog.getByLabel('卖出印花税率（万分之）')).toHaveValue('5')

  // 预设「万 1 免 5」→ 保存 → 重开持久
  await dialog.getByRole('button', { name: '万 1 免 5' }).click()
  await expect(dialog.getByLabel('佣金率（万分之）')).toHaveValue('1')
  await expect(dialog.getByLabel('最低佣金（元）')).toHaveValue('0')
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog).toContainText('已保存')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(await (await page.request.get('/api/settings/training')).json())
    .toMatchObject({ commissionRate: 0.0001, minimumCommission: 0, stampDutyRate: 0.0005 })

  // 重开设置：持久值仍在
  await openSettings(page)
  await expect(dialog.getByLabel('佣金率（万分之）')).toHaveValue('1')
  await expect(dialog.getByLabel('最低佣金（元）')).toHaveValue('0')

  // 非法输入：佣金率 999 → 客户端拦截、不写、错误可见
  await dialog.getByLabel('佣金率（万分之）').fill('999')
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog).toContainText('佣金率需在万分之 0 至 100 之间')
  expect(await (await page.request.get('/api/settings/training')).json())
    .toMatchObject({ commissionRate: 0.0001, minimumCommission: 0 })
  await dialog.getByLabel('佣金率（万分之）').fill('1')
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog).toContainText('已保存')
  await page.keyboard.press('Escape')

  // 新训练冻结：rules_json 快照带配置费率；训练详情摘要显示本局费率
  const created = await page.request.post('/api/trainings', {
    data: { code: '300857', tier: '1M', start_date: '2026-04-15', blind: false },
  })
  expect(created.status()).toBe(201)
  const id = (await created.json()).training.id as number
  const snapshot = await (await page.request.get(`/api/trainings/${id}/bars?tf=1D`)).json()
  expect(snapshot.training.rules).toMatchObject({
    version: 1, feesEnabled: true, commissionRate: 0.0001, minimumCommission: 0, stampDutyRate: 0.0005,
  })
  await page.goto('/')
  await expect(page.locator('.boot-loading')).toHaveCount(0)
  await expect(page.locator('.training-topbar .workspace-title')).toContainText('300857')
  await page.getByLabel('训练详情', { exact: true }).click()
  await expect(page.locator('.training-meta')).toContainText('佣金万 1')
  await expect(page.locator('.training-meta')).toContainText('免 5')
  await page.screenshot({ path: evidencePath('training-fees-rules-summary.png') })

  // 旧客户端两布尔 PUT 兼容：只改开关，已存费率不被覆盖
  const legacy = await page.request.put('/api/settings/training', { data: { feesEnabled: false, tPlusOne: true } })
  expect(legacy.status()).toBe(200)
  expect(await (await page.request.get('/api/settings/training')).json())
    .toMatchObject({ feesEnabled: false, commissionRate: 0.0001, minimumCommission: 0 })
  await abandonActive(page)

  // 深浅主题与 1280/1440 布局：设置弹层无溢出
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size)
    await page.goto('/')
    await expect(page.locator('.boot-loading')).toHaveCount(0)
    await openSettings(page)
    await expect(page.locator('.boot-loading')).toHaveCount(0)
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(size.width)
    expect(box.y + box.height).toBeLessThanOrEqual(size.height)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.waitForTimeout(350)
    await page.screenshot({ path: evidencePath(`training-fees-settings-${size.width}.png`) })
    await page.keyboard.press('Escape')
  }
  await expect(dialog).not.toBeVisible()
  expect(errors).toEqual([])
})
