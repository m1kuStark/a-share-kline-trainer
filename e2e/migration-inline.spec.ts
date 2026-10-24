import { expect, test, type Page } from '@playwright/test'

// MIG-INLINE-01 内置迁移向导 e2e（矩阵 migration-inline：首启弹窗/跳过记忆/全流程/卸载指引）。
// 形态说明：journey 起的是隔离 server（浏览器形态无真实 desktopMigration 桥）——本 spec 用
// addInitScript 注入 stub 桥驱动前端向导逻辑（步骤流转/文案/跳过记忆）；主进程三段（体检/
// 历史合并/导出伺服）由 desktop/test/mig-inline.test.ts 真实文件链锁定，不在此重复。

interface StubCalls { inspect: string[]; migrate: string[] }

async function installStubBridge(page: Page, calls: StubCalls): Promise<void> {
  // addInitScript 的入参会被序列化成浏览器侧拷贝——页内 push 回不到 Node；间谍走 exposeFunction 真回调
  await page.exposeFunction('__migSpyInspect', (root: string) => { calls.inspect.push(root) })
  await page.exposeFunction('__migSpyMigrate', (root: string) => { calls.migrate.push(root) })
  await page.addInitScript(() => {
    const w = window as unknown as {
      __migSpyInspect: (root: string) => Promise<void>
      __migSpyMigrate: (root: string) => Promise<void>
      desktopMigration: unknown
    }
    w.desktopMigration = {
      pick: async () => ({ ok: false, error: 'stub' }),
      inspectLegacy: async (root: string) => {
        await w.__migSpyInspect(root)
        if (!root || !root.includes('v127')) return { ok: false, error: '所选目录里找不到 v1.2.7 的训练数据（期望位置：<目录>\\data\\trainer.sqlite）。' }
        return { ok: true, trainings: 3, trades: 5, originPort: 8787, recordingNamespace: 'ns-e2e' }
      },
      migrateLegacyHistory: async (root: string) => {
        await w.__migSpyMigrate(root)
        return { ok: true, imported: 3, skipped: 0 }
      },
      startLegacyExport: async () => ({ ok: false, error: 'stub 不覆盖录像分支' }),
      legacyExportStatus: async () => ({ ok: true, state: { phase: 'idle' } }),
      stopLegacyExport: async () => ({ ok: true }),
    }
  })
}

test.beforeEach(async ({ page }) => {
  // 真实路由契约（mock 漂移教训 2026-10-25）：mock 必须镜像真实端点 /api/trainings/history
  // 与真实形状 HistoryListPayload{total,limit,offset,items}——早前 mock 了不存在的 /api/trainings，
  // 掩盖了产品 404 缺陷（首启弹窗永不触发），真机自验才暴露。
  await page.route('**/api/trainings/history*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [], total: 0, limit: 1, offset: 0 }),
  }))
})

test('MIGI-BOOT-PROMPT-ONCE：空库首启弹询问；「不再提示」后重载不再弹', async ({ page }) => {
  const calls: StubCalls = { inspect: [], migrate: [] }
  await installStubBridge(page, calls)
  // 注：不加 localStorage.clear() 的 initScript——addInitScript 每次加载都会跑（含 reload），
  // 会把「不再提示」标记一并抹掉造成假失败；Playwright 每测新 context 本就是空存储。
  await page.goto('/')
  const dialog = page.locator('.migration-wizard-panel')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('从 v1.2.7 迁移老数据')
  // 回归锁定（截图复盘）：向导自带 scoped 遮罩样式——曾裸用设置页 scoped 类名导致平铺无遮罩
  expect(await page.locator('div.settings-mask').first().evaluate(el => getComputedStyle(el).position)).toBe('fixed')
  await page.locator('.migration-wizard-panel button', { hasText: '我不用 v1.2.7，不再提示' }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await expect(page.locator('.migration-wizard-panel')).not.toBeVisible()
})

test('MIGI-INSPECT/HISTORY/FINISH：校验→迁移→完成页含导入汇总与安全卸载指引', async ({ page }) => {
  const calls: StubCalls = { inspect: [], migrate: [] }
  await installStubBridge(page, calls)
  await page.goto('/')
  const dialog = page.locator('.migration-wizard-panel')
  await expect(dialog).toBeVisible()
  // 无效路径：人话报错留在第一步（fixture 不能含 'v127' 子串——stub 以此判合法）
  await page.locator('#mig-root-input').fill('D:\\bad-path')
  await dialog.locator('button', { hasText: '校验该目录' }).click()
  await expect(page.locator('.migration-wizard-panel .error-text')).toContainText('找不到 v1.2.7 的训练数据')
  // 合法路径：摘要→迁移→录像步（跳过）→完成页
  await page.locator('#mig-root-input').fill('D:\\pkg-v127')
  await dialog.locator('button', { hasText: '校验该目录' }).click()
  await expect(dialog).toContainText('训练历史 3 局')
  await dialog.locator('button', { hasText: '开始迁移训练历史' }).click()
  await expect(dialog).toContainText('新导入 3 局')
  await dialog.locator('button', { hasText: '跳过录像，直接完成' }).click()
  await expect(dialog).toContainText('迁移完成')
  // 用户拍板的卸载指引文案逐字锁定
  await expect(dialog).toContainText('把 v1.2.7 版本的文件夹完整删除即可完成卸载')
  await expect(dialog).toContainText('不会影响')
  expect(calls.inspect).toEqual(['D:\\bad-path', 'D:\\pkg-v127'])
  expect(calls.migrate).toEqual(['D:\\pkg-v127'])
})

test('设置页常驻入口：数据目录分栏可打开向导（桌面桥存在时）', async ({ page }) => {
  const calls: StubCalls = { inspect: [], migrate: [] }
  await installStubBridge(page, calls)
  await page.addInitScript(() => localStorage.setItem('mig-inline-dismissed', '1'))
  await page.goto('/')
  await expect(page.locator('.migration-wizard-panel')).not.toBeVisible()
  await page.click('button[title="训练默认设置"]')
  await page.waitForTimeout(800)
  await page.locator('nav.settings-nav button', { hasText: '数据目录' }).click()
  await page.locator('button', { hasText: '从 v1.2.7 迁移老数据' }).click()
  await expect(page.locator('.migration-wizard-panel')).toBeVisible()
})
