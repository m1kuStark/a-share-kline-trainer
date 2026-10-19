import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// GAP1-DIAG 设置页「关于与更新」分栏「复制诊断信息」按钮（2026-10-19 拍板 G1）web 侧回归。
// 消费契约＝矩阵行 DESKTOP-DIAG-CLIPBOARD（web 侧）＋desktop/src/diagnostics.ts（主进程组装，
// desktop/test/diagnostics.test.ts 锁定）；纯逻辑＝web/src/diagnosticsFlow.ts（server/test/
// diagnostics-ui.test.ts transpile 锁定）。
//
// 架构：真实浏览器里 window.desktopDiagnostics 不存在（preload 仅桌面形态注入）——
// ① 无桥形态＝按钮不渲染（fail-closed gating，diagnosticsFlow.detectDesktopDiagnostics）；
// ② 有桥形态＝page.addInitScript 注入桩桥（先于应用脚本执行），断言点击→已复制反馈→
// 3 秒消失（DIAG_FEEDBACK_MS proposed_default）→失败路径呈现结构化中文错误且可重试。
// 真剪贴板往返与 packaged 形态走桌面冒烟/真机验收（gpu3060 关机，deferred——root 已在
// 任务卡与矩阵 oracle 注明）；本 spec 不触任何 Electron 面。
//
// 注意（root 2026-10-19 硬约束）：本 spec 与浏览器/e2e/journey 命令在阶段1 均未运行——
// 另一 worker 独占浏览器跑全量 journey；待 root 通知后串行执行。

const errors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const list: string[] = []
  errors.set(page, list)
  page.on('pageerror', error => list.push(error.message))
})
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]) })

async function openAboutSection(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '训练默认设置' }).click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '关于与更新' }).click()
  await expect(dialog.getByRole('button', { name: '关于与更新' })).toHaveClass(/selected/)
  return dialog
}

test('diagnostics copy stays hidden in the pure browser form (DESKTOP-DIAG-CLIPBOARD fail-closed gating)', async ({ page }) => {
  const dialog = await openAboutSection(page)
  // 无 desktopDiagnostics 桥＝区块整体不渲染（同 desktopUpdates channel gating 模式）
  await expect(dialog.getByRole('button', { name: '复制诊断信息' })).toHaveCount(0)
  await expect(dialog.locator('.diag-copy')).toHaveCount(0)
  // 既有更新分栏内容不受影响（版本行仍在）
  await expect(dialog.locator('.update-current-version')).toBeVisible()
  await page.screenshot({ path: evidencePath('diagnostics-copy-hidden.png') })
})

test('diagnostics copy rounds the stubbed bridge: 已复制 feedback fades and the failure path stays retryable (DESKTOP-DIAG-CLIPBOARD)', async ({ page }) => {
  // 桩桥先于应用脚本注入：首次 copy→ok:true；后续 copy→ok:false（结构化中文错误路径）
  await page.addInitScript(() => {
    const calls: string[] = []
    const holder = window as unknown as { __diagStubCalls?: string[], desktopDiagnostics?: unknown }
    holder.__diagStubCalls = calls
    holder.desktopDiagnostics = {
      copyDiagnostics: async (): Promise<{ ok: true } | { ok: false, error: string }> => {
        calls.push('copy')
        if (calls.length === 1) return { ok: true }
        return { ok: false, error: '剪贴板被其他程序占用（fixture 演示）' }
      },
    }
  })
  const dialog = await openAboutSection(page)
  const button = dialog.getByRole('button', { name: '复制诊断信息' })
  await expect(button).toBeVisible()

  // 成功：role=status 已复制反馈出现
  await button.click()
  await expect(dialog.locator('.diag-copy-result')).toHaveText('已复制，可粘贴到问题反馈')
  const stubCalls = await page.evaluate(() => (window as unknown as { __diagStubCalls?: string[] }).__diagStubCalls)
  expect(stubCalls).toEqual(['copy'])
  // 反馈按 DIAG_FEEDBACK_MS（3 秒，容差上限 10 秒）自动消失
  await expect(dialog.locator('.diag-copy-result')).toHaveCount(0, { timeout: 10_000 })

  // 失败：结构化中文原因呈现、按钮仍可点（可重试）
  await button.click()
  await expect(dialog.locator('.diag-copy-error')).toContainText('复制失败：')
  await expect(dialog.locator('.diag-copy-error')).toContainText('剪贴板被其他程序占用')
  await expect(button).toBeEnabled()
  await page.screenshot({ path: evidencePath('diagnostics-copy-feedback.png') })
})
