import { expect, test } from '@playwright/test'
import { evidencePath } from './runtime'
import { startTrainingFromForm } from './training-flow'

test('report themes, independent overlays and date-aligned hover', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
  await expect(page.getByText(/已选：/)).toBeVisible()
  await page.getByRole('button', { name: '3个月', exact: true }).click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  await page.getByRole('button', { name: '提前结算', exact: true }).click()
  await page.getByRole('dialog', { name: '结束训练' }).getByRole('button', { name: '确认结算', exact: true }).click()
  await page.getByRole('button', { name: '查看历史成绩单' }).click()

  // A deterministic frontend fixture makes the two independent overlays distinguishable.
  await page.route('**/equity-comparison*', async route => {
    const url = new URL(route.request().url())
    const requested = (url.searchParams.get('benchmarks') ?? '').split(',')
    if (requested.includes('sh000001') && !requested.includes('sz399303')) await new Promise(resolve => setTimeout(resolve, 350))
    await route.fulfill({ json: {
      trainingId: Number(url.pathname.split('/')[3]),
      series: ['2026-09-01', '2026-09-02', '2026-09-03'].map((date, index) => ({
        date, user: index * 0.04,
        ...(requested.includes('sh000001') ? { sh000001: index * 0.01 } : {}),
        ...(requested.includes('sz399303') ? { sz399303: index * -0.015 } : {}),
      })),
      benchmarks: Object.fromEntries(requested.filter(Boolean).map(key => [key, { ok: true }])),
    } })
  })
  await page.locator('.history-row').first().click()
  const report = page.getByRole('dialog', { name: '成绩单', exact: true })
  const chart = report.locator('.equity-curve-svg')
  await expect(chart).toBeVisible()
  await expect(report.getByRole('button', { name: '关闭成绩单' })).toHaveCount(1)
  await expect(report.getByRole('button', { name: '返回历史列表' })).toHaveCount(0)
  await expect(report.locator('.report-header')).not.toContainText(/第 \d+ 局/)
  await expect(report.locator('.report-rule-tags')).toContainText('收盘成交')
  await expect(chart.locator('.curve-axis-label')).toHaveCount(8)
  const dark = await report.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
  expect(dark.background).toBe('rgb(32, 32, 32)')
  expect(dark.color).toBe('rgb(228, 228, 228)')
  const sh = report.getByRole('checkbox', { name: '上证指数', exact: true })
  const sz = report.getByRole('checkbox', { name: '国证 2000', exact: true })
  await sh.check()
  await sz.check()
  await expect(chart.locator('path')).toHaveCount(3)
  expect(await chart.locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('stroke')))).toEqual(['#d24b4b', '#5b72c9', '#d28a3d'])
  expect(await chart.locator('path').evaluateAll(paths => new Set(paths.map(path => path.getAttribute('d'))).size)).toBe(3)
  await page.waitForTimeout(500)
  await expect(chart.locator('path')).toHaveCount(3)

  const hover = chart.getByLabel('收益率曲线悬停区域')
  const box = await hover.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width * 0.01, box!.y + box!.height / 2)
  await expect(report.locator('.report-curve-tooltip')).toContainText('2026-09-01')
  await page.mouse.move(box!.x + box!.width * 0.99, box!.y + box!.height / 2)
  await expect(report.locator('.report-curve-tooltip')).toContainText('2026-09-03')
  await expect(report.locator('.report-curve-tooltip')).toContainText('8.00%')
  await page.screenshot({ path: evidencePath('report-feedback-dark-desktop.png'), fullPage: true })
  await sh.uncheck()
  await expect(chart.locator('path')).toHaveCount(2)
  await sz.uncheck()
  await expect(chart.locator('path')).toHaveCount(1)
  await expect(chart).toBeVisible()
  await report.getByRole('button', { name: '关闭成绩单' }).click()
  await page.getByRole('button', { name: '切换到浅色主题' }).click()
  await page.locator('.history-row').first().click()
  await expect(chart).toBeVisible()
  expect(await report.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)')
  await page.screenshot({ path: evidencePath('report-feedback-light-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: evidencePath('report-feedback-light-mobile.png'), fullPage: true })
  expect(await report.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await report.getByRole('button', { name: '关闭成绩单' }).click()
  await page.getByRole('button', { name: '切换到深色主题' }).click()
  await page.locator('.history-row').first().click()
  await expect(chart).toBeVisible()
  await page.screenshot({ path: evidencePath('report-feedback-dark-mobile.png'), fullPage: true })
  expect(await report.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(errors).toEqual([])
})
