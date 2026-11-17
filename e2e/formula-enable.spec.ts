import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// M9-ENABLE-01：通过真实设置操作验证请求、SQLite 持久化及图表挂载。
// API 只用于隔离夹具和只读核验；唯一拦截用于保存失败分支。
test.setTimeout(180_000)

type Formula = { id: number; name: string; source: string; builtin: boolean; enabled: boolean; placement: 'main' | 'sub' }
const CUSTOM = 'ENABLE_CUSTOM'
const errors = new WeakMap<Page, string[]>()

async function formulas(page: Page): Promise<Formula[]> {
  const response = await page.request.get('/api/formulas')
  expect(response.status()).toBe(200)
  return (await response.json()).formulas
}

async function resetFormulas(page: Page): Promise<void> {
  for (const item of await formulas(page)) {
    if (item.builtin) {
      expect((await page.request.put('/api/formulas/' + item.id, { data: { enabled: false } })).status()).toBe(200)
    } else if (item.name === CUSTOM) {
      expect((await page.request.delete('/api/formulas/' + item.id)).status()).toBe(204)
    }
  }
}

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = []
  errors.set(page, pageErrors)
  page.on('pageerror', error => pageErrors.push(error.message))
  const activeResponse = await page.request.get('/api/trainings/active')
  expect(activeResponse.status()).toBe(200)
  const active = (await activeResponse.json()).training
  if (active) expect((await page.request.post('/api/trainings/' + active.id + '/abandon')).status()).toBe(200)
  await resetFormulas(page)
  const created = await page.request.post('/api/trainings', {
    data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 1_000_000 },
  })
  expect(created.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' })
  await resetFormulas(page)
  expect(errors.get(page)).toEqual([])
})

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '训练默认设置' }).click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '公式指标' }).click()
  const section = dialog.getByRole('region', { name: '公式指标' })
  await expect(section).toBeVisible()
  await expect(section.locator('.formula-list-pane')).not.toContainText('读取中')
  return { dialog, section }
}

async function chartLines(page: Page, id: number): Promise<Array<{ name: string; paneId: string; hasResult: boolean }>> {
  return page.evaluate(formulaId => {
    const probe = (window as any).__trainerChart?.formulaIndicators
    if (!probe) throw new Error('formulaIndicators read-only probe missing')
    return probe().filter((line: { name: string }) => line.name.startsWith('FORMULA_' + formulaId + '_'))
  }, id)
}

test('公式启停：自定义创建停用、开启与停用保存后刷新仍保持', async ({ page }) => {
  let { dialog, section } = await openSettings(page)
  await section.getByRole('button', { name: '新建', exact: true }).click()
  await section.getByLabel('公式名称', { exact: true }).fill(CUSTOM)
  await section.getByLabel('公式源码', { exact: true }).fill('MA5:MA(CLOSE,5);')
  await section.getByLabel('显示位置').selectOption('sub')
  await section.getByLabel('在图表启用', { exact: true }).uncheck()
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/formulas') && response.request().method() === 'POST')
  await section.getByRole('button', { name: '保存新公式' }).click()
  const created = await createdResponse
  expect(created.status()).toBe(201)
  const saved = await created.json() as Formula
  expect(saved.enabled).toBe(false)
  expect(created.request().postDataJSON().enabled).toBe(false)
  await expect(section.locator('.settings-saved')).toHaveText('已保存新公式')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(() => chartLines(page, saved.id)).toEqual([])

  ;({ dialog, section } = await openSettings(page))
  await section.getByLabel('公式列表').getByRole('button', { name: new RegExp(CUSTOM) }).click()
  await expect(section.getByLabel('在图表启用', { exact: true })).not.toBeChecked()
  await section.getByLabel('在图表启用', { exact: true }).check()
  await section.getByRole('button', { name: '保存修改' }).click()
  await expect(section.locator('.settings-saved')).toHaveText('已保存修改')
  expect((await formulas(page)).find(item => item.id === saved.id)?.enabled).toBe(true)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(() => chartLines(page, saved.id)).toHaveLength(1)
  expect((await chartLines(page, saved.id))[0]).toMatchObject({ hasResult: true })
  expect((await chartLines(page, saved.id))[0].paneId).not.toBe('candle_pane')

  await page.reload()
  await expect.poll(() => chartLines(page, saved.id)).toHaveLength(1)
  ;({ dialog, section } = await openSettings(page))
  await section.getByLabel('公式列表').getByRole('button', { name: new RegExp(CUSTOM) }).click()
  await expect(section.getByLabel('在图表启用', { exact: true })).toBeChecked()
  await section.getByLabel('在图表启用', { exact: true }).uncheck()
  await section.getByRole('button', { name: '保存修改' }).click()
  await expect(section.locator('.settings-saved')).toHaveText('已保存修改')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(() => chartLines(page, saved.id)).toEqual([])
  await page.reload()
  expect((await formulas(page)).find(item => item.id === saved.id)?.enabled).toBe(false)
  await expect.poll(() => chartLines(page, saved.id)).toEqual([])
})

