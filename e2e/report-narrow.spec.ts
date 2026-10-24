import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { evidencePath } from './runtime'
import { startTrainingFromForm } from './training-flow'

test('带真实成交的成绩单在窄窗不溢出且所有成交列可访问', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
  await page.locator('.suggestions button').first().click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('成交')
  const id = (await (await page.request.get('/api/trainings/active')).json()).training.id
  await page.getByRole('button', { name: '提前结算', exact: true }).click()
  await page.getByRole('dialog', { name: '结束训练' }).getByRole('button', { name: '确认结算', exact: true }).click()
  await page.getByRole('button', { name: '查看历史成绩单' }).click()
  const ownHistory = page.locator(`[data-training-id="${id}"] .history-report-entry`)
  const report = page.getByRole('dialog', { name: '成绩单', exact: true })

  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') await page.getByRole('button', { name: '切换到浅色主题' }).click()
    await ownHistory.click()
    await expect(report.locator('.report-trade-row')).not.toHaveCount(0)
    await expect(report.locator('.report-trades th')).toHaveText(['序号', '日期', '买卖', '价格', '股数', '金额', '费用'])
    for (const width of [390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await report.getByRole('button', { name: '关闭成绩单' }).scrollIntoViewIfNeeded()
      const dimensions = await report.evaluate(el => ({
        width: el.clientWidth, scrollWidth: el.scrollWidth,
        overflowing: Array.from(el.querySelectorAll<HTMLElement>('*'))
          .filter(node => node.getBoundingClientRect().right > el.getBoundingClientRect().right + 1)
          .map(node => ({ tag: node.tagName, class: node.className, text: node.textContent?.slice(0, 80), width: node.clientWidth, scrollWidth: node.scrollWidth })),
      }))
      await writeFile(evidencePath(`report-narrow-${theme}-${width}.json`), JSON.stringify(dimensions, null, 2))
      await report.screenshot({ path: evidencePath(`report-narrow-${theme}-${width}.png`) })
      expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.width)
      const tableRegion = report.getByRole('region', { name: '逐笔成交明细' })
      await expect(tableRegion).toHaveAttribute('tabindex', '0')
      await tableRegion.scrollIntoViewIfNeeded()
      if (width === 390) {
        await tableRegion.focus()
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => tableRegion.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
        await tableRegion.hover()
        await page.mouse.wheel(1600, 0)
        await expect.poll(() => tableRegion.evaluate(el => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)).toBe(true)
        const fee = await report.locator('.report-trades th').last().boundingBox()
        const region = await tableRegion.boundingBox()
        expect(fee!.x + fee!.width).toBeLessThanOrEqual(region!.x + region!.width + 1)
        await page.screenshot({ path: evidencePath(`report-narrow-${theme}-390-trades.png`) })
      }
      await report.getByRole('button', { name: '关闭成绩单' }).scrollIntoViewIfNeeded()
      await expect(report.getByRole('button', { name: '关闭成绩单' })).toBeInViewport()
    }
    await report.getByRole('button', { name: '关闭成绩单' }).click()
  }
  expect(errors).toEqual([])
})
