// REC-COLLECT-01：录像库收藏与自定义目录 e2e（UI 轮）。
// 覆盖：星标快速加入/移出内置收藏；新建目录（校验）＋归档＋按目录过滤；
// 全部导出合并包携带 collections 清单；带结构合并包导入→重名目录并集合并；
// 删除录像→成员关系级联消失（重载后持久，IndexedDbCollectionStorage 首次真实浏览器执行）。
// 断言前先证观测面活着（非空清单再断言数量）。
import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { evidencePath } from './runtime'

function recording(sessionId: string, trainingKey: string) {
  return {
    format: 'trainer-session', schemaVersion: 2, sessionId, createdAt: '2026-10-26T00:00:00.000Z',
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
  await expect(page.getByLabel('导入录制', { exact: true })).toBeEnabled({ timeout: 15_000 })
}

/** 经既有单条导入路径播种一份导入录像（零回归口径），回到录像库界面 */
async function seedRecording(page: Page, sessionId: string) {
  await page.getByLabel('导入录制', { exact: true }).setInputFiles({
    name: `${sessionId}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recording(sessionId, `${sessionId}.key`))),
  })
  await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭回放', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
}

/** 目录条按钮（名称 + 实时计数，如「收藏 (2)」） */
function collectionChip(page: Page, name: string) {
  return page.locator('nav[aria-label="收藏目录"]').getByRole('button', { name: new RegExp(`^${name} \\(\\d+\\)$`) })
}

async function createCollection(page: Page, name: string) {
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  await page.getByLabel('目录名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(collectionChip(page, name)).toBeVisible()
}

/** 打开某行录像的归档面板（该行可见的「归档到目录」按钮） */
async function openArchivePanel(page: Page) {
  await page.locator('.recording-history-item').first().getByRole('button', { name: '归档到目录' }).click()
}

test('条目星标快速加入/移出内置收藏，收藏视图按成员过滤', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect-a' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'star-1')
  await seedRecording(page, 'star-2')
  // 观测面活性：先证两条导入录像在列，再断言目录计数
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  await expect(collectionChip(page, '收藏')).toContainText('(0)')
  await expect(collectionChip(page, '全部')).toContainText('(2)')
  // 星标加入：星钮状态与目录计数同步
  await page.locator('[data-recording-source="imported"] .recording-history-item').first().getByRole('button', { name: '加入收藏' }).click()
  await expect(collectionChip(page, '收藏')).toContainText('(1)')
  const starred = page.locator('[data-recording-source="imported"] .recording-history-item').first().getByRole('button', { name: '移出收藏' })
  await expect(starred).toBeVisible()
  await expect(starred).toHaveAttribute('aria-pressed', 'true')
  // 收藏视图过滤：仅成员可见（跨两列合计）
  await collectionChip(page, '收藏').click()
  await expect(page.locator('.recording-history-item')).toHaveCount(1)
  await collectionChip(page, '全部').click()
  await expect(page.locator('.recording-history-item')).toHaveCount(2)
  // 再点移出：QQ 邮箱式往返
  await page.locator('[data-recording-source="imported"] .recording-history-item').first().getByRole('button', { name: '移出收藏' }).click()
  await expect(collectionChip(page, '收藏')).toContainText('(0)')
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item').first().getByRole('button', { name: '加入收藏' })).toBeVisible()
})

test('新建目录（空白拒/重名拒）、归档与按目录过滤、重命名与删除目录，全部导出携带收藏结构', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect-b' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'dir-1')
  await seedRecording(page, 'dir-2')
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  // 新建：空白名拒绝（错误人话，表单保持）
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  await page.getByLabel('目录名称', { exact: true }).fill('   ')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '目录名称不能为空' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  // 新建：与内置收藏重名拒绝
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  await page.getByLabel('目录名称', { exact: true }).fill('收藏')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '已存在同名目录：收藏' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  // 新建成功
  await createCollection(page, '骑牛1买训练')
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(0)')
  // 归档第一条入目录（勾选幂等归属）；内置收藏也可经归档菜单操作（与星标等价）
  await openArchivePanel(page)
  await page.locator('.recording-archive-panel').getByLabel('骑牛1买训练').check()
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(1)')
  await page.locator('.recording-archive-panel').getByLabel('收藏').check()
  await expect(collectionChip(page, '收藏')).toContainText('(1)')
  await page.locator('.recording-archive-panel').getByRole('button', { name: '收起归档' }).click()
  // 按目录过滤：目录视图=1 条，收藏视图=同一条（多对多），全部=2 条
  await collectionChip(page, '骑牛1买训练').click()
  await expect(page.locator('.recording-history-item')).toHaveCount(1)
  await collectionChip(page, '收藏').click()
  await expect(page.locator('.recording-history-item')).toHaveCount(1)
  await collectionChip(page, '全部').click()
  await expect(page.locator('.recording-history-item')).toHaveCount(2)
  // 重命名：重名拒绝（人话）后成功改名
  await page.locator('nav[aria-label="收藏目录"]').getByRole('button', { name: '重命名目录：骑牛1买训练' }).click()
  await page.getByLabel('目录名称', { exact: true }).fill('收藏')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '已存在同名目录：收藏' })).toBeVisible()
  await page.getByLabel('目录名称', { exact: true }).fill('左峰突破训练')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(collectionChip(page, '左峰突破训练')).toContainText('(1)')
  // 全部导出：合并包携带收藏结构（下载内容断言）
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '全部导出', exact: true }).click()
  const download = await pending
  const bundlePath = evidencePath('rec-collect-bundle.trainer-recordings.json')
  await download.saveAs(bundlePath)
  const bundle = JSON.parse((await readFile(bundlePath)).toString('utf8'))
  expect(bundle.format).toBe('trainer-recordings-bundle')
  expect(bundle.version).toBe(1)
  expect(bundle.collections.type).toBe('recording-collections-manifest')
  expect(bundle.collections.collections).toEqual(expect.arrayContaining([
    { name: '收藏', kind: 'builtin' },
    { name: '左峰突破训练', kind: 'user' },
  ]))
  const memberNames = bundle.collections.members.map((member: { collectionName: string }) => member.collectionName)
  expect(memberNames).toEqual(expect.arrayContaining(['收藏', '左峰突破训练']))
  expect(bundle.collections.members.every((member: { recordingKey: string }) => /^imported:/.test(member.recordingKey))).toBe(true)
  await expect(page.getByRole('status').filter({ hasText: '含收藏结构' })).toBeVisible()
  // 删除目录：确认框→成员关系清除、录像本体不动
  await page.locator('nav[aria-label="收藏目录"]').getByRole('button', { name: '删除目录：左峰突破训练' }).click()
  await page.getByRole('alertdialog', { name: '确认删除目录' }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(collectionChip(page, '左峰突破训练')).toHaveCount(0)
  await expect(collectionChip(page, '收藏')).toContainText('(1)')
  await expect(page.locator('.recording-history-item')).toHaveCount(2)
  await page.screenshot({ path: evidencePath('rec-collect-library-collections.png') })
})

test('带收藏结构的合并包导入：重名目录并集合并；删除录像成员关系级联消失且重载持久', async ({ page }) => {
  await cleanActive(page)
  let namespace = 'rec-collect-c'
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: namespace } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'merge-1')
  await seedRecording(page, 'merge-2')
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  await createCollection(page, '骑牛1买训练')
  // merge-1 归档进目录；merge-2 星标进收藏
  await openArchivePanel(page)
  await page.locator('.recording-archive-panel').getByLabel('骑牛1买训练').check()
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(1)')
  await page.locator('.recording-archive-panel').getByRole('button', { name: '收起归档' }).click()
  await page.locator('.recording-history-item').nth(1).getByRole('button', { name: '加入收藏' }).click()
  await expect(collectionChip(page, '收藏')).toContainText('(1)')
  // 导出带结构合并包
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '全部导出', exact: true }).click()
  const download = await pending
  const bundlePath = evidencePath('rec-collect-merge-bundle.trainer-recordings.json')
  await download.saveAs(bundlePath)
  // 切换安装命名空间（模拟新机器）：预置同名目录且已有一名既有成员（并集不丢的对照）
  namespace = 'rec-collect-d'
  await page.reload()
  await openLibrary(page)
  await expect(page.locator('.recording-history-item')).toHaveCount(0)
  await seedRecording(page, 'merge-3')
  await createCollection(page, '骑牛1买训练')
  await openArchivePanel(page)
  await page.locator('.recording-archive-panel').getByLabel('骑牛1买训练').check()
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(1)')
  await page.locator('.recording-archive-panel').getByRole('button', { name: '收起归档' }).click()
  // 导入带结构的合并包：录像恢复＋目录与成员合并
  await page.getByLabel('导入录制', { exact: true }).setInputFiles(bundlePath)
  await expect(page.getByRole('status').filter({ hasText: '批量导入完成：成功 2' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '收藏目录已合并' })).toBeVisible()
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(3)
  // 重名目录并集：既有成员（merge-3）不丢，导入成员（merge-1）并入
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(2)')
  // 内置收藏成员随包恢复（merge-2）
  await expect(collectionChip(page, '收藏')).toContainText('(1)')
  // 删除录像→成员关系级联消失：目录视图下删掉一名目录成员（成员排序不稳定，删任一成员
  // 的断言等价：目录计数 2→1、总清单 3→2；收藏成员 merge-2 不在目录视图内、不受影响）
  await collectionChip(page, '骑牛1买训练').click()
  await expect(page.locator('.recording-history-item')).toHaveCount(2)
  await page.locator('.recording-history-item').first().getByRole('button', { name: '删除录像' }).click()
  await page.getByRole('alertdialog', { name: '确认删除录像' }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.recording-history-item')).toHaveCount(1)
  await collectionChip(page, '全部').click()
  await expect(page.locator('.recording-history-item')).toHaveCount(2)
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(1)')
  await expect(collectionChip(page, '收藏')).toContainText('(1)')
  // 重载后成员关系持久（IndexedDbCollectionStorage 真实浏览器存取）
  await page.reload()
  await openLibrary(page)
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(1)')
  await expect(collectionChip(page, '收藏')).toContainText('(1)')
  await page.screenshot({ path: evidencePath('rec-collect-cascade-persist.png') })
})
