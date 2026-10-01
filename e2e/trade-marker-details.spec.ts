import { evidencePath } from './runtime'
import { startTrainingFromForm } from './training-flow'
import { expect, test, type Locator, type Page } from '@playwright/test'

const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', e => list.push(e.message)) })
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })
const shot = (page: Page, name: string) => page.screenshot({ path: evidencePath(`details-${name}.png`) })

const money = (value: number) => `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`
const panel = (page: Page): Locator => page.locator('.trade-marker-details')

async function open(page: Page, options: { blind?: boolean } = {}): Promise<number> {
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  const response = await page.request.post('/api/trainings', { data: { code: '600519', tier: '1Y', start_date: '2025-01-02', initial_cash: 100_000_000, blind: options.blind } })
  expect(response.status()).toBe(201)
  const id = (await response.json()).training.id
  await page.goto('/')
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  await expect(page.locator('.loading-dot')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__trainerChart?.bars?.().length))).toBe(true)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  return id
}

/** 首日一笔买入、隔 7 个交易日两笔买入：单笔徽标与聚合徽标投影间距超过聚合单元宽，必然分开 */
async function trainSingleAndCluster(page: Page, id: number) {
  expect((await page.request.post(`/api/trainings/${id}/trade`, { data: { side: 'buy', weightPct: 1 } })).ok()).toBe(true)
  for (let i = 0; i < 7; i++) expect((await page.request.post(`/api/trainings/${id}/next`)).ok()).toBe(true)
  expect((await page.request.post(`/api/trainings/${id}/trade`, { data: { side: 'buy', weightPct: 0.5 } })).ok()).toBe(true)
  expect((await page.request.post(`/api/trainings/${id}/trade`, { data: { side: 'buy', weightPct: 0.5 } })).ok()).toBe(true)
  await page.reload()
  await expect(page.locator('.trade-marker-badge')).toHaveCount(2)
  return (await (await page.request.get(`/api/trainings/${id}`)).json()).trades as Array<{ seq: number; date: string; price: number; shares: number; amount: number; fee: number }>
}

/** 首日一笔买入、隔 7 个交易日两笔买入，再隔 30 个交易日卖出 100 股（T+1）：
 *  B 与 S 徽标间距约 200px，互不落入对方 288px 详情浮层的覆盖范围，B→S→B 可不关闭连续点击 */
async function trainSingleClusterAndSell(page: Page, id: number) {
  expect((await page.request.post(`/api/trainings/${id}/trade`, { data: { side: 'buy', weightPct: 1 } })).ok()).toBe(true)
  for (let i = 0; i < 7; i++) expect((await page.request.post(`/api/trainings/${id}/next`)).ok()).toBe(true)
  expect((await page.request.post(`/api/trainings/${id}/trade`, { data: { side: 'buy', weightPct: 0.5 } })).ok()).toBe(true)
  expect((await page.request.post(`/api/trainings/${id}/trade`, { data: { side: 'buy', weightPct: 0.5 } })).ok()).toBe(true)
  for (let i = 0; i < 30; i++) expect((await page.request.post(`/api/trainings/${id}/next`)).ok()).toBe(true)
  expect((await page.request.post(`/api/trainings/${id}/trade`, { data: { side: 'sell', shares: 100 } })).ok()).toBe(true)
  await page.reload()
  await expect(page.locator('.trade-marker-badge')).toHaveCount(3)
  return (await (await page.request.get(`/api/trainings/${id}`)).json()).trades as Array<{ seq: number; date: string; side: 'buy' | 'sell'; price: number; shares: number; amount: number; fee: number }>
}

function factValue(page: Page, label: string) {
  return panel(page).locator('.details-facts div', { hasText: label }).locator('dd')
}

const headerTitle = (page: Page) => panel(page).locator('.details-head strong')

