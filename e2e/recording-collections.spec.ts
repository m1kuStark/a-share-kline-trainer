// REC-COLLECT-01 UI v2（方案 A，2026-10-29 用户拍板）录像库收藏与自定义目录 e2e。
// 覆盖：星标往返与目录过滤（v1 语义零回归）；行内固定四控件＋行高恒定；
// 锚定「加入目录」弹层（清单绝不含收藏、勾选即生效、仅一个弹层、Esc/点外/再点关闭且焦点返回、
// 新建目录并加入就地报错、≥8 目录过滤框、操作失败就地报错）；目录条单行横向滚动＋chip ⋯ 溢出
// 管理菜单（重命名/删除走既有确认对话框）；批量选择模式（等高批量栏、一次 assign 全部选中键、
// 退出零位移）；导出含 collections 结构、导入并集合并、删除级联且重载持久（v1 语义零回归）。
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

/** 目录条条尾「新建目录」入口＋既有内联表单（v2：入口移到条尾，交互不变） */
async function createCollectionAtBar(page: Page, name: string) {
  await page.locator('nav[aria-label="收藏目录"]').getByRole('button', { name: '新建目录', exact: true }).click()
  await page.getByLabel('目录名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(collectionChip(page, name)).toBeVisible()
}

/** 打开某行录像的「加入目录」锚定弹层，返回弹层定位器 */
async function openArchivePopover(page: Page, nth = 0) {
  await page.locator('[data-recording-source="imported"] .recording-history-item').nth(nth).getByRole('button', { name: '加入目录' }).click()
  const popover = page.locator('.archive-popover')
  await expect(popover).toBeVisible()
  return popover
}

/** 弹层展开/批量模式进出前后的行几何（逐像素不变的独立采样） */
async function rowBoxes(page: Page): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  return page.locator('[data-recording-source="imported"] .recording-history-item').evaluateAll(
    els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }),
  )
}

/** 直接从收藏库 IndexedDB 删除一条目录记录（模拟存储被外部改动，制造 assign 的自然失败） */
async function deleteCollectionRecord(page: Page, collectionId: string): Promise<void> {
  await page.evaluate(async id => {
    const databases = await indexedDB.databases()
    const hit = databases.find(db => db.name?.endsWith('.collections'))
    if (!hit?.name) throw new Error('collections database not found')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(hit.name!, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('collections', 'readwrite')
      tx.objectStore('collections').delete(id)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    })
  }, collectionId)
}

test('条目星标快速加入/移出内置收藏，收藏视图按成员过滤', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect2-a' } })
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

test('每行固定四控件无展开块，弹层打开前后列表行位置不变', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect2-b' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'fixed-1')
  await seedRecording(page, 'fixed-2')
  await createCollectionAtBar(page, '突破左峰')
  const rows = page.locator('[data-recording-source="imported"] .recording-history-item')
  await expect(rows).toHaveCount(2)
  // 四控件：星标｜主信息｜加入目录｜删除（行内再无其他元素，无归档展开面板）
  const row = rows.first()
  await expect(row.getByRole('button', { name: '加入收藏' })).toBeVisible()
  await expect(row.getByRole('button', { name: '加入目录' })).toBeVisible()
  await expect(row.getByRole('button', { name: '删除录像' })).toBeVisible()
  await expect(page.getByRole('button', { name: '归档到目录' })).toHaveCount(0)
  await expect(page.locator('.recording-archive-panel')).toHaveCount(0)
  // 布局恒定：弹层开（勾选状态变化）前后，行数与每行几何逐像素不变
  const before = await rowBoxes(page)
  const popover = await openArchivePopover(page)
  await expect(popover.getByRole('checkbox', { name: '突破左峰' })).toBeVisible()
  expect(await rowBoxes(page)).toEqual(before)
  await popover.getByRole('checkbox', { name: '突破左峰' }).check()
  await expect(collectionChip(page, '突破左峰')).toContainText('(1)')
  expect(await rowBoxes(page)).toEqual(before)
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  expect(await rowBoxes(page)).toEqual(before)
})

