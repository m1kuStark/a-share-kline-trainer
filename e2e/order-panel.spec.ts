import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// V1.2.3 用户反馈返修 e2e：统一下单面板（普通下单/条件单标签页＋共享仓位），
// 多条件单挂单列表，挂单标记悬停信息（移入显示/移开消失/主题令牌一致），开盘阶段唯一活动价位线。
// 真实隔离服务＋真实样本数据（300857），全部用户级交互；__trainerChart 仅只读定位与核验。

const SAMPLE = { code: '300857', startDate: '2026-04-15' }

const shot = (page: Page, name: string) => page.screenshot({ path: evidencePath(`order-panel-${name}.png`) })

async function abandonActive(page: Page): Promise<void> {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
}

async function createOpenCloseTraining(page: Page): Promise<number> {
  const created = await page.request.post('/api/trainings', {
    data: { code: SAMPLE.code, tier: '1M', start_date: SAMPLE.startDate, initial_cash: 1_000_000, blind: false, clock_mode: 'open_close', orders_enabled: true },
  })
  expect(created.status()).toBe(201)
  return (await created.json()).training.id
}

async function openTrainingPage(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.training-topbar .workspace-title')).toContainText(SAMPLE.code)
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存', { timeout: 15_000 })
}

async function snapshotJson(page: Page, id: number): Promise<{ training: { currentOpen: number | null; currentPhase: string }; bars: Array<{ low: number; close: number }>; account: { shares: number } }> {
  const response = await page.request.get(`/api/trainings/${id}/bars?tf=1D`)
  expect(response.status()).toBe(200)
  return response.json()
}

// 主题一致性探针：解析当前主题下 --surface-background 的实际色值。
// 悬浮层必须跟随该令牌（1.2.3 反馈＝引用未定义令牌导致深色主题回落浅色），不与个别面板的覆盖色比对。
async function surfaceTokenBackground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--surface-background)'
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  })
}

// 移出标记命中区：落到图表中部（远离右侧价格轴的标记触达窗口），
// 标记贴近可见区间顶部时"标记位置−固定偏移"会飞出图表，指针实际仍留在命中窗口附近
async function dismissHover(page: Page, hostBox: { x: number; y: number; width: number; height: number }): Promise<void> {
  await page.mouse.move(hostBox.x + hostBox.width * 0.3, hostBox.y + hostBox.height * 0.55)
}

