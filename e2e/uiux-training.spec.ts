import { expect, test, type Locator, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a => a.finished.catch(() => {})))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

async function openTraining(page: Page) {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const created = await page.request.post('/api/trainings', { data: {
    code: '300857', tier: '1M', start_date: '2026-04-15', initial_cash: 1_000_000,
    blind: false, clock_mode: 'close_only', orders_enabled: true,
  } })
  expect(created.status()).toBe(201)
  const id = (await created.json()).training.id as number
  await page.goto('/')
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(page.locator('.training-grid')).not.toHaveAttribute('inert', '')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.panes().length)).toBe(4)
  await settle(page)
  return id
}

// Read clipping ancestors and hit-test before any click; locator auto-scroll must not repair the layout under test.
async function reachable(target: Locator, label: string) {
  const m = await target.evaluate(el => {
    const r = el.getBoundingClientRect(), clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p), b = p.getBoundingClientRect()
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clip.left = Math.max(clip.left, b.left + p.clientLeft); clip.right = Math.min(clip.right, b.left + p.clientLeft + p.clientWidth) }
      if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) { clip.top = Math.max(clip.top, b.top + p.clientTop); clip.bottom = Math.min(clip.bottom, b.top + p.clientTop + p.clientHeight) }
    }
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, clip, hit: hit === el || el.contains(hit), hitText: hit?.textContent?.slice(0, 80) }
  })
  expect(m.box.width, label).toBeGreaterThan(0)
  expect(m.box.height, label).toBeGreaterThan(0)
  expect(m.box.x, `${label} left ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(m.clip.left - 1)
  expect(m.box.y, `${label} top ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(m.clip.top - 1)
  expect(m.box.x + m.box.width, `${label} right ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.clip.right + 1)
  expect(m.box.y + m.box.height, `${label} bottom ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.clip.bottom + 1)
  expect(m.hit, `${label} center hit ${JSON.stringify(m)}`).toBe(true)
  return m.box
}

async function mouseClick(page: Page, target: Locator, label: string) {
  const b = await reachable(target, label)
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}

async function setTheme(page: Page, mode: 'light' | 'dark') {
  if (await page.locator('body').evaluate(el => el.classList.contains('dark')) !== (mode === 'dark')) await mouseClick(page, page.locator('.theme-toggle'), 'theme')
  await settle(page)
}

async function fixedPositions(page: Page) {
  return { chart: (await page.locator('.chart-host').boundingBox())!, advance: (await page.getByRole('button', { name: '推进下一日', exact: true }).boundingBox())!,
    heading: (await page.locator('.drawing-toolbar-heading').boundingBox())!, actions: (await page.locator('.drawing-toolbar-actions').boundingBox())!,
    footer: (await page.locator('.drawing-save-footer').boundingBox())!, scrollY: await page.evaluate(() => scrollY) }
}

async function stable(page: Page, before: Awaited<ReturnType<typeof fixedPositions>>) {
  const after = await fixedPositions(page)
  expect(after.scrollY).toBe(before.scrollY)
  for (const region of ['chart', 'advance', 'heading', 'actions', 'footer'] as const) for (const dim of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(after[region][dim] - before[region][dim]), `${region} ${dim}`).toBeLessThanOrEqual(.5)
}

async function geometry(page: Page, name: string) {
  const data = await page.evaluate(() => {
    const r = document.querySelector('.chart-host')!.getBoundingClientRect()
    const metrics = (s: string) => { const e = document.querySelector(s)!; return { scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, scrollTop: e.scrollTop } }
    return { content: { width: innerWidth, height: innerHeight }, browserOuter: { width: outerWidth, height: outerHeight }, dpr: devicePixelRatio,
      visualViewportScale: visualViewport?.scale, chart: { width: r.width, height: r.height }, console: metrics('.console-scroll'), tools: metrics('.toolbar-tool-lists'),
      panes: (window as any).__trainerChart.panes(), fontTokens: Object.fromEntries(['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'].map(k => [k, getComputedStyle(document.documentElement).getPropertyValue(`--font-size-${k}`)])) }
  })
  await test.info().attach(name, { body: JSON.stringify(data, null, 2), contentType: 'application/json' })
  expect(data.panes.map((p: any) => p.name)).toEqual(['candle_pane', 'VOL', 'MACD', 'KDJ'])
  for (const p of data.panes) {
    expect(p.width).toBeGreaterThan(0); expect(p.height).toBeGreaterThan(0)
    expect(p.left).toBeGreaterThanOrEqual(0); expect(p.top).toBeGreaterThanOrEqual(0)
    expect(p.left + p.width).toBeLessThanOrEqual(data.chart.width + 1)
    expect(p.top + p.height).toBeLessThanOrEqual(data.chart.height + 1)
  }
}