test('弹层清单只含用户目录，勾选即生效且同一时刻仅一个弹层', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect2-c' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'list-1')
  await seedRecording(page, 'list-2')
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  await createCollectionAtBar(page, '骑牛1买训练')
  await createCollectionAtBar(page, '假阴真阳')
  const popover = await openArchivePopover(page)
  await expect(popover.getByRole('heading', { name: '加入目录' })).toBeVisible()
  // 清单绝不含内置收藏（用户否决理由一：星标是收藏唯一写入口）
  await expect(popover.getByRole('checkbox')).toHaveCount(2)
  await expect(popover.getByRole('checkbox', { name: '收藏' })).toHaveCount(0)
  // 勾选即生效（乐观更新）：加入两目录，计数同步
  await popover.getByRole('checkbox', { name: '骑牛1买训练' }).check()
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(1)')
  await popover.getByRole('checkbox', { name: '假阴真阳' }).check()
  await expect(collectionChip(page, '假阴真阳')).toContainText('(1)')
  // 取消勾选即移出
  await popover.getByRole('checkbox', { name: '骑牛1买训练' }).uncheck()
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(0)')
  await expect(collectionChip(page, '假阴真阳')).toContainText('(1)')
  await page.keyboard.press('Escape')
  // 同一时刻仅一个浮层（开新关旧）：行级弹层开着时打开目录 chip 管理菜单 → 弹层关闭、全场仅剩一个浮层
  await openArchivePopover(page)
  const wrap = page.locator('.collection-chip-wrap').filter({ hasText: '骑牛1买训练' })
  await wrap.hover()
  await wrap.getByRole('button', { name: '管理目录：骑牛1买训练' }).click()
  await expect(page.locator('.chip-menu')).toBeVisible()
  await expect(page.locator('.archive-popover')).toHaveCount(0)
  await expect(page.locator('.anchored-popover')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.chip-menu')).toHaveCount(0)
  // 另一行打开弹层：锚定该行，清单勾选状态与该行成员关系一致（第二行未加入任何目录）
  const popover1 = await openArchivePopover(page, 1)
  await expect(popover1.getByRole('checkbox', { name: '假阴真阳' })).not.toBeChecked()
  await expect(popover1.getByRole('checkbox', { name: '骑牛1买训练' })).not.toBeChecked()
})

test('弹层关闭语义与焦点返回，Esc 点外部与再点触发按钮均可关闭', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect2-d' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'close-1')
  await createCollectionAtBar(page, '左峰训练')
  const trigger = page.locator('[data-recording-source="imported"] .recording-history-item').first().getByRole('button', { name: '加入目录' })
  // Esc 关闭且焦点返回触发按钮
  await trigger.click()
  const popover = page.locator('.archive-popover')
  await expect(popover).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  // 点外部关闭（页头空白处）且焦点返回
  await trigger.click()
  await expect(popover).toBeVisible()
  await page.locator('.recording-library-header h1').click()
  await expect(popover).toHaveCount(0)
  await expect(trigger).toBeFocused()
  // 弹层内 ✕ 关闭
  await trigger.click()
  await expect(popover).toBeVisible()
  await popover.getByRole('button', { name: '关闭加入目录' }).click()
  await expect(popover).toHaveCount(0)
  await expect(trigger).toBeFocused()
  // 再点触发按钮＝开→关
  await trigger.click()
  await expect(popover).toBeVisible()
  await trigger.click()
  await expect(popover).toHaveCount(0)
})

test('弹层内新建目录并加入，空白与重名就地报错且成功即勾选新目录', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect2-e' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'create-1')
  // 空目录弹层：空态引导＋新建输入首焦点
  const popover = await openArchivePopover(page)
  await expect(popover.getByText('还没有目录，新建一个开始整理')).toBeVisible()
  await expect(popover.getByLabel('新目录名称', { exact: true })).toBeFocused()
  // 空白名就地报错（复用既有校验文案），弹层保持
  await popover.getByRole('button', { name: '加入', exact: true }).click()
  await expect(popover.getByRole('alert').filter({ hasText: '目录名称不能为空' })).toBeVisible()
  // 与内置收藏重名就地报错
  await popover.getByLabel('新目录名称', { exact: true }).fill('收藏')
  await popover.getByRole('button', { name: '加入', exact: true }).click()
  await expect(popover.getByRole('alert').filter({ hasText: '已存在同名目录：收藏' })).toBeVisible()
  // 成功：新建并加入当前录像——新目录出现在清单且已勾选，目录条 chip 计数 1
  await popover.getByLabel('新目录名称', { exact: true }).fill('B1买点训练')
  await popover.getByLabel('新目录名称', { exact: true }).press('Enter')
  await expect(popover.getByRole('checkbox', { name: 'B1买点训练' })).toBeChecked()
  await expect(collectionChip(page, 'B1买点训练')).toContainText('(1)')
  await page.keyboard.press('Escape')
  // 再次打开：新建入口折叠态，展开可继续新建（条尾入口是专门建，弹层内是顺路建）
  const popover2 = await openArchivePopover(page)
  await popover2.getByRole('button', { name: '新建目录并加入' }).click()
  await popover2.getByLabel('新目录名称', { exact: true }).fill('B1买点训练')
  await popover2.getByRole('button', { name: '加入', exact: true }).click()
  await expect(popover2.getByRole('alert').filter({ hasText: '已存在同名目录：B1买点训练' })).toBeVisible()
})

