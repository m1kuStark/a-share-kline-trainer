import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { runtime, evidencePath } from './runtime'

test('本机页面正常读写，其他站点无法读取历史或修改设置', async ({ page }) => {
  const run = runtime()
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.request.put('/api/settings/app', { data: { autoDataCheck: true } })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '开始训练', exact: true })).toBeVisible()
  expect(await page.evaluate(async () => (await fetch('/api/trainings/history')).status)).toBe(200)
  expect(await page.evaluate(async () => (await fetch('/api/settings/app', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoDataCheck: true }),
  })).status)).toBe(200)
  await page.screenshot({ path: evidencePath('origin-guard-legitimate-page.png') })

  const foreign = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>隔离外站夹具</title>外站来源验证')
  })
  foreign.listen(0, '127.0.0.1')
  await once(foreign, 'listening')
  try {
    const port = (foreign.address() as { port: number }).port
    await page.goto(`http://127.0.0.1:${port}`)
    const results = await page.evaluate(async baseURL => {
      const read = await fetch(`${baseURL}/api/trainings/history`).then(response => `read:${response.status}`, () => 'blocked')
      const write = await fetch(`${baseURL}/api/settings/app`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoDataCheck: false }),
      }).then(response => `write:${response.status}`, () => 'blocked')
      return { read, write }
    }, run.baseURL!)
    expect(results).toEqual({ read: 'blocked', write: 'blocked' })
    expect((await (await page.request.get(`${run.baseURL}/api/settings/app`)).json()).autoDataCheck).toBe(true)
  } finally {
    await new Promise<void>((resolve, reject) => foreign.close(error => error ? reject(error) : resolve()))
  }
})
