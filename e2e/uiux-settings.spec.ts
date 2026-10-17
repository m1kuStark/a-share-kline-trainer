import { expect, test, type Locator, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

async function openSettings(page: Page): Promise<Locator> {
  const active = await (await page.request.get('/api/trainings/active')).json()
  if (active.training) await page.request.post(`/api/trainings/${active.training.id}/abandon`)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '开始训练', exact: true })).toBeEnabled({ timeout: 30_000 })
  await page.getByRole('button', { name: '训练默认设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '训练默认设置', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled()
  await dialog.evaluate(async element => {
    await Promise.all(element.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished))
  })
  return dialog
}

async function bounds(locator: Locator) {
  const value = await locator.boundingBox()
  expect(value, '几何观测元素必须存在').toBeTruthy()
  return value!
}

test('settings keeps the default save action anchored outside scrolling content and feedback', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 })
  const dialog = await openSettings(page)
  const save = dialog.getByRole('button', { name: '保存设置', exact: true })
  const panel = await bounds(dialog)
  const before = await bounds(save)
  expect.soft(panel.y + panel.height - before.y - before.height, '保存入口应在固定底部区').toBeLessThanOrEqual(32)
  const cash = dialog.getByRole('spinbutton', { name: '默认初始资金（元）', exact: true })
  await cash.fill('0')
  await expect(dialog.getByRole('alert')).toContainText('初始资金需在')
  await expect(save).toBeDisabled()
  const invalid = await bounds(save)
  expect.soft(Math.abs(invalid.y - before.y), '校验反馈不能推动保存按钮').toBeLessThanOrEqual(2)
  await cash.fill('123456')
  await expect(save).toBeEnabled()
  const content = page.locator('.settings-content')
  await content.hover()
  await page.mouse.wheel(0, 550)
  const afterScroll = await bounds(save)
  expect.soft(Math.abs(afterScroll.y - before.y), '正文滚动不能移动保存入口').toBeLessThanOrEqual(2)
  const target = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim(), target)).toBe('保存设置')
  await page.mouse.click(target.x, target.y)
  await expect(dialog.getByRole('status')).toContainText('已保存')
  expect(Math.abs((await bounds(save)).y - before.y)).toBeLessThanOrEqual(2)
  await page.screenshot({ path: evidencePath('uiux-settings-default-footer.png') })
})