test('DETAILS-single-and-cluster：单笔直显、聚合列笔次选笔、金额费用按笔不合并', async ({ page }) => {
  const id = await open(page)
  const trades = await trainSingleAndCluster(page, id)
  const [singleTrade, ...clusterTrades] = trades
  const [second, third] = clusterTrades
  // 聚合在末日（#2、#3），单笔在 7 个交易日前（#1）
  expect(singleTrade.seq).toBe(1)

  // 悬停预览：进入显示、离开收起
  await page.locator('.trade-marker-badge[data-count="1"]').hover()
  await expect(panel(page)).toBeVisible()
  await page.mouse.move(15, 15)
  await expect(panel(page)).toHaveCount(0)

  // 单笔点击：直接是该笔事实，无笔次列表
  await page.locator('.trade-marker-badge[data-count="1"]').click()
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).locator('.details-list')).toHaveCount(0)
  await expect(factValue(page, '日期')).toHaveText(singleTrade.date)
  await expect(factValue(page, '方向')).toHaveText('买入')
  await expect(factValue(page, '序号')).toHaveText(`#${singleTrade.seq}`)
  await expect(factValue(page, '成交价')).toHaveText(money(singleTrade.price))
  await expect(factValue(page, '股数')).toHaveText(`${singleTrade.shares.toLocaleString('zh-CN')} 股`)
  await expect(factValue(page, '金额')).toHaveText(money(singleTrade.amount))
  await expect(factValue(page, '费用')).toHaveText(money(singleTrade.fee))

  // Esc 关闭并归还焦点到徽标
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement?.className)).toContain('trade-marker-badge')

  // 聚合点击：笔次列表逐笔列出，选择第二笔后事实随该笔更新，绝不合并多笔
  await page.locator('.trade-marker-badge[data-count="2"]').click()
  await expect(panel(page).locator('.details-list button')).toHaveCount(2)
  const rows = await panel(page).locator('.details-list button').allTextContents()
  expect(rows[0]).toContain(`#${second.seq}`)
  expect(rows[0]).toContain(money(second.price))
  expect(rows[1]).toContain(`#${third.seq}`)
  expect(rows[1]).toContain(money(third.price))
  await panel(page).locator('.details-list button', { hasText: `#${third.seq}` }).click()
  await expect(factValue(page, '序号')).toHaveText(`#${third.seq}`)
  await expect(factValue(page, '成交价')).toHaveText(money(third.price))
  await expect(factValue(page, '金额')).toHaveText(money(third.amount))
  await expect(panel(page).locator('.details-list button', { hasText: `#${third.seq}` })).toHaveAttribute('aria-pressed', 'true')
  // 已打开时悬停其它标记不抢占
  await page.locator('.trade-marker-badge[data-count="1"]').hover()
  await expect(factValue(page, '序号')).toHaveText(`#${third.seq}`)

  // 点击另一聚合内成交＝更新选择；键盘 Enter 可从徽标进入；关闭按钮可用
  await page.locator('.trade-marker-badge[data-count="1"]').click()
  await expect(factValue(page, '序号')).toHaveText(`#${singleTrade.seq}`)
  await panel(page).getByRole('button', { name: '关闭', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
  await page.locator('.trade-marker-badge[data-count="1"]').focus()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toBeVisible()
  await expect(factValue(page, '序号')).toHaveText(`#${singleTrade.seq}`)
  await shot(page, 'single-cluster')
})

test('REPAIR-F1 同一挂载 B→S→B：标题与事实区方向/序号始终一致', async ({ page }) => {
  const id = await open(page)
  const trades = await trainSingleClusterAndSell(page, id)
  const buy = trades.find(item => item.side === 'buy' && item.seq === 1)!
  const sell = trades.find(item => item.side === 'sell')!

  await page.locator('.trade-marker-badge[data-side="buy"][data-count="1"]').click()
  await expect(headerTitle(page)).toHaveText('买入')
  await expect(factValue(page, '方向')).toHaveText('买入')
  await expect(factValue(page, '序号')).toHaveText(`#${buy.seq}`)

  // 不关闭浮层直接切到卖出徽标：标题必须随当前成交更新（原缺陷：const 停留在首次方向）
  await page.locator('.trade-marker-badge[data-side="sell"]').click()
  await expect(headerTitle(page)).toHaveText('卖出')
  await expect(factValue(page, '方向')).toHaveText('卖出')
  await expect(factValue(page, '序号')).toHaveText(`#${sell.seq}`)
  expect(await headerTitle(page).innerText()).toBe(await factValue(page, '方向').innerText())

  // 再切回买入：方向反向更新
  await page.locator('.trade-marker-badge[data-side="buy"][data-count="1"]').click()
  await expect(headerTitle(page)).toHaveText('买入')
  await expect(factValue(page, '方向')).toHaveText('买入')
  await expect(factValue(page, '序号')).toHaveText(`#${buy.seq}`)
})

