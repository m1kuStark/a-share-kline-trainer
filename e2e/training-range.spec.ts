// UI-03 用户反馈后的训练范围表单 e2e：真实路由合同（/api/training-ranges/preview 响应为
// {preview:{...}} 包装、POST /api/trainings 必须携带 previewId），真实点击走完「选股→自动校验→创建」。
// 覆盖：股票双框（模糊下拉/精确自动选中/清空联动/未匹配提示）、周期点击从最新数据日回退起始日、
// 自定义范围只留「起始日＋根数」、校验自动生成、输入变化失效后自动重建、
// 根数超过最新数据自动截取并常驻提醒、409 后自动重建校验、非法 N 不调用预览。
import { expect, test, type Page } from '@playwright/test'

const MAOTAI = { code: '600519', market: 'sh', name: '贵州茅台', bars: 100, lastDate: '2026-09-24' }
const TIRE = { code: '000589', market: 'sz', name: '贵州轮胎', bars: 100, lastDate: '2026-09-24' }

// 范围校验 mock：bars 请求 echo 其 range；bars 超过 61 根时按服务端合同拒绝（INSUFFICIENT_DATA 不截短），
// latest 请求返回实际可用 61 根——与真实 planTrainingRange 行为同构。
function makePreviewRoute(page: Page) {
  let previewCalls = 0
  void page.route('**/api/training-ranges/preview', async route => {
    previewCalls += 1
    const body = JSON.parse(route.request().postData() ?? '{}')
    const range = body.range as { mode: string; startDate: string; count?: number }
    const base = {
      version: 1,
      previewId: `prev-e2e-${previewCalls}`,
      code: '600519',
      market: 'sh',
      requestedStart: range.startDate,
      requestedEnd: null as string | null,
      startDate: range.startDate,
      endDate: '2026-09-24',
      barCount: 61,
      notes: ['合成范围备注'],
      sourceFingerprint: 'fp-e2e',
      expiresAt: '2026-09-26T10:00:00.000Z',
    }
    if (range.mode === 'latest') {
      await route.fulfill({ json: { preview: { ...base, barCount: 61 } } })
      return
    }
    if (range.mode === 'bars' && (range.count ?? 0) > 61) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: `对齐首根后可用日线仅 61 根，请求 ${range.count} 根；不截短，请缩小 count 或前移起点`, code: 'INSUFFICIENT_DATA' }),
      })
      return
    }
    await route.fulfill({ json: { preview: { ...base, request: range, barCount: Math.min(range.count ?? 61, 61) } } })
  })
  return { getCalls: () => previewCalls }
}

// DATA 守卫需要 current 才不打断创建：隔离服务端返回的真实状态可能 stale/unknown。
// 注意必须是对象：route.fulfill({ json }) 会自行序列化，传预序列化字符串会双重编码。
const CURRENT_DATA_STATUS = {
  state: 'unchanged', needsUpdate: false, reason: '本地数据与数据源一致',
  source: { kind: 'tdx', name: '通达信本地数据', available: true },
  tdx: { available: true, root: 'C:/new_tdx' },
  online: { configured: false, provider: null },
  sourceMaxDate: '2026-09-24', lastCheckedAt: '2026-09-25T01:00:00.000Z', lastResult: null, revisionWarning: null,
  freshness: { state: 'current', expectedDate: '2026-09-24', sourceMaxDate: '2026-09-24', checkedAt: '2026-09-25T01:00:00.000Z', reason: '来源最大日期 2026-09-24 已达到应收收盘日 2026-09-24。' },
  calendar: { id: 'sse-2026-annual', from: '2026-01-01', through: '2026-12-31', version: 'e2e' },
}

const CODE_INPUT = '股票代码，如 600519'
const NAME_INPUT = '股票名称，如 贵州茅台（可用拼音首字母 GZMT）'

