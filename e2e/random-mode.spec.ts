// M7-02 随机训练模式·前端接线 e2e：真实 journey 服务＋真实 TDX 数据。
// 覆盖矩阵 RAND-UI-* 六行：首页经典/随机标签切换（RAND-UI-TABS）、维度驱动的控件显隐
// 与 POST /api/trainings/random 载荷（RAND-UI-PANEL-REUSE）、运行中遮蔽呈现（RAND-UI-MASKED-DISPLAY）、
// 结算揭晓（RAND-UI-REVEAL-DISPLAY）、两类 422 人话提示（RAND-UI-ERROR-422）、
// 经典面板回归抽查（RAND-UI-CLASSIC-INTACT）。
// oracle 独立性：期望文案来自 M7-02 派发简报/设计文档字面量（不从 DOM 抄回）；
// 遮蔽/揭晓期望来自 M7-01 契约（运行中 code/name=null、结束态真实值、非零常量偏移）。
import { expect, test, type Page } from '@playwright/test'

const CODE_INPUT = '股票代码，如 600519'

// 股票检索 mock（载荷类测试用；真实创建类测试走真实目录检索）
const MAOTAI = { code: '600519', market: 'sh', name: '贵州茅台', bars: 100, lastDate: '2026-09-24' }

// DATA 守卫需要 current 才不打断创建：journey 真实状态可能 stale/unknown，统一 mock。
const CURRENT_DATA_STATUS = {
  state: 'unchanged', needsUpdate: false, reason: '本地数据与数据源一致',
  source: { kind: 'tdx', name: '通达信本地数据', available: true },
  tdx: { available: true, root: 'C:/new_tdx' },
  online: { configured: false, provider: null },
  sourceMaxDate: '2026-09-24', lastCheckedAt: '2026-09-25T01:00:00.000Z', lastResult: null, revisionWarning: null,
  freshness: { state: 'current', expectedDate: '2026-09-24', sourceMaxDate: '2026-09-24', checkedAt: '2026-09-25T01:00:00.000Z', reason: '来源最大日期 2026-09-24 已达到应收收盘日 2026-09-24。' },
  calendar: { id: 'sse-2026-annual', from: '2026-01-01', through: '2026-12-31', version: 'e2e' },
}

// —— 日期推算（spec 本地实现，不 import 应用/服务端代码；UTC 日历日即可，服务端自做交易日对齐）——
function isoDay(date: Date): string { return date.toISOString().slice(0, 10) }
function minusDays(day: string, days: number): string {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000))
}
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

async function switchToRandomMode(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '随机模式' }).click()
  await expect(page.getByText('随机维度')).toBeVisible()
}

async function selectMaotaiFromMock(page: Page): Promise<void> {
  await page.route('**/api/stocks**', route => route.fulfill({ json: { items: [MAOTAI], total: 1 } }))
  await page.getByPlaceholder(CODE_INPUT).fill('600519')
  await expect(page.locator('.suggestions button').first()).toBeVisible()
  await page.locator('.suggestions button').first().click()
  await expect(page.getByText(/已选：贵州茅台/)).toBeVisible()
}

