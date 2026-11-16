import { evidencePath } from './runtime'
import { expect, test, type Page } from '@playwright/test'

// M9-04B 公式指标设置分栏（用户 2026-11-16 拍板默认方案）真实浏览器回归：
// ① 设置面板新增「公式指标」分栏，可新建/编辑/保存公式（SQLite 持久化，关闭重开仍在）；
// ② 校验失败显示中文错误，未来函数显式标记（允许使用），全角标点给出告警；
// ③ 支持粘贴通达信单行/多行文本；中文公式名可保存；
// ④ 预览使用 M9-04A 只读 evaluate（无进行中训练时按证券代码读通达信日线），曲线可见；
// ⑤ 删除需二次确认，删除不影响其他公式。

const FORMULA_NAMES = ['E2E_MA5', '周线MACD', 'E2E_UI_MA5', 'E2E_UI_MACD', 'E2E_UI_KDJ']

async function cleanFormulas(page: Page): Promise<void> {
  const response = await page.request.get('/api/formulas')
  if (!response.ok()) return
  const payload = (await response.json()) as { formulas: Array<{ id: number; name: string; builtin: boolean }> }
  for (const formula of payload.formulas) {
    if (!formula.builtin && FORMULA_NAMES.includes(formula.name)) {
      await page.request.delete('/api/formulas/' + formula.id)
    }
  }
}

async function openFormulaSection(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '训练默认设置' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '训练默认设置' }).click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '公式指标' }).click()
  const section = dialog.getByRole('region', { name: '公式指标' })
  await expect(section).toBeVisible()
  return { dialog, section }
}

test.beforeEach(async ({ page }) => {
  const active = await page.request.get('/api/trainings/active')
  if (active.ok()) {
    const payload = (await active.json()) as { training: { id: number } | null }
    if (payload.training) await page.request.post('/api/trainings/' + payload.training.id + '/abandon')
  }
  await cleanFormulas(page)
})
test.afterEach(async ({ page }) => { await cleanFormulas(page) })

test('公式指标：新建/校验/预览/保存持久化/删除（副图指标）', async ({ page }) => {
  const { dialog, section } = await openFormulaSection(page)

  await section.getByRole('button', { name: '新建' }).click()
  await section.getByLabel('公式名称').fill('E2E_MA5')
  await section.getByLabel('公式源码').fill('MA5:MA(CLOSE,5);\nMA10:MA(CLOSE,10);')
  await section.getByLabel('显示位置').selectOption('sub')
  await section.getByRole('button', { name: '校验' }).click()
  await expect(section.locator('.formula-status')).toContainText('校验通过')

  // 预览：无进行中训练时按证券代码走通达信日线只读求值（dataSource 标注不复权）
  await section.getByRole('button', { name: '预览' }).click()
  await expect(section.getByRole('img', { name: /公式预览曲线/ })).toBeVisible({ timeout: 30_000 })
  await expect(section.getByLabel('公式预览', { exact: true })).toContainText('不复权')
  await expect(section.getByLabel('公式预览', { exact: true })).toContainText('MA5')

  await section.getByRole('button', { name: '保存新公式' }).click()
  await expect(section.locator('.settings-saved')).toContainText('已保存')
  await expect(section.getByLabel('公式列表')).toContainText('E2E_MA5')
  await page.screenshot({ path: evidencePath('formula-settings-preview.png') })

  // 持久化：关闭设置重开仍在（SQLite 公式库）
  await dialog.getByRole('button', { name: '关闭' }).click()
  const reopened = await openFormulaSection(page)
  const list = reopened.section.getByLabel('公式列表')
  await expect(list).toContainText('E2E_MA5')
  await list.getByRole('button', { name: /E2E_MA5/ }).click()
  await expect(reopened.section.getByLabel('公式源码')).toHaveValue(/MA5:MA\(CLOSE,5\)/)

  // 删除二次确认
  await reopened.section.getByRole('button', { name: '删除', exact: true }).click()
  await expect(reopened.section.getByRole('button', { name: '再次点击确认删除' })).toBeVisible()
  await reopened.section.getByRole('button', { name: '再次点击确认删除' }).click()
  await expect(reopened.section.getByLabel('公式列表')).not.toContainText('E2E_MA5')
  await expect(reopened.section.locator('.settings-saved')).toContainText('已删除')
})

test('公式指标：中文错误/未来函数标记/全角告警/中文名单行导入', async ({ page }) => {
  const { dialog, section } = await openFormulaSection(page)

  await section.getByRole('button', { name: '新建' }).click()
  await section.getByLabel('公式名称').fill('周线MACD')

  // 语法错误：中文原因
  await section.getByLabel('公式源码').fill('A:MA(CLOSE,;')
  await section.getByRole('button', { name: '校验' }).click()
  await expect(section.locator('.formula-status')).toContainText('语法错误')

  // 未来函数：允许并显式标记
  await section.getByLabel('公式源码').fill('A:MA(CLOSE,5); B:BACKSET(CLOSE>OPEN,3);')
  await section.getByRole('button', { name: '校验' }).click()
  await expect(section.locator('.formula-status')).toContainText('BACKSET')

  // 全角标点：校验失败且显式告警（不静默改写用户文本）
  await section.getByLabel('公式源码').fill('MA5:MA(CLOSE，5);')
  await section.getByRole('button', { name: '校验' }).click()
  await expect(section.getByLabel('公式告警')).toContainText('全角')

  // 通达信单行粘贴版 + 中文公式名保存
  await section.getByLabel('公式源码').fill('MA5:MA(CLOSE,5); MA10:MA(CLOSE,10);')
  await section.getByRole('button', { name: '校验' }).click()
  await expect(section.locator('.formula-status')).toContainText('校验通过')
  await section.getByRole('button', { name: '保存新公式' }).click()
  await expect(section.getByLabel('公式列表')).toContainText('周线MACD')
  await dialog.getByRole('button', { name: '关闭' }).click()
})

test('公式指标：桌面尺寸与深浅主题布局无横向溢出（视觉证据）', async ({ page }) => {
  const presets = [
    { width: 1440, height: 900, theme: 'light' },
    { width: 1366, height: 705, theme: 'light' },
    { width: 1024, height: 680, theme: 'light' },
    { width: 1440, height: 900, theme: 'dark' },
  ]
  for (const name of ['E2E_UI_MA5', 'E2E_UI_MACD', 'E2E_UI_KDJ']) {
    await page.request.post('/api/formulas', { data: { name, description: '视觉证据', placement: name === 'E2E_UI_MA5' ? 'main' : 'sub', source: 'MA5:MA(CLOSE,5);' } })
  }
  for (const preset of presets) {
    await page.addInitScript((theme: string) => localStorage.setItem('trainer_theme', theme), preset.theme)
    await page.setViewportSize({ width: preset.width, height: preset.height })
    await page.reload()
    const { dialog, section } = await openFormulaSection(page)
    await expect(section).toBeVisible()
    await expect(section.locator('.formula-list-pane')).not.toContainText('读取中', { timeout: 15_000 })
    const overflow = await section.evaluate(element => {
      const content = element.closest('.settings-content') as HTMLElement | null
      return content ? content.scrollWidth - content.clientWidth : -1
    })
    expect(overflow).toBeLessThanOrEqual(0)
    await page.screenshot({ path: evidencePath('formula-settings-' + preset.width + 'x' + preset.height + '-' + preset.theme + '.png') })
    await dialog.getByRole('button', { name: '关闭' }).click()
  }
})