test('统一下单面板＋多条件单＋悬停信息＋唯一活动价位线', async ({ page }: { page: Page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await abandonActive(page)
  const id = await createOpenCloseTraining(page)
  await openTrainingPage(page)

  // 开盘阶段：阶段价位线（当日开盘价）是唯一活动价位线，内置最新价线必须隐藏（1.2.3 双线问题回归）
  await expect.poll(() => page.evaluate(() => (window as unknown as { __trainerChart: { lastPriceMarkShow: () => boolean | null } }).__trainerChart.lastPriceMarkShow())).toBe(false)

  const panel = page.locator('.trade-panel')
  // 统一面板结构：标签页＋共享仓位控件；普通下单页保留买卖按钮
  await expect(panel.getByRole('tab', { name: '普通下单' })).toBeVisible()
  await expect(panel.getByRole('tab', { name: '条件单' })).toBeVisible()
  await expect(panel.getByPlaceholder('按股数买卖（选填）')).toBeVisible()
  await expect(panel.locator('.trade-action.buy')).toBeVisible()
  await expect(panel.locator('.trade-action.sell')).toBeVisible()

  // 按股数买入 200 股：共享输入框买卖通用（此前仅卖出可用）
  await panel.getByPlaceholder('按股数买卖（选填）').fill('200')
  await panel.locator('.trade-action.buy').click()
  await expect.poll(async () => (await snapshotJson(page, id)).account.shares).toBe(200)

  // 条件单标签页：买卖按钮收起，出现方向/类型/触发价/理由表单
  await panel.getByRole('tab', { name: '条件单' }).click()
  await expect(panel.locator('.trade-action.buy')).toBeHidden()
  await expect(panel.getByLabel('条件单方向')).toBeVisible()
  await expect(panel.getByLabel('条件单类型')).toBeVisible()
  await expect(panel.getByLabel('条件单触发价')).toBeVisible()
  await expect(panel.getByLabel('挂单理由')).toBeVisible()
  await expect(panel.getByRole('button', { name: '提交条件单' })).toBeVisible()

  // 挂单 A、B：不同触发价两笔同时 pending（多挂单支持）。样本股价约 ¥240，
  // 先把共享仓位切到 10%，两笔 10% 挂单加此前 200 股买入仍在现金余量内
  const before = await snapshotJson(page, id)
  const prevLow = before.bars.at(-1)!.low
  await panel.getByRole('button', { name: '10%', exact: true }).click()
  await panel.getByLabel('条件单触发价').fill((prevLow * 0.98).toFixed(2))
  await panel.getByLabel('挂单理由').fill('回踩支撑')
  await panel.getByRole('button', { name: '提交条件单' }).click()
  await expect(panel.locator('.order-item:not(.finished)')).toHaveCount(1)
  await panel.getByLabel('条件单触发价').fill((prevLow * 0.96).toFixed(2))
  await panel.getByRole('button', { name: '提交条件单' }).click()
  await expect(panel.locator('.order-item:not(.finished)')).toHaveCount(2)
  await expect(panel.locator('.order-item:not(.finished)').first()).toContainText('回踩支撑')
  await shot(page, 'pending-two-dark')

  // 悬停信息：移入标记显示、移开消失；深色主题下与面板同底色（同一设计令牌），纯信息层不拦截指针
  const marker = await page.evaluate(() => (window as unknown as { __trainerChart: { orderMarkerPoints: () => Array<{ id: number; x: number; y: number | null }> } }).__trainerChart.orderMarkerPoints())
  expect(marker.length).toBe(2)
  const hostBox = await page.locator('.chart-host').boundingBox()
  expect(hostBox).not.toBeNull()
  await page.mouse.move(hostBox!.x + marker[0].x - 7, hostBox!.y + (marker[0].y ?? 0))
  const tooltip = page.locator('.order-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('触发价')
  await expect(tooltip).toContainText('理由：回踩支撑')
  const tooltipBackground = await tooltip.evaluate(element => getComputedStyle(element).backgroundColor)
  expect(tooltipBackground).toBe(await surfaceTokenBackground(page))
  expect(await tooltip.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
  await shot(page, 'tooltip-hover-dark')
  await dismissHover(page, hostBox!)
  await expect(tooltip).toHaveCount(0)

  // 撤单 A：多笔列表回落到 1 笔；再撤 B 后空列表提示
  await panel.locator('.order-item:not(.finished)').first().getByRole('button', { name: '撤单' }).click()
  await expect(panel.locator('.order-item:not(.finished)')).toHaveCount(1)
  await panel.locator('.order-item:not(.finished)').first().getByRole('button', { name: '撤单' }).click()
  await expect(panel.locator('.order-item:not(.finished)')).toHaveCount(0)
  await expect(panel.locator('.order-list-empty')).toBeVisible()

  // 收盘也保留唯一阶段线和轴标签，内置最新价继续隐藏。
  await page.getByRole('button', { name: '推进下一日' }).click()
  await expect(page.locator('.phase-tag')).toContainText('收盘阶段')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __trainerChart: { lastPriceMarkShow: () => boolean | null } }).__trainerChart.lastPriceMarkShow())).toBe(false)

  // 收盘阶段再挂一笔（触发价在当日收盘价附近、visible 区间内），悬停信息在深浅主题下都与面板同底色
  const atClose = await snapshotJson(page, id)
  await panel.getByLabel('条件单触发价').fill((atClose.bars.at(-1)!.close * 0.97).toFixed(2))
  await panel.getByRole('button', { name: '提交条件单' }).click()
  await expect(panel.locator('.order-item:not(.finished)')).toHaveCount(1)
  const closeMarker = await page.evaluate(() => (window as unknown as { __trainerChart: { orderMarkerPoints: () => Array<{ id: number; x: number; y: number | null }> } }).__trainerChart.orderMarkerPoints())
  expect(closeMarker.length).toBe(1)
  await page.mouse.move(hostBox!.x + closeMarker[0].x - 7, hostBox!.y + (closeMarker[0].y ?? 0))
  await expect(tooltip).toBeVisible()
  await shot(page, 'tooltip-close-dark')

  await page.locator('.theme-toggle').click()
  // 点击主题切换会把指针物理移开标记区，悬浮层随之消失；重新移入验证浅色令牌
  await page.mouse.move(hostBox!.x + closeMarker[0].x - 7, hostBox!.y + (closeMarker[0].y ?? 0))
  await expect(tooltip).toBeVisible()
  const lightTooltipBackground = await tooltip.evaluate(element => getComputedStyle(element).backgroundColor)
  expect(lightTooltipBackground).toBe(await surfaceTokenBackground(page))
  await shot(page, 'tooltip-hover-light')
  await dismissHover(page, hostBox!)
  await expect(tooltip).toHaveCount(0)
  await page.locator('.theme-toggle').click()

  // 再次推进进入次日开盘阶段：状态消息只报开盘价（不再泄露当日收盘），唯一价位线保持
  await page.getByRole('button', { name: '推进下一日' }).click()
  await expect(page.locator('.status-strip')).toContainText(/，开盘 \d/)
  await expect(page.locator('.status-strip')).not.toContainText(/，收盘 \d/)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __trainerChart: { lastPriceMarkShow: () => boolean | null } }).__trainerChart.lastPriceMarkShow())).toBe(false)

  expect(errors).toEqual([])
})
