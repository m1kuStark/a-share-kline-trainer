import { expect, test, type Page } from '@playwright/test'

// DIAG-OPLOG-01：真实页面操作 -> 本机操作日志（验收/问题定位）；只看脱敏后的 tail，不读训练数据。
async function tailRows(page: Page, limit = 120): Promise<Array<Record<string, any>>> {
  const response = await page.request.get('/api/diagnostics/tail?limit=' + limit)
  expect(response.status()).toBe(200)
  const body = await response.json() as { lines: string[] }
  return body.lines.map(line => JSON.parse(line))
}

test('本地操作日志记录真实点击/页面错误/业务 API，并可通过 info 定位日志文件', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '训练', exact: true })).toBeVisible({ timeout: 30_000 })
  const info = await page.request.get('/api/diagnostics/info')
  expect(info.status()).toBe(200)
  const infoBody = await info.json() as { enabled: boolean, logPath: string, format: string }
  expect(infoBody.enabled).toBe(true)
  expect(infoBody.format).toBe('jsonl')
  expect(infoBody.logPath).toMatch(/operations\.log$/)
  await expect.poll(async () => {
    const rows = await tailRows(page)
    return rows.some(row => row.type === 'lifecycle' && row.action === 'app.ready')
  }, { timeout: 15_000 }).toBe(true)

  await page.getByRole('button', { name: '训练', exact: true }).click()
  await page.evaluate(() => {
    setTimeout(() => { throw new Error('e2e-operation-log-probe') }, 0)
  })
  await expect.poll(async () => {
    const rows = await tailRows(page)
    return rows.some(row => row.type === 'ui' && row.action === 'click' && row.data?.label === '训练')
  }, { timeout: 15_000 }).toBe(true)
  await expect.poll(async () => {
    const rows = await tailRows(page)
    return rows.some(row => row.type === 'error' && String(row.data?.message ?? '').includes('e2e-operation-log-probe'))
  }, { timeout: 15_000 }).toBe(true)
  const rows = await tailRows(page)
  expect(rows.some(row => row.type === 'api' && String(row.action).startsWith('GET /api/'))).toBe(true)
  expect(JSON.stringify(rows)).not.toContain('password')
})
