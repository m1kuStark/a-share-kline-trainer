import { expect, test, type Page } from '@playwright/test'

// 日线数据更新 e2e：全部 /api/data/* 用 page.route mock（不依赖服务端真实实现），
// /api/env、/api/trainings/active、/api/stocks、POST /api/trainings 一并 mock 保证与
// 隔离服务端的真实数据解耦。断言纪律：可见性用 toBeVisible，真实点击真实事件。
// DATA-05：payload 携带 freshness（服务端按官方离线日历重算）与 calendar 元信息；
// 绿色"已最新"只对应 current；unknown 不绿色；始终提供手动"重新读取本地日线"入口。

// /api/data/status 契约样例（与服务端 DATA-05 契约一致）
function freshness(state: 'current' | 'stale' | 'unknown', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    state,
    expectedDate: state === 'unknown' ? null : '2026-09-24',
    sourceMaxDate: state === 'unknown' ? null : '2026-09-24',
    checkedAt: '2026-09-25T01:00:00.000Z',
    reason: '来源最大日期 2026-09-24 已达到应收收盘日 2026-09-24。来源末日不证明所有股票完整。',
  }
  if (state === 'stale') {
    base.expectedDate = '2026-09-24'
    base.sourceMaxDate = '2026-09-15'
    base.reason = '来源最大日期 2026-09-15 落后应收收盘日 2026-09-24。来源末日不证明所有股票完整。'
  }
  if (state === 'unknown') {
    base.expectedDate = null
    base.sourceMaxDate = '2026-09-15'
    base.reason = '缺少可信交易日历，无法推算应收收盘日。来源末日不证明所有股票完整。'
  }
  return { ...base, ...overrides }
}

const CALENDAR = {
  id: 'sse-2026-annual',
  from: '2026-01-01',
  through: '2026-12-31',
  sourceUrl: 'https://www.sse.com.cn/disclosure/dealinstruc/closed/',
  version: 'snapshot-2026-09-25',
}

function statusPayload(overrides: Record<string, unknown> = {}, fresh: Record<string, unknown> = freshness('current'), calendar: unknown = CALENDAR): string {
  return JSON.stringify({
    state: 'unchanged',
    needsUpdate: false,
    reason: '本地数据与数据源一致',
    source: { kind: 'tdx', name: '通达信本地数据', available: true },
    tdx: { available: true, root: 'C:/new_tdx' },
    online: { configured: false, provider: null },
    sourceMaxDate: '2026-09-24',
    lastCheckedAt: '2026-09-25T01:00:00.000Z',
    lastResult: null,
    revisionWarning: null,
    freshness: fresh,
    calendar,
    ...overrides,
  })
}

async function installBaseMocks(page: Page): Promise<void> {
  await page.route('**/api/env', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', tdxRoot: 'C:/new_tdx', dataCutoff: '2026-09-15', stockCount: 5321, capabilities: {}, activeTrainingId: null }),
  }))
  await page.route('**/api/trainings/active', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ training: null }),
  }))
  await page.route('**/api/stocks?**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [{ code: '600519', market: 'sh', name: '贵州茅台', bars: 8200, lastDate: '2026-09-15' }], total: 1 }),
  }))
  await page.route('**/api/trainings', route => route.fulfill({
    status: 201, contentType: 'application/json',
    body: JSON.stringify({ training: { id: 77, tier: '3M', code: '600519', name: '贵州茅台', market: 'sh', startDate: '2026-09-16', plannedEnd: '2026-12-16', currentDate: null, status: 'running', settleDate: null, earlySettle: false, blind: false, adjustMode: 'forward', initialCash: 1000000, createdAt: '2026-09-16T01:00:00.000Z' } }),
  }))
  // M5-DEFAULTS：Launcher 挂载会读取训练默认设置；确定性 mock 避免真实服务往返竞态
  await page.route('**/api/settings/training', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ version: 1, feesEnabled: false, tPlusOne: true, initialCash: 1000000, adjustMode: 'forward', commissionRate: 0.00025, minimumCommission: 5, stampDutyRate: 0.0005, lotSize: 100, execution: 'same-day-raw-close', weightBasis: 'total-equity', corporateActionPolicy: 'cash-shares-v1' }),
  }))
}

