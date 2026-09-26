// TRAIN-02 第二片表单 e2e：真实路由合同（/api/training-ranges/preview 响应为 {preview:{...}} 包装、
// POST /api/trainings 必须携带 previewId），真实点击走完「选股→生成预览→审阅→创建」最短通路。
// 覆盖：预览创建前可见、预览块显示请求/实际区间与数量、旧预览在输入变化后失效、
// 月数选项与服务端一致（1/3/6/12/24）、latest 文案为「到最新日线」。
import { expect, test, type Page } from '@playwright/test'

const STOCKS = {
  items: [{ code: '600519', market: 'sh', name: '贵州茅台', bars: 100, lastDate: '2026-09-24' }],
  total: 1,
}

const RANGE_REQUEST = { mode: 'preset', startDate: '2026-06-26', months: 3 }

const PREVIEW = {
  version: 1,
  previewId: 'prev-e2e-1',
  code: '600519',
  market: 'sh',
  request: RANGE_REQUEST,
  requestedStart: '2026-06-26',
  requestedEnd: null as string | null,
  startDate: '2026-06-26',
  endDate: '2026-09-24',
  barCount: 61,
  notes: ['合成范围备注'],
  sourceFingerprint: 'fp-e2e',
  expiresAt: '2026-09-26T10:00:00.000Z',
}

// DATA 守卫需要 current 才不打断创建：隔离服务端返回的真实状态可能 stale/unknown
const CURRENT_DATA_STATUS = JSON.stringify({
  state: 'unchanged', needsUpdate: false, reason: '本地数据与数据源一致',
  source: { kind: 'tdx', name: '通达信本地数据', available: true },
  tdx: { available: true, root: 'C:/new_tdx' },
  online: { configured: false, provider: null },
  sourceMaxDate: '2026-09-24', lastCheckedAt: '2026-09-25T01:00:00.000Z', lastResult: null, revisionWarning: null,
  freshness: { state: 'current', expectedDate: '2026-09-24', sourceMaxDate: '2026-09-24', checkedAt: '2026-09-25T01:00:00.000Z', reason: '来源最大日期 2026-09-24 已达到应收收盘日 2026-09-24。' },
  calendar: { id: 'sse-2026-annual', from: '2026-01-01', through: '2026-12-31', version: 'e2e' },
})

async function openLauncher(page: Page): Promise<void> {
  await page.route('**/api/data/status**', route => route.fulfill({ json: CURRENT_DATA_STATUS }))
  await page.goto('/')
  await expect(page.getByText('创建训练').first()).toBeVisible()
}

test('range form: select stock, generate visible preview, create carries previewId', async ({ page }: { page: Page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => route.fulfill({ json: STOCKS }))
  let createBody: Record<string, unknown> | null = null
  let createCalls = 0
  await page.route('**/api/trainings', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    createCalls += 1
    createBody = JSON.parse(route.request().postData() ?? '{}')
    await route.fulfill({ status: 201, json: { training: { id: 1 } } })
  })
  await page.route('**/api/training-ranges/preview', async route => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    // 服务端合同：响应形如 {preview:{...}}
    await route.fulfill({ json: { preview: { ...PREVIEW, request: body.range, requestedStart: body.range.startDate } } })
  })
  // 其余默认请求放行到隔离服务端
  await page.route(/^((?!stocks|trainings|training-ranges).)*$/, route => route.continue())

  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill('600519')
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').dispatchEvent('input')
  await page.getByRole('button', { name: /600519/ }).first().click()

  // 切到自定义范围：默认起点=上海今天回退3自然月（月末对齐），出现预览按钮
  await page.getByRole('button', { name: '自定义范围' }).click()
  await expect(page.getByRole('button', { name: '生成范围预览' })).toBeVisible()

  // 月数选项与服务端合法集合一致（不得出现 2 个月）；getByRole name 是子串匹配，必须 exact
  await expect(page.getByRole('button', { name: '24个月', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '2个月', exact: true })).toHaveCount(0)

  // 生成预览：创建前可见，含请求/实际区间与数量/notes
  await page.getByRole('button', { name: '生成范围预览' }).click()
  await expect(page.getByText('范围预览', { exact: true })).toBeVisible()
  await expect(page.getByText(/共 61 根日线/)).toBeVisible()
  await expect(page.getByText(/合成范围备注/)).toBeVisible()

  // 开始训练第一次点击：预览已匹配当前输入 → 直接创建，payload 必须带 previewId
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect.poll(() => createCalls).toBe(1)
  expect((createBody as Record<string, unknown> | null)!.previewId).toBe('prev-e2e-1')
  expect((createBody as Record<string, unknown> | null)!.range).toBeTruthy()
})

test('range form: editing input invalidates the preview and first submit only regenerates it', async ({ page }: { page: Page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => route.fulfill({ json: STOCKS }))
  let createCalls = 0
  await page.route('**/api/trainings', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    createCalls += 1
    await route.fulfill({ status: 201, json: { training: { id: 1 } } })
  })
  await page.route('**/api/training-ranges/preview', route => route.fulfill({ json: { preview: PREVIEW } }))
  await page.route(/^((?!stocks|trainings|training-ranges).)*$/, route => route.continue())

  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill('600519')
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').dispatchEvent('input')
  await page.getByRole('button', { name: /600519/ }).first().click()
  await page.getByRole('button', { name: '自定义范围' }).click()
  await page.getByRole('button', { name: '生成范围预览' }).click()
  await expect(page.getByText('范围预览', { exact: true })).toBeVisible()

  // 编辑起点：旧预览立即失效消失
  await page.locator('input[type="date"]').last().fill('2026-07-01')
  await expect(page.getByText('范围预览', { exact: true })).toHaveCount(0)

  // 第一次提交只重新生成预览（不创建），第二次提交才创建
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect(page.getByText(/已生成范围预览，请核对/)).toBeVisible()
  await expect.poll(() => createCalls).toBe(0)
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect.poll(() => createCalls).toBe(1)
})

test('latest mode copy says 到最新日线 and 409 clears the stale preview', async ({ page }: { page: Page }) => {
  await openLauncher(page)
  await page.route('**/api/stocks**', route => route.fulfill({ json: STOCKS }))
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
  await page.route('**/api/training-ranges/preview', route => route.fulfill({ json: { preview: PREVIEW } }))
  await page.route(/^((?!stocks|trainings|training-ranges).)*$/, route => route.continue())

  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').fill('600519')
  await page.getByPlaceholder('搜索代码或名称，如 600519 或 贵州茅台').dispatchEvent('input')
  await page.getByRole('button', { name: /600519/ }).first().click()
  await page.getByRole('button', { name: '自定义范围' }).click()
  await expect(page.getByRole('button', { name: '起始日到最新日线' })).toBeVisible()

  await page.getByRole('button', { name: '生成范围预览' }).click()
  await expect(page.getByText('范围预览', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '开始训练' }).click()
  // 409：旧预览失效并明确提示重新生成
  await expect(page.getByText(/范围预览已失效，请重新生成预览并确认/)).toBeVisible()
  await expect(page.getByText('范围预览', { exact: true })).toHaveCount(0)
  // 重新生成预览后再次提交成功
  await page.getByRole('button', { name: '生成范围预览' }).click()
  await expect(page.getByText('范围预览', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect.poll(() => createCalls).toBe(2)
})