test('弹层操作失败就地报错且弹层保持可用（目录被外部移除）', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect2-f' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'fail-1')
  await createCollectionAtBar(page, '待移除目录')
  await createCollectionAtBar(page, '健在目录')
  const popover = await openArchivePopover(page)
  await expect(popover.getByRole('checkbox')).toHaveCount(2)
  // 收藏库中被外部移除「待移除目录」：勾选它 → assign 真实失败 → 弹层底部 role=alert 就地报错
  // （用 click 触发 change 而非 check()：失败后该行会随存储真实态刷新消失，check() 的复核会撞上卸载）
  await deleteCollectionRecord(page, await collectionChip(page, '待移除目录').getAttribute('data-collection-id'))
  await popover.getByRole('checkbox', { name: '待移除目录' }).click()
  await expect(popover.getByRole('alert').filter({ hasText: '目录不存在' })).toBeVisible()
  await expect(collectionChip(page, '待移除目录')).toHaveCount(0) // 失败后以存储真实态刷新
  // 弹层保持可用：另一目录勾选正常生效
  await popover.getByRole('checkbox', { name: '健在目录' }).check()
  await expect(collectionChip(page, '健在目录')).toContainText('(1)')
})

test('目录条多行换行全可见，管理按钮独立槽位不重叠且字号对齐控件基准', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect2-g' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'bar-1')
  await createCollectionAtBar(page, '目录甲')
  await createCollectionAtBar(page, '目录乙')
  await createCollectionAtBar(page, '目录丙')
  // 换行全可见（用户 2026-10-29 复验拍板：目录多也不许横向滚动隐藏）：
  // 容器 flex-wrap wrap 且无横向滚动；全部 chip 都在可滚区域外可见
  const chipsArea = page.locator('.recording-collections-wrap')
  await expect(chipsArea).toBeVisible()
  expect(await chipsArea.evaluate(el => getComputedStyle(el).flexWrap)).toBe('wrap')
  expect(await chipsArea.evaluate(el => getComputedStyle(el).overflowX)).not.toBe('scroll')
  expect(await chipsArea.evaluate(el => getComputedStyle(el).overflowX)).not.toBe('auto')
  for (const name of ['全部', '收藏', '目录甲', '目录乙', '目录丙']) {
    await expect(collectionChip(page, name)).toBeVisible()
  }
  // 字号对齐全局控件基准：chip 文字＝--font-size-sm（12px，tokens.css 控件基准档）
  expect(await collectionChip(page, '目录甲').evaluate(el => getComputedStyle(el).fontSize)).toBe('12px')
  // ⋯ 管理按钮独立槽位：与 chip 几何不重叠（右边界不越界），仅用户目录有
  await expect(page.locator('nav[aria-label="收藏目录"] .collection-overflow')).toHaveCount(3)
  const wrap = page.locator('.collection-chip-wrap').filter({ hasText: '目录甲' })
  const overflow = wrap.getByRole('button', { name: '管理目录：目录甲' })
  // 浏览态零常驻观感：hover 才显形（visibility 切换，槽位常驻＝布局恒定）；
  // 几何在 hover 显形后量取（槽位在文档流内常驻，显隐不改变几何——重叠检查对 hover 前后同样成立）
  await expect(overflow).toBeHidden()
  await wrap.hover()
  await expect(overflow).toBeVisible()
  const chipBox = await collectionChip(page, '目录甲').boundingBox()
  const overflowBox = await overflow.boundingBox()
  expect(chipBox, 'chip 应有几何').not.toBeNull()
  expect(overflowBox, '⋯ 显形后应有几何').not.toBeNull()
  expect(overflowBox!.x >= chipBox!.x + chipBox!.width - 0.5, '⋯ 按钮不得与 chip 重叠').toBe(true)
  // 菜单两项：重命名走既有内联表单（预填现名），删除走既有确认对话框（文案不变）
  // （菜单项 role=menuitem——显式角色覆盖隐式 button，按 menuitem 检索）
  await overflow.click()
  const menu = page.locator('.chip-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: '重命名目录' }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.getByLabel('目录名称', { exact: true })).toHaveValue('目录甲')
  await page.getByLabel('目录名称', { exact: true }).fill('目录甲改')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(collectionChip(page, '目录甲改')).toBeVisible()
  // 删除：⋯ 菜单 → 既有确认对话框
  const wrapB = page.locator('.collection-chip-wrap').filter({ hasText: '目录乙' })
  await wrapB.hover()
  await wrapB.getByRole('button', { name: '管理目录：目录乙' }).click()
  await page.locator('.chip-menu').getByRole('menuitem', { name: '删除目录' }).click()
  await page.getByRole('alertdialog', { name: '确认删除目录' }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(collectionChip(page, '目录乙')).toHaveCount(0)
  await expect(collectionChip(page, '目录甲改')).toBeVisible()
  await expect(collectionChip(page, '收藏')).toBeVisible()
  await page.screenshot({ path: evidencePath('rec-collect2-bar-overflow-menu.png') })
})

test('弹层过滤框在用户目录达到八个时出现，无命中显示无匹配目录', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect2-h' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'filter-1')
  // 七个目录：过滤框不出现（弹层极简）
  for (let i = 1; i <= 7; i++) await createCollectionAtBar(page, `训练目录${i}`)
  const popover7 = await openArchivePopover(page)
  await expect(popover7.getByRole('checkbox')).toHaveCount(7)
  await expect(popover7.getByLabel('过滤目录')).toHaveCount(0)
  await page.keyboard.press('Escape')
  // 第八个目录：过滤框出现（Spotify 教训：目录多时无搜索找不到目标）
  await createCollectionAtBar(page, '左峰专项')
  const popover8 = await openArchivePopover(page)
  const filter = popover8.getByLabel('过滤目录')
  await expect(filter).toBeVisible()
  await expect(filter).toBeFocused() // 过滤框存在时首焦点进过滤框
  await filter.fill('不存在的目录')
  await expect(popover8.getByText('无匹配目录')).toBeVisible()
  await expect(popover8.getByRole('checkbox')).toHaveCount(0)
  await filter.fill('左峰')
  await expect(popover8.getByRole('checkbox')).toHaveCount(1)
  await expect(popover8.getByRole('checkbox', { name: '左峰专项' })).toBeVisible()
  await popover8.getByRole('checkbox', { name: '左峰专项' }).check()
  await expect(collectionChip(page, '左峰专项')).toContainText('(1)')
})

