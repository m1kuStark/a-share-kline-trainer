// Actual unpacked Electron acceptance; all data and profiles belong to this run.
import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { stageHistoryImport } from '../../desktop/dist/mig-import.js'
const root = resolve('.')
const packageRoot = resolve(process.argv[2])
const exe = join(packageRoot, 'app/K线训练器.exe')
const workspace = await mkdtemp(join(root, '.runs/packaged-accept-'))
const evidence = join(root, 'docs/verification/2026-10/BUILDER-ACCEPT-01')
const data = join(workspace, 'data')
const profile = join(workspace, 'profile')
const home = join(workspace, 'home')
const roaming = join(home, 'AppData/Roaming')
const local = join(home, 'AppData/Local')
const temp = join(local, 'Temp')
for (const path of [data, profile, roaming, local, temp]) await mkdir(path, { recursive: true })
const env = { ...process.env }
for (const key of Object.keys(env)) if (key.startsWith('TRAINER_') || key.startsWith('PORTABLE_EXECUTABLE') || ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'DESKTOP_DEV_URL', 'TDX_ROOT', 'PORT', 'HOST', 'OPEN_BROWSER'].includes(key)) delete env[key]
const listener = createServer()
await new Promise(yes => listener.listen(0, '127.0.0.1', yes))
const port = listener.address().port
await new Promise(yes => listener.close(yes))
Object.assign(env, { TRAINER_DATA_DIR: data, TRAINER_DB: join(data, 'trainer.sqlite'), TDX_ROOT: join(packageRoot, 'sample-market'), PORT: String(port), OPEN_BROWSER: '0', USERPROFILE: home, HOMEDRIVE: home.slice(0, 2), HOMEPATH: home.slice(2), APPDATA: roaming, LOCALAPPDATA: local, TEMP: temp, TMP: temp })
const sourceReceipt = JSON.parse(await readFile(join(evidence, 'history-migration-real.json'), 'utf8'))
const receipt = { time: new Date().toISOString(), exe, workspace, data, profile, port, boots: [], reports: [], sourceManifest: sourceReceipt.manifest, errors: [], scope: 'Unpacked production Electron; no installer/system-upgrade run. History exported from verified real v1.2.7, staged with production importer while closed, then applied by packaged boot.' }
let app
let page
async function boot() {
  app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${profile}`], env, cwd: packageRoot, timeout: 45000 })
  app.process().stderr?.on('data', chunk => process.stderr.write(chunk))
  page = await app.firstWindow({ timeout: 45000 })
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => receipt.errors.push(error.message))
  page.on('response', async response => {
    if (response.url().includes('/api/lifecycle/')) console.log('LIFECYCLE', response.status(), new URL(response.url()).pathname)
  })
  await expect(page.getByPlaceholder('股票代码，如 600519')).toBeVisible({ timeout: 45000 })
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData'), appData: app.getPath('appData'), home: app.getPath('home'), exe: app.getPath('exe') }))
  assert.equal(identity.packaged, true)
  assert.ok(identity.userData.toLowerCase().startsWith(workspace.toLowerCase()), JSON.stringify(identity))
  assert.ok(identity.appData.toLowerCase().startsWith(workspace.toLowerCase()), JSON.stringify(identity))
  const actual = await page.request.get(`http://127.0.0.1:${port}/api/health`)
  receipt.boots.push({ identity, health: await actual.json(), url: page.url() })
}
async function closeThroughUi() {
  const child = app.process()
  await page.getByRole('button', { name: '保存并退出训练器', exact: true }).click()
  await page.getByRole('dialog', { name: '退出训练器' }).getByRole('button', { name: '保存并退出', exact: true }).click()
  // The browser-oriented save/exit flow stops the local service and shows an exit page.
  // Closing the Electron window then exercises its own graceful shutdown path.
  await expect(page.getByText('训练器已退出', { exact: true })).toBeVisible({ timeout: 20000 })
  const exit = new Promise((yes, no) => {
    const timer = setTimeout(() => no(new Error('packaged graceful exit exceeded 25s')), 25000)
    child.once('exit', (code, signal) => { clearTimeout(timer); yes({ code, signal }) })
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  const ended = await exit
  assert.equal(ended.code, 0)
  receipt.boots.at(-1).exit = ended
  app = null
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`))
}
try {
  await boot()
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
  await page.locator('.suggestions button').first().click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await page.getByRole('button', { name: '开始训练', exact: true }).click()
  const guard = page.getByRole('dialog', { name: '建议先更新日线数据' })
  await expect(guard.or(page.locator('.training-topbar'))).toBeVisible()
  if (await guard.isVisible()) await guard.getByRole('button', { name: '仍要开始训练', exact: true }).click()
  await expect(page.locator('.training-topbar')).toBeVisible()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('成交')
  const ownId = (await (await page.request.get(`http://127.0.0.1:${port}/api/trainings/active`)).json()).training.id
  await page.getByRole('button', { name: '提前结算', exact: true }).click()
  await page.getByRole('dialog', { name: '结束训练' }).getByRole('button', { name: '确认结算', exact: true }).click()
  await page.getByRole('button', { name: '查看历史成绩单', exact: true }).click()
  receipt.existingId = ownId
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: '切换到浅色主题' }).click()
    await page.locator(`[data-training-id="${ownId}"] .history-report-entry`).click()
    const report = page.getByRole('dialog', { name: '成绩单', exact: true })
    await expect(report.locator('.report-trades th')).toHaveText(['序号', '日期', '买卖', '价格', '股数', '金额', '费用'])
    for (const width of [1024, 1440]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width)
      await report.getByRole('region', { name: '逐笔成交明细' }).scrollIntoViewIfNeeded()
      const dimensions = await report.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, viewport: { width: innerWidth, height: innerHeight } }))
      assert.ok(dimensions.scroll <= dimensions.client)
      receipt.reports.push({ theme, width, dimensions })
      await page.screenshot({ path: join(evidence, `packaged-report-${theme}-${width}.png`) })
    }
    await report.getByRole('button', { name: '关闭成绩单' }).click()
  }
  const namespace = (await (await page.request.get(`http://127.0.0.1:${port}/api/env`)).json()).recordingNamespace
  await closeThroughUi()
  receipt.stage = await stageHistoryImport(sourceReceipt.manifest, join(data, 'trainer.sqlite'))
  assert.equal(receipt.stage.ok, true)
  assert.equal(receipt.stage.importing, 1)
  await boot()
  await page.getByRole('button', { name: '历史训练', exact: true }).click()
  await expect(page.locator('.history-report-entry')).toHaveCount(2)
  const items = await page.locator('[data-training-id]').evaluateAll(els => els.map(el => Number(el.getAttribute('data-training-id'))))
  const importedId = items.find(id => id !== ownId)
  assert.ok(importedId)
  const migrated = await (await page.request.get(`http://127.0.0.1:${port}/api/trainings/${importedId}/report`)).json()
  assert.equal(migrated.trades.length, 2)
  assert.equal((await (await page.request.get(`http://127.0.0.1:${port}/api/trainings/${importedId}/trades/1/note`)).json()).note, 'old-v127-note')
  assert.equal((await (await page.request.get(`http://127.0.0.1:${port}/api/env`)).json()).recordingNamespace, namespace)
  await page.locator(`[data-training-id="${importedId}"] .history-report-entry`).click()
  await expect(page.getByRole('dialog', { name: '成绩单', exact: true })).toBeVisible()
  await page.screenshot({ path: join(evidence, 'packaged-migrated-history.png') })
  await page.getByRole('button', { name: '关闭成绩单' }).click()
  receipt.importedId = importedId
  await closeThroughUi()
  receipt.repeatStage = await stageHistoryImport(sourceReceipt.manifest, join(data, 'trainer.sqlite'))
  assert.equal(receipt.repeatStage.importing, 0)
  await boot()
  await page.getByRole('button', { name: '历史训练', exact: true }).click()
  await expect(page.locator('.history-report-entry')).toHaveCount(2)
  await closeThroughUi()
  assert.deepEqual(receipt.errors, [])
  receipt.asarSha256 = createHash('sha256').update(await readFile(join(packageRoot, 'app/resources/app.asar'))).digest('hex')
  receipt.passed = true
  console.log('PACKAGED_ACCEPTANCE_PASS', JSON.stringify({ boots: receipt.boots.length, importedId, workspace }))
} finally {
  await writeFile(join(evidence, 'packaged-acceptance.json'), JSON.stringify(receipt, null, 2) + '\n')
  if (app) await app.close().catch(() => {})
}