/** 训练页可交互：顶栏挂载且画线初始化完成（结算前置，避免 preparingRecording 竞态） */
async function waitTrainingInteractive(page: Page): Promise<void> {
  await expect(page.locator('.training-topbar')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存', { timeout: 30_000 })
}

/** 目录检索（真实服务；page.request 不经 route mock，与浏览器侧 mock 互不干扰） */
async function searchRealStocks(page: Page, q: string): Promise<Array<{ code: string; name: string; lastDate: string | null }>> {
  const payload = await (await page.request.get(`/api/stocks?q=${encodeURIComponent(q)}`)).json() as { items: Array<{ code: string; name: string; lastDate: string | null }> }
  return payload.items
}

test.describe('random mode (M7-02)', () => {
  test('home tabs: classic is default, switching to random swaps the panel and back', async ({ page }) => {
    await openLauncher(page)
    const tabs = page.getByRole('tablist', { name: '训练模式' })
    await expect(tabs).toBeVisible()
    await expect(page.getByRole('tab', { name: '经典模式' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: '随机模式' })).toHaveAttribute('aria-selected', 'false')

    // 默认经典面板：周期网格＋股票选择器在
    await expect(page.getByRole('button', { name: '3个月', exact: true })).toBeVisible()
    await expect(page.getByPlaceholder(CODE_INPUT)).toBeVisible()

    // 切随机：周期网格退场、随机维度进场（面板互斥）
    await page.getByRole('tab', { name: '随机模式' }).click()
    await expect(page.getByText('随机维度')).toBeVisible()
    await expect(page.getByRole('button', { name: '3个月', exact: true })).toHaveCount(0)
    await expect(page.getByText('训练周期')).toHaveCount(0)

    // 切回经典：恢复
    await page.getByRole('tab', { name: '经典模式' }).click()
    await expect(page.getByRole('button', { name: '3个月', exact: true })).toBeVisible()
    await expect(page.getByText('随机维度')).toHaveCount(0)
  })

  const DIMENSION_BUTTON = {
    random_stock: '随机股票 · 我选时间段',
    random_time: '随机时间段 · 我选股票',
    random_both: '全随机',
  } as const

  test('random panel: dimension-driven control visibility and payload for random_stock', async ({ page }) => {
    await openLauncher(page)
    await switchToRandomMode(page)
    let createBody: Record<string, unknown> | null = null
    await page.route('**/api/trainings/random', async route => {
      createBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ status: 201, json: { training: { id: 9101 } } })
    })

    // 默认维度＝随机股票：股票选择器与窗口长度隐藏，起止日可见
    await expect(page.getByRole('button', { name: DIMENSION_BUTTON.random_stock })).toHaveClass(/selected/)
    await expect(page.getByPlaceholder(CODE_INPUT)).toHaveCount(0)
    await expect(page.getByLabel('训练窗口长度（交易日）')).toHaveCount(0)
    const dates = page.locator('input[type="date"]')
    await expect(dates).toHaveCount(2)

    await dates.nth(0).fill('2026-06-24')
    await dates.nth(1).fill('2026-09-24')
    await page.getByRole('button', { name: '开始训练', exact: true }).click()
    await expect.poll(() => createBody).toBeTruthy()
    expect(createBody!.dimension).toBe('random_stock')
    expect(createBody!.start_date).toBe('2026-06-24')
    expect(createBody!.end_date).toBe('2026-09-24')
    expect(createBody!.code).toBeUndefined()
    expect(createBody!.window_bars).toBeUndefined()
    expect(createBody!.clock_mode).toBe('close_only')
    expect(createBody!.orders_enabled).toBe(false)
    expect(createBody!.adjust_mode).toBe('forward')
  })

  test('random panel: dimension-driven control visibility and payload for random_time', async ({ page }) => {
    await openLauncher(page)
    await switchToRandomMode(page)
    await page.getByRole('button', { name: DIMENSION_BUTTON.random_time }).click()

    // 选股器进场；起止日退场；窗口长度可见且默认 250
    await selectMaotaiFromMock(page)
    await expect(page.locator('input[type="date"]')).toHaveCount(0)
    const windowInput = page.getByLabel('训练窗口长度（交易日）')
    await expect(windowInput).toBeVisible()
    expect(await windowInput.inputValue()).toBe('250')
    await windowInput.fill('40')

    let createBody: Record<string, unknown> | null = null
    await page.route('**/api/trainings/random', async route => {
      createBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ status: 201, json: { training: { id: 9102 } } })
    })
    await page.getByRole('button', { name: '开始训练', exact: true }).click()
    await expect.poll(() => createBody).toBeTruthy()
    expect(createBody!.dimension).toBe('random_time')
    expect(createBody!.code).toBe('600519')
    expect(createBody!.window_bars).toBe(40)
    expect(createBody!.start_date).toBeUndefined()
    expect(createBody!.end_date).toBeUndefined()
  })

  test('random panel: dimension-driven control visibility and payload for random_both', async ({ page }) => {
    await openLauncher(page)
    await switchToRandomMode(page)
    await page.getByRole('button', { name: DIMENSION_BUTTON.random_both }).click()

    // 全随机：选股器与起止日都退场，只剩窗口长度（默认 250 原样发送）
    await expect(page.getByPlaceholder(CODE_INPUT)).toHaveCount(0)
    await expect(page.locator('input[type="date"]')).toHaveCount(0)
    const windowInput = page.getByLabel('训练窗口长度（交易日）')
    await expect(windowInput).toBeVisible()
    expect(await windowInput.inputValue()).toBe('250')

    let createBody: Record<string, unknown> | null = null
    await page.route('**/api/trainings/random', async route => {
      createBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ status: 201, json: { training: { id: 9103 } } })
    })
    await page.getByRole('button', { name: '开始训练', exact: true }).click()
    await expect.poll(() => createBody).toBeTruthy()
    expect(createBody!.dimension).toBe('random_both')
    expect(createBody!.window_bars).toBe(250)
    expect(createBody!.code).toBeUndefined()
    expect(createBody!.start_date).toBeUndefined()
    expect(createBody!.end_date).toBeUndefined()
  })

  test('masked session: hidden stock shows placeholder and badge while dates render as served', async ({ page }) => {
    // 真实创建（random_stock：隐藏股票、日期真实）；窗口末缘取目录流动股 lastDate 前推 14 天，
    // 保证随机池中 lastDate ≥ end 的股票充足（不依赖冷启慢完成的数据状态扫描）
    const liquid = (await searchRealStocks(page, '600519'))[0]
    expect(liquid?.lastDate, '真实目录应给出 600519 的 lastDate').toBeTruthy()
    const windowEnd = minusDays(liquid.lastDate as string, 14)
    const windowStart = minusMonths(windowEnd, 3)

    await openLauncher(page)
    await switchToRandomMode(page)
    const dates = page.locator('input[type="date"]')
    await dates.nth(0).fill(windowStart)
    await dates.nth(1).fill(windowEnd)
    await page.getByRole('button', { name: '开始训练', exact: true }).click()

    await waitTrainingInteractive(page)
    // 遮蔽态：占位＋徽标；当前日期按服务端下发原样呈现（不二次处理）
    await expect(page.locator('.workspace-title')).toHaveText('随机标的 · 已隐藏')
    await expect(page.locator('.random-mode-badge')).toBeVisible()
    const active = await (await page.request.get('/api/trainings/active')).json() as {
      training: { code: string | null; name: string | null; currentDate: string | null; random: { dimension: string; hideStock: boolean; hideTime: boolean } }
    }
    expect(active.training.code).toBeNull()
    expect(active.training.name).toBeNull()
    expect(active.training.random).toEqual({ dimension: 'random_stock', hideStock: true, hideTime: false })
    await expect(page.locator('.training-current-date strong')).toHaveText(active.training.currentDate ?? '')
  })

  test('settle reveal: real stock and real date window surface after settlement', async ({ page }) => {
    // 真实创建（random_time：股票可见、日期隐藏）；结算后揭晓真实信息
    const search = await searchRealStocks(page, '600519')
    expect(search.length, '真实目录应能检索到 600519').toBeGreaterThan(0)
    const code = search[0].code

    await openLauncher(page)
    await switchToRandomMode(page)
    await page.getByRole('button', { name: DIMENSION_BUTTON.random_time }).click()
    await page.getByPlaceholder(CODE_INPUT).fill(code)
    await expect(page.locator('.suggestions button').first()).toBeVisible()
    await page.locator('.suggestions button').first().click()
    await expect(page.getByText(/已选：/)).toBeVisible()
    await page.getByLabel('训练窗口长度（交易日）').fill('20')

    await page.getByRole('button', { name: '开始训练', exact: true }).click()
    await waitTrainingInteractive(page)

    // 运行中：真实名称·代码可见＋徽标；日期为偏移空间（UI 原样呈现服务端值）
    await expect(page.locator('.workspace-title')).toHaveText(new RegExp(`· ${code}`))
    await expect(page.locator('.random-mode-badge')).toBeVisible()
    const running = await (await page.request.get('/api/trainings/active')).json() as {
      training: { id: number; startDate: string; currentDate: string; random: { dimension: string; hideStock: boolean; hideTime: boolean } }
    }
    expect(running.training.random).toEqual({ dimension: 'random_time', hideStock: false, hideTime: true })
    await expect(page.locator('.training-current-date strong')).toHaveText(running.training.currentDate)

    // 结算（显式确认弹窗，真实 settle）
    await page.getByRole('button', { name: '提前结算', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '结束训练' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '确认结算', exact: true }).click()
    const results = page.getByRole('dialog', { name: '训练结算' })
    await expect(results).toBeVisible()

    // 揭晓：结束态响应为真实信息（random 字段消失、名称/代码非空、真实起始日≠运行中偏移起始日）
    const revealed = await (await page.request.get(`/api/trainings/${running.training.id}`)).json() as {
      training: { code: string; name: string; startDate: string; settleDate: string | null; random?: unknown }
    }
    expect(revealed.training.code).toBe(code)
    expect(revealed.training.name.length).toBeGreaterThan(0)
    expect(revealed.training.random).toBeUndefined()
    expect(revealed.training.startDate).not.toBe(running.training.startDate)

    // 结算面板显示真实训练区间
    await expect(results.getByText('训练区间')).toBeVisible()
    await expect(results.locator('.settle-grid')).toContainText(revealed.training.startDate)

    // 留在图表：徽标退场、真实名称·代码顶上
    await results.getByRole('button', { name: '留在当前界面', exact: true }).click()
    await expect(results).not.toBeVisible()
    await expect(page.locator('.random-mode-badge')).toHaveCount(0)
    await expect(page.locator('.workspace-title')).toHaveText(new RegExp(`· ${code}`))
  })

  test('error mapping: 422 RANDOM_WINDOW_NOT_FIT and RANDOM_STOCK_UNIVERSE_EMPTY show friendly hints', async ({ page }) => {
    await openLauncher(page)
    await switchToRandomMode(page)
    await page.getByRole('button', { name: DIMENSION_BUTTON.random_time }).click()
    await selectMaotaiFromMock(page)

    let calls = 0
    await page.route('**/api/trainings/random', async route => {
      calls += 1
      if (calls === 1) {
        await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: '该股票可用日线 150 根，无法在保留 200 根指标预热的前提下随机选取 250 根窗口', code: 'RANDOM_WINDOW_NOT_FIT' }) })
        return
      }
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: '本地数据中没有满足窗口需求的股票', code: 'RANDOM_STOCK_UNIVERSE_EMPTY' }) })
    })

    // 窗口不拟合：人话提示；表单保留用户输入可修正重试
    await page.getByRole('button', { name: '开始训练', exact: true }).click()
    await expect(page.getByText('该股票数据不足以容纳所选窗口，请缩短窗口或换股票')).toBeVisible()
    await expect(page.getByText(/已选：贵州茅台/)).toBeVisible()
    await expect(page.getByRole('button', { name: '开始训练', exact: true })).toBeEnabled()

    // 换全随机重试：池空文案
    await page.getByRole('button', { name: DIMENSION_BUTTON.random_both }).click()
    await page.getByRole('button', { name: '开始训练', exact: true }).click()
    await expect(page.getByText('本地数据中没有满足窗口的股票，请缩短窗口或更新数据')).toBeVisible()
  })

  test('classic panel spot check: tier grid and stock picker intact with tabs present', async ({ page }) => {
    await openLauncher(page)
    // 标签在场且经典默认；经典行为抽查：周期点击从锚点（mock sourceMaxDate 2026-09-24）回退起始日
    await expect(page.getByRole('tab', { name: '经典模式' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '2年', exact: true }).click()
    await expect(page.locator('input[type="date"]')).toHaveValue('2024-09-24')
    await page.getByRole('button', { name: '1个月', exact: true }).click()
    await expect(page.locator('input[type="date"]')).toHaveValue('2026-08-24')

    // 股票选择器照常可用（mock 检索）
    await page.route('**/api/stocks**', route => route.fulfill({ json: { items: [MAOTAI], total: 1 } }))
    await page.getByPlaceholder(CODE_INPUT).fill('600519')
    await expect(page.locator('.suggestions button').first()).toBeVisible()
  })
})
