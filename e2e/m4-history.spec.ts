// M4-HISTORY-01 历史成绩单 e2e：真实隔离服务＋真实样本数据（600519/300857）。
// 覆盖冻结合同主链（真实用户动作，不用 API 替代关键用户路径）：
// 真实结算按钮结算一局 → 历史训练入口 → 按本局 id 定位列表行（分类/事实）→ 只读事实成绩单
// （初始/最终权益、收益率、逐笔成交、已保存权益曲线、画线清单）→ 返回；
// 加载三态真实延迟门闩（FM-015/F2）；运行中守卫提示；放弃不入列表；详情 A→B 迟到响应不覆盖；
// 深/浅 1440/840 截图与 pageerror 0。
// 共享库约定（FM-015/F1）：完整 Journey 共用同一隔离 SQLite，前序 spec 可能留下 settled 记录；
// 历史列表断言一律按本局创建的 training id 定位（data-training-id），不作绝对行数假设。
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

/** 表单创建训练并返回本局 id（后续一切历史断言按此 id 定位自己的行）。 */
async function createTrainingFromForm(page: Page, code: string): Promise<number> {
  await resetToLauncher(page)
  const created = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/trainings', { timeout: 30_000 })
  // UI-03 双框选股（Launcher.vue 代码框 placeholder＝『股票代码，如 600519』）：填精确代码，
  // 250ms 去抖后精确命中自动选中（『已选：』提示），无需点击建议按钮——旧单框流程已不存在。
  await page.getByPlaceholder('股票代码，如 600519').fill(code)
  await expect(page.getByText(/已选：/)).toBeVisible()
  await page.getByRole('button', { name: '3个月' }).click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  await expect(page.locator('.training-meta')).toContainText('时长 3个月')
  const payload = await (await created).json()
  return payload.training.id
}

async function fetchHistory(page: Page): Promise<{ total: number; items: Array<{ id: number; code: string }> }> {
  return (await (await page.request.get('/api/trainings/history')).json())
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

test('历史页加载三态与错误重试（真实延迟门闩，FM-015/F2）', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await resetToLauncher(page)
  // 真实服务响应挂起门闩：fetch 真实数据后延迟释放，不伪造内容
  let historyRequests = 0
  await page.route(url => url.pathname === '/api/trainings/history', async route => {
    historyRequests += 1
    const response = await route.fetch()
    await new Promise(resolve => setTimeout(resolve, 3000))
    await route.fulfill({ response })
  })
  const total = (await fetchHistory(page)).total
  await page.getByRole('button', { name: '历史训练' }).click()
  const history = page.getByRole('region', { name: '历史训练' })
  await expect(history).toBeVisible()

  // 挂起期间：只允许加载态；空态/列表/分页不得出现
  await expect(history.locator('.history-loading')).toBeVisible()
  expect(historyRequests).toBeGreaterThanOrEqual(1)
  await expect(history.getByText('暂无已结算训练')).not.toBeVisible()
  await expect(history.locator('.history-row')).toHaveCount(0)
  await expect(history.getByRole('button', { name: '上一页' })).not.toBeVisible()
  await expect(history.getByRole('button', { name: '下一页' })).not.toBeVisible()

  // 释放后由真实响应决定：有数据→列表（分页可见），无数据→空态
  await expect(history.locator('.history-loading')).toBeHidden({ timeout: 10_000 })
  if (total === 0) {
    await expect(history.getByText('暂无已结算训练')).toBeVisible()
    await history.getByRole('button', { name: '返回创建训练' }).click()
    await expect(page.getByRole('heading', { name: '创建训练' })).toBeVisible()
    expect(errors).toEqual([])
    return
  }
  await expect(history.locator('.history-row').first()).toBeVisible()
  await expect(history.getByRole('button', { name: '上一页' })).toBeDisabled()

  // 错误注入（真实路由一次性 500，predicate 形式与门闩一致）→ 错误态与重试；解除后重试恢复列表
  await page.route(url => url.pathname === '/api/trainings/history', route => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ error: '注入错误' }),
  }), { times: 1 })
  await railTrainingButton(page).click()
  await page.getByRole('button', { name: '历史训练' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('注入错误')
  const retry = page.getByRole('button', { name: '重试' })
  await expect(retry).toBeVisible()
  await page.unrouteAll()
  await retry.click()
  await expect(history.locator('.history-row').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('结算→按本局id定位历史行→事实成绩单→返回（深色1440）', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const id = await createTrainingFromForm(page, '600519')
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

  // 共享库：前序 spec 的 settled 记录保留；只按本局 id 断言自己的行
  const row = history.locator(`.history-row[data-training-id="${id}"]`)
  await expect(row).toBeVisible()
  await expect(row).toContainText('600519')
  await expect(row).toContainText('提前结算')
  await expect(history.getByRole('button', { name: '上一页' })).toBeDisabled()
  const { total } = await fetchHistory(page)
  if (total <= 20) await expect(history.getByRole('button', { name: '下一页' })).toBeDisabled()
  await page.screenshot({ path: evidencePath('m4-history-list-dark-1440.png'), fullPage: true })

  // 详情：只读事实成绩单（按本局 id 进入）
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
  for (const selector of ['.history-page', '.report-page']) {
    await page.locator(selector).evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight })
  }
  await page.waitForTimeout(200)
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
  const runningId = await createTrainingFromForm(page, '600519')
  await waitRecordingReady(page)

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

  // 放弃（清理约定走 API）：自己的行不得出现；既有 settled 记录不受影响
  await page.request.post(`/api/trainings/${runningId}/abandon`)
  await page.getByRole('button', { name: '历史训练' }).click()
  await expect(history.locator(`.history-row[data-training-id="${runningId}"]`)).toHaveCount(0)

  // 浅色 840：详情成绩单可用（按最新结算行进入，不假设它来自哪个 spec）
  const { items } = await fetchHistory(page)
  expect(items.length).toBeGreaterThan(0)
  const latestId = items[0].id
  await history.locator(`.history-row[data-training-id="${latestId}"]`).click()
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
  const idNew = await createTrainingFromForm(page, '300857')
  await waitRecordingReady(page)
  await buyAll(page)
  await settleThroughButtons(page)
  await page.getByRole('button', { name: '查看历史成绩单' }).click()
  const history = page.getByRole('region', { name: '历史训练' })
  // 本局 300857 与此前 600519 已结算行都可见（不假设库中总行数）
  const newRow = history.locator(`.history-row[data-training-id="${idNew}"]`)
  await expect(newRow).toBeVisible()
  const { items } = await fetchHistory(page)
  const old = items.find(item => item.code === '600519')
  expect(old).toBeTruthy()
  const idOld = old!.id
  const oldRow = history.locator(`.history-row[data-training-id="${idOld}"]`)
  await expect(oldRow).toBeVisible()
  // 稳定排序：600519（结算日更晚）在 300857（本局新结算）之前
  const ordered = await page.evaluate(([a, b]) => {
    const first = document.querySelector(`.history-row[data-training-id="${a}"]`)
    const second = document.querySelector(`.history-row[data-training-id="${b}"]`)
    return !!(first && second && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING))
  }, [idOld, idNew])
  expect(ordered).toBe(true)

  // A→B 竞态：延迟旧行 A 的真实 report 响应，先点 A 立刻点 B
  let blockedA = 0
  await page.route(`**/api/trainings/${idOld}/report`, async route => {
    blockedA += 1
    await new Promise(resolve => setTimeout(resolve, 1500))
    await route.continue()
  })
  await oldRow.click()
  await newRow.click()
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
