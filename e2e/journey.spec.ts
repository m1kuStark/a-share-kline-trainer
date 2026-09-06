import { expect, test } from '@playwright/test'

// Playwright 用户旅程（真实受信任事件，与用户输入同构）。
// 本文件当前含 Act 1（训练闭环）与 Act 5（交易与周期）；Act 2/3/4/6 在后续提交追加。
test.describe.configure({ mode: 'serial' })

// 重试/复跑时临时库中可能残留上次的活动训练（库随 global-setup 只建一次）：
// 直接调 API 放弃残留训练（UI confirm 弹窗的自动 dismiss 会吞掉放弃流程），保证从启动页开始。
async function resetToLauncher(page: import('@playwright/test').Page): Promise<void> {
  const base = 'http://127.0.0.1:8791'
  const active = await page.evaluate(async base => {
    const r = await fetch(`${base}/api/trainings/active`)
    return (await r.json()).training
  }, base)
  if (active) await page.evaluate(([base, id]) => fetch(`${base}/api/trainings/${id}/abandon`, { method: 'POST' }), [base, active.id])
  await page.goto('/')
  await page.waitForTimeout(400)
  await expect(page.getByRole('button', { name: '开始训练' })).toBeVisible()
}

test('Act1 创建训练并进入训练视图', async ({ page }) => {
  await resetToLauncher(page)
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill('600519')
  await page.getByRole('button', { name: /600519 贵州茅台/ }).click()
  await page.getByRole('button', { name: '3个月' }).click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect(page.locator('.training-meta')).toContainText('时长 3个月')
  // 工具条与多选开关就绪
  await expect(page.locator('.draw-toolbar button', { hasText: '线段' })).toBeVisible()
  await expect(page.locator('.draw-toolbar button', { hasText: '射线' })).toBeVisible()
  await expect(page.locator('.draw-toolbar button', { hasText: '直线' })).toBeVisible()
  await expect(page.locator('.draw-toolbar button', { hasText: '多选' })).toBeVisible()
  // 模式机初始状态
  const mode = await page.evaluate(() => (window as any).__trainerChart.mode())
  expect(mode).toEqual({ draw: null, multiSelect: false, axisScaleDrag: false })
})

test('Act5 买入推进卖出结算', async ({ page }) => {
  await resetToLauncher(page)
  // 重建训练（serial 顺序在 Act1 之后，库中状态由 Act5 前置步骤决定）
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill('600519')
  await page.getByRole('button', { name: /600519 贵州茅台/ }).click()
  await page.getByRole('button', { name: '3个月' }).click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect(page.locator('.training-meta')).toContainText('时长 3个月')
  // B 买入：B/S 标记 overlay 出现（引擎标记不可选中，不在多选集合）。
  // 注意：expect(promise).resolves 不做重试，此处成交→快照刷新→refreshMarks 有异步链，改轮询断言
  await page.keyboard.press('b')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.overlayCount('bsMark')), { timeout: 5000 }).toBe(1)
  // Space 推进：当前日期前进
  const metaBefore = await page.locator('.training-meta').innerText()
  await page.keyboard.press('Space')
  await expect(page.locator('.training-meta')).not.toHaveText(metaBefore)
  // S 卖出
  await page.keyboard.press('s')
  // 提前结算 → 结算面板 → 返回首页
  await page.getByRole('button', { name: '提前结算' }).click()
  await expect(page.locator('.settle-panel')).toBeVisible()
  await page.getByRole('button', { name: '完成，返回首页' }).click()
  await expect(page.getByRole('heading', { name: '创建训练' })).toBeVisible()
})
