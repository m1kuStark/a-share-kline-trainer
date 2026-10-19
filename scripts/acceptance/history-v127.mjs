// Local acceptance only. Never reads the default user database or browser profile.
// Usage: node scripts/acceptance/history-v127.mjs <real-v127-root> <frozen-tdx-root>
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startTrainerServer } from '../../server/dist/index.js'
import { stageHistoryImport, applyPendingHistoryAtBoot } from '../../desktop/dist/mig-import.js'

const require = createRequire(import.meta.url)
const { buildHistoryPackage } = require('../../tools/migrate-v127/dist/migrate-v127/export-v127.cjs')
const root = resolve('.')
const oldRoot = resolve(process.argv[2])
const tdxRoot = resolve(process.argv[3])
const evidence = join(root, 'docs/verification/2026-10/BUILDER-ACCEPT-01')
const workspace = await mkdtemp(join(root, '.runs/history-v127-'))
const oldData = join(workspace, 'old-data')
const newData = join(workspace, 'new-data')
await mkdir(newData)
const target = join(newData, 'trainer.sqlite')
const source = join(oldData, 'trainer.sqlite')
const configPath = join(workspace, 'old-config.json')
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.startsWith('TRAINER_') || ['TDX_ROOT', 'PORT', 'HOST', 'OPEN_BROWSER'].includes(key)) delete env[key]
}
async function freePort() {
  const server = createServer()
  await new Promise((yes, no) => server.once('error', no).listen(0, '127.0.0.1', yes))
  const port = server.address().port
  await new Promise(yes => server.close(yes))
  return port
}
const oldPort = await freePort()
const oldUrl = `http://127.0.0.1:${oldPort}`
await writeFile(configPath, JSON.stringify({ port: oldPort, dataDir: oldData, tdxRoot }))
function launchOld(extra = []) {
  const child = spawn(join(oldRoot, 'runtime/node.exe'), [join(oldRoot, 'launcher.cjs'), '--config', configPath, ...extra], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => process.stdout.write(`[old] ${data}`))
  child.stderr.on('data', data => process.stderr.write(`[old] ${data}`))
  return child
}
async function waitHealth(url, available) {
  for (let i = 0; i < 80; i++) {
    let ok = false
    try { ok = (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) })).ok } catch {}
    if (ok === available) return
    await new Promise(yes => setTimeout(yes, 250))
  }
  throw new Error(`health expected available=${available} at ${url}`)
}
async function request(url, path, body, method = 'POST') {
  const response = await fetch(`${url}${path}`, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status}: ${JSON.stringify(value)}`)
  return value
}
async function makeTraining(url, note) {
  const { training } = await request(url, '/api/trainings', { code: '600519', tier: '1M', start_date: '2026-09-01', initial_cash: 1000000, blind: false })
  const path = `/api/trainings/${training.id}`
  await request(url, `${path}/trade`, { side: 'buy', shares: 100 })
  await request(url, `${path}/trades/1/note`, { note }, 'PUT')
  await request(url, `${path}/drawings`, [{ id: `line-${note}`, name: 'horizontalStraightLine', paneId: 'candle_pane', points: [{ timestamp: Date.parse('2026-09-01T00:00:00Z'), value: 1400 }] }], 'PUT')
  await request(url, `${path}/next`, {})
  await request(url, `${path}/trade`, { side: 'sell', shares: 100 })
  await request(url, `${path}/settle`, {})
  await request(url, '/api/env')
  return training.id
}
function snapshot(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return Object.fromEntries(['trainings', 'trades', 'orders', 'equity_curve', 'position_events', 'drawings', 'trade_notes', 'cache_meta'].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all().map(row => ({ ...row }))]))
  } finally { db.close() }
}
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
let current
let oldStarted = false
async function stopOld() {
  const stopper = launchOld(['--stop'])
  const exit = await new Promise((yes, no) => { stopper.once('error', no); stopper.once('exit', yes) })
  assert.equal(exit, 0)
  await waitHealth(oldUrl, false)
  oldStarted = false
}
async function startCurrent() {
  Object.assign(process.env, env, { TRAINER_DATA_DIR: newData, TRAINER_DB: target, TRAINER_STATIC_DIR: join(root, 'web/dist'), TDX_ROOT: tdxRoot, PORT: String(await freePort()), HOST: '127.0.0.1', OPEN_BROWSER: '0' })
  current = await startTrainerServer()
  return current.url.replace(/\/$/, '')
}
try {
  launchOld(['--no-open'])
  oldStarted = true
  await waitHealth(oldUrl, true)
  const oldId = await makeTraining(oldUrl, 'old-v127-note')
  await stopOld()
  const beforeSource = await hash(source)
  const oldRows = snapshot(source)
  assert.equal(oldRows.trainings.length, 1)
  assert.equal(oldRows.trades.length, 2)
  assert.equal(oldRows.drawings.length, 1)
  assert.equal(oldRows.trade_notes[0].note, 'old-v127-note')
  const exported = await buildHistoryPackage(source, workspace)
  assert.equal(exported.ok, true, JSON.stringify(exported))
  assert.equal(await hash(source), beforeSource)

  const existingId = await makeTraining(await startCurrent(), 'new-existing-note')
  await current.shutdown(); current = null
  const existingRows = snapshot(target)
  const manifest = join(exported.folder, '迁移清单.json')
  const staged = await stageHistoryImport(manifest, target)
  assert.equal(staged.ok, true, JSON.stringify(staged))
  assert.equal(staged.importing, 1)
  const applied = await applyPendingHistoryAtBoot(target)
  assert.deepEqual(applied, { applied: true, imported: 1, skipped: 0 })
  const merged = snapshot(target)
  assert.equal(merged.trainings.length, 2)
  assert.deepEqual(merged.trainings.find(row => row.id === existingId), existingRows.trainings[0])
  assert.equal(merged.cache_meta.find(row => row.key === 'recording_namespace').value, existingRows.cache_meta.find(row => row.key === 'recording_namespace').value)
  const importedId = merged.trainings.find(row => row.id !== existingId).id
  for (const [key, value] of Object.entries(oldRows.trainings[0])) {
    if (key !== 'id') assert.deepEqual(merged.trainings.find(row => row.id === importedId)[key], value, `training.${key}`)
  }
  for (const table of ['trades', 'equity_curve', 'drawings', 'trade_notes']) {
    const imported = merged[table].filter(row => row.training_id === importedId)
    assert.equal(imported.length, oldRows[table].length, table)
    for (let i = 0; i < imported.length; i++) {
      for (const [key, value] of Object.entries(oldRows[table][i])) {
        if (!['id', 'training_id'].includes(key)) assert.deepEqual(imported[i][key], value, `${table}.${key}`)
      }
    }
    assert.deepEqual(merged[table].filter(row => row.training_id === existingId), existingRows[table], `existing ${table}`)
  }
  const repeatStage = await stageHistoryImport(manifest, target)
  assert.equal(repeatStage.ok, true)
  assert.equal(repeatStage.importing, 0)
  const repeated = await applyPendingHistoryAtBoot(target)
  assert.deepEqual(repeated, { applied: true, imported: 0, skipped: 1 })
  assert.deepEqual(snapshot(target), merged)
  const finalUrl = await startCurrent()
  const report = await request(finalUrl, `/api/trainings/${importedId}/report`)
  assert.equal(report.trades.length, 2)
  assert.equal((await request(finalUrl, `/api/trainings/${importedId}/trades/1/note`)).note, 'old-v127-note')
  assert.equal((await request(finalUrl, `/api/trainings/${importedId}/drawings`)).drawings.length, 1)
  await current.shutdown(); current = null
  assert.equal(await hash(source), beforeSource)
  const receipt = { time: new Date().toISOString(), workspace, oldRoot, tdxRoot, source, target, manifest, sourceSha256: beforeSource, oldId, existingId, importedId, oldCounts: exported.manifest.counts, staged, applied, repeatStage, repeated, checks: ['old API created settled training with buy/sell, note, drawing', 'source database unchanged', 'existing target rows and recording namespace preserved', 'imported training and children match original fields', 'repeat import adds zero records', 'current API reads migrated report, note and drawing'], backups: (await readdir(newData)).filter(name => name.includes('pre-migration')), scope: 'Real v1.2.7 binary + real exporter + production desktop migration functions + current API; packaged Electron verification is a separate receipt.' }
  await writeFile(join(evidence, 'history-migration-real.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log('HISTORY_MIGRATION_PASS', JSON.stringify({ importedId, applied, repeated, workspace }))
} finally {
  if (current) await current.shutdown()
  if (oldStarted) await stopOld()
}
