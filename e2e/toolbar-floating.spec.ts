import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// UI-TOOLBAR-01（Issue #8 工具栏布局，用户 2026-11-07 拍板）：顶栏「划线」开关打开可拖拽的
// 图形化悬浮工具面板；图标 + hover 中文名称/描述；全部 23 个工具在 1024×680 可达且无需纵向滚动；
// 位置持久化；深浅主题无溢出/遮挡；不改变画线语义与快捷键守恒。
// UI-TOOLBAR-03（用户 2026-11-10 Issue #8）：标题栏固定（pin）按钮锁定面板位置、拖动无效、刷新保持；
// 右下角尺寸手柄在 240–560px 宽、200px–min(85vh, innerHeight−24) 高范围内调整并持久化、双击恢复默认；
// 小尺寸下工具列表按需滚动、23 工具可经滚轮到达、按钮 ≥32×32；窗口缩放后仍钳制在视口内。
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
// 默认 284px 宽必须保持 UI-TOOLBAR-02 冻结的 6 列；收窄/拉宽时列数随宽度变化
async function toolColumns(page: Page): Promise<number> {
  return page.locator('.favorite-tools').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length)
}

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
  // UI-TOOLBAR-03：默认宽 284px 必须保持 UI-TOOLBAR-02 冻结的 6 列外观
  expect(await toolColumns(page), '默认 284px 宽下 6 列').toBe(6)

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

// ===== UI-TOOLBAR-03：固定（pin）与可调宽高（resize） =====
const TOOLBAR_PINNED_KEY = 'trainer.drawToolbar.pinned.v1'
const TOOLBAR_POSITION_KEY = 'trainer.drawToolbar.position.v1'
const TOOLBAR_SIZE_KEY = 'trainer.drawToolbar.size.v1'
const TOOLBAR_MIN_WIDTH = 240
const TOOLBAR_MAX_WIDTH = 560
const TOOLBAR_MIN_HEIGHT = 200

const panelBox = async (page: Page) => (await panel(page).boundingBox())!
const readStorage = (page: Page, key: string) => page.evaluate(key => localStorage.getItem(key), key)
const pinButton = (page: Page) => page.locator('.draw-toolbar').getByRole('button', { name: /固定工具面板/ })
const resizeHandle = (page: Page) => page.locator('.draw-toolbar').getByRole('separator', { name: /尺寸/ })

async function dragHeading(page: Page, dx: number, dy: number): Promise<void> {
  const heading = (await page.locator('.drawing-toolbar-heading').boundingBox())!
  const x = heading.x + 6, y = heading.y + heading.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}
// 尺寸手柄拖动到视口绝对坐标（真实鼠标；pointer capture 后越出面板仍由手柄接管）
async function dragResizeHandleTo(page: Page, targetX: number, targetY: number): Promise<void> {
  const handle = (await resizeHandle(page).boundingBox())!
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(targetX, targetY, { steps: 10 })
  await page.mouse.up()
}
async function setThemeMode(page: Page, mode: 'light' | 'dark'): Promise<void> {
  if (await page.locator('body').evaluate(el => el.classList.contains('dark')) !== (mode === 'dark')) {
    await page.locator('.theme-toggle').click()
    await page.waitForTimeout(250)
  }
}
function expectInViewport(box: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): void {
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
}
// 125% 字体压力场景（既有 UIUX 门禁口径）：仅放大页面字体 token，不改 DOM 结构
async function setTextScale125(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.documentElement, style = getComputedStyle(root)
    const sizes = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'].map(key => [key, parseFloat(style.getPropertyValue(`--font-size-${key}`))] as const)
    for (const [key, size] of sizes) root.style.setProperty(`--font-size-${key}`, `${size * 1.25}px`)
  })
  await page.waitForTimeout(250)
}
async function abandonActive(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
}

