import { test, expect } from '@playwright/test'
import { cp, writeFile } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { createRun, startServer } from '../scripts/runtime/run'
import { startTrainingFromForm } from './training-flow'
import { runtime, evidencePath } from './runtime'
import { readRecordingArtifact } from './recording-file'

test('独立数据库和全新浏览器可恢复训练事实并导入带画线录像', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const run = runtime()
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
  await expect(page.locator('.suggestions button').first()).toBeVisible()
  await page.locator('.suggestions button').first().click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  await expect(page.getByRole('status').filter({ hasText: '正在记录' })).toBeVisible()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('成交')
  await page.getByRole('button', { name: '推进下一日', exact: true }).click()
  await expect(page.getByRole('button', { name: '刷新图表', exact: true })).toBeEnabled()
  await page.locator('.draw-toolbar').getByRole('button', { name: '线段', exact: true }).click()
  const host = await page.locator('.chart-host').boundingBox()
  await page.mouse.click(host!.x + host!.width * .35, host!.y + 140)
  await page.waitForTimeout(550)
  await page.mouse.click(host!.x + host!.width * .55, host!.y + 180)
  await expect(page.locator('.drawing-save-status')).toHaveText('已保存')
  const id = (await (await page.request.get('/api/trainings/active')).json()).training.id
  await page.getByRole('button', { name: '提前结算', exact: true }).click()
  await page.getByRole('dialog', { name: '结束训练' }).getByRole('button', { name: '确认结算', exact: true }).click()
  const results = page.getByRole('dialog', { name: '训练结算' })
  await expect(results).toBeVisible()
  const pending = page.waitForEvent('download')
  await results.getByRole('button', { name: '导出本场录制', exact: true }).click()
  const filePath = evidencePath('backup-restore-recording.json.gz')
  await (await pending).saveAs(filePath)
  const recording = await readRecordingArtifact(filePath)
  expect(recording.events.some(event => event.action === 'training.trade' && event.outcome === 'accepted')).toBe(true)
  await results.getByRole('button', { name: '完成，返回首页', exact: true }).click()
  const before = await (await page.request.get(`/api/trainings/${id}`)).json()
  const beforeDrawings = await (await page.request.get(`/api/trainings/${id}/drawings`)).json()
  const beforeReport = await (await page.request.get(`/api/trainings/${id}/report`)).json()
  expect(before.trades.length).toBeGreaterThan(0)
  expect(beforeDrawings.drawings.length).toBeGreaterThan(0)

  const restored = await createRun(run.root, 'journey', { tdxRoot: run.tdxRoot })
  for (const path of [run.databasePath, restored.databasePath]) {
    const local = relative(join(run.root, '.runs'), path)
    expect(local && !local.startsWith('..') && !isAbsolute(local)).toBeTruthy()
  }
  const source = new DatabaseSync(run.databasePath, { readOnly: true })
  const snapshot = join(run.artifactsDir, 'backup-trainer.sqlite')
  try { await backup(source, snapshot) } finally { source.close() }
  await cp(snapshot, restored.databasePath)
  await cp(run.serverDir, restored.serverDir, { recursive: true })
  await cp(run.webDir, restored.webDir, { recursive: true })
  const server = await startServer(restored)
  const fresh = await browser.newContext({ baseURL: restored.baseURL, viewport: { width: 1440, height: 900 } })
  try {
    expect(await (await fresh.request.get(`/api/trainings/${id}`)).json()).toEqual(before)
    expect(await (await fresh.request.get(`/api/trainings/${id}/drawings`)).json()).toEqual(beforeDrawings)
    expect(await (await fresh.request.get(`/api/trainings/${id}/report`)).json()).toEqual(beforeReport)
    const restoredPage = await fresh.newPage()
    const pageErrors: string[] = []
    restoredPage.on('pageerror', error => pageErrors.push(error.message))
    await restoredPage.goto('/')
    await restoredPage.getByRole('button', { name: '训练录像', exact: true }).click()
    await expect(restoredPage.getByLabel('导入录制', { exact: true })).toBeEnabled({ timeout: 15_000 })
    await expect(restoredPage.getByText('还没有保存的本机训练录像', { exact: true })).toBeVisible()
    await restoredPage.getByLabel('导入录制', { exact: true }).setInputFiles(filePath)
    await expect(restoredPage.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
    await restoredPage.getByRole('button', { name: '跳到最后一天' }).click()
    await expect.poll(() => restoredPage.evaluate(() => (window as any).__trainerChart?.drawings().length ?? 0)).toBeGreaterThan(0)
    await expect(restoredPage.getByRole('button', { name: '买入', exact: true })).toHaveCount(0)
    await restoredPage.screenshot({ path: evidencePath('backup-restored-replay-dark.png') })
    await restoredPage.getByRole('button', { name: '切换到浅色主题', exact: true }).click()
    await restoredPage.setViewportSize({ width: 1280, height: 800 })
    expect(await restoredPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await restoredPage.screenshot({ path: evidencePath('backup-restored-replay-light.png') })
    expect(pageErrors).toEqual([])
    await expect(restoredPage.locator('vite-error-overlay')).toHaveCount(0)
    expect(await (await fresh.request.get(`/api/trainings/${id}`)).json()).toEqual(before)
    await writeFile(join(run.artifactsDir, 'backup-restore-receipt.json'), JSON.stringify({
      sourceRun: run.runId, restoredRun: restored.runId, trainingId: id,
      database: 'consistent SQLite snapshot copied into independent directory',
      matched: ['training', 'trades', 'drawings', 'report'], recording: 'exported gzip imported into empty browser context',
      replayDrawings: true, replayReadOnly: true, desktopAutomaticArchive: 'not exercised',
    }, null, 2))
  } finally { await fresh.close(); await server.stop() }
})
