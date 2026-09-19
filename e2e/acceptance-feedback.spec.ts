import { expect, test } from '@playwright/test'
import { evidencePath } from './runtime'
import { startTrainingFromForm } from './training-flow'

test('用户能找到录像入口，往返录像库保持训练，顶部显示快捷键且不挤账户', async ({ page }) => {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1071, height: 728 })
  await page.goto('/')
  await page.getByRole('button', { name: '查看训练录像', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
  await expect(page.getByLabel('导入录制', { exact: true })).toBeAttached()
  await expect(page.getByText('还没有保存的训练录像')).toBeVisible()
  await page.getByRole('button', { name: '返回训练', exact: true }).click()
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill('600519')
  await page.getByRole('button', { name: /600519 贵州茅台/ }).click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  await expect(page.getByRole('status').filter({ hasText: '正在记录' })).toBeVisible()
  const before = (await (await page.request.get('/api/trainings/active')).json()).training
  await expect(page.locator('.status-strip')).toContainText('空格')
  await expect(page.locator('.status-strip')).toContainText('Home')
  await expect(page.locator('.status-strip')).toContainText('Del')
  await expect(page.locator('.trade-panel .recording-strip')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '导出可读 JSON', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('更多录制导出方式', { exact: true })).toHaveCount(0)
  const chart = await page.locator('.chart-host').boundingBox()
  expect(chart!.y).toBeLessThanOrEqual(95)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1071)
  await page.screenshot({ path: evidencePath('feedback-training-1071.png') })
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
  await expect(page.locator('.recording-history-item').first()).toBeVisible()
  await page.getByRole('button', { name: '返回训练', exact: true }).click()
  await expect(page.locator('.training-topbar')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '正在记录' })).toBeVisible()
  const after = (await (await page.request.get('/api/trainings/active')).json()).training
  expect(after.id).toBe(before.id)
  expect(after.currentDate).toBe(before.currentDate)
  expect(after.status).toBe('running')
  expect(errors).toEqual([])
})
