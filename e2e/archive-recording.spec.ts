// DATA-ARCH-01 录像自动归档·浏览器（journey/dev Web）形态降级验证。
// 简报执行要求③：dev Web 模式下结算→无文件系统→降级提示断言（Electron IPC 路径由
// desktop/test/archive-ipc.test.ts 覆盖，此处不强求）。同时断言既有单条导出链零回归。
// 结算走真实点击纪律（training-flow.ts 同款步骤内联，中间插入「导出本场录制」）。
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { readRecordingArtifact } from './recording-file'
import { startTrainingFromForm } from './training-flow'
import { evidencePath } from './runtime'

test('训练结束后自动归档：浏览器环境降级为控制台提示，手动导出链不受影响', async ({ page }) => {
  // 前置：journey 是纯 Web 运行形态——渲染进程不存在桌面归档桥
  expect(await page.evaluate(() => (window as unknown as { desktopRecordings?: unknown }).desktopRecordings ?? null)).toBeNull()

  const consoleMessages: string[] = []
  page.on('console', message => consoleMessages.push(`[${message.type()}] ${message.text()}`))

  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
  await page.goto('/')
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
  await expect(page.locator('.suggestions button').first()).toBeVisible()
  await page.locator('.suggestions button').first().click()
  await expect(page.getByText(/已选：/)).toBeVisible()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await startTrainingFromForm(page)
  await expect(page.getByRole('status').filter({ hasText: '正在记录' })).toBeVisible()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('成交')

  // 结束训练：显式确认弹窗（真实点击）→ 结算面板
  await page.getByRole('button', { name: '提前结算', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '结束训练' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: '保留到本机训练历史' })).toBeChecked()
  await dialog.getByRole('button', { name: '确认结算', exact: true }).click()
  const results = page.getByRole('dialog', { name: '训练结算' })
  await expect(results).toBeVisible()

  // 既有单条导出链零回归：结算面板「导出本场录制」仍产出 gzip 录像
  const pending = page.waitForEvent('download')
  await results.getByRole('button', { name: '导出本场录制', exact: true }).click()
  const download = await pending
  const output = evidencePath('archive-degrade-export.json.gz')
  await download.saveAs(output)
  expect([...(await readFile(output)).subarray(0, 2)]).toEqual([0x1f, 0x8b])
  const file = await readRecordingArtifact(output)
  expect(file.gaps).toEqual([])
  if (file.schemaVersion !== 2) throw Error('Expected compact recording')

  // 「完成，返回首页」触发结束钩子：无桌面 IPC 时降级提示且流程不被打断
  await results.getByRole('button', { name: '完成，返回首页', exact: true }).click()
  await expect(results).not.toBeVisible()
  await expect(page.getByRole('button', { name: '开始训练', exact: true })).toBeVisible({ timeout: 30_000 })
  const degrade = consoleMessages.find(text => text.includes('录像归档') && text.includes('浏览器环境'))
  expect(degrade, `expected degrade console info, got:\n${consoleMessages.join('\n')}`).toBeTruthy()
})
