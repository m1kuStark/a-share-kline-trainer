import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// CHART-LAYOUT-01（用户 2026-11-10 Issue #8 反馈）：训练页图表铺满可用高度、消除底部空白行。
// 独立 oracle：真实浏览器几何测量（frame/host/rail/quote 的 getBoundingClientRect）＋库只读探针
// panes()/paneRects()。断言与当前实现无关——只看「面板内容高度是否被 frame/host/窗格铺满」，
// 不依赖 .chart-frame 采用 grid 还是 flex（grid 空行会表现为 trailing 空白带 / 行数多于子元素）。
const SIZES = [
  { width: 1024, height: 680 },
  { width: 1366, height: 705 },
  { width: 1440, height: 900 },
] as const
const THEMES = ['dark', 'light'] as const
const errors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(async ({ page }, testInfo) => {
  // 失败证据：保留当时真实几何与空白带截图（首次失败记录进验证记录）。
  if (testInfo.status !== testInfo.expectedStatus) {
    const name = 'FAILED-' + testInfo.title.replace(/[^0-9A-Za-z\u4e00-\u9fa5-]+/g, '-').slice(0, 60) + '.png'
    await page.screenshot({ path: evidencePath(name) }).catch(() => {})
  }
  expect(errors.get(page)).toEqual([])
})

type Box = { x: number; y: number; width: number; height: number; bottom: number; right: number }
type Pane = { id: string; name: string; width: number; height: number; top: number; left: number }
type LayoutSnapshot = {
  frame: Box
  host: Box
  rail: Box
  quote: Box | null
  quoteInFrame: boolean
  containerContentTop: number
  containerContentBottom: number
  frameDisplay: string
  gridRows: number[] | null
  children: Array<{ className: string; top: number; height: number; bottom: number }>
  panes: Pane[]
  paneRects: { candle: Pane; xAxis: Pane }
  scroll: { width: number; height: number; innerWidth: number; innerHeight: number }
}

async function layout(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }
    }
    const frameEl = document.querySelector('.chart-frame') as HTMLElement
    // frame 的直接父元素＝图表容器（训练页 .chart-panel、回放页 .replay-chart，均 1px 边框）；
    // 用 clientTop/clientHeight 取内容盒，避免把边框算进面板内容高度。
    const containerEl = frameEl.parentElement as HTMLElement
    const frameStyle = getComputedStyle(frameEl)
    // 参与布局的直接子元素（排除绝对/固定定位的浮层）；text 节点不产生盒子。
    const children = Array.from(frameEl.children)
      .filter(el => {
        const style = getComputedStyle(el)
        return style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed'
      })
      .map(el => { const r = el.getBoundingClientRect(); return { className: String((el as HTMLElement).className), top: r.top, height: r.height, bottom: r.bottom } })
    const chart = (window as any).__trainerChart
    const quoteEl = document.querySelector('.chart-quote')
    return {
      frame: box(frameEl),
      host: box(document.querySelector('.chart-host')!),
      rail: box(document.querySelector('.trade-marker-rail')!),
      quote: quoteEl ? box(quoteEl) : null,
      quoteInFrame: quoteEl ? frameEl.contains(quoteEl) : false,
      containerContentTop: containerEl.getBoundingClientRect().top + containerEl.clientTop,
      containerContentBottom: containerEl.getBoundingClientRect().top + containerEl.clientTop + containerEl.clientHeight,
      frameDisplay: frameStyle.display,
      gridRows: frameStyle.display === 'grid' ? frameStyle.gridTemplateRows.split(' ').filter(Boolean).map(Number) : null,
      children,
      panes: chart.panes(),
      paneRects: chart.paneRects(),
      scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, innerWidth, innerHeight },
    }
  })
}

const near = (actual: number, expected: number, label: string, tolerance = 1) =>
  expect(Math.abs(actual - expected), `${label}: actual ${actual} vs expected ${expected}`).toBeLessThanOrEqual(tolerance)

// 等待布局稳定：连续两次采样 frame/host/rail/grid 形状一致（klinecharts 的 _layout 经 Promise 微任务，
// ResizeObserver 也会排一次重排；CHART-VIEWPORT 要求先等布局稳定再断言）。
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  let previous = ''
  await expect.poll(async () => {
    const m = await layout(page)
    const key = JSON.stringify([m.frame.height, m.host.height, m.rail.height, m.frameDisplay, m.gridRows, m.panes.map(pane => [pane.id, pane.height, pane.top])])
    const stable = key === previous
    previous = key
    return stable
  }, { timeout: 8_000, intervals: [120, 120, 120, 120] }).toBe(true)
  await page.waitForTimeout(80)
  await settleFrames(page)
}
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

