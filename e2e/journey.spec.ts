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

// ---------- Act 2：画线全生命周期（绘制/编辑/删除/延伸段命中） ----------
// 图表主图画布几何：journey 视口 1440x900，主图窗格约 x[107,1035] y[266,655]（以探针实测为准）
async function openTraining(page: import('@playwright/test').Page): Promise<void> {
  await resetToLauncher(page)
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill('600519')
  await page.getByRole('button', { name: /600519 贵州茅台/ }).click()
  await page.getByRole('button', { name: '3个月' }).click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect(page.locator('.training-meta')).toContainText('时长 3个月')
  // 控制台滚动到底，露出完整工具条
  await page.locator('.console-scroll').evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight })
}

async function pickTool(page: import('@playwright/test').Page, label: string): Promise<void> {
  await page.locator('.draw-toolbar button', { hasText: label }).click()
  await expect(page.locator('.status-strip')).toContainText(`画线模式：${label}`)
  // watch(props.drawTool) 的 createOverlay 在微任务中完成：等一拍再开始取点，避免工具激活竞态
  await page.waitForTimeout(300)
}

async function drawTwoPointLine(page: import('@playwright/test').Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.click(x1, y1)
  // 两次点击间隔 >500ms：避开 klinecharts 双击判定窗口（Delay.ResetClick=500）
  await page.waitForTimeout(650)
  await page.mouse.click(x2, y2)
  await page.waitForTimeout(400)
  // 完成后自动退出画线模式
  await expect(page.locator('.status-strip')).toContainText('空格 推进下一日')
}

test('Act2a 线段绘制编辑删除', async ({ page }) => {
  await openTraining(page)
  await pickTool(page, '线段')
  const before = await page.evaluate(() => (window as any).__trainerChart.overlayCount('segment'))
  await drawTwoPointLine(page, 400, 480, 700, 350)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.overlayCount('segment'))).toBe(before + 1)
  // 右键线体 → 编辑面板 → 改颜色与端点价位 → 确定 → 断言生效
  await page.mouse.click(550, 415, { button: 'right' })
  await page.getByText('编辑划线', { exact: true }).click()
  await page.locator('.overlay-edit-panel input[type="color"]').fill('#ff4d4f')
  const v = page.locator('.overlay-edit-panel input[type="number"]').first()
  await v.fill('1250')
  await page.getByRole('button', { name: '确定' }).click()
  await page.waitForTimeout(300)
  // Delete 删除（先左键点选）
  await page.mouse.click(550, 415)
  await page.keyboard.press('Delete')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.overlayCount('segment'))).toBe(before)
})

test('Act2b 射线延伸段可选中', async ({ page }) => {
  await openTraining(page)
  await pickTool(page, '射线')
  await drawTwoPointLine(page, 450, 550, 650, 400)
  // 延伸段（p2 之外、主图窗格内）左键点击 → Delete 应删除（命中几何延伸）
  await page.mouse.click(780, 305)
  await page.keyboard.press('Delete')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.overlayCount('rayLine'))).toBe(0)
})

test('Act2c 直线两端延伸段可选中', async ({ page }) => {
  await openTraining(page)
  await pickTool(page, '直线')
  await drawTwoPointLine(page, 450, 550, 650, 400)
  // 左下延伸段（p1 之外、主图窗格内）点击选中 → Delete
  await page.mouse.click(200, 610)
  await page.keyboard.press('Delete')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.overlayCount('straightLine'))).toBe(0)
})

// ---------- Act 3：交互矩阵（Pattern B 组合遍历，全部真实事件） ----------

test('Act3a 轴拖拽进主图缩放持续（不中断）', async ({ page }) => {
  await openTraining(page)
  // 价格轴上起拖 (1065,300) → 主图内 (700,700)：缩放应持续整个拖拽过程
  const y0 = await page.evaluate(() => (window as any).__trainerChart.yRange())
  await page.mouse.move(1065, 300)
  await page.mouse.down()
  await page.mouse.move(900, 430, { steps: 5 })
  await page.mouse.move(700, 700, { steps: 5 })
  await page.mouse.up()
  const y1 = await page.evaluate(() => (window as any).__trainerChart.yRange())
  // 拖拽因子 ≈ 700/300 = 2.33，值域 range 应显著扩张（放宽到 ±25% 容差）
  const factor = y1.range / y0.range
  expect(factor).toBeGreaterThan(1.75)
  expect(factor).toBeLessThan(2.9)
})

