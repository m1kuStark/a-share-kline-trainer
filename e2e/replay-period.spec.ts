import { test, expect } from '@playwright/test'
import { readRecordingArtifact } from './recording-file'
import { startTrainingFromForm } from './training-flow'
import { evidencePath } from './runtime'

// RF-03 用户验收：开盘+收盘训练的回放里不能切周K/月K且提示缺日线。
// 根因：开盘阶段检查点按 canonical 1D 嵌入「当时已见」日线（当日K线尚未形成，
// 末根止于前一交易日），回放旧门控按「末根 >= currentDate」判完整性，把整个
// 开盘段误判为缺日线。训练页在开盘阶段切周K/月K看到的正是同一份「截至前一
// 交易日」的聚合，回放必须与训练页同口径：三周期可用、由嵌入日线前端聚合。
test('开盘训练回放：开盘段可切周K月K且不再提示缺日线', async ({ page }) => {
  test.setTimeout(6 * 60 * 1000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  await expect(page.getByLabel('记录操作', { exact: true })).toBeChecked()
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
  await expect(page.locator('.suggestions button').first()).toBeVisible()
  await page.locator('.suggestions button').first().click()
  await expect(page.getByText(/已选：/)).toBeVisible()
  await page.getByRole('button', { name: '开盘 + 收盘', exact: true }).click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  const recording = page.getByRole('status').filter({ hasText: '正在记录' })
  await expect(recording).toBeVisible()
  await expect(page.locator('.phase-tag')).toHaveText('开盘阶段')

  // 推进两次：D1 开盘→收盘、D1 收盘→D2 开盘；首屏（D1 初始开盘段）成为回放第 1 步
  for (let step = 0; step < 2; step += 1) {
    await page.getByRole('button', { name: '推进下一日', exact: true }).click()
    await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  }
  await expect(page.locator('.phase-tag')).toHaveText('开盘阶段')
  await expect(page.locator('.training-current-date')).toContainText('2026-09-02')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出录制', exact: true }).click()
  const download = await pending
  const output = evidencePath('replay-period-open-close.json.gz')
  await download.saveAs(output)
  const file = await readRecordingArtifact(output)
  if (file.schemaVersion !== 2) throw Error('Expected compact recording')
  // 检查点必须是 canonical 1D：开盘段嵌入的日线止于前一交易日
  const charted = file.checkpoints.filter((checkpoint: any) => checkpoint.chart)
  expect(charted.length).toBeGreaterThan(0)
  expect(charted.every((checkpoint: any) => checkpoint.chart.timeframe === '1D')).toBe(true)
  const exported = (await (await page.request.get('/api/trainings/active')).json()).training
  if (exported) await page.request.post(`/api/trainings/${exported.id}/abandon`)

  // 用户真实路径：从本机录像库直接打开回放（放弃后录制保留在本机）
  await page.goto('/')
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
  // 录像库进入动画期间 libraryBusy 仍置位（App.showLibrary 尾段异步落库后才复位）；
  // 等它复位再打开回放，避免库列表在途时打开的回放被尾段回落覆盖（另行登记的相邻缺陷）
  await expect(page.getByRole('button', { name: '训练录像', exact: true })).toBeEnabled({ timeout: 30_000 })
  await page.route('**/api/**', route => route.abort())
  await page.locator('[data-recording-source="local"] .recording-history-open').first().click()
  await expect(page.getByRole('button', { name: '关闭回放' })).toBeVisible({ timeout: 30_000 })

  // 第 1 步 = D1 初始开盘段：三周期都必须可用（无缺日线回落）
  await expect(page.locator('.replay-day')).toContainText('第 1 /')
  await expect(page.locator('.replay-gap', { hasText: '缺日线' })).toHaveCount(0)
  const dailyDates = await page.evaluate(() =>
    (window as any).__trainerChart.bars().map((bar: any) => bar.date as string))
  expect(dailyDates.length).toBeGreaterThan(50)
  expect(dailyDates.at(-1)! < '2026-09-01').toBe(true)

  // 切周K：真实换数据（周一起始键、根数显著少于日线）
  await expect(page.getByRole('tab', { name: '周K', exact: true })).toBeEnabled()
  await page.getByRole('tab', { name: '周K', exact: true }).click()
  await expect(page.getByRole('tab', { name: '周K' })).toHaveAttribute('aria-selected', 'true')
  const barDates = () => page.evaluate(() =>
    (window as any).__trainerChart.bars().map((bar: any) => bar.date as string))
  await expect.poll(async () => (await barDates()).filter(date => new Date(`${date}T00:00:00Z`).getUTCDay() === 1).length
  ).toBeGreaterThan(0)
  const weeklyDates = await barDates()
  expect(weeklyDates.length).toBeLessThan(dailyDates.length / 3)
  expect(weeklyDates.every(date => new Date(`${date}T00:00:00Z`).getUTCDay() === 1)).toBe(true)

  // 切月K：自然月键
  await expect(page.getByRole('tab', { name: '月K', exact: true })).toBeEnabled()
  await page.getByRole('tab', { name: '月K', exact: true }).click()
  await expect(page.getByRole('tab', { name: '月K' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(async () => (await barDates()).filter(date => /^\d{4}-\d{2}$/.test(date)).length).toBeGreaterThan(0)
  const monthlyDates = await barDates()
  expect(monthlyDates.every(date => /^\d{4}-\d{2}$/.test(date))).toBe(true)
  expect(monthlyDates.length).toBeLessThan(weeklyDates.length)

  // 切回日K：还原为完整日线
  await page.getByRole('tab', { name: '日K', exact: true }).click()
  await expect(page.getByRole('tab', { name: '日K' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.bars().length)).toBe(dailyDates.length)
  await expect(page.locator('.replay-day')).toContainText('第 1 /')

  // 第 2 步 = D1 收盘段（既有行为不回归）：日线含当日，周K 同样可用
  await page.getByRole('button', { name: '下一日', exact: true }).click()
  await expect(page.locator('.replay-day')).toContainText('第 2 /')
  await expect(page.locator('.replay-gap', { hasText: '缺日线' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '周K', exact: true })).toBeEnabled()
  await page.getByRole('tab', { name: '周K', exact: true }).click()
  await expect(page.getByRole('tab', { name: '周K' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.bars().length)).toBeLessThan(dailyDates.length / 3)

  await page.screenshot({ path: evidencePath('replay-period-open-close.png') })
  expect(pageErrors).toEqual([])
})