async function buy100(page: Page, id: number) {
  const before = (await (await page.request.get(`/api/trainings/${id}`)).json()).account.shares
  await mouseClick(page, page.getByRole('spinbutton', { name: '按股数买卖', exact: true }), 'share input')
  await page.keyboard.press('Control+A'); await page.keyboard.type('100')
  const response = page.waitForResponse(r => r.url().endsWith(`/api/trainings/${id}/trade`) && r.request().method() === 'POST')
  await mouseClick(page, page.getByRole('button', { name: '买入', exact: true }), 'buy 100')
  expect((await response).status()).toBe(200)
  await expect.poll(async () => (await (await page.request.get(`/api/trainings/${id}`)).json()).account.shares).toBe(before + 100)
  await expect(page.locator('.training-grid')).not.toHaveAttribute('inert', '')
  await settle(page)
}

const scrollMetrics = (container: Locator) => container.evaluate(e => ({ top: e.scrollTop, height: e.scrollHeight, client: e.clientHeight }))
async function wheel(page: Page, container: Locator, delta: number) {
  const b = (await container.boundingBox())!
  await page.mouse.move(b.x + Math.min(20, b.width / 2), b.y + b.height / 2)
  await page.mouse.wheel(0, delta)
  await page.waitForTimeout(120)
}
async function wheelToEnd(page: Page, container: Locator, label: string) {
  await wheel(page, container, -2400)
  await expect.poll(async () => (await scrollMetrics(container)).top, { message: `${label} begins at top by real wheel` }).toBe(0)
  const before = await scrollMetrics(container)
  expect(before.height, `${label} real overflow`).toBeGreaterThan(before.client)
  await wheel(page, container, 2400)
  await expect.poll(async () => (await scrollMetrics(container)).top, { message: `${label} real wheel changes scrollTop` }).toBeGreaterThan(before.top)
  await expect.poll(async () => { const m = await scrollMetrics(container); return m.height - m.client - m.top }).toBeLessThanOrEqual(1)
  await test.info().attach(`${label}-wheel`, { body: JSON.stringify({ before, after: await scrollMetrics(container) }), contentType: 'application/json' })
}
async function wheelIntoView(page: Page, container: Locator, target: Locator) {
  for (let i = 0; i < 24; i++) {
    const c = (await container.boundingBox())!, t = (await target.boundingBox())!
    if (t.y >= c.y + 1 && t.y + t.height <= c.y + c.height - 1) return
    await wheel(page, container, t.y < c.y + 1 ? -36 : 36)
  }
  await reachable(target, 'wheel-reached tool')
}

test('training keeps trading and drawing available together without shifting chart or advance target', async ({ page }) => {
  test.setTimeout(120_000)
  for (const size of [{ width: 1008, height: 641 }, { width: 1024, height: 680 }, { width: 1440, height: 900 }]) {
    for (const mode of ['light', 'dark'] as const) {
    await page.setViewportSize(size)
    const id = await openTraining(page)
    await setTheme(page, mode)
    await geometry(page, `default-${size.width}-${mode}`)
    await page.screenshot({ path: evidencePath(`uiux-training-${size.width}-${mode}-before.png`) })
    const consoleBox = (await page.locator('.console-scroll').boundingBox())!
    const buy = (await page.getByRole('button', { name: '买入', exact: true }).boundingBox())!
    expect(buy.y + buy.height, 'buy action remains visible with default drawing tools').toBeLessThanOrEqual(consoleBox.y + consoleBox.height + 1)
    for (const label of ['买入', '卖出']) await reachable(page.getByRole('button', { name: label, exact: true }), label)
    await expect(page.getByRole('button', { name: '自定义常用', exact: true })).toBeVisible()
    for (const target of [page.locator('.favorite-tools [data-tool-name]').first(), page.getByRole('button', { name: '自定义常用', exact: true }), page.getByRole('button', { name: '多选', exact: true }), page.getByRole('combobox', { name: '吸附', exact: true })]) await reachable(target, 'default drawing action')
    const first = page.locator('.favorite-tools [data-tool-name]').first()
    await mouseClick(page, first, 'first tool'); await expect(first).toHaveClass(/active/)
    await page.keyboard.press('Escape'); await expect(first).not.toHaveClass(/active/)
    const chart = (await page.locator('.chart-host').boundingBox())!
    // The chart remains the primary workspace; this is a layout ratio, not a chart-library pixel minimum.
    const workspace = (await page.locator('.training-grid').boundingBox())!
    expect(chart.width).toBeGreaterThan(workspace.width / 2)
    expect(chart.height).toBeGreaterThan(size.height - 220)
    const next = page.getByRole('button', { name: '推进下一日', exact: true })
    const before = (await next.boundingBox())!
    await reachable(next, 'advance')
    for (let repeat = 0; repeat < 3; repeat++) {
    const current = await page.locator('.training-current-date').innerText()
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
    await expect(page.locator('.training-current-date')).not.toHaveText(current)
    await expect(next).toBeEnabled()
    await expect(page.locator('.training-grid')).not.toHaveAttribute('inert', '')
    const after = (await next.boundingBox())!
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(.5)
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(.5)
    expect(await page.locator('.chart-host').boundingBox()).toEqual(chart)
    }
    await buy100(page, id)
    await page.screenshot({ path: evidencePath(`uiux-training-${size.width}-${mode}.png`) })
    }
  }
})