async function openLauncher(page: Page): Promise<void> {
  // e2e 约定"每个测试开头清理活动训练"：trade-marker-details 收尾不清理导致全量 Journey 中
  // 本页停留在训练视图（既有顺序缺陷），先显式清理。
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  await page.route('**/api/data/status**', route => route.fulfill({ json: CURRENT_DATA_STATUS }))
  await page.goto('/')
  // 等顶栏"数据已最新"：既证明启动完成（env 解析、launcher 挂载；定向运行时 /api/env 首扫冷启动可达数秒），
  // 也证明 mocked dataStatus 已到达——周期锚点（sourceMaxDate）相关断言从此无竞态。
  await expect(page.getByText(/数据已最新/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('创建训练').first()).toBeVisible()
}

/** 精确代码输入自动选中（不再有点击建议步骤），等待已选提示出现 */
async function selectMaotaiByCode(page: Page): Promise<void> {
  await page.getByPlaceholder(CODE_INPUT).fill('600519')
  await expect(page.getByText(/已选：贵州茅台/)).toBeVisible()
}

test('stock dual inputs: fuzzy dropdown, suggestion fills both, clearing one clears both, exact code auto-selects, unmatched shows hint', async ({ page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    const items = [MAOTAI, TIRE].filter(stock => q === '' || stock.name.includes(q) || stock.code.includes(q))
    void route.fulfill({ json: { items, total: items.length } })
  })

  // 名称前缀模糊下拉：选择建议后两框联动补全
  await page.getByPlaceholder(NAME_INPUT).fill('贵州')
  await page.getByRole('button', { name: /000589/ }).click()
  await expect(page.getByPlaceholder(NAME_INPUT)).toHaveValue('贵州轮胎')
  await expect(page.getByPlaceholder(CODE_INPUT)).toHaveValue('000589')
  await expect(page.getByText(/已选：贵州轮胎/)).toBeVisible()

  // 清空任一框＝重新选择：另一框与已选状态同步清空
  await page.getByPlaceholder(NAME_INPUT).fill('')
  await expect(page.getByPlaceholder(CODE_INPUT)).toHaveValue('')
  await expect(page.getByText(/已选：/)).toHaveCount(0)

  // 精确代码自动选中并补全名称
  await page.getByPlaceholder(CODE_INPUT).fill('600519')
  await expect(page.getByText(/已选：贵州茅台/)).toBeVisible()
  await expect(page.getByPlaceholder(NAME_INPUT)).toHaveValue('贵州茅台')

  // 匹配不到：行内提示用户可能写错
  await page.getByPlaceholder(CODE_INPUT).fill('999999')
  await expect(page.getByText(/未匹配到股票/)).toBeVisible()
})

test('tier click regenerates start date back from latest data date', async ({ page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => route.fulfill({ json: { items: [MAOTAI], total: 1 } }))

  await selectMaotaiByCode(page)
  // 锚点＝数据状态最新日 2026-09-24：2年 → 2024-09-24；1个月 → 2026-08-24
  await page.getByRole('button', { name: '2年', exact: true }).click()
  await expect(page.locator('input[type="date"]')).toHaveValue('2024-09-24')
  await page.getByRole('button', { name: '1个月', exact: true }).click()
  await expect(page.locator('input[type="date"]')).toHaveValue('2026-08-24')
  // 手动修改保留；再次点周期按用户口径重新生成（不保留手填值）
  await page.locator('input[type="date"]').fill('2025-01-01')
  await page.getByRole('button', { name: '3个月', exact: true }).click()
  await expect(page.locator('input[type="date"]')).toHaveValue('2026-06-24')
})

test('range form: auto validation appears and create carries previewId', async ({ page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => route.fulfill({ json: { items: [MAOTAI], total: 1 } }))
  const preview = makePreviewRoute(page)
  let createBody: Record<string, unknown> | null = null
  let createCalls = 0
  await page.route('**/api/trainings', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    createCalls += 1
    createBody = JSON.parse(route.request().postData() ?? '{}')
    await route.fulfill({ status: 201, json: { training: { id: 1 } } })
  })

  await selectMaotaiByCode(page)
  await page.getByRole('button', { name: '自定义范围' }).click()
  // 自定义范围只留「范围起始日＋K线根数」，不再有范围模式切换与月数档
  await expect(page.getByText('K 线根数')).toBeVisible()
  await expect(page.getByRole('button', { name: '起始日到最新日线' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '生成范围预览' })).toHaveCount(0)
  // 校验自动生成（防抖）：创建前可见，含请求/实际区间与数量/notes（默认根数 60）
  await expect(page.getByText('范围校验', { exact: false })).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/共 60 根日线/)).toBeVisible()
  await expect(page.getByText(/合成范围备注/)).toBeVisible()

  // 预览已匹配当前输入 → 直接创建，payload 必须带 previewId
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect.poll(() => createCalls).toBe(1)
  expect((createBody as Record<string, unknown> | null)!.previewId).toBe('prev-e2e-1')
  expect((createBody as Record<string, unknown> | null)!.range).toBeTruthy()
  expect(preview.getCalls()).toBeGreaterThanOrEqual(1)
})