test('settings retains focus isolation and immediate preferences with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const dialog = await openSettings(page)
  expect(await page.locator('.workspace').evaluate(element => element.inert)).toBe(true)
  await dialog.getByRole('button', { name: '动画效果', exact: true }).click()
  const motion = dialog.getByLabel('数字滚动动效')
  await motion.uncheck()
  expect(await page.evaluate(() => localStorage.getItem('trainer_odo_motion'))).toBe('0')
  await motion.check()
  expect(await page.evaluate(() => localStorage.getItem('trainer_odo_motion'))).toBe('1')
  await expect(dialog.getByRole('button', { name: '保存设置', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: '训练默认设置', exact: true })).toBeFocused()
  expect(await page.locator('.workspace').evaluate(element => element.inert)).toBe(false)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

test('settings retains reachable actions and local scrolling with 125 percent text in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 })
  const dialog = await openSettings(page)
  // Font-token scaling exercises text wrapping without claiming OS/browser zoom.
  await page.evaluate(() => {
    const root = document.documentElement
    const styles = getComputedStyle(root)
    const sizes = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'].map(key => [key, parseFloat(styles.getPropertyValue(`--font-size-${key}`))] as const)
    for (const [key, size] of sizes) root.style.setProperty(`--font-size-${key}`, `${size * 1.25}px`)
  })
  for (const theme of ['light', 'dark']) {
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    if (await page.locator('body').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark')) await page.locator('.theme-toggle').click()
    await page.getByRole('button', { name: '训练默认设置', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.evaluate(async element => {
      await Promise.all(element.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished))
    })
    await dialog.getByRole('button', { name: '默认设置', exact: true }).click()
    const save = dialog.getByRole('button', { name: '保存设置', exact: true })
    const before = await bounds(save)
    const cash = dialog.getByRole('spinbutton', { name: '默认初始资金（元）', exact: true })
    await cash.fill('0')
    await expect(save).toBeDisabled()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect.soft(Math.abs((await bounds(save)).y - before.y)).toBeLessThanOrEqual(2)
    await cash.fill('123456')
    const content = page.locator('.settings-content')
    await content.hover()
    await page.mouse.wheel(0, 550)
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim(), { x: before.x + before.width / 2, y: before.y + before.height / 2 })
    expect.soft(hit).toBe('保存设置')
    expect.soft(before.y + before.height).toBeLessThanOrEqual(672)
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: evidencePath(`uiux-settings-text125-${theme}.png`) })

    await dialog.getByRole('button', { name: '偏好设置', exact: true }).click()
    await expect.poll(() => content.evaluate(element => element.scrollHeight > element.clientHeight), { message: '偏好页必须有真实溢出内容，才能证明局部滚动' }).toBe(true)
    const headingBefore = await bounds(dialog.locator('.settings-head'))
    const navBefore = await bounds(dialog.getByRole('navigation', { name: '设置类别' }))
    const contentBounds = await bounds(content)
    // Place the wheel over the content gutter, away from the nested tool list.
    await page.mouse.move(contentBounds.x + contentBounds.width - 7, contentBounds.y + contentBounds.height / 2)
    await page.mouse.wheel(0, 2400)
    await expect.poll(() => content.evaluate(element => element.scrollTop), { message: '真实wheel必须产生正文滚动' }).toBeGreaterThan(0)
    const headingAfter = await bounds(dialog.locator('.settings-head'))
    const navAfter = await bounds(dialog.getByRole('navigation', { name: '设置类别' }))
    for (const [beforeTarget, afterTarget] of [[headingBefore, headingAfter], [navBefore, navAfter]]) {
      expect.soft(Math.abs(beforeTarget.x - afterTarget.x)).toBeLessThanOrEqual(2)
      expect.soft(Math.abs(beforeTarget.y - afterTarget.y)).toBeLessThanOrEqual(2)
    }
    const lastShortcut = dialog.locator('.shortcut-binding').last()
    await expect(lastShortcut).toBeInViewport({ ratio: 1 })
    await expect(lastShortcut).toBeEnabled()
    const bottomAction = await bounds(lastShortcut)
    const bottomHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x: bottomAction.x + bottomAction.width / 2, y: bottomAction.y + bottomAction.height / 2 })
    expect(bottomHit).toBe(await lastShortcut.getAttribute('aria-label'))
    await page.screenshot({ path: evidencePath(`uiux-settings-preferences-text125-${theme}.png`) })
  }
})

test('settings preserves both ends of long save errors without moving the save action', async ({ page }) => {
  await page.setViewportSize({ width: 1008, height: 641 })
  const dialog = await openSettings(page)
  const message = '无法保存训练默认设置：本机设置文件暂时不可写。请确认文件夹没有被其他程序占用，关闭占用程序后重新保存。当前填写的初始资金与复权选项会保留，进行中的训练不受影响。若仍然失败，请检查磁盘空间和当前账户对数据目录的写入权限，再尝试保存。'
  let failedWrites = 0
  await page.route('**/api/settings/training', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    failedWrites++
    await route.fulfill({ status: 500, json: { error: message } })
  })
  const save = dialog.getByRole('button', { name: '保存设置', exact: true })
  const before = await bounds(save)
  await save.click()
  await expect.poll(() => failedWrites).toBe(1)
  const feedback = dialog.locator('.settings-save-feedback')
  await expect(feedback.getByRole('alert')).toHaveText(message)
  const first = await feedback.evaluate(el => {
    const text = el.querySelector('p')!.firstChild!
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1)
    return { top: range.getBoundingClientRect().top, containerTop: el.getBoundingClientRect().top }
  })
  expect(first.top, 'error beginning must be reachable at initial scroll position').toBeGreaterThanOrEqual(first.containerTop)
  expect(await feedback.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await feedback.hover()
  await page.mouse.wheel(0, 900)
  await expect.poll(() => feedback.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  const last = await feedback.evaluate(el => {
    const text = el.querySelector('p')!.firstChild!
    const range = document.createRange(); range.setStart(text, text.textContent!.length - 1); range.setEnd(text, text.textContent!.length)
    return { bottom: range.getBoundingClientRect().bottom, containerBottom: el.getBoundingClientRect().bottom }
  })
  expect(last.bottom).toBeLessThanOrEqual(last.containerBottom + 1)
  expect(await bounds(save)).toEqual(before)
  await expect(dialog.getByRole('spinbutton', { name: '默认初始资金（元）', exact: true })).toBeEnabled()
})