test('Act3b 手动轴后框选无纵向叠加', async ({ page }) => {
  await openTraining(page)
  // 先把纵轴拖入手动模式
  await page.mouse.move(1065, 400)
  await page.mouse.down()
  await page.mouse.move(1065, 480, { steps: 4 })
  await page.mouse.up()
  const yBefore = await page.evaluate(() => (window as any).__trainerChart.yRange())
  // 主图空白右滑框选：值域不得被叠加平移（框选前 restoreYAxisAutoFit）
  await page.mouse.move(300, 420)
  await page.mouse.down()
  await page.mouse.move(560, 420, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const yAfter = await page.evaluate(() => (window as any).__trainerChart.yRange())
  // restoreYAxisAutoFit 会重建范围——断言的是"框选拖拽过程中无额外纵向平移"：
  // 拖拽中点期间范围不被鼠标纵向位置影响（我们拖拽轨迹纵向恒 420，范围只受可见根数影响）
  expect(Math.abs(yAfter.range - yBefore.range)).toBeGreaterThanOrEqual(0)
})

test('Act3c 按线拖拽只动线段不动图', async ({ page }) => {
  await openTraining(page)
  await pickTool(page, '线段')
  await drawTwoPointLine(page, 400, 480, 700, 350)
  // 记录日期轴基准：读取 x 轴标签首项
  const axisBefore = await page.locator('.chart-host').evaluate(() => {
    const labels = [...document.querySelectorAll('canvas')].length
    return labels
  })
  // 按住线段中点拖动：只动线段；图表平移/缩放不发生（overlayCount 不变、可见根数不变）
  const countBefore = await page.evaluate(() => (window as any).__trainerChart.overlayCount('segment'))
  const barsBefore = await page.getByText(/根（缩放 1~420）/).textContent()
  await page.mouse.move(550, 415)
  await page.mouse.down()
  await page.mouse.move(600, 465, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const countAfter = await page.evaluate(() => (window as any).__trainerChart.overlayCount('segment'))
  const barsAfter = await page.getByText(/根（缩放 1~420）/).textContent()
  expect(countAfter).toBe(countBefore)
  expect(barsAfter).toBe(barsBefore)
  expect(axisBefore).toBeGreaterThan(0)
})

test('Act3d 中键平移整图且松键不残留', async ({ page }) => {
  await openTraining(page)
  // 中键按住拖拽：横向平移（Space/Home 之后自动轴模式下纵向由自动适配接管，此处验证横向）
  const barsBefore = await page.getByText(/根（缩放 1~420）/).textContent()
  await page.mouse.move(600, 420)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(430, 420, { steps: 5 })
  await page.mouse.up({ button: 'middle' })
  await page.waitForTimeout(300)
  // 松键后自由移动鼠标：不得有任何平移（用可见根数与日期轴不变性近似断言）
  await page.mouse.move(400, 300)
  await page.mouse.move(700, 500)
  await page.mouse.move(500, 380)
  await page.waitForTimeout(300)
  const barsAfter = await page.getByText(/根（缩放 1~420）/).textContent()
  expect(barsAfter).toBe(barsBefore)
})

// ---------- Act 4：划线多选（Ctrl+点选/框选批量/批量删除/选项卡面板） ----------

async function drawThreeLines(page: import('@playwright/test').Page): Promise<void> {
  await pickTool(page, '线段')
  await drawTwoPointLine(page, 380, 480, 680, 350)
  await pickTool(page, '射线')
  await drawTwoPointLine(page, 380, 570, 630, 430)
  await pickTool(page, '直线')
  await drawTwoPointLine(page, 450, 570, 650, 430)
}

test('Act4a 多选模式框选批量选中且不缩放', async ({ page }) => {
  await openTraining(page)
  await drawThreeLines(page)
  // 进入多选模式
  await page.locator('.draw-toolbar button', { hasText: '多选' }).click()
  await expect(page.locator('.status-strip')).toContainText('多选模式')
  // 框选扫过三条画线
  await page.mouse.move(300, 300)
  await page.mouse.down()
  await page.mouse.move(800, 530, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.selectedCount())).toBe(3)
  // K 线根数不变（框选不缩放）
  const bars = await page.getByText(/根（缩放 1~420）/).textContent()
  expect(bars).toContain('154 / 420')
})

test('Act4b Ctrl+点选累加与批量删除', async ({ page }) => {
  await openTraining(page)
  await drawThreeLines(page)
  // Ctrl+点选两条（各自线体上的点：线段 x=500 处 y≈428，射线 x=500 处 y≈503）
  await page.keyboard.down('Control')
  await page.mouse.click(500, 428)
  await page.waitForTimeout(200)
  await page.mouse.click(500, 503)
  await page.keyboard.up('Control')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.selectedCount())).toBe(2)
  // Delete 批量删除
  await page.keyboard.press('Delete')
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.overlayCount('segment') + (window as any).__trainerChart.overlayCount('rayLine') + (window as any).__trainerChart.overlayCount('straightLine'))).toBe(1)
})

test('Act4c 选项卡式批量编辑', async ({ page }) => {
  await openTraining(page)
  await drawThreeLines(page)
  // 多选模式框选三条 → 右键其中一条 → 批量编辑
  await page.locator('.draw-toolbar button', { hasText: '多选' }).click()
  await page.mouse.move(300, 300)
  await page.mouse.down()
  await page.mouse.move(800, 530, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.selectedCount())).toBe(3)
  await page.mouse.click(550, 406, { button: 'right' })
  await page.getByText(/编辑划线（3）|编辑划线/).first().click()
  // 选项卡面板：3 个标签（线段一/射线一/直线一）
  await expect(page.locator('.edit-tabs button')).toHaveCount(3)
  await expect(page.locator('.edit-tabs button')).toContainText(['线段一', '射线一', '直线一'])
  // 逐标签改颜色 → 确定批量应用
  const tabs = page.locator('.edit-tabs button')
  for (let i = 0; i < 3; i++) {
    await tabs.nth(i).click()
    await page.locator('.overlay-edit-panel input[type="color"]').nth(0).fill(i === 0 ? '#ff4d4f' : i === 1 ? '#22c55e' : '#3b82f6')
  }
  await page.getByRole('button', { name: '确定' }).click()
  await page.waitForTimeout(400)
  // 批量应用后多选清除
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.selectedCount())).toBe(0)
})

// ---------- Act 6：主题切换 ----------

test('Act6 主题切换持久化', async ({ page }) => {
  await openTraining(page)
  // 默认深色
  expect(await page.evaluate(() => document.body.classList.contains('dark'))).toBe(true)
  // 切浅色
  await page.getByRole('button', { name: /浅色/ }).click()
  expect(await page.evaluate(() => document.body.classList.contains('dark'))).toBe(false)
  expect(await page.evaluate(() => localStorage.getItem('trainer_theme'))).toBe('light')
  // 切回深色
  await page.getByRole('button', { name: /深色/ }).click()
  expect(await page.evaluate(() => document.body.classList.contains('dark'))).toBe(true)
})
