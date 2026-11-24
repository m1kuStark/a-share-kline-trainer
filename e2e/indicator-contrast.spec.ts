import { test, expect, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

const names = ['DIF', 'DEA', 'K', 'D', 'J'] as const
const customMaColor = '#123456'
type Ink = Record<string, { color: string; background: string; curve: boolean; width?: number }>
type Probes = Window & {
  __indicatorInk: { reset(): void; read(): Ink }
  __trainerChart: {
    ma(): { colors: string[] }; indicatorPanes(): string[]; bars(): { timestamp: number }[]
    indicatorResult(name: string): Record<string, number>[]
    pointToPixel(timestamp: number, value: number, pane: string): { x: number; y: number }
  }
}

// Observe actual canvas paint only. Match legend and curve across layers of
// the same plot, excluding horizontal/vertical grid and axis strokes.
async function observe(page: Page) {
  await page.addInitScript(() => {
    const labels = new Map<string, { plot: string; color: string; canvas: HTMLCanvasElement }>()
    const strokes = new Map<string, Map<string, number>>()
    const paths = new WeakMap<CanvasRenderingContext2D, { x: number; y: number; sloped: boolean }>()
    function plot(ctx: CanvasRenderingContext2D) {
      if (!ctx.canvas.closest('.chart-host')) return ''
      const { left, top, width } = ctx.canvas.getBoundingClientRect()
      return `${left}:${top}:${width}`
    }
    const proto = CanvasRenderingContext2D.prototype
    const { fillText, beginPath, moveTo, lineTo, stroke } = proto
    proto.fillText = function (...args: Parameters<typeof fillText>) {
      const label = args[0].trim().replace(/:.*$/, '')
      if (/^(DIF|DEA|K|D|J)$/.test(label)) {
        const key = plot(this)
        if (key) labels.set(label, { plot: key, color: String(this.fillStyle), canvas: this.canvas })
      }
      return fillText.apply(this, args)
    }
    proto.beginPath = function () { paths.delete(this); return beginPath.call(this) }
    proto.moveTo = function (x, y) { paths.set(this, { x, y, sloped: false }); return moveTo.call(this, x, y) }
    proto.lineTo = function (x, y) {
      const path = paths.get(this)
      if (path) { path.sloped ||= x !== path.x && y !== path.y; path.x = x; path.y = y }
      return lineTo.call(this, x, y)
    }
    proto.stroke = function (path?: Path2D) {
      if (!path && paths.get(this)?.sloped) {
        const key = plot(this)
        if (key) {
          const colors = strokes.get(key) ?? new Map<string, number>()
          colors.set(String(this.strokeStyle), this.lineWidth); strokes.set(key, colors)
        }
      }
      return path ? stroke.call(this, path) : stroke.call(this)
    }
    // The canvas is transparent. Training and replay paint different light
    // surfaces behind it. Do not use the nominal theme token for contrast.
    function background(canvas: HTMLCanvasElement) {
      for (let el: HTMLElement | null = canvas; el; el = el.parentElement) {
        const style = getComputedStyle(el)
        if (style.backgroundImage !== 'none') throw new Error('Sample the composited background image instead')
        const rgba = style.backgroundColor.match(/[\d.]+/g)?.map(Number)
        if (!rgba || rgba[3] === 0) continue
        if (rgba.length !== 3 && rgba[3] !== 1) throw new Error(`Translucent chart surface: ${style.backgroundColor}`)
        return '#' + rgba.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')
      }
      throw new Error('Indicator canvas has no opaque background')
    }
    ;(window as Probes).__indicatorInk = {
      reset() { labels.clear(); strokes.clear() },
      read() { return Object.fromEntries(Array.from(labels).filter(([, v]) => v.canvas.isConnected).map(([k, v]) => [k, { color: v.color, background: background(v.canvas), curve: strokes.get(v.plot)?.has(v.color) ?? false, width: strokes.get(v.plot)?.get(v.color) }])) },
    }
  })
}
function luminance(hex: string) {
  const [r, g, b] = hex.match(/[a-f\d]{2}/gi)!.map(s => parseInt(s, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return r * .2126 + g * .7152 + b * .0722
}
async function verifyPaint(page: Page, mode: 'light' | 'dark') {
  await expect(async () => {
    const ink = await page.evaluate(() => (window as Probes).__indicatorInk.read())
    for (const n of names) expect(ink[n]?.curve, `${n} legend with matching curve`).toBe(true)
    // Only the formerly white line (DIF/K) changes. The yellow/purple identities and
    // the original stroke weight are part of the contract, even on a light background.
    const neutral = mode === 'light' ? '#000000' : '#f2f2f2'
    expect(names.map(n => ink[n].color)).toEqual([neutral, '#f5c343', neutral, '#f5c343', '#d446d6'])
    for (const n of names) expect(ink[n].width, `${n} stroke width`).toBe(1)
    if (mode === 'light') for (const n of ['DIF', 'K']) {
      const bg = ink[n].background
      const a = luminance(ink[n].color), b = luminance(bg)
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${n}: ${ink[n].color} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(ink.DIF.color).toBe(ink.K.color); expect(ink.DEA.color).toBe(ink.D.color)
    expect(new Set([ink.K.color, ink.D.color, ink.J.color]).size).toBe(3)
  }).toPass({ timeout: 15_000 })
}
// The legend and a same-colour curve in the same pane are not enough: swapping
// K and D strokes alone must fail. Look for actual ink at each named result's y.
async function verifySeriesGeometry(page: Page) {
  const scores = await page.evaluate(() => {
    const chart = (window as Probes).__trainerChart, ink = (window as Probes).__indicatorInk.read()
    const host = document.querySelector('.chart-host')!, origin = host.getBoundingClientRect()
    const layers = Array.from(host.querySelectorAll('canvas')).filter(c => c.width && c.height).map(c => ({
      rect: c.getBoundingClientRect(), pixels: c.getContext('2d')!.getImageData(0, 0, c.width, c.height),
    }))
    const result: Record<string, { hits: number; sampled: number }> = {}, bars = chart.bars()
    for (const [pane, keys] of [['MACD', ['DIF', 'DEA']], ['KDJ', ['K', 'D', 'J']]] as const) {
      const data = chart.indicatorResult(pane)
      for (const key of keys) {
        let hits = 0, sampled = 0
        const rgb = ink[key].color.match(/[a-f\d]{2}/gi)!.map(h => parseInt(h, 16))
        data.forEach((row, i) => {
          if (!row || !bars[i] || keys.some(k => !Number.isFinite(row[k.toLowerCase()]))) return
          const at = (k: string) => chart.pointToPixel(bars[i].timestamp, row[k.toLowerCase()], pane)
          const p = at(key)
          if (keys.some(k => k !== key && Math.abs(at(k).y - p.y) < 7)) return
          const x = origin.left + p.x, y = origin.top + p.y
          const targets = layers.filter(({ rect: r }) => x >= r.left + 2 && x < r.right - 2 && y >= r.top + 24 && y < r.bottom - 2)
          if (!targets.length) return
          sampled++
          const found = targets.some(({ rect: r, pixels }) => {
            const cx = Math.round((x - r.left) * pixels.width / r.width), cy = Math.round((y - r.top) * pixels.height / r.height)
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const offset = 4 * ((cy + dy) * pixels.width + cx + dx)
              if (pixels.data[offset + 3] >= 70 && rgb.every((v, k) => Math.abs(v - pixels.data[offset + k]) <= 5)) return true
            }
            return false
          })
          if (found) hits++
        })
        result[key] = { hits, sampled }
      }
    }
    return result
  })
  for (const n of names) {
    expect(scores[n].sampled, `${n}: insufficient separated points`).toBeGreaterThanOrEqual(5)
    expect(scores[n].hits / scores[n].sampled, `${n} pixels at its own values: ${JSON.stringify(scores[n])}`).toBeGreaterThan(.65)
  }
}
const reset = (page: Page) => page.evaluate(() => (window as Probes).__indicatorInk.reset())
async function verifyMa(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as Probes).__trainerChart.ma()?.colors[0])).toBe(customMaColor)
}
async function flip(page: Page, to: 'light' | 'dark') {
  await reset(page)
  await page.getByRole('button', { name: to === 'light' ? '切换到浅色主题' : '切换到深色主题' }).click()
  await expect(page.locator('body')).toHaveClass(to === 'light' ? /^(?!.*\bdark\b).*$/ : /\bdark\b/)
  await verifyPaint(page, to); await verifyMa(page)
}

