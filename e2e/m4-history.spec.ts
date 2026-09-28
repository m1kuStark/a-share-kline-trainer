// M4-HISTORY-01 历史成绩单 e2e：真实隔离服务＋真实样本数据（600519/300857）。
// 覆盖冻结合同主链（真实用户动作，不用 API 替代关键路径）：
// 真实结算按钮结算一局 → 历史训练入口 → 稳定排序列表与分类 → 只读事实成绩单
// （初始/最终权益、收益率、逐笔成交、已保存权益曲线、画线清单）→ 返回；
// 空列表返回创建；运行中守卫提示；放弃不入列表；详情 A→B 迟到响应不覆盖；
// 深/浅 1440/840 截图与 pageerror 0。
import { startTrainingFromForm } from './training-flow'
import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 940 } })

async function resetToLauncher(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  await page.waitForTimeout(400)
  await expect(page.getByRole('button', { name: '开始训练' })).toBeVisible()
}

async function createTrainingFromForm(page: Page, code: string): Promise<void> {
  await resetToLauncher(page)
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill(code)
  await page.getByRole('button', { name: new RegExp(`${code}`) }).click()
  await page.getByRole('button', { name: '3个月' }).click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  await expect(page.locator('.training-meta')).toContainText('时长 3个月')
}

async function waitRecordingReady(page: Page): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: '正在记录' })).toBeVisible()
  await expect(page.locator('.training-grid')).not.toHaveAttribute('inert', '')
}

// ---------- 真实画线（与 journey.spec 相同的受信任事件路径） ----------
async function screenPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x, y }) => {
    const chart = (window as any).__trainerChart
    const host = document.querySelector('.chart-host')!.getBoundingClientRect()
    const panes = chart.panes()
    const reference = y < 656 ? { index: 0, top: 266, height: 389 }
      : y < 757 ? { index: 1, top: 656, height: 100 }
        : { index: 2, top: 757, height: 100 }
    const pane = panes[reference.index]
    const mainWidth = chart.viewportMetrics().width
    return {
      x: host.left + (x >= 1035 ? mainWidth + (pane.width - mainWidth) / 2 : (x - 107) / (1035 - 107) * mainWidth),
      y: host.top + pane.top + (y - reference.top) / reference.height * pane.height,
    }
  }, { x, y })
}
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const point = await screenPoint(page, x, y)
  await page.mouse.click(point.x, point.y)
}
function toolButton(page: Page, label: string): ReturnType<Page['locator']> {
  return page.locator('.draw-toolbar button').filter({ has: page.locator(`text="${label}"`) })
}
async function drawSegment(page: Page): Promise<void> {
  await page.locator('.console-scroll').evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight })
  if (!await toolButton(page, '线段').isVisible()) await page.locator('.other-tools-toggle').click()
  await toolButton(page, '线段').click()
  await expect(page.locator('.status-strip')).toContainText('画线模式：线段')
  await page.waitForTimeout(300)
  await clickAt(page, 300, 400)
  await page.waitForTimeout(650)
  await clickAt(page, 700, 350)
  await page.waitForTimeout(400)
  await expect.poll(() => page.evaluate(() => (window as any).__trainerChart.mode().draw)).toBeNull()
  // 画线持久化完成（防"已保存"之前结算导致画线缺失）
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存', { timeout: 15_000 })
}

// ---------- 真实交易与结算 ----------
async function buyAll(page: Page): Promise<void> {
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('买入成交')
}
async function advanceDays(page: Page, days: number): Promise<void> {
  for (let index = 0; index < days; index += 1) {
    await page.getByRole('button', { name: '推进下一日' }).click()
    await expect(page.getByRole('button', { name: '推进下一日' })).toBeEnabled({ timeout: 15_000 })
  }
}
async function settleThroughButtons(page: Page): Promise<void> {
  await page.getByRole('button', { name: '提前结算', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '结束训练' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '确认结算', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '训练结算' })).toBeVisible()
}