test('固定按钮锁定面板位置、标题栏拖动无效且刷新后保持固定态，取消固定恢复拖动与位置记忆', async ({ page }: { page: Page }) => {
  test.setTimeout(240_000)
  const viewport = { width: 1440, height: 900 }
  await page.setViewportSize(viewport)
  await openTraining(page)
  const pin = pinButton(page)
  await expect(pin).toBeVisible()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  const name = await pin.getAttribute('aria-label')
  const title = await pin.getAttribute('title')
  expect(name, '固定按钮 requires 中文名称').toContain('固定')
  expect(title, '固定按钮 requires 中文 title').toContain('固定')

  // 先拖动标题栏产生持久化位置（既有键）
  await dragHeading(page, 120, -100)
  const moved = await panelBox(page)
  expect(moved.x).toBeGreaterThan(20)
  const positionBeforePin = await readStorage(page, TOOLBAR_POSITION_KEY)
  expect(positionBeforePin).not.toBeNull()

  // 固定：aria-pressed＋独立 localStorage 键
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  expect(JSON.parse((await readStorage(page, TOOLBAR_PINNED_KEY)) ?? 'false')).toBe(true)
  expect(await page.locator('.drawing-toolbar-heading').evaluate(el => getComputedStyle(el).cursor)).not.toBe('grab')

  // 固定后标题栏拖动无效：内存位置与持久化都不变
  const locked = await panelBox(page)
  await dragHeading(page, -140, -120)
  const stillLocked = await panelBox(page)
  expect(Math.abs(stillLocked.x - locked.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(stillLocked.y - locked.y)).toBeLessThanOrEqual(1)
  expect(await readStorage(page, TOOLBAR_POSITION_KEY)).toBe(positionBeforePin)

  // 刷新后仍为固定态且位置保持，拖动依旧无效
  await page.reload()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  const restoredPinned = await panelBox(page)
  expect(Math.abs(restoredPinned.x - stillLocked.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(restoredPinned.y - stillLocked.y)).toBeLessThanOrEqual(2)
  await dragHeading(page, 100, 80)
  const stillAfterReload = await panelBox(page)
  expect(Math.abs(stillAfterReload.x - restoredPinned.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(stillAfterReload.y - restoredPinned.y)).toBeLessThanOrEqual(1)

  // 视口缩小后固定态仍钳制在视口内（UIUX-TOOLBAR-PIN）
  await page.setViewportSize({ width: 1024, height: 680 })
  await page.waitForTimeout(250)
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  expectInViewport(await panelBox(page), { width: 1024, height: 680 })

  // 取消固定：恢复正常拖动与位置持久化
  await page.setViewportSize(viewport)
  await page.waitForTimeout(250)
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  expect(JSON.parse((await readStorage(page, TOOLBAR_PINNED_KEY)) ?? 'true')).toBe(false)
  const unlocked = await panelBox(page)
  await dragHeading(page, 90, -70)
  const draggedAfterUnpin = await panelBox(page)
  expect(Math.abs(draggedAfterUnpin.x - (unlocked.x + 90))).toBeLessThanOrEqual(6)
  expect(Math.abs(draggedAfterUnpin.y - (unlocked.y - 70))).toBeLessThanOrEqual(6)
  const positionAfterUnpin = await readStorage(page, TOOLBAR_POSITION_KEY)
  expect(positionAfterUnpin).not.toBe(positionBeforePin)

  // 刷新后取消固定态与位置记忆都恢复
  await page.reload()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  const restoredUnpinned = await panelBox(page)
  expect(Math.abs(restoredUnpinned.x - draggedAfterUnpin.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(restoredUnpinned.y - draggedAfterUnpin.y)).toBeLessThanOrEqual(2)
  await abandonActive(page)
})

test('尺寸手柄在 240–560px 宽、200px–85vh 高范围内调整并持久化，小尺寸下 23 工具经滚动可达、双击恢复默认', async ({ page }: { page: Page }) => {
  test.setTimeout(300_000)
  const viewport = { width: 1440, height: 900 }
  await page.setViewportSize(viewport)
  await openTraining(page)
  const handle = resizeHandle(page)
  await expect(handle).toBeVisible()
  await expect(handle).toHaveAttribute('role', 'separator')
  const handleLabel = await handle.getAttribute('aria-label')
  expect(handleLabel, '尺寸手柄 requires 可访问名称').toContain('尺寸')
  expect(await handle.evaluate(el => getComputedStyle(el).cursor)).toBe('nwse-resize')
  const handleBox = (await handle.boundingBox())!
  expect(handleBox.width).toBeGreaterThanOrEqual(10)
  expect(handleBox.height).toBeGreaterThanOrEqual(10)
  const defaultBox = await panelBox(page)
  expect(defaultBox.width).toBeGreaterThanOrEqual(276)
  expect(defaultBox.width).toBeLessThanOrEqual(292)

  // 面板上移让高度有增长空间（默认贴底，视口底边限制向下拖动距离）
  await dragHeading(page, 120, -420)
  const moved = await panelBox(page)
  // 拖动尺寸手柄向右下增长
  const handleStart = (await handle.boundingBox())!
  await dragResizeHandleTo(page, handleStart.x + handleStart.width / 2 + 140, handleStart.y + handleStart.height / 2 + 100)
  const grown = await panelBox(page)
  expect(Math.abs(grown.width - (moved.width + 140))).toBeLessThanOrEqual(8)
  expect(Math.abs(grown.height - (moved.height + 100))).toBeLessThanOrEqual(8)
  expect(grown.width).toBeLessThanOrEqual(TOOLBAR_MAX_WIDTH + 1)
  const storedSize = JSON.parse((await readStorage(page, TOOLBAR_SIZE_KEY)) ?? 'null')
  expect(storedSize, '尺寸持久化到独立键').not.toBeNull()
  expect(Math.abs(storedSize.width - grown.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(storedSize.height - grown.height)).toBeLessThanOrEqual(2)
  expectInViewport(grown, viewport)

  // 刷新恢复尺寸
  await page.reload()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const restored = await panelBox(page)
  expect(Math.abs(restored.width - grown.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(restored.height - grown.height)).toBeLessThanOrEqual(2)

  // 下界钳制：手柄拖到视口左上 → 240×200
  await dragResizeHandleTo(page, 2, 2)
  const minimum = await panelBox(page)
  expect(minimum.width).toBeGreaterThanOrEqual(TOOLBAR_MIN_WIDTH)
  expect(minimum.width).toBeLessThanOrEqual(TOOLBAR_MIN_WIDTH + 2)
  expect(minimum.height).toBeGreaterThanOrEqual(TOOLBAR_MIN_HEIGHT)
  expect(minimum.height).toBeLessThanOrEqual(TOOLBAR_MIN_HEIGHT + 2)

  // 小尺寸：240px 宽仍为 5 列、无横向溢出；内容区按需纵向滚动，23 个工具仍可经真实滚轮到达，按钮 ≥32×32
  expect(await toolColumns(page), '收窄到 240px 时 5 列').toBe(5)
  const minHorizontal = await page.locator('.draw-toolbar').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(minHorizontal.scroll, '240px 宽面板不得横向溢出').toBeLessThanOrEqual(minHorizontal.client + 1)
  await expect(page.locator('.draw-toolbar [data-tool-name]')).toHaveCount(23)
  const list = page.locator('.toolbar-tool-lists')
  const metrics = await list.evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight, top: el.scrollTop }))
  expect(metrics.scroll, '高度不足时工具列表必须纵向滚动').toBeGreaterThan(metrics.client + 1)
  const segment = (await page.locator('[data-tool-name="segment"]').boundingBox())!
  expect(segment.width).toBeGreaterThanOrEqual(32)
  expect(segment.height).toBeGreaterThanOrEqual(32)
  const listBox = (await list.boundingBox())!
  await page.mouse.move(listBox.x + 12, listBox.y + Math.min(40, listBox.height / 2))
  await page.mouse.wheel(0, 3000)
  await page.waitForTimeout(200)
  const lastTool = page.locator('.other-tools [data-tool-name]').last()
  const lastBox = (await lastTool.boundingBox())!
  expect(lastBox.y).toBeGreaterThanOrEqual(listBox.y - 1)
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1)
  expect(await lastTool.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === el || el.contains(hit) })).toBe(true)

  // 125% 字体压力：仍可经滚动到达全部工具，无横向溢出，按钮 ≥32×32
  await setTextScale125(page)
  const scaledPanel = await panelBox(page)
  const horizontal = await page.locator('.draw-toolbar').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(horizontal.scroll, '125% 字体下面板不得横向溢出').toBeLessThanOrEqual(horizontal.client + 1)
  const scaledList = await list.evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight }))
  expect(scaledList.scroll).toBeGreaterThan(scaledList.client + 1)
  const scaledButton = (await page.locator('[data-tool-name="segment"]').boundingBox())!
  expect(scaledButton.width).toBeGreaterThanOrEqual(32)
  expect(scaledButton.height).toBeGreaterThanOrEqual(32)
  const pinInPanel = (await pinButton(page).boundingBox())!
  expect(pinInPanel.x + pinInPanel.width).toBeLessThanOrEqual(scaledPanel.x + scaledPanel.width + 1)
  const scaledListBox = (await list.boundingBox())!
  await page.mouse.move(scaledListBox.x + 12, scaledListBox.y + Math.min(40, scaledListBox.height / 2))
  await page.mouse.wheel(0, 3000)
  await page.waitForTimeout(200)
  const scaledLast = page.locator('.other-tools [data-tool-name]').last()
  const scaledLastBox = (await scaledLast.boundingBox())!
  expect(scaledLastBox.y + scaledLastBox.height).toBeLessThanOrEqual(scaledListBox.y + scaledListBox.height + 1)

  // 刷新（恢复字体）后尺寸仍被记住；双击手柄恢复默认尺寸并清除尺寸键
  await page.reload()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const restoredMinimum = await panelBox(page)
  expect(Math.abs(restoredMinimum.width - minimum.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(restoredMinimum.height - minimum.height)).toBeLessThanOrEqual(2)
  const resetHandle = (await resizeHandle(page).boundingBox())!
  await page.mouse.dblclick(resetHandle.x + resetHandle.width / 2, resetHandle.y + resetHandle.height / 2)
  await page.waitForTimeout(150)
  const resetBox = await panelBox(page)
  expect(Math.abs(resetBox.width - defaultBox.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(resetBox.height - defaultBox.height)).toBeLessThanOrEqual(3)
  expect(await readStorage(page, TOOLBAR_SIZE_KEY)).toBeNull()
  await page.reload()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  expect(Math.abs((await panelBox(page)).width - defaultBox.width)).toBeLessThanOrEqual(2)

  // 上界钳制：面板移到顶部后拉到视口右下 → 560 × min(85vh, innerHeight−24)
  await dragHeading(page, 0, -800)
  await dragResizeHandleTo(page, viewport.width - 2, viewport.height - 2)
  const maximum = await panelBox(page)
  expect(maximum.width).toBeGreaterThanOrEqual(TOOLBAR_MAX_WIDTH - 1)
  expect(maximum.width).toBeLessThanOrEqual(TOOLBAR_MAX_WIDTH + 1)
  const maxHeight = Math.min(viewport.height * 0.85, viewport.height - 24)
  expect(maximum.height).toBeGreaterThanOrEqual(maxHeight - 2)
  expect(maximum.height).toBeLessThanOrEqual(maxHeight + 1)
  expectInViewport(maximum, viewport)
  const maxStored = JSON.parse((await readStorage(page, TOOLBAR_SIZE_KEY)) ?? 'null')
  expect(Math.abs(maxStored.width - TOOLBAR_MAX_WIDTH)).toBeLessThanOrEqual(1)
  expect(Math.abs(maxStored.height - maxHeight)).toBeLessThanOrEqual(2)

  // 窗口 resize 后尺寸与位置仍钳制在视口内
  await page.setViewportSize({ width: 1024, height: 680 })
  await page.waitForTimeout(250)
  const shrunk = await panelBox(page)
  expect(shrunk.width).toBeLessThanOrEqual(TOOLBAR_MAX_WIDTH + 1)
  expect(shrunk.height).toBeLessThanOrEqual(Math.min(680 * 0.85, 680 - 24) + 1)
  expectInViewport(shrunk, { width: 1024, height: 680 })

  // 最大宽度下列数随宽度增加，按钮命中区仍 ≥32×32
  expect(await toolColumns(page), '拉宽到 560px 时 12 列').toBe(12)
  const wideButton = (await page.locator('[data-tool-name="segment"]').boundingBox())!
  expect(wideButton.width).toBeGreaterThanOrEqual(32)
  expect(wideButton.height).toBeGreaterThanOrEqual(32)

  // 固定态下双击尺寸手柄仍恢复默认尺寸（pin 不得阻断复位；真实鼠标双击）
  await pinButton(page).click()
  await expect(pinButton(page)).toHaveAttribute('aria-pressed', 'true')
  const pinnedHandle = (await resizeHandle(page).boundingBox())!
  await page.mouse.dblclick(pinnedHandle.x + pinnedHandle.width / 2, pinnedHandle.y + pinnedHandle.height / 2)
  await page.waitForTimeout(200)
  const pinnedReset = await panelBox(page)
  expect(Math.abs(pinnedReset.width - defaultBox.width), '固定态双击仍恢复默认宽度').toBeLessThanOrEqual(2)
  expect(Math.abs(pinnedReset.height - defaultBox.height), '固定态双击仍恢复默认高度').toBeLessThanOrEqual(3)
  expect(await readStorage(page, TOOLBAR_SIZE_KEY), '固定态双击仍清除尺寸键').toBeNull()
  await expect(pinButton(page)).toHaveAttribute('aria-pressed', 'true')
  await abandonActive(page)
})