test('built-in indicator curves and legends follow theme across mount, toggle and replay', async ({ page }) => {
  await observe(page); await page.setViewportSize({ width: 1280, height: 800 })
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const created = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 100_000_000 } })
  expect(created.status()).toBe(201)
  await page.goto('/'); await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await verifyPaint(page, 'dark')
  // Keep the indicator legends visible in the evidence, not behind the floating tools.
  const tools = page.getByRole('button', { name: '划线', exact: true })
  if (await page.locator('.drawing-toolbar-heading').isVisible()) await tools.click()
  await expect(page.locator('.drawing-toolbar-heading')).not.toBeVisible()
  await page.getByRole('button', { name: '设置均线' }).click()
  await page.getByLabel('第 1 条均线颜色', { exact: true }).fill(customMaColor)
  await page.getByRole('button', { name: '应用', exact: true }).click(); await verifyMa(page)
  await page.screenshot({ path: evidencePath('indicator-1280-dark.png') })
  await flip(page, 'light'); await page.screenshot({ path: evidencePath('indicator-1280-light.png') })

  const kdj = page.getByRole('button', { name: 'KDJ', exact: true })
  await kdj.click()
  await expect.poll(() => page.evaluate(() => (window as Probes).__trainerChart.indicatorPanes())).not.toContain('KDJ')
  await reset(page); await kdj.click(); await verifyPaint(page, 'light')
  await page.setViewportSize({ width: 1600, height: 900 }); await flip(page, 'dark')
  await page.screenshot({ path: evidencePath('indicator-1600-dark.png') })
  await flip(page, 'light'); await page.screenshot({ path: evidencePath('indicator-1600-light.png') })

  await page.getByRole('button', { name: '推进下一日', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出录制', exact: true }).click(); await pending
  const training = (await (await page.request.get('/api/trainings/active')).json()).training
  await page.request.post(`/api/trainings/${training.id}/abandon`); await page.goto('/')
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await reset(page); await page.locator('[data-recording-source="local"] .recording-history-open').first().click()
  await expect(page.getByRole('button', { name: '关闭回放' })).toBeVisible()
  await verifyPaint(page, 'light'); await page.screenshot({ path: evidencePath('indicator-replay-light.png') })
})