test('a) freshness stale 时顶栏出现摇晃的"更新日线"醒目按钮＋截止日小字＋通达信盘后指引，窄屏不横向溢出', async ({ page }) => {
  await installBaseMocks(page)
  await page.route('**/api/data/status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: statusPayload({ state: 'unchanged', needsUpdate: true, reason: '数据源已有 2026-09-24 的日线', sourceMaxDate: '2026-09-15' }, freshness('stale')),
  }))
  await page.goto('/')
  const button = page.locator('.data-update-btn.attention')
  await expect(button).toBeVisible()
  await expect(button).toHaveClass(/shake/)
  await expect(button).toHaveText('更新日线')
  // stale 指引：先去通达信完成盘后下载，再回来重新读取（不暗示联网下载）
  await expect(button).toHaveAttribute('title', /请先在通达信完成盘后数据下载/)
  await expect(button).toHaveAttribute('title', /不联网/)
  await expect(page.locator('.data-status-note')).toBeVisible()
  await expect(page.locator('.data-status-note')).toHaveText('截止 2026-09-15')
  // 布局红线抽查：840/1024/1440/1920 四档宽度都不得横向溢出
  for (const width of [840, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow, `${width}px 宽出现横向溢出`).toBe(false)
  }
})

test('b) 点击更新 → POST refresh 被调用 → 更新中禁用态 → updated 后显示"数据已最新"，醒目按钮消失且常驻手动入口仍在', async ({ page }) => {
  await installBaseMocks(page)
  let refreshCalls = 0
  let statusPhase: 'initial' | 'running' | 'done' = 'initial'
  await page.route('**/api/data/refresh', route => {
    refreshCalls++
    void route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ taskId: 'task-1', state: 'running', joined: false }) })
  })
  await page.route('**/api/data/status', route => {
    const body = statusPhase === 'initial'
      ? statusPayload({ state: 'unchanged', needsUpdate: true, reason: '数据源已有新日线', sourceMaxDate: '2026-09-15' }, freshness('stale'))
      : statusPhase === 'running'
        ? statusPayload({ state: 'running', needsUpdate: true, reason: '更新任务进行中' }, freshness('stale'))
        : statusPayload({
            state: 'updated', needsUpdate: false,
            lastResult: { finishedAt: '2026-09-25T01:30:00.000Z', outcome: 'updated', added: 5321, removed: 0, revised: 12, message: '已更新到 2026-09-24，新增 5321 根' },
          })
    void route.fulfill({ status: 200, contentType: 'application/json', body })
  })
  await page.goto('/')
  const button = page.locator('.data-update-btn.attention')
  await expect(button).toBeVisible()
  statusPhase = 'running'
  await button.click()
  await expect.poll(() => refreshCalls).toBe(1)
  // 进入更新中：禁用态按钮（running 分支），不摇晃
  const runningButton = page.locator('.data-update-btn.running')
  await expect(runningButton).toBeVisible()
  await expect(runningButton).toBeDisabled()
  await expect(runningButton).toContainText('更新中')
  // 模拟任务完成：下一次轮询返回 updated + freshness current
  statusPhase = 'done'
  const okRow = page.locator('.data-status-ok')
  await expect(okRow).toBeVisible()
  await expect(okRow).toHaveText(/数据已最新 · 截止 2026-09-24/)
  // 醒目按钮全部消失，但常驻手动"重新读取本地日线"入口仍在
  await expect(page.locator('.data-update-btn')).toHaveCount(0)
  await expect(page.locator('.data-reread-btn')).toBeVisible()
  await expect(page.locator('.data-reread-btn')).toHaveText('重新读取')
})

