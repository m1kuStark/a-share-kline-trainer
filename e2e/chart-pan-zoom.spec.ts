import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// CHART-ZOOM-01（Issue #8-D S 半，用户 2026-11-07 拍板计划）真浏览器回归：
// Ctrl+滚轮缩放（右端锚定，复用键盘 zoomBy 口径）；普通滚轮保持平移；价格轴滚轮保持原生纵轴缩放；
// 新增 Shift+←/→ 平移快捷键（可重复、不与交易/推进/缩放热键冲突），设置面板可见并可改键。
test.setTimeout(180_000)
const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function openChart(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  const response = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02' } })
  expect(response.status()).toBe(201)
  await page.goto('/')
  await expect(page.locator('.training-current-date')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
}

async function viewport(page: Page): Promise<{ from: number; to: number; realFrom: number; realTo: number; count: number; bar: number }> {
  return page.evaluate(() => {
    const hook = (window as any).__trainerChart
    const range = hook.visibleRange()
    return { from: range.from, to: range.to, realFrom: range.realFrom, realTo: range.realTo, count: range.to - range.from, bar: hook.viewportMetrics().bar }
  })
}

test('Ctrl+滚轮缩放/普通滚轮平移/Shift+←→ 平移：方向与右端锚定正确，设置面板可见新动作', async ({ page }: { page: Page }) => {
  await openChart(page)
  const host = (await page.locator('.chart-host').boundingBox())!
  const centerX = host.x + host.width * 0.5, centerY = host.y + host.height * 0.35

  // ① Ctrl+滚轮：向上滚（deltaY<0）放大（同屏根数减少），且右端锚点保持
  await page.mouse.move(centerX, centerY)
  const beforeZoom = await viewport(page)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await viewport(page)).count).toBeLessThan(beforeZoom.count)
  const zoomedIn = await viewport(page)
  // 右端锚定：可见区间整数右界不漂移（右侧空白像素保持，realTo 随柱宽换算变化）
  expect(Math.abs(zoomedIn.to - beforeZoom.to)).toBeLessThanOrEqual(1)
  // Ctrl+滚轮向下滚缩小（同屏根数增加）
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 240)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await viewport(page)).count).toBeGreaterThan(zoomedIn.count)
  const zoomedOut = await viewport(page)
  expect(Math.abs(zoomedOut.to - beforeZoom.to)).toBeLessThanOrEqual(1)

  // ② 普通滚轮仍平移：同屏根数不变；wheel down＝向历史（realTo 减小），wheel up＝回更新（realTo 增大）
  const beforeWheel = await viewport(page)
  await page.mouse.wheel(0, 120)
  await expect.poll(async () => (await viewport(page)).realTo).toBeLessThan(beforeWheel.realTo)
  const wheelOlder = await viewport(page)
  expect(Math.abs(wheelOlder.count - beforeWheel.count)).toBeLessThanOrEqual(1)
  await page.mouse.wheel(0, -120)
  await expect.poll(async () => (await viewport(page)).realTo).toBeGreaterThan(wheelOlder.realTo)

  // ③ Shift+←/→ 平移：同屏根数不变；左移 realTo 减小、右移 realTo 增大（可按住连发）
  const beforePan = await viewport(page)
  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await viewport(page)).realTo).toBeLessThan(beforePan.realTo)
  const panLeft = await viewport(page)
  expect(Math.abs(panLeft.count - beforePan.count)).toBeLessThanOrEqual(1)
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => (await viewport(page)).realTo).toBeGreaterThan(panLeft.realTo)
  const panRight = await viewport(page)
  expect(Math.abs(panRight.count - panLeft.count)).toBeLessThanOrEqual(1)
  await page.keyboard.down('Shift')
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.up('ArrowLeft')
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await viewport(page)).realTo).toBeLessThan(panRight.realTo)

  // ④ 页面帮助文案可见（顶部状态条）
  await expect(page.locator('.shortcut-hint')).toContainText('Shift←→ 平移')

  // ⑤ 设置面板「训练快捷键」可见新动作且可改键
  await page.getByRole('button', { name: '训练默认设置' }).click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '偏好设置' }).click()
  await expect(dialog.getByText('向左平移（查看更早 K 线）')).toBeVisible()
  await expect(dialog.getByText('向右平移（查看更新 K 线）')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()

  // ⑥ 1440/1280 截图与横向溢出红线
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(350)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow, `${size.width}px 宽出现横向溢出`).toBe(false)
    await page.screenshot({ path: evidencePath(`chart-pan-zoom-${size.width}.png`) })
  }
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
})