test('REPAIR-F2 hover 浮层键盘进入后不被鼠标离开关闭，焦点与指针均离开才收起', async ({ page }) => {
  const id = await open(page)
  await trainSingleAndCluster(page, id)
  await page.locator('.trade-marker-badge[data-count="1"]').hover()
  await expect(panel(page)).toBeVisible()

  // 真实键盘进入浮层（浮层被 Teleport 到 body 末尾，Shift+Tab 落到面板内可聚焦元素）
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.trade-marker-details') !== null)).toBe(true)
  const focusBefore = await page.evaluate(() => document.activeElement?.textContent ?? '')

  // 鼠标离开标记和浮层：焦点仍在面板内 → 浮层必须保留且焦点不丢
  await page.mouse.move(15, 15)
  await page.waitForTimeout(400)
  await expect(panel(page)).toBeVisible()
  expect(await page.evaluate(() => document.activeElement?.closest('.trade-marker-details') !== null)).toBe(true)
  expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toBe(focusBefore)

  // 真正焦点离开面板（指针仍在外）→ 普通预览收起
  await page.keyboard.press('Tab')
  await expect(panel(page)).toHaveCount(0)
})

test('REPAIR-F3 固定后徽标离屏浮层保留当前成交，回视口恢复锚定', async ({ page }) => {
  const id = await open(page)
  const trades = await trainSingleAndCluster(page, id)
  const second = trades.find(item => item.seq === 2)!
  await page.locator('.trade-marker-badge[data-count="2"]').click()
  await panel(page).locator('.details-list button', { hasText: `#${second.seq}` }).click()
  await panel(page).getByRole('button', { name: '固定', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '已固定', exact: true })).toBeVisible()

  // 真实滚轮平移让徽标离屏：面板必须继续显示仍存在的选中成交（最后有效位置）
  const host = await page.locator('.chart-host').boundingBox()
  await page.mouse.move(host!.x + host!.width * .5, host!.y + host!.height * .4)
  let offscreen = false
  for (let i = 0; i < 20 && !offscreen; i++) {
    await page.mouse.wheel(0, 600)
    offscreen = await page.locator('.trade-marker-badge').count() === 0
  }
  expect(offscreen).toBe(true)
  await expect(panel(page)).toBeVisible()
  await expect(factValue(page, '序号')).toHaveText(`#${second.seq}`)
  await expect(factValue(page, '成交价')).toHaveText(money(second.price))
  await shot(page, 'pin-offscreen')

  // 平移回视口：恢复徽标锚定，事实不变
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, -600)
    if (await page.locator('.trade-marker-badge').count() > 0) break
  }
  await expect(page.locator('.trade-marker-badge')).not.toHaveCount(0)
  await expect(panel(page)).toBeVisible()
  await expect(factValue(page, '序号')).toHaveText(`#${second.seq}`)
  await expect(factValue(page, '成交价')).toHaveText(money(second.price))
})

