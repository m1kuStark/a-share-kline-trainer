// RF2-02/03 随机时间模式 K 线时间轴遮蔽联动＋到期结算披露股票名（呈现层行为）。
// 覆盖矩阵两行（random-training-mode，2026-10-09 架构师修订/新增）：
// - RANDOM-HIDE-TIME-REMAINING（轴子句）：random_time/random_both 运行中 K 线 X 轴日期标签
//   默认隐藏；reveal 揭示后轴标签同步显示（按会话常量差换算真实日期）；服务端偏移保留。
// - RAND-UI-MASK-STARS：星号遮蔽＋小眼睛＋确认弹窗既有行为（RF-05）扩展到轴的遮蔽/揭示联动。
// - RANDOM-SETTLE-REVEAL-STOCK：随机训练结束（到期/提前结算/放弃）结算呈现面板显示真实
//   股票名称与代码（与训练区间、成绩并列）——RF-05 服务端已回真实值，本任务补 UI 渲染。
// oracle 独立性：轴标签期望来自 x 轴刻度探针（klinecharts 轴为 canvas，DOM 断言不可用）；
// 换算常量差由「运行中偏移起始日 ↔ reveal 真实起始日」现场推算，不从实现抄回；
// 结算面板股票名/码期望来自服务端结束态响应（真实值）。
import { expect, test, type Page } from '@playwright/test'

const CODE_INPUT = '股票代码，如 600519'

const CURRENT_DATA_STATUS = {
  state: 'unchanged', needsUpdate: false, reason: '本地数据与数据源一致',
  source: { kind: 'tdx', name: '通达信本地数据', available: true },
  tdx: { available: true, root: 'C:/new_tdx' },
  online: { configured: false, provider: null },
  sourceMaxDate: '2026-09-24', lastCheckedAt: '2026-09-25T01:00:00.000Z', lastResult: null, revisionWarning: null,
  freshness: { state: 'current', expectedDate: '2026-09-24', sourceMaxDate: '2026-09-24', checkedAt: '2026-09-25T01:00:00.000Z', reason: '来源最大日期 2026-09-24 已达到应收收盘日 2026-09-24。' },
  calendar: { id: 'sse-2026-annual', from: '2026-01-01', through: '2026-12-31', version: 'e2e' },
}

const MS_PER_DAY = 86_400_000
function isoDay(date: Date): string { return date.toISOString().slice(0, 10) }
function shiftIsoDay(day: string, days: number): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY))
}
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / MS_PER_DAY)
}
function minusDays(day: string, days: number): string { return shiftIsoDay(day, -days) }
function minusMonths(day: string, months: number): string {
  const date = new Date(Date.parse(`${day}T00:00:00Z`))
  date.setUTCMonth(date.getUTCMonth() - months)
  return isoDay(date)
}

async function clearActiveTraining(page: Page): Promise<void> {
  const active = await (await page.request.get('/api/trainings/active')).json() as { training?: { id: number } | null }
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
}

async function openLauncher(page: Page): Promise<void> {
  await clearActiveTraining(page)
  await page.route('**/api/data/status**', route => route.fulfill({ json: CURRENT_DATA_STATUS }))
  await page.goto('/')
  await expect(page.getByText(/数据已最新/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('创建训练').first()).toBeVisible()
}

async function waitTrainingInteractive(page: Page): Promise<void> {
  await expect(page.locator('.training-topbar')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存', { timeout: 30_000 })
}

async function searchRealStocks(page: Page, q: string): Promise<Array<{ code: string; name: string; lastDate: string | null }>> {
  const payload = await (await page.request.get(`/api/stocks?q=${encodeURIComponent(q)}`)).json() as { items: Array<{ code: string; name: string; lastDate: string | null }> }
  return payload.items
}

/** 目录检索选股后以自定义根数档创建 random_time 会话（真实 TDX 数据） */
async function startRandomTime(page: Page, bars = '20'): Promise<{ id: number }> {
  const search = await searchRealStocks(page, '600519')
  expect(search.length, '真实目录应能检索到 600519').toBeGreaterThan(0)
  await page.getByRole('tab', { name: '随机模式' }).click()
  await expect(page.getByText('随机维度')).toBeVisible()
  await page.getByRole('button', { name: '随机时间段 · 我选股票' }).click()
  await page.getByPlaceholder(CODE_INPUT).fill(search[0].code)
  await expect(page.locator('.suggestions button').first()).toBeVisible()
  await page.locator('.suggestions button').first().click()
  await expect(page.getByText(/已选：/)).toBeVisible()
  await page.getByRole('button', { name: '自定义根数', exact: true }).click()
  await page.getByLabel('训练窗口长度（交易日）').fill(bars)
  await page.getByRole('button', { name: '开始训练', exact: true }).click()
  await waitTrainingInteractive(page)
  const active = await (await page.request.get('/api/trainings/active')).json() as { training: { id: number } }
  return { id: active.training.id }
}

// ===== 轴标签探针（klinecharts 时间轴为 canvas 绘制，经 journey 只读探针读当前刻度文本） =====

function axisLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__trainerChart.xAxisLabels() as string[])
}

