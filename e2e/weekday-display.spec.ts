import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// CHART-WEEKDAY-01（Issue #8-C，用户 2026-11-07 拍板）：日K 悬浮卡＋X 轴时间刻度＋状态条
// （可见至/末根、常驻行情条日期）显示中文星期；周K/月K 不加星期（无单一日内星期语义）。
// oracle 独立性：星期由 e2e 侧公历数组按日期串现算（Date.UTC 日序），不从实现模块导入。
test.setTimeout(180_000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

const SAMPLE = { code: '300857', startDate: '2026-04-15' }
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAY_SUFFIX = /^\d{4}-\d{2}-\d{2} 周[一二三四五六日]$/
function weekdayOracle(isoDate: string): string {
  const date = new Date(Date.parse(`${isoDate}T00:00:00Z`))
  return WEEKDAYS[date.getUTCDay()]!
}
function isoOf(text: string): string | null {
  return text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
}

async function openTraining(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const created = await page.request.post('/api/trainings', { data: { code: SAMPLE.code, tier: '1M', start_date: SAMPLE.startDate, blind: false } })
  expect(created.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
}

const chartBars = (page: Page) => page.evaluate(() => (window as any).__trainerChart.bars() as Array<{ date: string }>)
const axisLabels = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__trainerChart.xAxisLabels() as string[])

test('日K 状态条/行情条/X 轴/悬浮卡显示星期；周K 不加；1440/1280 截图无 pageerror', async ({ page }: { page: Page }) => {
  await openTraining(page)
  const barDates = new Set((await chartBars(page)).map(bar => bar.date))

  // ① 状态条「可见至」与常驻行情条日期：日期＋星期，星期与公历 oracle 一致
  const visibleText = await page.locator('.chart-date-status').innerText()
  expect(visibleText).toContain('可见至')
  const visibleDate = isoOf(visibleText)
  expect(visibleDate, `可见至应含日K日期，实际=${visibleText}`).toBeTruthy()
  expect(visibleText).toContain(`${visibleDate} ${weekdayOracle(visibleDate!)}`)
  expect(barDates.has(visibleDate!)).toBe(true)
  const quoteText = await page.getByRole('group', { name: 'K线行情', exact: true }).locator('.chart-quote-date').innerText()
  expect(quoteText).toMatch(/^日K \d{4}-\d{2}-\d{2} 周[一二三四五六日]$/)
  const quoteDate = isoOf(quoteText)!
  expect(quoteText).toBe(`日K ${quoteDate} ${weekdayOracle(quoteDate)}`)

  // ② X 轴刻度（canvas，经只读探针读取）：日K 每个非空刻度都以中文星期结尾
  await expect.poll(async () => (await axisLabels(page)).filter(Boolean).length).toBeGreaterThan(0)
  const dayLabels = (await axisLabels(page)).filter(Boolean)
  expect(dayLabels.length).toBeGreaterThan(0)
  for (const label of dayLabels) expect(label, `日K轴刻度应含星期：${label}`).toMatch(/周[一二三四五六日]$/)

  // ③ 悬浮卡：指针停驻 ≥1s 后日期行＝'YYYY-MM-DD 周X'，且日期命中图内真实 bar
  const host = (await page.locator('.chart-host').boundingBox())!
  await page.mouse.move(host.x + host.width * 0.55, host.y + host.height * 0.35, { steps: 4 })
  await expect(page.locator('.hover-card-date')).toBeVisible({ timeout: 5_000 })
  const cardText = (await page.locator('.hover-card-date').innerText()).trim()
  expect(cardText).toMatch(WEEKDAY_SUFFIX)
  const cardDate = isoOf(cardText)!
  expect(cardText).toBe(`${cardDate} ${weekdayOracle(cardDate)}`)
  expect(barDates.has(cardDate)).toBe(true)
  await page.screenshot({ path: evidencePath('weekday-hover-card-1440.png') })

  // ④ 周K：状态条/轴都不加星期（周键无单一日内星期语义）
  await page.getByRole('tab', { name: '周K', exact: true }).click()
  await expect(page.locator('.chart-date-status')).toContainText('右端周K')
  await expect.poll(async () => (await page.locator('.chart-date-status').innerText()).includes('周K')).toBe(true)
  expect(await page.locator('.chart-date-status').innerText()).not.toMatch(/周[一二三四五六日]/)
  await expect.poll(async () => (await axisLabels(page)).filter(Boolean).length).toBeGreaterThan(0)
  for (const label of (await axisLabels(page)).filter(Boolean)) expect(label, `周K轴刻度不应加星期：${label}`).not.toMatch(/周[一二三四五六日]/)
  await page.getByRole('tab', { name: '日K', exact: true }).click()
  await expect(page.locator('.chart-date-status')).toContainText('可见至')

  // ⑤ 1440/1280 截图（主代理视觉检查用）与横向溢出红线
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(350)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow, `${size.width}px 宽出现横向溢出`).toBe(false)
    await page.screenshot({ path: evidencePath(`weekday-status-${size.width}.png`) })
  }
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
})
