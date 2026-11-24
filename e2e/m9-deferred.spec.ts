import { expect, test } from '@playwright/test'
import { evidencePath } from './runtime'

test('M9 hold keeps ordinary settings visible without a formula tab', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '训练默认设置' }).click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '默认设置', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '公式指标' })).toHaveCount(0)
  await expect(page.getByText('正在连接本地服务', { exact: false })).toBeHidden()
  await dialog.getByRole('button', { name: '偏好设置' }).click()
  await expect(dialog.getByRole('region', { name: '应用偏好' })).toBeVisible()
  await page.screenshot({ path: evidencePath('m9-deferred-settings.png') })
})