test('weekly chart changes only the white DIF and K strokes when switching theme', async ({ page }) => {
  await observe(page); await page.setViewportSize({ width: 1440, height: 900 })
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const created = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 100_000_000 } })
  expect(created.status()).toBe(201)
  await page.goto('/'); await expect(page.locator('.training-grid[inert]')).toHaveCount(0)
  await page.getByRole('button', { name: '推进下一日', exact: true }).click()
  await expect(page.locator('.training-current-date')).toContainText('2025-01-03')
  await page.getByRole('tab', { name: '周K', exact: true }).click()
  await expect(page.getByRole('tab', { name: '周K', exact: true })).toHaveAttribute('aria-selected', 'true')
  if (await page.locator('.drawing-toolbar-heading').isVisible()) await page.getByRole('button', { name: '划线', exact: true }).click()
  await reset(page); await page.getByRole('button', { name: '切换到浅色主题', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as Probes).__indicatorInk.read().K?.background)).toBe('#f7f9f8')
  await page.mouse.move(1435, 895)
  await verifyPaint(page, 'light')
  await verifySeriesGeometry(page)
  await page.screenshot({ path: evidencePath('indicator-week-light.png') })
  await reset(page); await page.getByRole('button', { name: '切换到深色主题', exact: true }).click()
  await verifyPaint(page, 'dark')
  await verifySeriesGeometry(page)
  await page.screenshot({ path: evidencePath('indicator-week-dark.png') })
})