// rail「训练」按钮的可达名是「⌁ 训练」（图标+文本），按 .rail-item 内精确文本定位
function railTrainingButton(page: Page): ReturnType<Page['locator']> {
  return page.locator('.rail-item').filter({ has: page.locator('text="训练"') })
}

test('空历史：列表空态可返回创建训练', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetToLauncher(page)
  await page.getByRole('button', { name: '历史训练' }).click()
  await expect(page.getByRole('region', { name: '历史训练' })).toBeVisible()
  await expect(page.getByText('暂无已结算训练')).toBeVisible()
  await page.getByRole('button', { name: '返回创建训练' }).click()
  await expect(page.getByRole('heading', { name: '创建训练' })).toBeVisible()
  expect(errors).toEqual([])
})

test('结算→历史列表→事实成绩单→返回（深色1440）', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createTrainingFromForm(page, '600519')
  await waitRecordingReady(page)
  await drawSegment(page)
  await buyAll(page)
  await advanceDays(page, 2)
  await settleThroughButtons(page)

  // 结算面板提供进入历史的最小入口：真实点击进入历史训练
  await page.getByRole('button', { name: '查看历史成绩单' }).click()
  const history = page.getByRole('region', { name: '历史训练' })
  await expect(history).toBeVisible()
  await expect(history.getByText('历史训练', { exact: true })).toBeVisible()

  // 列表：稳定排序与分类；单页时上一页/下一页不可用
  const rows = history.locator('.history-row')
  await expect(rows).toHaveCount(1)
  const row = rows.first()
  await expect(row).toContainText('600519')
  await expect(row).toContainText('提前结算')
  await expect(history.getByRole('button', { name: '上一页' })).toBeDisabled()
  await expect(history.getByRole('button', { name: '下一页' })).toBeDisabled()
  await page.screenshot({ path: evidencePath('m4-history-list-dark-1440.png'), fullPage: true })

  // 详情：只读事实成绩单
  await row.click()
  const report = page.getByRole('region', { name: '成绩单' })
  await expect(report).toBeVisible()
  await expect(report.getByText('600519').first()).toBeVisible()
  await expect(report.getByText('提前结算').first()).toBeVisible()
  await expect(report.getByText('¥1,000,000').first()).toBeVisible()
  await expect(report.getByText('逐笔成交')).toBeVisible()
  await expect(report.locator('.report-trade-row')).toHaveCount(1)
  await expect(report.locator('.report-trade-row').first()).toContainText('买入')
  await expect(report.getByText('已保存权益曲线')).toBeVisible()
  await expect(report.locator('svg.equity-curve-svg')).toBeVisible()
  await expect(report.getByText('画线标注')).toBeVisible()
  await expect(report.locator('.report-drawing-item')).toHaveCount(1)
  await expect(report.locator('.report-drawing-item').first()).toContainText('线段')
  await expect(report.locator('.report-drawing-item').first()).toContainText('主图')
  // 金额不出现 NaN/undefined
  const reportText = await report.innerText()
  expect(reportText).not.toContain('NaN')
  expect(reportText).not.toContain('undefined')
  await page.screenshot({ path: evidencePath('m4-history-report-dark-1440.png'), fullPage: true })
  // 详情是内部滚动容器（history-page 与内层 report-page 各自滚动）：都滚到底补拍画线标注区块
  async function scrollReportToBottom(): Promise<void> {
    for (const selector of ['.history-page', '.report-page']) {
      await page.locator(selector).evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight })
    }
    await page.waitForTimeout(200)
  }
  await scrollReportToBottom()
  await page.screenshot({ path: evidencePath('m4-history-report-drawings-dark-1440.png'), fullPage: true })

  // 返回列表 → 录像库 → 训练入口仍可用（结算时 URL 带 ?training=N，训练入口回到该局只读视图）
  await report.getByRole('button', { name: '返回历史列表' }).click()
  await expect(history).toBeVisible()
  await page.getByRole('button', { name: '训练录像' }).click()
  await expect(page.getByRole('heading', { name: '训练录像' })).toBeVisible()
  await railTrainingButton(page).click()
  await expect(page.locator('.training-topbar')).toBeVisible()
  expect(errors).toEqual([])
})

