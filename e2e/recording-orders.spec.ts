import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { readRecordingArtifact } from './recording-file'
import { settleThroughConfirmation } from './training-flow'

// RF-02 用户报告（oracle）：训练中挂条件单/撤销条件单的操作没有被录像记录，属信息丢失。
// 端到端闭环：录制开启的训练中挂两笔条件单→撤一笔→结算（默认保留录像）→导出核对事件流
// →训练录像页从历史打开回放→业务操作列表可见挂单/撤单条目。

const SAMPLE = { code: '300857', startDate: '2026-04-15' }

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
  await expect(page.getByRole('status').filter({ hasText: '正在记录' })).toBeVisible()
}

async function lastBars(page: Page, id: number): Promise<Array<{ low: number; close: number }>> {
  const response = await page.request.get(`/api/trainings/${id}/bars?tf=1D`)
  expect(response.status()).toBe(200)
  return (await response.json()).bars
}

test('条件单挂单与撤单被录制，结算后回放业务列表可见', async ({ page }: { page: Page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await abandonActive(page)
  const id = await createOpenCloseTraining(page)
  await openTrainingPage(page)

  // 条件单面板：挂两笔低于市价的买入限价单，再撤第一笔
  const panel = page.locator('.trade-panel')
  await panel.getByRole('tab', { name: '条件单' }).click()
  await panel.getByRole('button', { name: '10%', exact: true }).click()
  const bars = await lastBars(page, id)
  const prevLow = bars.at(-1)!.low
  const triggerA = Number((prevLow * 0.98).toFixed(2))
  const triggerB = Number((prevLow * 0.96).toFixed(2))
  await panel.getByLabel('条件单触发价').fill(String(triggerA))
  await panel.getByLabel('挂单理由').fill('回踩支撑')
  await panel.getByRole('button', { name: '提交条件单' }).click()
  await expect(panel.locator('.order-item:not(.finished)')).toHaveCount(1)
  await panel.getByLabel('条件单触发价').fill(String(triggerB))
  await panel.getByRole('button', { name: '提交条件单' }).click()
  await expect(panel.locator('.order-item:not(.finished)')).toHaveCount(2)
  await panel.locator('.order-item:not(.finished)').first().getByRole('button', { name: '撤单' }).click()
  await expect(panel.locator('.order-item:not(.finished)')).toHaveCount(1)

  // 导出录制：挂/撤必须以 started+finished 成对进入事件流并带关键参数
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出录制', exact: true }).click()
  const output = evidencePath('recording-orders.json.gz')
  await (await pending).saveAs(output)
  expect([...(await readFile(output)).subarray(0, 2)]).toEqual([0x1f, 0x8b])
  const file = await readRecordingArtifact(output)
  if (file.schemaVersion !== 2) throw Error('Expected compact recording')
  const create = file.events.filter((event: any) => event.action === 'training.order.create')
  expect(create.map((event: any) => event.phase)).toEqual(['started', 'finished', 'started', 'finished'])
  expect(create.filter((event: any) => event.phase === 'finished').map((event: any) => event.outcome)).toEqual(['accepted', 'accepted'])
  const firstCreate = create[0]!
  expect(firstCreate.params).toMatchObject({ side: 'buy', orderType: 'limit', triggerPrice: triggerA })
  expect(typeof firstCreate.params.shares).toBe('number')
  const cancel = file.events.filter((event: any) => event.action === 'training.order.cancel')
  expect(cancel.map((event: any) => event.phase)).toEqual(['started', 'finished'])
  expect(cancel[1]!.outcome).toBe('accepted')
  expect(cancel[0]!.params).toMatchObject({ orderId: expect.any(Number) })

  // 结算（默认保留录像）→ 训练录像页历史回放：业务操作列表呈现挂单与撤单
  await settleThroughConfirmation(page)
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(page.locator('.recording-history-item')).toHaveCount(1)
  await page.locator('.recording-history-item').click()
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
  const businessTexts = page.locator('.replay-event-list .event-text')
  await expect(businessTexts).toHaveCount(3)
  await expect(businessTexts.nth(0)).toContainText('挂条件单')
  await expect(businessTexts.nth(0)).toContainText('买入')
  await expect(businessTexts.nth(1)).toContainText('挂条件单')
  await expect(businessTexts.nth(2)).toContainText('撤条件单')
  // 状态条 dayText 显示当天最后一笔业务操作：本场景尾笔为撤单
  await expect(page.locator('.replay-event-text', { hasText: '撤条件单' })).toBeVisible()
  await page.screenshot({ path: evidencePath('recording-orders-replay.png') })

  expect(errors).toEqual([])
})