test('DETAILS-pin-lifecycle：固定后移开/切周期/resize 保持，解固定、Esc、外部按下关闭', async ({ page }) => {
  const id = await open(page)
  await trainSingleAndCluster(page, id)
  await page.locator('.trade-marker-badge[data-count="2"]').click()
  await panel(page).locator('.details-list button', { hasText: '#2' }).click()
  await expect(factValue(page, '序号')).toHaveText('#2')
  await panel(page).getByRole('button', { name: '固定', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '已固定', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // 移开鼠标不丢；焦点离开面板（外部按下不动固定面板）
  await page.mouse.move(15, 15)
  await expect(factValue(page, '序号')).toHaveText('#2')
  await page.locator('.chart-host').click({ position: { x: 200, y: 120 } })
  await expect(panel(page)).toBeVisible()

  // 切周期：聚合重算后仍在对应周线聚合内，选择与固定保持
  await page.keyboard.press('BracketRight')
  await expect(page.locator('.timeframe-tabs button.selected')).toHaveText('周K')
  await expect(page.locator('.loading-dot')).not.toBeVisible()
  await expect(panel(page)).toBeVisible()
  await expect(factValue(page, '序号')).toHaveText('#2')

  // resize 保持（840 与 1440）
  for (const size of [{ width: 840, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(350)
    await expect(panel(page)).toBeVisible()
    await expect(factValue(page, '序号')).toHaveText('#2')
  }
  await shot(page, 'pinned-weekly-1440')

  // 解固定后恢复普通关闭：外部按下关闭
  await panel(page).getByRole('button', { name: '已固定', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: '固定', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.locator('.chart-host').click({ position: { x: 200, y: 120 } })
  await expect(panel(page)).toHaveCount(0)

  // 切回日K（周K右缘相邻周线合并为一个徽标），再做 Esc 关闭与焦点归还序列
  await page.keyboard.press('BracketLeft')
  await expect(page.locator('.timeframe-tabs button.selected')).toHaveText('日K')
  await expect(page.locator('.loading-dot')).not.toBeVisible()

  // Esc 始终可关闭（含固定态），焦点归还徽标
  await page.locator('.trade-marker-badge[data-count="2"]').click()
  await panel(page).getByRole('button', { name: '固定', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement?.className)).toContain('trade-marker-badge')
})

test('DETAILS-replay-hotkeys：浮层内 Space/B/S/Delete/方向不触发交易、推进或画线', async ({ page }) => {
  const id = await open(page)
  expect((await page.request.post(`/api/trainings/${id}/trade`, { data: { side: 'buy', weightPct: 1 } })).ok()).toBe(true)
  await page.reload()
  await expect(page.locator('.trade-marker-badge')).toHaveCount(1)
  await page.locator('.trade-marker-badge').click()
  await panel(page).getByRole('button', { name: '固定', exact: true }).focus()

  const before = await (await page.request.get(`/api/trainings/${id}`)).json()
  for (const key of ['Space', 'b', 's', 'B', 'S', 'Delete', 'ArrowDown', 'ArrowUp']) await page.keyboard.press(key)
  const after = await (await page.request.get(`/api/trainings/${id}`)).json()
  expect(after.trades).toHaveLength(before.trades.length)
  expect(after.training.currentDate).toBe(before.training.currentDate)
  // 固定按钮吃到的 Space 只切换自身按压态，面板保持打开
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
})

test('DETAILS-replay-no-future：离线回放可查看，退至成交日前立即隐藏且无业务写请求', async ({ page }) => {
  test.setTimeout(120_000)
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  await page.goto('/')
  await expect(page.getByLabel('记录操作', { exact: true })).toBeChecked()
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
await expect(page.locator(".suggestions button").first()).toBeVisible()
await page.locator(".suggestions button").first().click()
  await expect(page.getByText(/已选：/)).toBeVisible()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText(/成交|买入/)
  await page.getByRole('button', { name: '推进下一日', exact: true }).click()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText(/成交|买入/)

  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出录制', exact: true }).click()
  const download = await pending
  const output = evidencePath('details-recorded.json.gz')
  await download.saveAs(output)

  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
  await page.route('**/api/**', route => route.abort())
  await page.getByLabel('导入录制', { exact: true }).setInputFiles(output)
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
  const writes: string[] = []
  page.on('request', request => { if (/\/api\//.test(request.url()) && ['POST', 'PUT', 'DELETE'].includes(request.method())) writes.push(request.url()) })

  await page.getByRole('button', { name: '跳到最后一天' }).click()
  await expect(page.locator('.replay-day')).toHaveText(/第 \d+ \/ \d+ 日/)
  // 相邻两日合并为一个聚合徽标：打开后选第二天（末日）那笔再固定
  await expect(page.locator('.trade-marker-badge')).toHaveCount(1)
  await page.locator('.trade-marker-badge').click()
  await expect(panel(page)).toBeVisible()
  await panel(page).locator('.details-list button', { hasText: '#2' }).click()
  await panel(page).getByRole('button', { name: '固定', exact: true }).click()
  await expect(factValue(page, '日期')).toHaveText('2026-09-02')

  // 退至成交日前：选中成交消失，面板立即清空（含固定）；日1成交仍显示
  await page.getByRole('button', { name: '上一日', exact: true }).click()
  await expect(page.locator('.trade-marker-badge')).toHaveCount(1)
  await expect(panel(page)).toHaveCount(0)

  // 回到成交日：无固定残留，可重新打开
  await page.getByRole('button', { name: '下一日', exact: true }).click()
  await expect(page.locator('.trade-marker-badge')).toHaveCount(1)
  await expect(panel(page)).toHaveCount(0)
  await page.locator('.trade-marker-badge').click()
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press('Escape')
  expect(writes).toEqual([])
  await shot(page, 'replay-details')
})

test('DETAILS-blind：盲训详情只显示相对日期，真实日期不泄露', async ({ page }) => {
  const id = await open(page, { blind: true })
  expect((await page.request.post(`/api/trainings/${id}/trade`, { data: { side: 'buy', weightPct: 1 } })).ok()).toBe(true)
  await page.reload()
  await expect(page.locator('.trade-marker-badge')).toHaveCount(1)
  await page.locator('.trade-marker-badge').click()
  await expect(panel(page)).toBeVisible()
  await expect(factValue(page, '日期')).toHaveText('今日')
  const panelText = await panel(page).innerText()
  expect(panelText).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  const aria = await page.locator('.trade-marker-badge').getAttribute('aria-label')
  expect(aria).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  expect(aria).toContain('今日')
  // 原生 title 已由详情浮层取代
  expect(await page.locator('.trade-marker-badge').getAttribute('title')).toBeNull()
  await shot(page, 'blind')
})

test('DETAILS-visual-regression：深浅主题、840/1440px 面板完整可见且徽标无重叠', async ({ page }) => {
  const id = await open(page)
  await trainSingleAndCluster(page, id)
  await page.locator('.trade-marker-badge[data-count="2"]').click()
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('button', { name: '固定', exact: true }).click()
  await page.mouse.move(15, 15)

  async function setTheme(theme: 'dark' | 'light') {
    const isDark = await page.evaluate(() => document.body.classList.contains('dark'))
    if ((theme === 'dark') !== isDark) await page.getByRole('button', { name: /切换到(深色|浅色)主题/ }).click()
  }

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(theme)
    for (const width of [840, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(350)
      await expect(panel(page)).toBeVisible()
      // F4：聚合列表文字必须随主题可读（深色亮字/浅色暗字），不接受深字叠深底
      const rowColor = await panel(page).locator('.details-list button').first().evaluate(el => getComputedStyle(el).color)
      const channels = rowColor.match(/\d+/g)!.map(Number)
      const brightness = channels[0]! + channels[1]! + channels[2]!
      if (theme === 'dark') expect(brightness).toBeGreaterThan(400)
      else expect(brightness).toBeLessThan(400)
      const box = await panel(page).boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      expect(box!.y + box!.height).toBeLessThanOrEqual(900)
      // 同侧徽标两两无重叠
      const badges = await page.locator('.trade-marker-badge').evaluateAll(elements => elements.map(el => {
        const rect = el.getBoundingClientRect()
        return { side: el.getAttribute('data-side'), left: rect.left, right: rect.right }
      }))
      for (const [index, badge] of badges.entries()) {
        for (const other of badges.slice(index + 1)) {
          if (badge.side !== other.side) continue
          expect(badge.right <= other.left || other.right <= badge.left).toBe(true)
        }
      }
      await shot(page, `${theme}-${width}`)
    }
  }
})
\nawait expect(page.locator(".suggestions button").first()).toBeVisible()\nawait page.locator(".suggestions button").first().click()