test('批量选择模式勾选两条一次加入目录全部生效，退出选择零位移恢复', async ({ page }) => {
  await cleanActive(page)
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: 'rec-collect2-i' } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'batch-1')
  await seedRecording(page, 'batch-2')
  await seedRecording(page, 'batch-3')
  await createCollectionAtBar(page, '批量归档目录')
  const section = page.locator('[data-recording-source="imported"]')
  const header = section.locator('.recording-library-column-header')
  const rows = section.locator('.recording-history-item')
  await expect(rows).toHaveCount(3)
  // 批量入口在列头；进入后列头等高替换为批量栏（加入目录/退出选择），checkbox 浮现且行零位移
  const before = await rowBoxes(page)
  await header.getByRole('button', { name: '批量选择' }).click()
  await expect(header.getByRole('button', { name: '加入目录' })).toBeVisible()
  await expect(header.getByRole('button', { name: '退出选择' })).toBeVisible()
  await expect(header.getByRole('button', { name: '批量选择' })).toHaveCount(0)
  await expect(header.getByRole('button', { name: '清空导入录像' })).toHaveCount(0)
  expect(await rowBoxes(page)).toEqual(before)
  // 勾选两条（checkbox 在星标左侧，浮现不推挤）
  await rows.nth(0).getByRole('checkbox').check()
  await rows.nth(1).getByRole('checkbox').check()
  await expect(header.getByText('已选 2 项')).toBeVisible()
  expect(await rowBoxes(page)).toEqual(before)
  // 批量加入：同一弹层形态，一次 assign 全部选中键；清单同样不含收藏
  await header.getByRole('button', { name: '加入目录' }).click()
  const popover = page.locator('.archive-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByText('已选 2 项录像')).toBeVisible()
  await expect(popover.getByRole('checkbox', { name: '收藏' })).toHaveCount(0)
  await popover.getByRole('checkbox', { name: '批量归档目录' }).check()
  await expect(collectionChip(page, '批量归档目录')).toContainText('(2)')
  await page.keyboard.press('Escape')
  // 全部生效：目录视图恰两条
  await collectionChip(page, '批量归档目录').click()
  await expect(page.locator('.recording-history-item')).toHaveCount(2)
  await collectionChip(page, '全部').click()
  await expect(page.locator('.recording-history-item')).toHaveCount(3)
  // 退出选择：恢复浏览态，checkbox 隐藏，行零位移残留
  await header.getByRole('button', { name: '退出选择' }).click()
  await expect(header.getByRole('button', { name: '批量选择' })).toBeVisible()
  await expect(header.getByRole('button', { name: '加入目录' })).toHaveCount(0)
  await expect(rows.nth(0).getByRole('checkbox')).toBeHidden()
  expect(await rowBoxes(page)).toEqual(before)
})

