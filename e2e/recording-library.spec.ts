import { test, expect, type Page } from '@playwright/test'
import { evidencePath } from './runtime'

function recording(sessionId = 'old-session') {
  return {
    format: 'trainer-session', schemaVersion: 2, sessionId, createdAt: '2026-10-03T00:00:00.000Z',
    app: { version: 'test', gitCommit: 'test', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 800 }, dpr: 1 },
    trainingKey: null, events: [], checkpoints: [], gaps: [], complete: true,
    resources: { series: [], drawings: [], trainingMeta: [], accounts: [], trades: [], contexts: [] },
  }
}
async function openLibrary(page: Page) {
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
}
async function cleanActive(page: Page) {
  const active = (await (await page.request.get('/api/trainings/active')).json()).training
  if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
}

test('第一次使用忽略相同地址下旧的浏览器录像库', async ({ page }) => {
  await cleanActive(page)
  await page.goto('/')
  await page.evaluate(async file => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('trainer-recordings', 2)
      request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'sessionId' }); if (!db.objectStoreNames.contains('compactSessions')) db.createObjectStore('compactSessions', { keyPath: 'sessionId' }); if (!db.objectStoreNames.contains('compactRecords')) db.createObjectStore('compactRecords', { keyPath: ['sessionId', 'kind', 'index'] }) }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put({ ...file, schemaVersion: 1 }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  }, recording())
  await page.reload()
  await openLibrary(page)
  await expect(page.locator('[data-recording-source="local"] .recording-library-empty')).toBeVisible()
  await expect(page.locator('[data-recording-source="imported"] .recording-library-empty')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(async () => {
    const request = indexedDB.open('trainer-recordings', 2)
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result) })
    const tx = db.transaction('sessions', 'readonly')
    const rows = tx.objectStore('sessions').getAll()
    const result = await new Promise<number>(resolve => { tx.oncomplete = () => resolve(rows.result.length) })
    db.close()
    return result
  })).toBe(1)
})

test('导入来源持久保存，同会话重复导入独立，并隔离两个安装实例', async ({ page }) => {
  await cleanActive(page)
  let namespace = 'journey-install-a'
  await page.route('**/api/env', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), recordingNamespace: namespace } })
  })
  await page.goto('/')
  await openLibrary(page)
  const upload = { name: '分享录像.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recording('shared-id'))) }
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('导入录制', { exact: true }).setInputFiles(upload)
    await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭回放', exact: true }).click()
  }
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  await page.reload()
  await openLibrary(page)
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  namespace = 'journey-install-b'
  await page.reload()
  await openLibrary(page)
  await expect(page.locator('.recording-history-item')).toHaveCount(0)
  namespace = 'journey-install-a'
  await page.reload()
  await openLibrary(page)
  await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(2)
  await page.getByRole('button', { name: '清空导入录像', exact: true }).click()
  await expect(page.getByRole('alertdialog', { name: '确认删除录像' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.recording-history-item')).toHaveCount(2)
  await page.getByRole('button', { name: '清空导入录像', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.recording-history-item')).toHaveCount(0)
  await page.screenshot({ path: evidencePath('recording-library-first-use-dark.png') })
})
