import { test, expect, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

const names = ['DIF', 'DEA', 'K', 'D', 'J'] as const
const customMaColor = '#123456'
type Ink = Record<string, { color: string; background: string; curve: boolean }>
type Probes = Window & {
  __indicatorInk: { reset(): void; read(): Ink }
  __trainerChart: { ma(): { colors: string[] }; indicatorPanes(): string[] }
}

// Observe actual canvas paint only. Match legend and curve across layers of
// the same plot, excluding horizontal/vertical grid and axis strokes.
async function observe(page: Page) {
  await page.addInitScript(() => {
    const labels = new Map<string, { plot: string; color: string; canvas: HTMLCanvasElement }>()
    const strokes = new Map<string, Set<string>>()
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
          const colors = strokes.get(key) ?? new Set<string>()
          colors.add(String(this.strokeStyle)); strokes.set(key, colors)
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
      read() { return Object.fromEntries(Array.from(labels).filter(([, v]) => v.canvas.isConnected).map(([k, v]) => [k, { color: v.color, background: background(v.canvas), curve: strokes.get(v.plot)?.has(v.color) ?? false }])) },
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
    if (mode === 'dark') expect(names.map(n => ink[n].color)).toEqual(['#f2f2f2', '#f5c343', '#f2f2f2', '#f5c343', '#d446d6'])
    else for (const n of names) {
      const bg = ink[n].background
      const a = luminance(ink[n].color), b = luminance(bg)
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${n}: ${ink[n].color} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(ink.DIF.color).toBe(ink.K.color); expect(ink.DEA.color).toBe(ink.D.color)
    expect(new Set([ink.K.color, ink.D.color, ink.J.color]).size).toBe(3)
  }).toPass({ timeout: 15_000 })
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