test('运行中守卫与放弃不入列表（浅色840）', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createTrainingFromForm(page, '600519')
  await waitRecordingReady(page)
  const runningId = (await (await page.request.get('/api/trainings/active')).json()).training.id

  // 运行中打开历史：守卫提示、零历史内容，可返回当前训练
  await page.getByRole('button', { name: '切换到浅色主题' }).click()
  await page.getByRole('button', { name: '历史训练' }).click()
  const history = page.getByRole('region', { name: '历史训练' })
  await expect(history).toBeVisible()
  await expect(history.getByText('结束当前训练后可查看历史')).toBeVisible()
  await expect(history.locator('.history-row')).toHaveCount(0)
  await page.setViewportSize({ width: 840, height: 900 })
  await page.screenshot({ path: evidencePath('m4-history-guard-light-840.png'), fullPage: true })
  await railTrainingButton(page).click()
  await expect(page.locator('.training-topbar')).toBeVisible()

  // 放弃（清理约定走 API）：不入历史列表，原已结算行不受影响
  await page.request.post(`/api/trainings/${runningId}/abandon`)
  await page.getByRole('button', { name: '历史训练' }).click()
  await expect(history.locator('.history-row')).toHaveCount(1)
  await expect(history.locator('.history-row').first()).not.toContainText('放弃')

  // 浅色 840：详情成绩单可用
  await history.locator('.history-row').first().click()
  const report = page.getByRole('region', { name: '成绩单' })
  await expect(report).toBeVisible()
  await expect(report.getByText('逐笔成交')).toBeVisible()
  await page.screenshot({ path: evidencePath('m4-history-report-light-840.png'), fullPage: true })
  for (const selector of ['.history-page', '.report-page']) {
    await page.locator(selector).evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight })
  }
  await page.waitForTimeout(200)
  await page.screenshot({ path: evidencePath('m4-history-report-drawings-light-840.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('详情A→B迟到响应不覆盖、不留永续loading；列表按settle_date DESC稳定排序', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createTrainingFromForm(page, '300857')
  await waitRecordingReady(page)
  await buyAll(page)
  await settleThroughButtons(page)
  await page.getByRole('button', { name: '查看历史成绩单' }).click()
  const history = page.getByRole('region', { name: '历史训练' })
  const rows = history.locator('.history-row')
  await expect(rows).toHaveCount(2)
  // 稳定排序：600519（结算日更晚）在前，300857（刚创建即结算）在后
  await expect(rows.first()).toContainText('600519')

  const idOld = (await (await page.request.get('/api/trainings/history')).json()).items[0].id
  let blockedA = 0
  await page.route(`**/api/trainings/${idOld}/report`, async route => {
    blockedA += 1
    await new Promise(resolve => setTimeout(resolve, 1500))
    await route.continue()
  })
  // 先点旧行 A（响应被延迟），立刻切到新行 B：B 正常呈现
  await rows.first().click()
  await rows.nth(1).click()
  const report = page.getByRole('region', { name: '成绩单' })
  await expect(report.getByText('300857').first()).toBeVisible({ timeout: 10_000 })
  // 释放 A 的迟到响应：界面仍是 B，且不留下永续 loading
  await page.waitForTimeout(2500)
  expect(blockedA).toBeGreaterThan(0)
  await expect(report.getByText('300857').first()).toBeVisible()
  await expect(report.getByText('600519')).toHaveCount(0)
  const reportText = await report.innerText()
  expect(reportText).not.toContain('NaN')
  expect(reportText).not.toContain('undefined')
  await page.unroute(`**/api/trainings/${idOld}/report`)
  expect(errors).toEqual([])
})
