import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'
import type { TradeView } from '../web/src/api'

const toggle = (page: Page) => page.getByRole('button', { name: '主图成交标记', exact: true })
const rail = (page: Page) => page.locator('.trade-marker-badge')
async function start(page: Page) {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 100_000_000 } })
  expect(response.status()).toBe(201)
  return (await response.json()).training.id as number
}
// Read the composited chart pixels, not the overlay count or its template.
async function hasArrow(page: Page, timestamp: number, trade: TradeView, mirror = false) {
  const p = await page.evaluate(({ timestamp, trade, mirror }) => {
    const hook = (window as any).__trainerChart
    const real = trade.chartPrice ?? trade.price
    const value = mirror ? 2 * hook.bars()[0].close - real : real
    return hook.pointToPixel(timestamp, value)
  }, { timestamp, trade, mirror })
  const png = (await page.locator('.chart-host').screenshot({ scale: 'css' })).toString('base64')
  return page.evaluate(async ({ png, p, buy }) => {
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d')!
    ctx.drawImage(image, 0, 0); image.close()
    const dir = buy ? 1 : -1
    const [x,y] = [Math.round(p.x) - dir * 4, Math.round(p.y) + dir * 4]
    const [r,g,b] = ctx.getImageData(x, y, 1, 1).data
    return buy ? r === 232 && g === 137 && b === 24 : r === 36 && g === 166 && b === 217
  }, { png, p, buy: trade.side === 'buy' })
}

test('paints execution glyphs at the confirmed bars and hides only chart glyphs', async ({ page }) => {
  test.setTimeout(120_000)
  const id = await start(page)
  for (const [path, data] of [['trade',{side:'buy',weightPct:10}],['next',{}],['trade',{side:'sell',shares:100}]] as const) {
    expect((await page.request.post(`/api/trainings/${id}/${path}`, {data})).ok()).toBe(true)
  }
  const { trades } = await (await page.request.get(`/api/trainings/${id}/bars?tf=1D`)).json() as { trades: TradeView[] }
  expect(trades.map(t => t.side)).toEqual(['buy','sell'])
  await page.goto('/'); await expect(rail(page)).toHaveCount(2)
  await expect(toggle(page)).toHaveAttribute('aria-pressed','false'); await toggle(page).click()
  for (const [tab, timestamps] of [['日K',['2025-01-02','2025-01-03']], ['周K',['2024-12-30','2024-12-30']], ['月K',['2025-01-01','2025-01-01']]] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    for (const [i, t] of trades.entries()) {
      const ts = Date.parse(timestamps[i]+'T00:00:00Z')
      try { await expect.poll(() => hasArrow(page,ts,t), { message: `${tab} ${t.side} ${t.date}` }).toBe(true) }
      catch (error) {
        const diag = await page.evaluate(({ts,t}) => { const h=(window as any).__trainerChart; return { last:h.bars().slice(-3), point:h.pointToPixel(ts,t.chartPrice??t.price), count:h.overlayCount('bsMark'), panes:h.panes() } }, {ts,t})
        console.log('FILL_DIAG', JSON.stringify({tab,t,ts,...diag})); await page.locator('.chart-host').screenshot({path:evidencePath('fill-diagnostic.png')}); throw error
      }
    }
  }
  await page.getByRole('tab', { name:'周K',exact:true }).click()
  await page.getByRole('button',{ name:'切换到浅色主题',exact:true }).click()
  for (const t of trades) await expect.poll(() => hasArrow(page,Date.parse('2024-12-30T00:00:00Z'),t)).toBe(true)
  await page.screenshot({path:evidencePath('fill-markers-week-light.png')})
  await page.getByRole('button',{ name:'切换到深色主题',exact:true }).click()
  await page.getByRole('tab', { name:'日K',exact:true }).click()
  const ts = Date.parse('2025-01-02T00:00:00Z')
  await page.getByRole('button',{name:'多空反转',exact:true}).click()
  await expect.poll(() => hasArrow(page,ts,trades[0],true)).toBe(true)
  await page.getByRole('button',{name:'多空反转',exact:true}).click()
  await page.screenshot({path:evidencePath('fill-markers-training.png')})
  await toggle(page).click(); await expect.poll(() => hasArrow(page,ts,trades[0])).toBe(false)
  await expect(rail(page)).toHaveCount(2); await rail(page).first().click()
  await expect(page.locator('.trade-marker-details')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__trainerChart.drawings())).toHaveLength(0)
})

test('replay paints only fills already present in the current frame', async ({ page }) => {
  test.setTimeout(120_000)
  const id = await start(page); await page.goto('/')
  await page.getByRole('button',{ name:'推进下一日',exact:true }).click()
  await expect(page.locator('.training-current-date')).toContainText('2025-01-03')
  await page.getByRole('button',{ name:'买入',exact:true }).click(); await expect(rail(page)).toHaveCount(1)
  const trade: TradeView = (await (await page.request.get(`/api/trainings/${id}/bars?tf=1D`)).json()).trades[0]
  const done = page.waitForEvent('download'); await page.getByRole('button',{ name:'导出录制',exact:true }).click()
  const file = evidencePath('fill-recording.json.gz'); await (await done).saveAs(file)
  await page.getByRole('button',{ name:'训练录像',exact:true }).click(); await page.getByLabel('导入录制',{exact:true}).setInputFiles(file)
  await expect(page.getByRole('button',{name:'关闭回放'})).toBeVisible(); await toggle(page).click()
  await page.getByRole('button',{name:'跳到最后一天'}).click(); await expect(rail(page)).toHaveCount(1)
  const ts = Date.parse('2025-01-03T00:00:00Z')
  await expect.poll(() => hasArrow(page,ts,trade)).toBe(true)
  await page.getByRole('button',{name:'回到第一天'}).click(); await expect(rail(page)).toHaveCount(0)
  await expect.poll(() => hasArrow(page,ts,trade)).toBe(false)
})