test('全部导出携带收藏结构，合并包导入并集合并，删除录像成员级联消失且重载持久', async ({ page }) => {
  await cleanActive(page)
  let namespace = 'rec-collect2-j'
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: namespace } })
  })
  await page.goto('/')
  await openLibrary(page)
  await seedRecording(page, 'merge-1')
  await seedRecording(page, 'merge-2')
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  await createCollectionAtBar(page, '骑牛1买训练')
  // 第一条弹层归档进目录；第二条星标进收藏
  const popover = await openArchivePopover(page)
  await popover.getByRole('checkbox', { name: '骑牛1买训练' }).check()
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(1)')
  await page.keyboard.press('Escape')
  await page.locator('[data-recording-source="imported"] .recording-history-item').nth(1).getByRole('button', { name: '加入收藏' }).click()
  await expect(collectionChip(page, '收藏')).toContainText('(1)')
  // 导出带结构合并包
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '全部导出', exact: true }).click()
  const download = await pending
  const bundlePath = evidencePath('rec-collect2-merge-bundle.trainer-recordings.json')
  await download.saveAs(bundlePath)
  const bundle = JSON.parse((await readFile(bundlePath)).toString('utf8'))
  expect(bundle.format).toBe('trainer-recordings-bundle')
  expect(bundle.collections.type).toBe('recording-collections-manifest')
  expect(bundle.collections.collections).toEqual(expect.arrayContaining([
    { name: '收藏', kind: 'builtin' },
    { name: '骑牛1买训练', kind: 'user' },
  ]))
  const memberNames = bundle.collections.members.map((member: { collectionName: string }) => member.collectionName)
  expect(memberNames).toEqual(expect.arrayContaining(['收藏', '骑牛1买训练']))
  expect(bundle.collections.members.every((member: { recordingKey: string }) => /^imported:/.test(member.recordingKey))).toBe(true)
  // 切换安装命名空间（模拟新机器）：预置同名目录且已有一名既有成员（并集不丢的对照）
  namespace = 'rec-collect2-k'
  await page.reload()
  await openLibrary(page)
  await expect(page.locator('.recording-history-item')).toHaveCount(0)
  await seedRecording(page, 'merge-3')
  await createCollectionAtBar(page, '骑牛1买训练')
  const popover3 = await openArchivePopover(page)
  await popover3.getByRole('checkbox', { name: '骑牛1买训练' }).check()
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(1)')
  await page.keyboard.press('Escape')
  // 导入带结构的合并包：录像恢复＋目录与成员合并
  await page.getByLabel('导入录制', { exact: true }).setInputFiles(bundlePath)
  await expect(page.getByRole('status').filter({ hasText: '批量导入完成：成功 2' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '收藏目录已合并' })).toBeVisible()
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(3)
  // 重名目录并集：既有成员（merge-3）不丢，导入成员（merge-1）并入；内置收藏成员随包恢复
  await expect(collectionChip(page, '骑牛1买训练')).toContainText('(2)')
  await expect(collectionChip(page, '收藏')).toContainText('(1)')
  // 删除录像→成员关系级联消失：目录视图下删掉一名目录成员（计数 2→1、总清单 3→2）
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
  await page.screenshot({ path: evidencePath('rec-collect2-cascade-persist.png') })
})