function chartBarDates(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__trainerChart.bars().map((bar: any) => bar.date as string))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 悬浮信息卡日期：指针停驻主图中心 ≥1s 触发（与用户真实悬停同路径），返回卡内日期文本 */
async function hoverCardDateAt(page: Page, clientX: number, clientY: number): Promise<string> {
  await page.mouse.move(clientX, clientY)
  await page.waitForTimeout(1_400)
  return (await page.locator('.hover-card-date').textContent()) ?? ''
}

test.describe('random mask axis and settle stock (RF2-02/03)', () => {
  // ①遮蔽态：random_time 运行中轴刻度无日期文本＋悬浮卡日期为星号遮蔽（RAND-UI-MASK-STARS 轴联动）
  // ②揭示态：眼睛确认后轴出现真实日期（常量差换算），悬浮卡日期同步换算
  // ③再点眼睛恢复遮蔽（轴无日期文本）
  test('mask axis: hidden while running, revealed by eye toggle with constant offset, restorable', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000)
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await openLauncher(page)
    const { id } = await startRandomTime(page)

    // 运行中会话元信息（偏移空间）与 reveal 真实值（oracle 推算常量差）
    const running = await (await page.request.get('/api/trainings/active')).json() as {
      training: { startDate: string; random: { dimension: string; hideTime: boolean } }
    }
    expect(running.training.random.dimension).toBe('random_time')
    expect(running.training.random.hideTime).toBe(true)
    const revealed = await (await page.request.post(`/api/trainings/${id}/reveal`)).json() as {
      training: { code: string; name: string; startDate: string }
    }
    const offsetDays = dayDiff(revealed.training.startDate, running.training.startDate)
    expect(Math.abs(offsetDays)).toBeGreaterThan(0) // 服务端偏移非零常量（M7-01 契约）

    // ① 遮蔽态：轴刻度全部无日期文本（旧实现显示偏移假日期 → RED）
    await expect.poll(async () => (await axisLabels(page)).length).toBeGreaterThan(0)
    let labels = await axisLabels(page)
    expect(labels.every(text => !ISO_DATE.test(text) && !/\d{4}/.test(text)), `遮蔽态轴不得出现日期文本，实际=${JSON.stringify(labels)}`).toBe(true)
    // 悬浮卡日期＝星号遮蔽（与轴同口径联动）
    const chart = await page.locator('.chart-host').boundingBox()
    expect(chart).toBeTruthy()
    const maskedCardDate = await hoverCardDateAt(page, chart!.x + chart!.width * 0.5, chart!.y + chart!.height * 0.35)
    expect(maskedCardDate, '遮蔽期悬浮信息卡日期应为星号遮蔽符').toBe('******')
    // 状态条「可见至」视窗日期同口径遮蔽（同类呈现面：bar 日期不得以偏移形态出现在页面）
    await expect(page.locator('.viewport-date').first()).toContainText('******')

    // ② 揭示：确认弹窗 → 确认显示 → 轴出现真实日期（每条标签反推常量差后必须命中图内真实 K 线日期）
    await page.getByRole('button', { name: '显示被隐藏的信息' }).click()
    const dialog = page.getByRole('dialog', { name: '显示随机训练隐藏信息' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '确认显示', exact: true }).click()
    await expect(page.locator('.workspace-title')).toHaveText(`${revealed.training.name} · ${revealed.training.code}`)

    await expect.poll(async () => (await axisLabels(page)).filter(text => ISO_DATE.test(text)).length).toBeGreaterThan(0)
    labels = await axisLabels(page)
    const dateLabels = labels.filter(text => ISO_DATE.test(text))
    expect(dateLabels.length).toBeGreaterThan(0)
    const barDates = await chartBarDates(page) // 运行中为偏移空间；真实日期＝偏移日期＋offsetDays
    for (const label of dateLabels) {
      expect(barDates, `揭示态轴标签 ${label} 反推偏移空间后应命中图内 K 线日期`).toContain(shiftIsoDay(label, -offsetDays))
    }
    // 状态条「可见至」视窗日期同步换算（命中真实空间任一 K 线日）
    const stripDate = ((await page.locator('.viewport-date').first().textContent()) ?? '').match(/\d{4}-\d{2}-\d{2}/)?.[0]
    expect(stripDate, '揭示态状态条应显示换算后的真实日期').toBeTruthy()
    expect(barDates).toContain(shiftIsoDay(stripDate!, -offsetDays))
    // 悬浮卡日期同步换算为真实日期（命中真实空间任一 K 线日）
    const revealedCardDate = await hoverCardDateAt(page, chart!.x + chart!.width * 0.5, chart!.y + chart!.height * 0.35)
    expect(ISO_DATE.test(revealedCardDate), `揭示态悬浮卡应为真实日期，实际=${revealedCardDate}`).toBe(true)
    expect(barDates).toContain(shiftIsoDay(revealedCardDate, -offsetDays))

    // ③ 再点眼睛恢复遮蔽（无需确认）：日期维度回遮蔽（random_time 股票本就真实，标题不变）
    await page.getByRole('button', { name: '恢复星号遮蔽' }).click()
    await expect(page.locator('.training-current-date')).toContainText('剩余未推进')
    await expect.poll(async () => (await axisLabels(page)).every(text => !/\d{4}/.test(text))).toBe(true)

    await page.request.post(`/api/trainings/${id}/abandon`)
    expect(pageErrors).toEqual([])
  })

  // ④ 结束态（提前结算路径）：结算面板显示真实股票名称与代码（RF2-03）＋轴恢复真实日期（结束即全面揭晓）
  test('settle reveal: panel shows real stock name and code with axis real dates', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000)
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await openLauncher(page)
    const { id } = await startRandomTime(page)

    // 提前结算（显式确认弹窗，真实 settle）；遮蔽态轴断言见上一用例（同一运行中口径）
    await page.getByRole('button', { name: '提前结算', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '结束训练' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '确认结算', exact: true }).click()
    const results = page.getByRole('dialog', { name: '训练结算' })
    await expect(results).toBeVisible()

    // 结束态响应＝真实信息（RF-05 服务端已覆盖）：名称/代码非空、random 字段消失
    const ended = await (await page.request.get(`/api/trainings/${id}`)).json() as {
      training: { code: string; name: string; startDate: string; settleDate: string; random?: unknown }
    }
    expect(ended.training.random).toBeUndefined()
    expect(ended.training.code.length).toBeGreaterThan(0)
    expect(ended.training.name.length).toBeGreaterThan(0)

    // RF2-03：结算面板与训练区间、成绩并列显示真实股票名称与代码（旧 UI 只渲染区间 → RED）
    await expect(results.getByText('训练标的')).toBeVisible()
    await expect(results.locator('.settle-grid')).toContainText(ended.training.name)
    await expect(results.locator('.settle-grid')).toContainText(ended.training.code)
    await expect(results.getByText('训练区间')).toBeVisible()
    await expect(results.locator('.settle-grid')).toContainText(ended.training.startDate)

    // 留在当前界面：结束＝全面揭晓，轴显示真实日期（bars 已换真实空间，标签直接命中 K 线日期）
    await results.getByRole('button', { name: '留在当前界面', exact: true }).click()
    await expect(results).not.toBeVisible()
    await expect.poll(async () => (await axisLabels(page)).filter(text => ISO_DATE.test(text)).length).toBeGreaterThan(0)
    const dateLabels = (await axisLabels(page)).filter(text => ISO_DATE.test(text))
    const barDates = await chartBarDates(page)
    for (const label of dateLabels) {
      expect(barDates, `结束态轴标签 ${label} 应直接命中真实 K 线日期`).toContain(label)
    }
    expect(pageErrors).toEqual([])
  })

  // ⑤ 维度联动回归：random_stock 日期真实，轴正常显示（遮蔽只作用于 random_time/random_both）
  test('random stock session: axis dates render normally without masking', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000)
    await openLauncher(page)
    const liquid = (await searchRealStocks(page, '600519'))[0]
    expect(liquid?.lastDate, '真实目录应给出 600519 的 lastDate').toBeTruthy()
    const windowEnd = minusDays(liquid.lastDate as string, 14)
    const windowStart = minusMonths(windowEnd, 3)
    await page.getByRole('tab', { name: '随机模式' }).click()
    await expect(page.getByText('随机维度')).toBeVisible()
    await page.getByRole('button', { name: '随机股票 · 我选时间段' }).click()
    const dates = page.locator('input[type="date"]')
    await dates.nth(0).fill(windowStart)
    await dates.nth(1).fill(windowEnd)
    await page.getByRole('button', { name: '开始训练', exact: true }).click()
    await waitTrainingInteractive(page)

    const active = await (await page.request.get('/api/trainings/active')).json() as { training: { id: number } }
    await expect.poll(async () => (await axisLabels(page)).filter(text => ISO_DATE.test(text)).length).toBeGreaterThan(0)
    const dateLabels = (await axisLabels(page)).filter(text => ISO_DATE.test(text))
    const barDates = await chartBarDates(page)
    for (const label of dateLabels) {
      expect(barDates, `random_stock 轴标签 ${label} 应直接命中 K 线日期`).toContain(label)
    }
    await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  })
})