test('c) 已最新（freshness current）初始态：绿点＋"数据已最新 · 截止"一行小字，无醒目按钮，手动重新读取入口常驻', async ({ page }) => {
  await installBaseMocks(page)
  await page.route('**/api/data/status', route => route.fulfill({
    status: 200, contentType: 'application/json', body: statusPayload(),
  }))
  await page.goto('/')
  const okRow = page.locator('.data-status-ok')
  await expect(okRow).toBeVisible()
  await expect(okRow).toContainText('数据已最新 · 截止 2026-09-24')
  await expect(page.locator('.data-update-btn')).toHaveCount(0)
  await expect(page.locator('.data-reread-btn')).toBeVisible()
  // 数据已最新时开始训练零打扰：点击直接创建，不弹确认框
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
await expect(page.locator(".suggestions button").first()).toBeVisible()
await page.locator(".suggestions button").first().click()
  await expect(page.getByText(/已选：/)).toBeVisible()
  let createCalls = 0
  // 返修 I1：与 g 同样的 continue 泄漏（真实创建会写入隔离服务）——fallback 链回创建夹具并等待响应
  await page.route('**/api/trainings', route => { createCalls++; return route.fallback() })
  const createResponsePromise = page.waitForResponse(
    response => /\/api\/trainings(\?|$)/.test(response.url()) && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect(page.locator('.data-confirm-panel')).toHaveCount(0)
  const createResponse = await createResponsePromise
  await expect.poll(() => createCalls).toBe(1)
  const createdBody = await createResponse.json()
  expect(createdBody.training.id).toBe(77)
})

test('d) freshness unknown 不显示绿色最新：中性"数据截至…最新交易日待确认"，手动重新读取入口仍可用', async ({ page }) => {
  await installBaseMocks(page)
  await page.route('**/api/data/status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: statusPayload({ sourceMaxDate: '2026-09-15' }, freshness('unknown'), null),
  }))
  await page.goto('/')
  const unknown = page.locator('.data-status-unknown')
  await expect(unknown).toBeVisible()
  await expect(unknown).toHaveText('数据截至 2026-09-15，最新交易日待确认')
  // 未知不绿色：不渲染绿点行与醒目琥珀按钮
  await expect(page.locator('.data-status-ok')).toHaveCount(0)
  await expect(page.locator('.data-update-btn.attention')).toHaveCount(0)
  await expect(page.locator('.data-reread-btn')).toBeVisible()
  await expect(page.locator('.data-reread-btn')).toHaveAttribute('title', /不联网/)
})

test('e) needsUpdate 时点开始训练弹确认框：仍要开始训练照常创建；先更新数据只触发 refresh 不创建', async ({ page }) => {
  await installBaseMocks(page)
  await page.route('**/api/data/status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: statusPayload({ state: 'unchanged', needsUpdate: true, reason: '数据源已有新日线', sourceMaxDate: '2026-09-15' }, freshness('stale')),
  }))
  let refreshCalls = 0
  let createCalls = 0
  await page.route('**/api/data/refresh', route => {
    refreshCalls++
    void route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ taskId: 'task-2', state: 'running', joined: false }) })
  })
  await page.route('**/api/trainings', route => {
    createCalls++
    void route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ training: { id: 78, tier: '3M', code: '600519', name: '贵州茅台', market: 'sh', startDate: '2026-09-16', plannedEnd: '2026-12-16', currentDate: null, status: 'running', settleDate: null, earlySettle: false, blind: false, adjustMode: 'forward', initialCash: 1000000, createdAt: '2026-09-16T01:00:00.000Z' } }),
    })
  })
  await page.goto('/')
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
await expect(page.locator(".suggestions button").first()).toBeVisible()
await page.locator(".suggestions button").first().click()
  await expect(page.getByText(/已选：/)).toBeVisible()
  await page.getByRole('button', { name: '开始训练' }).click()
  const dialog = page.locator('.data-confirm-panel')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('建议先更新日线数据')
  await expect(dialog).toContainText('本地日线数据截止 2026-09-15')
  // 次按钮【仍要开始训练】：创建请求照常发出
  await page.getByRole('button', { name: '仍要开始训练' }).click()
  await expect(dialog).not.toBeVisible()
  await expect.poll(() => createCalls).toBe(1)
  expect(refreshCalls).toBe(0)
  // 再次开始训练 → 弹窗 →【先更新数据】：refresh 被调用且不发创建请求
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: '先更新数据' }).click()
  await expect(dialog).not.toBeVisible()
  await expect.poll(() => refreshCalls).toBe(1)
  await page.waitForTimeout(500)
  expect(createCalls).toBe(1)
})

