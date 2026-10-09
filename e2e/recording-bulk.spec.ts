// REC-BULK-01：录像库批量导出/导入 e2e。
// 场景一（迁移主路径）：攒两份录像→全部导出为合并包→切换安装命名空间（模拟新版本安装）
// →批量导入合并包→库中恢复且回放可用；同时校验合并包文件名与格式契约头。
// 场景二（容错/去重）：多选导入「好文件＋损坏文件」不整批失败并计数报告；同批重复跳过不覆盖。
import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { evidencePath } from './runtime'

function recording(sessionId: string, trainingKey: string | null = null) {
  return {
    format: 'trainer-session', schemaVersion: 2, sessionId, createdAt: '2026-10-03T00:00:00.000Z',
    app: { version: 'test', gitCommit: 'test', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 800 }, dpr: 1 },
    trainingKey, events: [], checkpoints: [], gaps: [], complete: true,
    resources: { series: [], drawings: [], trainingMeta: [], accounts: [], trades: [], contexts: [] },
  }
}

async function cleanActive(page: Page) {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
}

async function openLibrary(page: Page) {
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
}

test('全部导出为合并包，并在新安装环境批量导入恢复且回放可用', async ({ page }) => {
  await cleanActive(page)
  let namespace = 'rec-bulk-a'
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: namespace } })
  })
  await page.goto('/')
  await openLibrary(page)
  // 攒两份录像：沿用既有单条导入路径（零回归口径）
  for (const id of ['bulk-1', 'bulk-2']) {
    await page.getByLabel('导入录制', { exact: true }).setInputFiles({
      name: `${id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recording(id, `${id}.key`))),
    })
    await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭回放', exact: true }).click()
    await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
  }
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  // 全部导出：单文件合并包
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '全部导出', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toContain('训练录像库-')
  expect(download.suggestedFilename()).toContain('.trainer-recordings.json')
  const bundlePath = evidencePath('recording-bulk-bundle.trainer-recordings.json')
  await download.saveAs(bundlePath)
  const bundle = JSON.parse((await readFile(bundlePath)).toString('utf8'))
  expect(bundle.format).toBe('trainer-recordings-bundle')
  expect(bundle.version).toBe(1)
  expect(typeof bundle.exportedAt).toBe('string')
  expect(bundle.items).toHaveLength(2)
  // 导入侧存储会重写 sessionId（imported-<uuid>），身份以 trainingKey 为准
  expect(new Set(bundle.items.map((item: any) => item.trainingKey))).toEqual(new Set(['bulk-1.key', 'bulk-2.key']))
  for (const item of bundle.items) {
    expect(item.format).toBe('trainer-session')
    expect([2, 3]).toContain(item.schemaVersion)
  }
  // 切换安装命名空间（模拟 v1.3.0 新环境）：库为空
  namespace = 'rec-bulk-b'
  await page.reload()
  await openLibrary(page)
  await expect(page.locator('.recording-history-item')).toHaveCount(0)
  // 批量导入合并包：全部恢复
  await page.getByLabel('导入录制', { exact: true }).setInputFiles(bundlePath)
  await expect(page.getByRole('status').filter({ hasText: '批量导入完成：成功 2' })).toBeVisible()
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  await page.screenshot({ path: evidencePath('recording-bulk-restored.png') })
  // 重复导入同一合并包：全部跳过、不产生重复行
  await page.getByLabel('导入录制', { exact: true }).setInputFiles(bundlePath)
  await expect(page.getByRole('status').filter({ hasText: '成功 0 / 跳过 2' })).toBeVisible()
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  // 重开录像库（父列表刷新后）回放恢复的录像
  await page.getByRole('button', { name: '返回训练', exact: true }).click()
  await openLibrary(page)
  await page.locator('[data-recording-source="imported"] .recording-history-open').first().click()
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
})

test('多选导入损坏文件不整批失败，同批重复跳过并计数报告', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-bulk-c' } })
  })
  await page.goto('/')
  await openLibrary(page)
  const good = { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recording('c-good', 'c.key'))) }
  const corrupt = { name: 'corrupt.json', mimeType: 'application/json', buffer: Buffer.from('{oops') }
  await page.getByLabel('导入录制', { exact: true }).setInputFiles([good, corrupt])
  await expect(page.getByRole('alert').filter({ hasText: '批量导入完成：成功 1 / 失败 1' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'corrupt.json' })).toBeVisible()
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(1)
  // 同批重复：同一文件选两次，导入一份、跳过一份，不覆盖
  const fresh = { name: 'fresh.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recording('c-fresh', 'c2.key'))) }
  await page.getByLabel('导入录制', { exact: true }).setInputFiles([fresh, fresh])
  await expect(page.getByRole('status').filter({ hasText: '成功 1 / 跳过 1' })).toBeVisible()
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  await page.screenshot({ path: evidencePath('recording-bulk-tolerant-import.png') })
})