test('固定与尺寸在 1024×680 / 1366×705 / 1440×900 深浅主题下刷新恢复并截图', async ({ page }: { page: Page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1024, height: 680 })
  await openTraining(page)
  const viewports = [{ width: 1024, height: 680 }, { width: 1366, height: 705 }, { width: 1440, height: 900 }]
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const mode of ['light', 'dark'] as const) {
      await setThemeMode(page, mode)
      await page.evaluate(keys => keys.forEach(key => localStorage.removeItem(key)), [TOOLBAR_PINNED_KEY, TOOLBAR_POSITION_KEY, TOOLBAR_SIZE_KEY])
      await page.reload()
      await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
      await expect(panel(page)).toBeVisible()
      const pin = pinButton(page)
      // 固定态：视口内、刷新后保持
      await pin.click()
      await expect(pin).toHaveAttribute('aria-pressed', 'true')
      const pinned = await panelBox(page)
      expectInViewport(pinned, viewport)
      await page.screenshot({ path: evidencePath(`toolbar-pin-${viewport.width}x${viewport.height}-${mode}.png`) })
      await page.reload()
      await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
      await expect(pin).toHaveAttribute('aria-pressed', 'true')
      const restoredPin = await panelBox(page)
      expect(Math.abs(restoredPin.x - pinned.x)).toBeLessThanOrEqual(2)
      expect(Math.abs(restoredPin.y - pinned.y)).toBeLessThanOrEqual(2)
      expectInViewport(restoredPin, viewport)
      // 取消固定 → 调宽高 → 刷新恢复
      await pin.click()
      await expect(pin).toHaveAttribute('aria-pressed', 'false')
      const before = await panelBox(page)
      const handle = (await resizeHandle(page).boundingBox())!
      const targetX = Math.min(viewport.width - 2, handle.x + handle.width / 2 + 96)
      const targetY = Math.min(viewport.height - 2, handle.y + handle.height / 2 + 72)
      await dragResizeHandleTo(page, targetX, targetY)
      const resized = await panelBox(page)
      expect(resized.width).toBeGreaterThan(before.width + 40)
      expect(resized.width).toBeLessThanOrEqual(TOOLBAR_MAX_WIDTH + 1)
      expect(resized.height).toBeLessThanOrEqual(Math.min(viewport.height * 0.85, viewport.height - 24) + 1)
      expectInViewport(resized, viewport)
      // 不覆盖右侧交易面板（图表价格轴关键区域在图表右缘）
      const trade = (await page.locator('.trade-panel').boundingBox())!
      expect(resized.x + resized.width).toBeLessThanOrEqual(trade.x + 1)
      await page.screenshot({ path: evidencePath(`toolbar-resize-${viewport.width}x${viewport.height}-${mode}.png`) })
      await page.reload()
      await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
      const restoredSize = await panelBox(page)
      expect(Math.abs(restoredSize.width - resized.width)).toBeLessThanOrEqual(2)
      expect(Math.abs(restoredSize.height - resized.height)).toBeLessThanOrEqual(2)
      expectInViewport(restoredSize, viewport)
      const stored = JSON.parse((await readStorage(page, TOOLBAR_SIZE_KEY)) ?? 'null')
      expect(Math.abs(stored.width - resized.width)).toBeLessThanOrEqual(2)
      expect(Math.abs(stored.height - resized.height)).toBeLessThanOrEqual(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
      // 刷新恢复后的尺寸/固定态截图（与拖动前状态同源，作为「刷新恢复」证据）
      await page.screenshot({ path: evidencePath(`toolbar-restored-${viewport.width}x${viewport.height}-${mode}.png`) })
    }
  }
  await abandonActive(page)
})