function expectNoEmptyRow(m: LayoutSnapshot, label: string): void {
  near(m.frame.bottom, m.containerContentBottom, `${label}: frame 底边 vs 面板内容底边`)
  near(m.frame.y, m.containerContentTop, `${label}: frame 顶边 vs 面板内容顶边`)
  const children = [...m.children].sort((a, b) => a.top - b.top)
  expect(children.length, `${label}: frame 直接布局子元素数量`).toBeGreaterThanOrEqual(2)
  near(children[0]!.top, m.frame.y, `${label}: 首个子元素顶边 vs frame 顶边`)
  near(children[children.length - 1]!.bottom, m.frame.bottom, `${label}: 末个子元素底边 vs frame 底边`)
  for (let i = 0; i + 1 < children.length; i++) {
    near(children[i + 1]!.top, children[i]!.bottom, `${label}: 子元素 ${children[i]!.className} 与 ${children[i + 1]!.className} 之间无空行/重叠`)
  }
  // 旧 3 行 grid 在行情条 Teleport 后保留空 auto 行：行数 > 流内子元素数，且行高总和仍等于 frame 高度。
  if (m.gridRows) {
    expect(m.gridRows.length, `${label}: grid 行数 vs 流内子元素数`).toBe(children.length)
  }
}

function expectPanesFillHost(m: LayoutSnapshot, label: string): void {
  const panes = [...m.panes].sort((a, b) => a.top - b.top)
  const xAxis = m.paneRects.xAxis
  expect(panes.length, `${label}: 绘图窗格数量`).toBeGreaterThanOrEqual(1)
  near(panes[0]!.top, 0, `${label}: 首个窗格顶边`)
  near(xAxis.top + xAxis.height, m.host.height, `${label}: 时间轴底边 vs host 高度`)
  const gaps: number[] = []
  for (let i = 0; i + 1 < panes.length; i++) gaps.push(panes[i + 1]!.top - (panes[i]!.top + panes[i]!.height))
  for (const gap of gaps) {
    expect(gap, `${label}: 相邻窗格间隙 ${gap}（不得出现空白带）`).toBeGreaterThanOrEqual(0)
    // 分隔条布局带实测 1px（7px 是事件命中带，不参与布局）；收紧到 ≤2，避免 7px 级空白带被当作分隔条放过
    expect(gap, `${label}: 相邻窗格间隙 ${gap}（不得出现空白带）`).toBeLessThanOrEqual(2)
  }
  const separator = gaps[0] ?? 0
  for (const gap of gaps) near(gap, separator, `${label}: 分隔条布局宽度一致`)
  const panesTotal = panes.reduce((sum, pane) => sum + pane.height, 0)
  near(panesTotal + xAxis.height + separator * gaps.length, m.host.height, `${label}: 主图+副图+分隔条+时间轴总高 vs host 高度`)
}

function expectViewportClean(m: LayoutSnapshot, label: string): void {
  expect(m.scroll.height, `${label}: 页面无纵向滚动`).toBeLessThanOrEqual(m.scroll.innerHeight + 1)
  expect(m.scroll.width, `${label}: 页面无横向溢出`).toBeLessThanOrEqual(m.scroll.innerWidth + 1)
}

// 训练页：行情条 Teleport 到状态条（不在 frame 流内）→ host 必须 = frame − 成交标记带。
function expectTrainingFill(m: LayoutSnapshot, label: string): void {
  expect(m.quoteInFrame, `${label}: 训练页行情条不在图表 frame 内（Teleport 到状态条）`).toBe(false)
  expectNoEmptyRow(m, label)
  near(m.rail.height, 40, `${label}: 成交标记带保持 40px`)
  near(m.host.height, m.frame.height - m.rail.height, `${label}: 图表宿主高度 = frame 高度 − 成交标记带高度`)
  near(m.host.y, m.frame.y, `${label}: 图表宿主顶边`)
  near(m.host.bottom, m.rail.y, `${label}: 图表宿主底边 vs 成交标记带顶边`)
  expect(m.host.width, `${label}: 图表宿主宽度`).toBeGreaterThan(0)
  expectPanesFillHost(m, label)
}

async function createTraining(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings', {
    data: { code: '600519', tier: '2Y', start_date: '2024-09-13', initial_cash: 1_000_000 },
  })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(page.locator('.loading-dot')).not.toBeVisible()
  // 默认偏好：candle/VOL/MACD/KDJ 四个绘图窗格
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.panes().length)).toBe(4)
}

async function setTheme(page: Page, mode: 'dark' | 'light'): Promise<void> {
  const isDark = await page.locator('body').evaluate(body => body.classList.contains('dark'))
  if (isDark !== (mode === 'dark')) await page.locator('.theme-toggle').click()
  expect(await page.locator('body').evaluate(body => body.classList.contains('dark')), `theme=${mode}`).toBe(mode === 'dark')
  await settle(page)
}

