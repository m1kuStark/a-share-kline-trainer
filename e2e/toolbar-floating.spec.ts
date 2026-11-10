import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// UI-TOOLBAR-01（Issue #8 工具栏布局，用户 2026-11-07 拍板）：顶栏「划线」开关打开可拖拽的
// 图形化悬浮工具面板；图标 + hover 中文名称/描述；全部 23 个工具在 1024×680 可达且无需纵向滚动；
// 位置持久化；深浅主题无溢出/遮挡；不改变画线语义与快捷键守恒。
test.setTimeout(180_000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function openTraining(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const created = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02' } })
  expect(created.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
}

const panel = (page: Page) => page.locator('.draw-toolbar')

const ALL_TOOLS = ['segment', 'rayLine', 'straightLine', 'horizontalStraightLine', 'horizontalSegment', 'horizontalRayLine', 'verticalStraightLine', 'verticalSegment', 'verticalRayLine', 'parallelStraightLine', 'priceChannelLine', 'fibonacciLine', 'polyline', 'priceLine', 'rectangle', 'circle', 'arc', 'arrowLine', 'bullArrow', 'bearArrow', 'percentageLine', 'curseLine', 'textAnnotation']

test('紧凑工具面板默认展开全部 23 个工具、常用数量 0/5/10/23 均无纵向滚动', async ({ page }: { page: Page }) => {
  test.setTimeout(240_000)
  const viewports = [{ width: 1024, height: 680 }, { width: 1280, height: 720 }, { width: 1366, height: 705 }]
  const favoriteCases = [0, 5, 10, 23]
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize(viewports[0])
  await openTraining(page)
  const toggle = page.getByRole('button', { name: '划线', exact: true })
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(panel(page)).toBeVisible()

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const count of favoriteCases) {
      await page.evaluate(({ names, count }) => {
        localStorage.setItem('trainer.favoriteTools.v1', JSON.stringify(names.slice(0, count)))
      }, { names: ALL_TOOLS, count })
      await page.reload()
      await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
      await expect(panel(page)).toBeVisible()
      // UI-TOOLBAR-02：默认即展开其他工具（无需再点「其他工具」才能看全）
      await expect(page.locator('.other-tools')).toBeVisible()
      await expect(page.locator('.other-tools-toggle')).toHaveAttribute('aria-expanded', 'true')

      const tools = page.locator('.draw-toolbar [data-tool-name]')
      await expect(tools).toHaveCount(23)
      for (let i = 0; i < 23; i++) await expect(tools.nth(i)).toBeVisible()
      const scroll = await page.locator('.toolbar-tool-lists').evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight }))
      expect(scroll.scroll, `favorites=${count} viewport=${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(scroll.client + 2)

      // 紧凑尺寸：图标 ≤18px、按钮高 ≤38px、可点击区域 ≥32×32
      const glyph = await page.locator('[data-tool-name="segment"] svg.tool-glyph').boundingBox()
      expect(glyph!.width).toBeLessThanOrEqual(18)
      expect(glyph!.height).toBeLessThanOrEqual(18)
      const button = await page.locator('[data-tool-name="segment"]').boundingBox()
      expect(button!.height).toBeLessThanOrEqual(38)
      expect(button!.width * button!.height).toBeGreaterThanOrEqual(32 * 32)
      expect(button!.height).toBeGreaterThanOrEqual(32)

      // 面板不超出视口底部
      const box = (await panel(page).boundingBox())!
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
    }
    await page.screenshot({ path: evidencePath(`toolbar-compact-${viewport.width}.png`) })
  }

  // hover/键盘提示仍可用
  await page.locator('[data-tool-name="segment"]').hover()
  const tip = page.locator('.draw-tool-hover')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('线段')
  await expect(tip).toContainText('两点之间')
  await page.mouse.move(8, 8)
  await expect(tip).toBeHidden()
  await page.locator('[data-tool-name="segment"]').focus()
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('两点之间')

  // 开关可收起/展开
  await toggle.click()
  await expect(panel(page)).not.toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(panel(page)).toBeVisible()
  expect(errors).toEqual([])
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
})

test('面板可拖拽移动、位置持久化、越界钳制；深浅主题 1440 截图', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openTraining(page)
  const before = (await panel(page).boundingBox())!
  const heading = (await page.locator('.drawing-toolbar-heading').boundingBox())!
  // UI-TOOLBAR-02：默认停靠左下，向右侧/上方拖动（避免一开始就撞钳制边界）
  await page.mouse.move(heading.x + heading.width / 2, heading.y + heading.height / 2)
  await page.mouse.down()
  await page.mouse.move(heading.x + heading.width / 2 + 120, heading.y + heading.height / 2 - 120, { steps: 8 })
  await page.mouse.up()
  const moved = (await panel(page).boundingBox())!
  expect(Math.abs(moved.x - (before.x + 120))).toBeLessThanOrEqual(6)
  expect(Math.abs(moved.y - (before.y - 120))).toBeLessThanOrEqual(6)

  // 刷新后位置保持（localStorage），且仍在视口内
  await page.reload()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const restored = (await panel(page).boundingBox())!
  expect(Math.abs(restored.x - moved.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(restored.y - moved.y)).toBeLessThanOrEqual(2)

  // 拖出左上/右下越界：被钳制在视口内
  const heading2 = (await page.locator('.drawing-toolbar-heading').boundingBox())!
  await page.mouse.move(heading2.x + 30, heading2.y + 8)
  await page.mouse.down()
  await page.mouse.move(2, 2, { steps: 4 })
  await page.mouse.up()
  const clamped = (await panel(page).boundingBox())!
  expect(clamped.x).toBeGreaterThanOrEqual(0)
  expect(clamped.y).toBeGreaterThanOrEqual(0)
  const height = clamped.height
  expect(clamped.y + height).toBeLessThanOrEqual(900)

  await page.screenshot({ path: evidencePath('toolbar-floating-1440-dark.png') })
  await page.locator('.theme-toggle').click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: evidencePath('toolbar-floating-1440-light.png') })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
})