test('training keeps enlarged text and every drawing entry reachable by local wheel at actual minimum content size', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1008, height: 641 })
  const id = await openTraining(page)
  await page.evaluate(() => {
    const root = document.documentElement, style = getComputedStyle(root)
    const sizes = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'].map(key => [key, parseFloat(style.getPropertyValue(`--font-size-${key}`))] as const)
    for (const [key, size] of sizes) root.style.setProperty(`--font-size-${key}`, `${size * 1.25}px`)
  })
  for (const mode of ['light', 'dark'] as const) {
    await setTheme(page, mode)
    await geometry(page, `text125-${mode}`)
    const console = page.locator('.console-scroll'), list = page.locator('.toolbar-tool-lists')
    await wheel(page, console, -2400)
    const fixed = await fixedPositions(page)
    await wheelToEnd(page, console, `console-${mode}`)
    for (const label of ['买入', '卖出']) await reachable(page.getByRole('button', { name: label, exact: true }), label)
    await buy100(page, id); await stable(page, fixed)
    await page.screenshot({ path: evidencePath(`uiux-training-text125-${mode}-trade.png`) })
    await wheel(page, list, -2400)
    await wheelToEnd(page, list, `tools-${mode}`)
    await reachable(page.locator('.favorite-tools [data-tool-name]').last(), 'last favorite')
    await reachable(page.locator('.other-tools-toggle'), 'other tools entry')
    for (const tool of await page.locator('.favorite-tools [data-tool-name]').all()) {
      await wheelIntoView(page, list, tool)
      await reachable(tool, `favorite ${await tool.getAttribute('data-tool-name')}`)
    }
    const favorite = page.locator('.favorite-tools [data-tool-name]').last()
    await mouseClick(page, favorite, 'last favorite'); await expect(favorite).toHaveClass(/active/); await page.keyboard.press('Escape')
    await wheelIntoView(page, list, page.locator('.other-tools-toggle'))
    await mouseClick(page, page.locator('.other-tools-toggle'), 'expand other tools')
    await expect(page.locator('.other-tools')).toBeVisible(); await settle(page)
    const expanded = await fixedPositions(page)
    await wheelToEnd(page, list, `other-tools-${mode}`)
    const lastOther = page.locator('.other-tools [data-tool-name]').last()
    await mouseClick(page, lastOther, 'last other'); await expect(lastOther).toHaveClass(/active/); await page.keyboard.press('Escape')
    await stable(page, expanded)
    await page.screenshot({ path: evidencePath(`uiux-training-text125-${mode}-other.png`) })
    await mouseClick(page, page.getByRole('button', { name: '自定义常用', exact: true }), 'customize')
    await expect(page.locator('.draw-toolbar')).toHaveClass(/is-customizing/); await settle(page)
    for (const kind of ['favorite', 'other']) {
      const inner = page.locator(`.${kind}-tools`)
      await wheelToEnd(page, inner, `custom-${kind}-${mode}`)
      const last = inner.locator('.tool-item').last()
      await reachable(last.locator('[data-tool-name]'), `custom ${kind} last tool`)
      await reachable(last.locator('.tool-item-actions button').last(), `custom ${kind} last action`)
    }
    await page.screenshot({ path: evidencePath(`uiux-training-text125-${mode}-custom.png`) })
    await mouseClick(page, page.getByRole('button', { name: '完成自定义', exact: true }), 'finish customization')
    await wheelIntoView(page, list, page.locator('.other-tools-toggle'))
    await mouseClick(page, page.locator('.other-tools-toggle'), 'close other tools')
    await expect(page.locator('.other-tools')).toHaveCount(0)
    await wheel(page, list, -2400)
  }
})