test('training chart fills the available height at three desktop sizes in both themes', async ({ page }) => {
  test.setTimeout(180_000)
  await createTraining(page)
  for (const size of SIZES) {
    await page.setViewportSize(size)
    await settle(page)
    for (const mode of THEMES) {
      await setTheme(page, mode)
      const label = `${size.width}x${size.height}-${mode}`
      const m = await layout(page)
      expectTrainingFill(m, label)
      expectViewportClean(m, label)
      // 几何快照进运行产物（frame/host/rail/panes 的实测值，供证据核对）
      await test.info().attach(`layout-${label}`, { body: JSON.stringify(m, null, 2), contentType: 'application/json' })
      // 行情条仍常驻状态条可见（Teleport 形态不因铺满修复而丢失）
      await expect(page.locator('.status-strip .chart-quote')).toBeVisible()
      await page.screenshot({ path: evidencePath(`layout-fill-${size.width}x${size.height}-${mode}.png`) })
    }
  }
})

test('fill invariants survive MACD toggle, maximize/restore and window resize', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await createTraining(page)
  await settle(page)
  let m = await layout(page)
  expectTrainingFill(m, 'initial-1440x900')
  expectViewportClean(m, 'initial-1440x900')

  const macdToggle = page.locator('.indicator-toggles').getByRole('button', { name: 'MACD', exact: true })
  // 关闭 MACD：窗格移除后仍铺满
  await macdToggle.click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.panes().length)).toBe(3)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.indicatorPanes())).toEqual(['candle_pane', 'VOL', 'KDJ'])
  await settle(page)
  m = await layout(page)
  expectTrainingFill(m, 'macd-off')
  expectViewportClean(m, 'macd-off')
  await page.screenshot({ path: evidencePath('layout-fill-macd-off.png') })

  // 重新开启 MACD：副图回来仍铺满
  await macdToggle.click()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.panes().length)).toBe(4)
  await settle(page)
  m = await layout(page)
  expectTrainingFill(m, 'macd-on')
  expectViewportClean(m, 'macd-on')

  // 双击 MACD 副图最大化：主图归零但 host 仍铺满 frame（分隔条让位、时间轴保留）
  const host = (await page.locator('.chart-host').boundingBox())!
  const macdPane = (await page.evaluate(() => (window as any).__trainerChart.panes())).find((pane: Pane) => pane.name === 'MACD')!
  await page.mouse.dblclick(host.x + macdPane.width * .45, host.y + macdPane.top + macdPane.height * .5)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.panes().find((pane: { id: string }) => pane.id === 'candle_pane').height)).toBe(0)
  await settle(page)
  m = await layout(page)
  expectTrainingFill(m, 'macd-maximized')
  expectViewportClean(m, 'macd-maximized')
  await page.screenshot({ path: evidencePath('layout-fill-macd-maximized.png') })

  // 再双击主图区域还原
  await page.mouse.dblclick(host.x + host.width * .45, host.y + 100)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.panes().find((pane: { id: string }) => pane.id === 'candle_pane').height)).toBeGreaterThan(0)
  await settle(page)
  m = await layout(page)
  expectTrainingFill(m, 'macd-restored')
  expectViewportClean(m, 'macd-restored')

  // 窗口 resize 1440 → 1024 → 1440：每次都在新的可用高度内铺满
  for (const size of [{ width: 1024, height: 680 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size)
    await settle(page)
    const label = `resize-${size.width}x${size.height}`
    m = await layout(page)
    expectTrainingFill(m, label)
    expectViewportClean(m, label)
    await page.screenshot({ path: evidencePath(`layout-fill-${label}.png`) })
  }
})

// 回放页无 #chart-quote-slot：ChartQuote 内联在 frame 流内（Quote 内联形态）。
// 铺满不变量：frame 无空行，host = frame − 行情条高度 − 成交标记带高度。
test('replay page keeps the inline quote and fills the frame without an empty row', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 705 })
  await createTraining(page)
  await page.getByRole('button', { name: '推进下一日', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await page.waitForTimeout(600)
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  await expect(page.getByPlaceholder('股票代码，如 600519')).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
  const open = page.locator('[data-recording-source="local"] .recording-history-open').first()
  await expect(open).toBeVisible({ timeout: 30_000 })
  await open.click()
  await expect(page.getByRole('button', { name: '关闭回放' })).toBeVisible()
  await expect(page.locator('.replay-chart .chart-host canvas').first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart?.panes().length)).toBeGreaterThanOrEqual(3)
  await settle(page)
  const m = await layout(page)
  expect(m.quoteInFrame, '回放页行情条内联在 frame 流内').toBe(true)
  expect(m.quote).not.toBeNull()
  expectNoEmptyRow(m, 'replay-inline')
  near(m.rail.height, 40, 'replay-inline: 成交标记带保持 40px')
  near(m.host.height, m.frame.height - m.quote!.height - m.rail.height, 'replay-inline: 图表宿主高度 = frame 高度 − 行情条高度 − 成交标记带高度')
  near(m.host.y, m.frame.y + m.quote!.height, 'replay-inline: 图表宿主顶边')
  expectPanesFillHost(m, 'replay-inline')
  expect(m.scroll.width, 'replay-inline: 页面无横向溢出').toBeLessThanOrEqual(m.scroll.innerWidth + 1)
  await page.screenshot({ path: evidencePath('layout-fill-replay-inline.png') })
})
