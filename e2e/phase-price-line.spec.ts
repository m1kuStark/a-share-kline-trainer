import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

type Marker = { price: number; y: number; height: number; lineFigures: Array<{ type: string; styles: { color: string; size: number; dashedValue: number[] } }>; axisFigures: Array<{ type: string; attrs: { text: string }; styles: { backgroundColor: string } }> }
type Probe = { count: number; previousClose: number; markers: Marker[] }
const state = (page: Page): Promise<Probe> => page.evaluate(() => (window as unknown as { __trainerChart: { phasePriceMark: () => Probe } }).__trainerChart.phasePriceMark())

async function assertMarker(page: Page, color: string): Promise<Marker> {
  await expect.poll(async () => (await state(page)).count).toBe(1)
  // Advance updates the phase label before its async bars reload completes.
  await expect.poll(async () => (await state(page)).markers[0]?.lineFigures[0]?.styles.color ?? null).toBe(color)
  const marker = (await state(page)).markers[0]
  expect(marker.y).toBeGreaterThan(0)
  expect(marker.y).toBeLessThan(marker.height)
  expect(marker.lineFigures.map(item => item.type)).toEqual(['line'])
  expect(marker.lineFigures[0].styles).toMatchObject({ color, size: 1, dashedValue: [4, 4] })
  expect(marker.axisFigures).toHaveLength(1)
  expect(marker.axisFigures[0]).toMatchObject({ type: 'text', attrs: { text: marker.price.toFixed(2) }, styles: { backgroundColor: color } })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __trainerChart: { lastPriceMarkShow: () => boolean } }).__trainerChart.lastPriceMarkShow())).toBe(false)
  return marker
}

test('open and close use one matching line and one axis label; gap price remains visible without a future candle', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings', { data: { code: '300857', tier: '1M', start_date: '2026-04-15', initial_cash: 1_000_000, blind: false, clock_mode: 'open_close' } })
  expect(response.status()).toBe(201)
  const id = (await response.json()).training.id
  let gapDirection: 'up' | 'down' = 'up'
  // Controlled display stress on the isolated service's real, truncated daily bars.
  // Only currentOpen changes; no current-day OHLC is appended to open-phase data.
  await page.route(`**/api/trainings/${id}/bars?**`, async route => {
    // Use the APIRequestContext for the fixture source. A page route's fetched
    // response can be disposed when Training replaces a superseded timeframe
    // request during its initial daily/canonical pair.
    const original = await fetch(route.request().url())
    const body = await original.json() as { training: { currentPhase: string; currentOpen: number | null }; bars: Array<{ low: number; high: number }> }
    if (body.training.currentPhase === 'open') {
      const prices = body.bars.flatMap((bar: { low: number; high: number }) => [bar.low, bar.high])
      body.training.currentOpen = gapDirection === 'up' ? Math.max(...prices) * 10 : Math.min(...prices) * 0.01
    }
    await route.fulfill({ response: original, json: body })
  })
  await page.goto('/')
  await expect(page.locator('.phase-tag')).toContainText('开盘阶段')
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const open = await assertMarker(page, '#ef4444')
  await page.screenshot({ path: evidencePath('phase-price-open-dark.png') })
  const openBars = await page.evaluate(() => (window as unknown as { __trainerChart: { bars: () => Array<{ date: string }> } }).__trainerChart.bars())
  const meta = await (await page.request.get(`/api/trainings/${id}/bars?tf=1D`)).json()
  expect(openBars.at(-1)!.date < meta.training.currentDate).toBe(true)

  await page.getByRole('button', { name: '推进下一日' }).click()
  await expect(page.locator('.phase-tag')).toContainText('收盘阶段')
  const closeState = await state(page)
  const close = closeState.markers[0]
  await assertMarker(page, close.price > closeState.previousClose ? '#ef4444' : close.price < closeState.previousClose ? '#16a34a' : '#94a3b8')
  expect(close.lineFigures[0].styles.size).toBe(open.lineFigures[0].styles.size)
  expect(close.lineFigures[0].styles.dashedValue).toEqual(open.lineFigures[0].styles.dashedValue)
  await page.locator('.theme-toggle').click()
  await assertMarker(page, close.price > closeState.previousClose ? '#ef4444' : close.price < closeState.previousClose ? '#16a34a' : '#94a3b8')
  await page.screenshot({ path: evidencePath('phase-price-close-light.png') })

  gapDirection = 'down'
  await page.getByRole('button', { name: '推进下一日' }).click()
  await expect(page.locator('.phase-tag')).toContainText('开盘阶段')
  await assertMarker(page, '#16a34a')
  await page.screenshot({ path: evidencePath('phase-price-open-gap-down-light.png') })
  await page.getByRole('tab', { name: '周K', exact: true }).click()
  await assertMarker(page, '#16a34a')
  await page.getByRole('tab', { name: '月K', exact: true }).click()
  await assertMarker(page, '#16a34a')
  expect(errors).toEqual([])
})

test('missing or invalid stage prices retain the normal CN latest-price marker', async ({ page }) => {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings', { data: { code: '300857', tier: '1M', start_date: '2026-04-15', initial_cash: 1_000_000, blind: false } })
  expect(response.status()).toBe(201)
  const id = (await response.json()).training.id
  let current: number | null = null
  await page.route(`**/api/trainings/${id}/bars?**`, async route => {
    const original = await route.fetch()
    const body = await original.json()
    body.training.currentClose = current
    await route.fulfill({ response: original, json: body })
  })
  for (const price of [null, 0]) {
    current = price
    await page.goto('/')
    await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
    await expect.poll(async () => (await state(page)).count).toBe(0)
    const actual = await page.evaluate(() => {
      const chart = (window as unknown as { __trainerChart: { bars: () => Array<{ close: number }>; lastPriceMarkShow: () => boolean; lastPriceMarkColor: () => string } }).__trainerChart
      return { bars: chart.bars(), show: chart.lastPriceMarkShow(), color: chart.lastPriceMarkColor() }
    })
    const last = actual.bars.at(-1)!.close
    const previous = actual.bars.at(-2)!.close
    expect(actual.show).toBe(true)
    expect(actual.color).toBe(last > previous ? '#ef4444' : last < previous ? '#16a34a' : '#94a3b8')
  }
})

test('manual price-axis scaling survives a theme switch', async ({ page }) => {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings', { data: { code: '300857', tier: '1M', start_date: '2026-04-15', initial_cash: 1_000_000, blind: false } })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const range = () => page.evaluate(() => (window as unknown as { __trainerChart: { yRange: () => { from: number; to: number } } }).__trainerChart.yRange())
  const before = await range()
  const box = (await page.locator('.chart-host').boundingBox())!
  const pane = await page.evaluate(() => (window as unknown as { __trainerChart: { panes: () => Array<{ height: number }> } }).__trainerChart.panes()[0])
  const x = box.x + box.width - 12, y = box.y + pane.height * 0.5
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 70, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await range()).to).not.toBe(before.to)
  const dragged = await range()
  await page.locator('.theme-toggle').click()
  await expect.poll(range).toEqual(dragged)
})