test('range form: editing input invalidates the validation which then auto-regenerates; single submit creates', async ({ page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => route.fulfill({ json: { items: [MAOTAI], total: 1 } }))
  makePreviewRoute(page)
  let createCalls = 0
  await page.route('**/api/trainings', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    createCalls += 1
    await route.fulfill({ status: 201, json: { training: { id: 1 } } })
  })

  await selectMaotaiByCode(page)
  await page.getByRole('button', { name: '自定义范围' }).click()
  await expect(page.getByText(/范围校验/)).toBeVisible({ timeout: 5000 })

  // 编辑起点：旧校验立即失效消失，随后自动重建
  await page.locator('input[type="date"]').last().fill('2026-07-01')
  await expect(page.getByText('范围校验', { exact: false })).toHaveCount(0)
  await expect(page.getByText(/范围校验/)).toBeVisible({ timeout: 5000 })

  // 校验已匹配当前输入 → 单次提交即创建
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect.poll(() => createCalls).toBe(1)
})

test('bars with N=0 never calls the preview API; fixing N auto-validates and clears the error', async ({ page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => route.fulfill({ json: { items: [MAOTAI], total: 1 } }))
  const preview = makePreviewRoute(page)

  await selectMaotaiByCode(page)
  await page.getByRole('button', { name: '自定义范围' }).click()
  await expect(page.getByText(/范围校验/)).toBeVisible({ timeout: 5000 })
  const before = preview.getCalls()

  await page.locator('input[type="number"][min="1"]').fill('0')
  await expect(page.getByText(/范围校验/)).toHaveCount(0)
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect(page.getByText(/K 线根数必须是正整数/)).toBeVisible()
  await expect.poll(() => preview.getCalls()).toBe(before)

  // 修正 N 后自动校验，旧的错误提示消失
  await page.locator('input[type="number"][min="1"]').fill('1')
  await expect(page.getByText(/范围校验/)).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/K 线根数必须是正整数/)).toHaveCount(0)
  await expect.poll(() => preview.getCalls()).toBeGreaterThan(before)
})

test('count exceeding latest data auto-clamps with persistent notice and create carries clamped count', async ({ page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => route.fulfill({ json: { items: [MAOTAI], total: 1 } }))
  makePreviewRoute(page)
  let createBody: Record<string, unknown> | null = null
  await page.route('**/api/trainings', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    createBody = JSON.parse(route.request().postData() ?? '{}')
    await route.fulfill({ status: 201, json: { training: { id: 1 } } })
  })

  await selectMaotaiByCode(page)
  await page.getByRole('button', { name: '自定义范围' }).click()
  await expect(page.getByText(/范围校验/)).toBeVisible({ timeout: 5000 })

  // 根数超过最新数据：服务端拒绝 → 前端自动收缩到可用根数并常驻提醒
  await page.locator('input[type="number"][min="1"]').fill('500')
  await expect(page.getByText(/已自动截取到最新数据截止日/)).toBeVisible({ timeout: 8000 })
  await expect(page.locator('input[type="number"][min="1"]')).toHaveValue(/\b61\b/)
  await expect(page.getByText(/共 61 根日线/)).toBeVisible()

  await page.getByRole('button', { name: '开始训练' }).click()
  await expect.poll(() => (createBody as Record<string, unknown> | null) !== null).toBe(true)
  const range = (createBody as Record<string, unknown> | null)!.range as { mode: string; count: number }
  expect(range.mode).toBe('bars')
  expect(range.count).toBe(61)
})

test('409 on create clears the stale validation which auto-regenerates; second submit creates', async ({ page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => route.fulfill({ json: { items: [MAOTAI], total: 1 } }))
  makePreviewRoute(page)
  let createCalls = 0
  await page.route('**/api/trainings', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    createCalls += 1
    if (createCalls === 1) {
      await route.fulfill({ status: 409, json: { error: 'RANGE_PREVIEW_STALE: 范围预览已过期' } })
      return
    }
    await route.fulfill({ status: 201, json: { training: { id: 1 } } })
  })

  await selectMaotaiByCode(page)
  await page.getByRole('button', { name: '自定义范围' }).click()
  await expect(page.getByText(/范围校验/)).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: '开始训练' }).click()
  // 409：旧校验失效并明确提示；自动重建后再次提交成功。
  // 文本引擎只匹配最内层元素：<strong>范围校验</strong> 不含冒号，
  // 用 exact 断言它重新出现（错误消息含"范围校验"子串但非精确文本，不干扰）。
  await expect(page.getByText(/范围校验已失效/)).toBeVisible()
  await expect(page.getByText('范围校验', { exact: true })).toBeVisible({ timeout: 8000 })
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect.poll(() => createCalls).toBe(2)
})
