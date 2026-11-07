import { expect, test, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

// SETUP-PASTE-01（Issue #8-B，用户 2026-11-07 拍板）e2e：
// 顶栏「连接通达信」弹层支持手动输入/粘贴路径；检查通过前不允许保存；取消零写入；
// 原生「浏览文件夹…」入口保持原行为（data-update.spec f 独立锁定）。
// 隔离服务端真实提供 env/settings/trainings；/api/data/status 与 setup 系列用 route mock
// 构造"未连接 + 用户确认路径"的确定性场景（原生选择器在无头环境无法打开）。

function freshness(state: 'current' | 'stale' | 'unknown'): Record<string, unknown> {
  return {
    state,
    expectedDate: state === 'unknown' ? null : '2026-09-24',
    sourceMaxDate: '2026-09-15',
    checkedAt: '2026-09-25T01:00:00.000Z',
    reason: '缺少可信交易日历，无法推算应收收盘日。来源末日不证明所有股票完整。',
  }
}

function statusPayload(): string {
  return JSON.stringify({
    state: 'unchanged', needsUpdate: true, reason: '本地数据与数据源一致',
    source: { kind: 'none', name: '无可用来源', available: false },
    tdx: { available: false, root: null },
    online: { configured: false, provider: null },
    sourceMaxDate: '2026-09-15', lastCheckedAt: '2026-09-25T01:00:00.000Z',
    lastResult: null, revisionWarning: null,
    freshness: freshness('unknown'),
    calendar: { id: 'sse-2026-annual', from: '2026-01-01', through: '2026-12-31', sourceUrl: 'https://www.sse.com.cn/', version: 'snapshot' },
  })
}

async function installBaseMocks(page: Page): Promise<void> {
  await page.route('**/api/data/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: statusPayload() }))
  await page.route('**/api/trainings/active', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ training: null }) }))
  await page.route('**/api/settings/training', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ version: 1, feesEnabled: false, tPlusOne: true, initialCash: 1000000, adjustMode: 'forward', commissionRate: 0.00025, minimumCommission: 5, stampDutyRate: 0.0005, lotSize: 100, execution: 'same-day-raw-close', weightBasis: 'total-equity', corporateActionPolicy: 'cash-shares-v1' }),
  }))
}

async function openConnectDialog(page: Page): Promise<void> {
  await installBaseMocks(page)
  await page.goto('/')
  const entry = page.locator('.data-update-btn.unavailable')
  await expect(entry).toBeVisible()
  await expect(entry).toHaveText('连接通达信')
  await entry.click()
  await expect(page.getByRole('dialog', { name: '连接通达信', exact: true })).toBeVisible()
}

test('手动粘贴深层路径：检查通过才能保存；保存走 save-choice+apply 并提示重启完成；不调用原生选择器', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openConnectDialog(page)
  const dialog = page.getByRole('dialog', { name: '连接通达信', exact: true })
  const deep = 'D:\\Very\\Deep\\Folder\\With Space\\tdx copy'

  const inspectBodies: string[] = []
  await page.route('**/api/setup/inspect', async route => {
    inspectBodies.push(JSON.parse(route.request().postData() ?? '{}').root)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ check: { root: deep, recognized: true, readable: true, problems: [] }, suggestions: [] }) })
  })
  const saveBodies: string[] = []
  await page.route('**/api/setup/save-choice', async route => {
    saveBodies.push(JSON.parse(route.request().postData() ?? '{}').root)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saved: true, root: deep, savedAt: '2026-11-07T00:00:00.000Z', apply: { available: true } }) })
  })
  const applyBodies: string[] = []
  await page.route('**/api/setup/apply', async route => {
    applyBodies.push(JSON.parse(route.request().postData() ?? '{}').root)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'restarting', attemptId: 'e2e-attempt' }) })
  })
  await page.route('**/api/setup/restart-status', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ attemptId: 'e2e-attempt', phase: 'ready', stage: 'done', reason: null, updatedAt: '2026-11-07T00:00:00.000Z', done: true }),
  }))
  let nativePickerCalls = 0
  await page.route('**/api/setup/select-directory', route => { nativePickerCalls++; void route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"cancelled"}' }) })

  // 保存按钮在检查通过前禁用
  await expect(dialog.getByRole('button', { name: '保存并连接' })).toBeDisabled()
  await dialog.getByLabel('通达信安装根目录').fill(deep)
  await dialog.getByRole('button', { name: '检查路径' }).click()
  await expect(dialog).toContainText('路径可用')
  expect(inspectBodies).toEqual([deep])
  await expect(dialog.getByRole('button', { name: '保存并连接' })).toBeEnabled()
  await dialog.getByRole('button', { name: '保存并连接' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.setup-connection-note')).toContainText('已切换到新的通达信目录')
  expect(saveBodies).toEqual([deep])
  expect(applyBodies).toEqual([deep])
  expect(nativePickerCalls).toBe(0)
  expect(errors).toEqual([])
})

test('非法目录：显示可行动原因、不保存；取消零写入；弹层 1280/1440 不溢出且无 pageerror', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openConnectDialog(page)
  const dialog = page.getByRole('dialog', { name: '连接通达信', exact: true })
  let saveCalls = 0
  await page.route('**/api/setup/save-choice', route => { saveCalls++; void route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) })
  await page.route('**/api/setup/inspect', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ check: { root: '', recognized: false, readable: false, problems: ['缺少 vipdoc 目录', '缺少 T0002 目录'] }, suggestions: [] }) })
  })
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size)
    await dialog.getByLabel('通达信安装根目录').fill('C:\\wrong-folder')
    await dialog.getByRole('button', { name: '检查路径' }).click()
    await expect(dialog).toContainText('缺少 vipdoc 目录')
    await expect(dialog.getByRole('button', { name: '保存并连接' })).toBeDisabled()
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(size.width)
    expect(box.y + box.height).toBeLessThanOrEqual(size.height)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: evidencePath(`setup-paste-${size.width}.png`) })
    await dialog.getByRole('button', { name: '关闭连接通达信弹层' }).click()
    await expect(dialog).not.toBeVisible()
    // 再次打开用于下一尺寸（弹层重置）
    await page.locator('.data-update-btn.unavailable').click()
    await expect(dialog).toBeVisible()
  }
  expect(saveCalls).toBe(0)
  expect(errors).toEqual([])
})