test('f) 无可用来源：中性警示按钮，点击后 409 中文原因行内展示（不用 alert）', async ({ page }) => {
  await installBaseMocks(page)
  await page.route('**/api/data/status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: statusPayload({
      state: 'idle', needsUpdate: true,
      source: { kind: 'none', name: '无可用来源', available: false },
      tdx: { available: false, root: null },
      online: { configured: false, provider: null },
    }, freshness('unknown')),
  }))
  let refreshCalls = 0
  await page.route('**/api/data/refresh', route => {
    refreshCalls++
    void route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '未检测到可用的日线数据来源：请先安装通达信并完成盘后下载' }) })
  })
  await page.goto('/')
  const unavailable = page.locator('.data-update-btn.unavailable')
  await expect(unavailable).toBeVisible()
  await expect(unavailable).toHaveText('未检测到通达信数据')
  await unavailable.click()
  const errorLine = page.locator('.data-refresh-error')
  await expect(errorLine).toBeVisible()
  await expect(errorLine).toHaveText('未检测到可用的日线数据来源：请先安装通达信并完成盘后下载')
  expect(refreshCalls).toBe(1)
})

test('g) freshness current 而 needsUpdate 兼容位为真（周末/节假日启发误报）：首页绿色、开始训练零打扰', async ({ page }) => {
  await installBaseMocks(page)
  // 场景：2026-09-26（周六）15:00 上海，cutoff 09-24；旧 needsUpdate 启发式按 09-25（中秋休市）误报，
  // 官方日历 freshness=current。首页须绿色"已最新"，开始训练不得弹"建议先更新"确认框。
  await page.route('**/api/data/status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: statusPayload({
      needsUpdate: true,
      reason: '本地日线数据截至 2026-09-24，落后于最近交易日 2026-09-25，建议更新（若当日为节假日休市，属正常现象）',
    }),
  }))
  let createCalls = 0
  // 返修 I1（control-handoff-20260928-48）：fallback 链回 installBaseMocks 的创建夹具
  // （continue 会把请求打进真实隔离服务），并返回 Promise 让 Playwright 等待处理完成，
  // 不用 void 丢 Promise；用例退出前真实等待创建响应（见下方 oracle）。
  await page.route('**/api/trainings', route => { createCalls++; return route.fallback() })
  await page.goto('/')
  const okRow = page.locator('.data-status-ok')
  await expect(okRow).toBeVisible()
  await expect(okRow).toContainText('数据已最新 · 截止 2026-09-24')
  // Launcher 守卫由 freshness 驱动：current → 直接创建，不弹确认框
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
await expect(page.locator(".suggestions button").first()).toBeVisible()
await page.locator(".suggestions button").first().click()
  await expect(page.getByText(/已选：/)).toBeVisible()
  // I1 零真实副作用 oracle（返修 control-handoff-20260928-48）：
  // 1) 创建响应身份必须是 mock 夹具（id 77）——route.continue() 把请求打进真实隔离服务时，
  //    响应来自真实库（id≠77），用例失败；
  // 2) 真实服务（page.request 绕过 page.route）的活动训练在创建前后不变——旧实现泄漏的真实
  //    创建会成为新的活动训练，用例失败。
  const createResponsePromise = page.waitForResponse(
    response => /\/api\/trainings(\?|$)/.test(response.url()) && response.request().method() === 'POST',
  )
  const activeBefore = await (await page.request.get('/api/trainings/active')).json()
  await page.getByRole('button', { name: '开始训练' }).click()
  await expect(page.locator('.data-confirm-panel')).toHaveCount(0)
  const createResponse = await createResponsePromise
  await expect.poll(() => createCalls).toBe(1)
  const createdBody = await createResponse.json()
  expect(createdBody.training.id).toBe(77)
  const activeAfter = await (await page.request.get('/api/trainings/active')).json()
  expect(activeAfter.training?.id ?? null).toBe(activeBefore.training?.id ?? null)
})
