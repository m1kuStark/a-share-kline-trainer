// M4-01 五档排行 e2e：真实隔离服务＋真实样本数据（600519/300857）。
// 覆盖（真实用户动作，不用 API 替代关键用户路径）：
// 真实买入/卖出/结算两局 → 侧栏排行 → 切 3个月档 → 按本局 id 定位两行（提前结算组＋实际天数、
// 指标列呈现：零卖出胜率/盈亏比 '--' 不冒充 0、已平仓胜率 100%）→ 点行打开成绩单 →
// 排行行点击打开成绩单事实浮窗 → 关闭；成绩单暂不承载 K 线复盘。
// 运行中守卫（排行 409 说明、零行）与放弃不入榜；深/浅 1440/840 截图与 pageerror 0。
// 共库约定（FM-015/F1）：排行断言一律按本局创建的 training id 定位（data-training-id），
// 不作绝对行数假设；基准超额取决于样本 TDX 是否含 sh000300 日线，不硬编码数值，只禁 NaN/undefined。
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

/** 表单创建 3 个月训练并返回本局 id（排行断言一律按此 id 定位自己的行）。 */
async function createTrainingFromForm(page: Page, code: string): Promise<number> {
  await resetToLauncher(page)
  // UI-03 双框选股（Launcher.vue 代码框 placeholder＝『股票代码，如 600519』）：填精确代码，
  // 250ms 去抖后精确命中自动选中（『已选：』提示），无需点击建议按钮——与 journey.spec.ts 同规范。
  await page.getByPlaceholder('股票代码，如 600519').fill(code)
  await expect(page.getByText(/已选：/)).toBeVisible()
  await page.getByRole('button', { name: '3个月' }).click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  await expect(page.locator('.training-meta')).toContainText('时长 3个月')
  const snapshot = (await (await page.request.get('/api/trainings/active')).json())
  return snapshot.training.id
}

async function waitRecordingReady(page: Page): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: '正在记录' })).toBeVisible()
  await expect(page.locator('.training-grid')).not.toHaveAttribute('inert', '')
}

async function buyAll(page: Page): Promise<void> {
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('买入成交')
}

async function sellAll(page: Page): Promise<void> {
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await page.getByRole('button', { name: '卖出', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('卖出成交')
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

function railButton(page: Page, label: string): ReturnType<Page['locator']> {
  return page.locator('.rail-item').filter({ has: page.locator(`text="${label}"`) })
}

async function openRankings(page: Page): Promise<void> {
  await railButton(page, '排行').click()
  await expect(page.getByRole('region', { name: '五档排行' })).toBeVisible()
}

test('结算两局→排行定位本局行→指标呈现→打开事实成绩单（深色1440）', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  // 第一局：买入→次日全卖（1 笔已平仓，胜率 100%）→ 提前结算
  const tradedId = await createTrainingFromForm(page, '600519')
  await waitRecordingReady(page)
  await buyAll(page)
  await advanceDays(page, 1)
  await sellAll(page)
  await settleThroughButtons(page)
  await page.getByRole('dialog', { name: '训练结算' }).getByRole('button', { name: '完成，返回首页' }).click()

  // 第二局：只买入不卖出（零卖出 → 胜率/盈亏比 '--'）→ 提前结算
  const buyOnlyId = await createTrainingFromForm(page, '300857')
  await waitRecordingReady(page)
  await buyAll(page)
  await settleThroughButtons(page)
  // 结算面板是模态（settle-mask 拦截指针）：先关闭再走侧栏入口，否则排行按钮点不进
  await page.getByRole('dialog', { name: '训练结算' }).getByRole('button', { name: '完成，返回首页' }).click()

  await openRankings(page)
  // 默认 1个月档为空或只有他局：切到 3个月档
  await page.getByRole('button', { name: '3个月' }).click()
  const rankings = page.getByRole('region', { name: '五档排行' })
  await expect(rankings.getByRole('heading', { name: /完整周期/ })).toBeVisible()
  await expect(rankings.getByRole('heading', { name: /提前结算/ })).toBeVisible()

  // 按本局 id 定位：两局都是提前结算，进提前结算组
  const tradedRow = rankings.locator(`.rankings-row[data-training-id="${tradedId}"]`)
  const buyOnlyRow = rankings.locator(`.rankings-row[data-training-id="${buyOnlyId}"]`)
  await expect(tradedRow).toBeVisible()
  await expect(buyOnlyRow).toBeVisible()
  await expect(tradedRow).toContainText('600519')
  // 指标呈现：数值不含 NaN/undefined
  for (const row of [tradedRow, buyOnlyRow]) {
    const text = await row.innerText()
    expect(text).not.toContain('NaN')
    expect(text).not.toContain('undefined')
  }
  // 胜率/盈亏比列（td 序 5/6）数据无关断言：1 笔卖出的局胜率必有值（100% 或 0% 取决于
  // 样本方向）、盈亏比必为 '--'（单笔无另一侧）；零卖出局两列均 '--'，不冒充 0。
  const winRateCell = (row: typeof tradedRow) => row.locator('td').nth(5)
  const plrCell = (row: typeof tradedRow) => row.locator('td').nth(6)
  await expect(winRateCell(tradedRow)).not.toContainText('--')
  await expect(plrCell(tradedRow)).toContainText('--')
  await expect(winRateCell(buyOnlyRow)).toContainText('--')
  await expect(plrCell(buyOnlyRow)).toContainText('--')
  await page.screenshot({ path: evidencePath('m4-rankings-tier3m-dark-1440.png'), fullPage: true })

  // 点行打开成绩单；K线复盘暂不在成绩单中展示，等待新的产品方案。
  await tradedRow.click()
  const report = page.getByRole('dialog', { name: '成绩单', exact: true })
  await expect(report).toBeVisible()
  await expect(report.getByRole('heading', { name: '逐笔成交' })).toBeVisible()
  await expect(report.getByText('K线复盘')).toHaveCount(0)
  const reportText = await report.innerText()
  expect(reportText).not.toContain('NaN')
  expect(reportText).not.toContain('undefined')
  await page.screenshot({ path: evidencePath('m4-review-readonly-dark-1440.png'), fullPage: true })
  await report.getByRole('button', { name: '关闭成绩单' }).click()
  await expect(page.getByRole('region', { name: '五档排行' })).toBeVisible()
  expect(errors).toEqual([])
})

test('运行中守卫（排行关闭、零行）与放弃不入榜（浅色840）', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const runningId = await createTrainingFromForm(page, '600519')
  await waitRecordingReady(page)

  await page.getByRole('button', { name: '切换到浅色主题' }).click()
  await page.setViewportSize({ width: 840, height: 900 })
  await railButton(page, '排行').click()
  const rankings = page.getByRole('region', { name: '五档排行' })
  await expect(rankings).toBeVisible()
  await expect(rankings.getByText('结束当前训练后可查看排行')).toBeVisible()
  await expect(rankings.locator('.rankings-row')).toHaveCount(0)
  await page.screenshot({ path: evidencePath('m4-rankings-guard-light-840.png'), fullPage: true })

  // 回到当前训练 → 放弃（清理约定走 API）→ 本局不得入榜；既有 settled 行不受影响
  await railButton(page, '训练').click()
  await expect(page.locator('.training-topbar')).toBeVisible()
  await page.request.post(`/api/trainings/${runningId}/abandon`)
  await railButton(page, '排行').click()
  await page.getByRole('button', { name: '3个月' }).click()
  await expect(rankings.locator(`.rankings-row[data-training-id="${runningId}"]`)).toHaveCount(0)
  expect(errors).toEqual([])
})