async function exerciseBuiltin(page: Page, preset: { name: string; placement: 'main' | 'sub'; lines: number }): Promise<void> {
    const initial = (await formulas(page)).find(item => item.builtin && item.name === preset.name)
    expect(initial).toBeDefined()
    const id = initial!.id
    expect(initial!.placement).toBe(preset.placement)
    let { dialog, section } = await openSettings(page)
    await section.getByLabel('公式列表').getByRole('button', { name: new RegExp(preset.name) }).click()
    await expect(section.getByLabel('公式名称', { exact: true })).toBeDisabled()
    await expect(section.getByLabel('公式源码', { exact: true })).toBeDisabled()
    await expect(section.getByLabel('在图表启用', { exact: true })).not.toBeChecked()
    await section.getByLabel('在图表启用', { exact: true }).check()
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/formulas/' + id) && response.request().method() === 'PUT')
    await section.getByRole('button', { name: '保存修改' }).click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    const payload = response.request().postDataJSON()
    expect(payload.enabled).toBe(true)
    expect(payload).not.toHaveProperty('name')
    expect(payload).not.toHaveProperty('source')
    await expect(section.locator('.settings-saved')).toHaveText('已保存修改')
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect.poll(() => chartLines(page, id)).toHaveLength(preset.lines)
    const lines = await chartLines(page, id)
    expect(lines.every(line => line.hasResult)).toBe(true)
    expect(new Set(lines.map(line => line.paneId)).size).toBe(1)
    expect(lines[0].paneId === 'candle_pane').toBe(preset.placement === 'main')
    await page.screenshot({ path: evidencePath('formula-enabled-' + preset.name + '.png') })

    await page.reload()
    await expect.poll(() => chartLines(page, id)).toHaveLength(preset.lines)
    ;({ dialog, section } = await openSettings(page))
    await section.getByLabel('公式列表').getByRole('button', { name: new RegExp(preset.name) }).click()
    await expect(section.getByLabel('在图表启用', { exact: true })).toBeChecked()
    await section.getByLabel('在图表启用', { exact: true }).uncheck()
    await section.getByRole('button', { name: '保存修改' }).click()
    await expect(section.locator('.settings-saved')).toHaveText('已保存修改')
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect.poll(() => chartLines(page, id)).toEqual([])
    await page.reload()
    await expect.poll(() => chartLines(page, id)).toEqual([])
    const persisted = (await formulas(page)).find(item => item.id === id)
    expect(persisted).toMatchObject({ enabled: false, name: preset.name, source: initial!.source, placement: preset.placement })
}

test('公式启停：内置 MA_BULL_MAIN 按预设位置显示、刷新和停用', async ({ page }) => {
  await exerciseBuiltin(page, { name: 'MA_BULL_MAIN', placement: 'main', lines: 4 })
})
test('公式启停：内置 WEEK_MACD_SUB 按预设位置显示、刷新和停用', async ({ page }) => {
  await exerciseBuiltin(page, { name: 'WEEK_MACD_SUB', placement: 'sub', lines: 3 })
})
test('公式启停：内置 QINIU_B1_SUB 按预设位置显示、刷新和停用', async ({ page }) => {
  await exerciseBuiltin(page, { name: 'QINIU_B1_SUB', placement: 'sub', lines: 3 })
})

test('公式启停：保存失败显示错误并清除上次成功提示', async ({ page }) => {
  const { section } = await openSettings(page)
  await section.getByRole('button', { name: '新建', exact: true }).click()
  await section.getByLabel('公式名称', { exact: true }).fill(CUSTOM)
  await section.getByLabel('公式源码', { exact: true }).fill('MA5:MA(CLOSE,5);')
  await section.getByRole('button', { name: '保存新公式' }).click()
  await expect(section.locator('.settings-saved')).toHaveText('已保存新公式')
  const saved = (await formulas(page)).find(item => item.name === CUSTOM)!
  await section.getByLabel('在图表启用', { exact: true }).uncheck()
  await page.route('**/api/formulas/' + saved.id, route => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 503, json: { message: '保存故障（回归测试）' } })
    return route.continue()
  })
  await section.getByRole('button', { name: '保存修改' }).click()
  await expect(section.getByRole('alert')).toContainText('保存故障')
  await expect(section.locator('.settings-saved')).toHaveCount(0)
  expect((await formulas(page)).find(item => item.id === saved.id)?.enabled).toBe(true)
})
