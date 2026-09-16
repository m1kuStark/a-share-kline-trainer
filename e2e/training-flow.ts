import { expect, type Page } from '@playwright/test'

/** Follow the same explicit choice as a user when local-data freshness is unknown. */
export async function startTrainingFromForm(page: Page): Promise<void> {
  const created = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/trainings', { timeout: 30_000 })
  await page.getByRole('button', { name: '开始训练', exact: true }).click()
  const guard = page.getByRole('dialog', { name: '建议先更新日线数据' })
  const training = page.locator('.training-topbar')
  await expect(guard.or(training)).toBeVisible({ timeout: 30_000 })
  if (await guard.isVisible()) {
    await guard.getByRole('button', { name: '仍要开始训练', exact: true }).click()
  }
  expect((await created).status()).toBe(201)
  await expect(training).toBeVisible({ timeout: 30_000 })
}
