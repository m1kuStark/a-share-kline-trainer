// Real old UI recording -> delivered exporter -> one-click staging -> packaged Electron.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { chromium, _electron, expect as baseExpect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
const expect = baseExpect.configure({ timeout: 30000 })
const require = createRequire(import.meta.url)
const root = resolve('.')
const packageRoot = resolve(process.argv[2])
const oldRoot = resolve('.runs/builder-accept-old-v127/kline-trainer-v1.2.7-windows-x64')
const toolDir = resolve('tools/migrate-v127/dist/migrate-v127')
const { stageOneClickImport } = require(join(toolDir, 'oneclick.cjs'))
const workspace = await mkdtemp(join(root, '.runs/old-ui-migration-'))
const evidence = resolve('docs/verification/2026-10/BUILDER-ACCEPT-01')
const oldData = join(workspace, 'old-data')
const newData = join(workspace, 'new-data')
await mkdir(newData)
const cleanEnv = { ...process.env }
for (const key of Object.keys(cleanEnv)) if (key.startsWith('TRAINER_') || ['PORT', 'HOST', 'TDX_ROOT', 'OPEN_BROWSER', 'ELECTRON_RUN_AS_NODE'].includes(key)) delete cleanEnv[key]
async function freePort() {
  const server = createServer()
  await new Promise(yes => server.listen(0, '127.0.0.1', yes))
  const port = server.address().port
  await new Promise(yes => server.close(yes))
  return port
}
const oldPort = await freePort()
const oldUrl = `http://127.0.0.1:${oldPort}`
const config = join(workspace, 'old-config.json')
await writeFile(config, JSON.stringify({ port: oldPort, dataDir: oldData, tdxRoot: join(packageRoot, 'sample-market') }))
const children = []
function oldNode(args) {
  const child = spawn(join(oldRoot, 'runtime/node.exe'), args, { env: cleanEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => process.stdout.write(data))
  child.stderr.on('data', data => process.stderr.write(data))
  children.push(child)
  return child
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(700) })).ok) return } catch {}
    await new Promise(yes => setTimeout(yes, 250))
  }
  throw new Error(`Not ready: ${url}`)
}
let browser, app, oldRunning = false
const receipt = { time: new Date().toISOString(), workspace, oldRoot, packageRoot, steps: [], errors: [] }
async function stopOld() {
  const child = oldNode([join(oldRoot, 'launcher.cjs'), '--config', config, '--stop'])
  assert.equal(await new Promise(yes => child.once('exit', yes)), 0)
  oldRunning = false
}
try {
  oldNode([join(oldRoot, 'launcher.cjs'), '--config', config, '--no-open'])
  oldRunning = true
  await ready(`${oldUrl}/api/health`)
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', error => receipt.errors.push(error.message))
  await page.goto(oldUrl)
  await expect(page.getByPlaceholder('股票代码，如 600519')).toBeVisible({ timeout: 45000 })
  await expect(page.getByLabel('记录操作', { exact: true })).toBeChecked()
  await page.getByPlaceholder('股票代码，如 600519').fill('600519')
  await page.locator('.suggestions button').first().click()
  await page.locator('input[type="date"]').fill('2026-09-01')
  await page.getByRole('button', { name: '开始训练', exact: true }).click()
  const guard = page.getByRole('dialog', { name: '建议先更新日线数据' })
  await expect(guard.or(page.locator('.training-topbar'))).toBeVisible()
  if (await guard.isVisible()) await guard.getByRole('button', { name: '仍要开始训练', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '正在记录' })).toBeVisible()
  await page.getByRole('button', { name: '买入', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('成交')
  await page.getByRole('button', { name: '推进下一日', exact: true }).click()
  await page.getByRole('button', { name: '提前结算', exact: true }).click()
  await page.getByRole('dialog', { name: '结束训练' }).getByRole('button', { name: '确认结算', exact: true }).click()
  await page.getByRole('button', { name: '完成，返回首页', exact: true }).click()
  await page.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(page.locator('[data-recording-source="local"] .recording-history-item')).toHaveCount(1)
  await page.screenshot({ path: join(evidence, 'old-ui-created-recording.png') })
  receipt.steps.push('Verified v1.2.7 UI created real recording via buy, advance, settle; local library has one')
  await stopOld()
  const tool = oldNode([join(toolDir, 'export-v127.cjs'), '--package-root', oldRoot, '--data-dir', oldData, '--port', String(oldPort), '--no-open'])
  await ready(`${oldUrl}/healthz`)
  await page.goto(oldUrl)
  await expect(page.locator('#list-body tr')).toHaveCount(1)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出录像合并包', exact: true }).click()
  const recordingPath = join(workspace, 'actual-old-recording.trainer-recordings.json')
  await (await downloaded).saveAs(recordingPath)
  const historyResponse = await page.request.post(`${oldUrl}/pack-history`)
  assert.equal(historyResponse.ok(), true)
  const history = await historyResponse.json()
  assert.equal(history.ok, true)
  const bundle = JSON.parse(await readFile(recordingPath, 'utf8'))
  assert.equal(bundle.items.length, 1)
  receipt.recordingSessionId = bundle.items[0].sessionId
  receipt.historyCounts = history.manifest.counts
  await page.screenshot({ path: join(evidence, 'old-ui-exported.png') })
  const shutdown = await page.request.post(`${oldUrl}/shutdown`)
  assert.equal(shutdown.ok(), true)
  await browser.close(); browser = null
  receipt.stage = await stageOneClickImport({ toolDir, dataDir: newData, artifacts: { historyDir: history.folder, recordingsFile: recordingPath } })
  assert.equal(receipt.stage.ok, true)
  const fakeHome = join(workspace, 'home')
  const fakeRoaming = join(fakeHome, 'AppData/Roaming')
  const fakeLocal = join(fakeHome, 'AppData/Local')
  const fakeTemp = join(fakeLocal, 'Temp')
  for (const path of [fakeRoaming, fakeLocal, fakeTemp]) await mkdir(path, { recursive: true })
  const newPort = await freePort()
  app = await _electron.launch({ executablePath: join(packageRoot, 'app/K线训练器.exe'), args: [`--user-data-dir=${join(workspace, 'electron-profile')}`], cwd: packageRoot, env: { ...cleanEnv, TRAINER_DATA_DIR: newData, TRAINER_DB: join(newData, 'trainer.sqlite'), TDX_ROOT: join(packageRoot, 'sample-market'), PORT: String(newPort), OPEN_BROWSER: '0', USERPROFILE: fakeHome, HOMEDRIVE: fakeHome.slice(0, 2), HOMEPATH: fakeHome.slice(2), APPDATA: fakeRoaming, LOCALAPPDATA: fakeLocal, TEMP: fakeTemp, TMP: fakeTemp }, timeout: 45000 })
  const newPage = await app.firstWindow()
  newPage.setDefaultTimeout(30000)
  newPage.on('pageerror', error => receipt.errors.push(error.message))
  await expect(newPage.getByPlaceholder('股票代码，如 600519')).toBeVisible()
  await newPage.getByRole('button', { name: '历史训练', exact: true }).click()
  await expect(newPage.locator('.history-report-entry')).toHaveCount(1)
  await newPage.getByRole('button', { name: '训练录像', exact: true }).click()
  await expect(newPage.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(1)
  await newPage.locator('[data-recording-source="imported"] .recording-history-open').first().click()
  await expect(newPage.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible()
  await newPage.screenshot({ path: join(evidence, 'packaged-actual-old-replay.png') })
  receipt.steps.push('Real export tool scanned/downloaded recording and packed history', 'Delivered one-click staging function populated both payloads', 'Packaged boot consumed history and injected recording importer; history and replay visible')
  receipt.identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath('userData'), version: app.getVersion() }))
  assert.equal(receipt.identity.packaged, true)
  await newPage.getByRole('button', { name: '关闭回放', exact: true }).click()
  const child = app.process()
  const ended = new Promise(yes => child.once('exit', code => yes(code)))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  assert.equal(await ended, 0); app = null
  assert.deepEqual(receipt.errors, [])
  receipt.passed = true
  console.log('OLD_UI_TO_PACKAGED_PASS')
} finally {
  await writeFile(join(evidence, 'old-ui-to-packaged.json'), JSON.stringify(receipt, null, 2) + '\n')
  if (browser) await browser.close()
  if (app) await app.close().catch(() => {})
  if (oldRunning) await stopOld()
  for (const child of children) if (child.exitCode === null) child.kill()
}
