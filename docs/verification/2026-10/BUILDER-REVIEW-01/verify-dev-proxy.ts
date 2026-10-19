// Run from repository root: npx tsx docs/verification/2026-10/BUILDER-REVIEW-01/verify-dev-proxy.ts
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { createServer as reservePort } from 'node:net'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { createRun } from '../../../../scripts/runtime/run'
import { startTrainerServer } from '../../../../server/src/index'

const run = await createRun(process.cwd(), 'dev')
Object.assign(process.env, {
  PORT: '0', HOST: '127.0.0.1', OPEN_BROWSER: '0', TDX_ROOT: '',
  TRAINER_RUN_ID: run.runId, TRAINER_DB: run.databasePath,
  TRAINER_DATA_DIR: run.runDir, TRAINER_STATIC_DIR: run.webDir,
  TRAINER_READY_FILE: run.readyFile, TRAINER_CONTROL_TOKEN: 'isolated-proxy-probe',
})
const backend = await startTrainerServer()
process.env.VITE_API_TARGET = `http://127.0.0.1:${backend.port}`
const reservation = reservePort()
await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
const reserved = reservation.address()
assert(reserved && typeof reserved !== 'string')
await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
const vite = await createServer({ configFile: join(run.root, 'web/vite.config.ts'), server: { host: '127.0.0.1', port: reserved.port, strictPort: true } })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await vite.listen()
  const address = vite.httpServer!.address()
  assert(address && typeof address !== 'string')
  browser = await chromium.launch({ channel: 'msedge' })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  const result = await page.evaluate(async () => {
    const write = await fetch('/api/settings/app', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoDataCheck: false }),
    })
    const read = await fetch('/api/settings/app')
    return { writeStatus: write.status, readStatus: read.status, saved: (await read.json()).autoDataCheck }
  })
  assert.deepEqual(result, { writeStatus: 200, readStatus: 200, saved: false })
  assert.deepEqual(errors, [])
  const receipt = { runId: run.runId, check: 'real Vite config + Edge same-origin API proxy', result, pageErrors: errors }
  await writeFile(join(run.root, 'docs/verification/2026-10/BUILDER-REVIEW-01/dev-proxy-receipt.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt))
} finally {
  await browser?.close()
  await vite.close()
  await backend.shutdown()
}
