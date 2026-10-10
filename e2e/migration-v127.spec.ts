// MIG-01：v1.2.7 → v1.3.0 迁移工具真实链路 e2e。
// 前置（环境变量注入，无包环境 skip）：MIG_V127_PACKAGE 指向本地 v1.2.7 zip 包根
// （含 runtime/node.exe、launcher.cjs、server/、web/）。
// 链路：真实老包按隔离端口+隔离数据目录起服务（绝不触碰用户默认 ~/.a-share-kline-trainer）
// → 旧 origin 页面按 v1.2.7 行形状播种录像（1 legacy v1 + 2 compact + 1 imported）
// → 旧应用自己的录像库能看到（证明种子与老格式一致）
// → 停老服务 → 跑 tools/migrate-v127 交付物（同源端口伺服导出页）→ 下载合并包
// → 当前版本（模拟 v1.3.0）录像库批量导入 → 断言成功数、可见性与回放。
import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { evidencePath } from './runtime'

const PACKAGE = process.env.MIG_V127_PACKAGE ? resolve(process.env.MIG_V127_PACKAGE) : ''
const TOOL_CJS = resolve('tools/migrate-v127/dist/migrate-v127/export-v127.cjs')

// v1.2.7 语义合法的录像载荷（事件 started/finished 配对；画线窗格 MACD）
function v127Recording(sessionId: string, trainingKey: string | null, createdAt: string) {
  return {
    format: 'trainer-session', schemaVersion: 2, sessionId, createdAt,
    app: { version: '1.2.7', gitCommit: 'bbd368b', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 720 }, dpr: 1 },
    trainingKey, complete: true, gaps: [],
    events: [
      { seq: 1, opId: 'op-1', segmentId: 'seg-1', elapsedMs: 0, phase: 'started', action: 'training.advance', source: 'ui', params: { day: 1 }, checkpointId: 'cp-1' },
      { seq: 2, opId: 'op-1', segmentId: 'seg-1', elapsedMs: 100, phase: 'finished', action: 'training.advance', source: 'ui', outcome: 'accepted', result: { ok: true }, checkpointId: 'cp-1' },
    ],
    checkpoints: [{
      id: 'cp-1', afterSeq: 1, segmentId: 'seg-1', capturedAt: createdAt,
      ui: { theme: 'light', tool: null, magnet: 'off', multiSelect: false },
      training: null,
      chart: {
        timeframe: '1D', seriesRef: 's-d-1', drawingsRef: 'dw-1', costPrice: null,
        view: { fromTimestamp: 1577836800000, toTimestamp: 1577923200000, barSpace: 8, paneHeights: { candle: 300, volume: 100 } },
      },
      contextRef: null,
    }],
    resources: {
      series: [{
        id: 's-d-1', timeframe: '1D', asOf: '2020-01-02', firstCheckpoint: 0, base: null,
        bars: [
          { date: '2020-01-01', open: 10, high: 11, low: 9, close: 10, volume: 1000, amount: 10500 },
          { date: '2020-01-02', open: 10, high: 11, low: 9, close: 10.1, volume: 1001, amount: 10501 },
        ],
      }],
      drawings: [{ id: 'dw-1', base: null, items: [{ id: 'dw-1', name: 'horizontalSegment', paneId: 'MACD', points: [{ timestamp: 1577836800000, value: 10.5 }] }] }],
      trainingMeta: [], accounts: [], trades: [], contexts: [],
    },
  }
}

const legacyV1 = {
  format: 'trainer-session', schemaVersion: 1, sessionId: 'mig-legacy-v1',
  createdAt: '2025-12-01T00:00:00.000Z',
  app: { version: '1.1.0', gitCommit: 'legacy', dirty: false, chartLibrary: '10.0.3' },
  environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 800 }, dpr: 1 },
  trainingKey: null, events: [], gaps: [], complete: true,
  checkpoints: [{ id: 'c0', afterSeq: 0, segmentId: 'seg0', capturedAt: '2025-12-01T00:00:00.000Z',
    training: null, chart: null, ui: { theme: 'dark', tool: null, magnet: 'weak_magnet', multiSelect: false }, context: null }],
}

function probePort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server: Server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

async function freePortFrom(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 40; port++) {
    if (await probePort(port)) return port
  }
  throw new Error(`no free port from ${preferred}`)
}

async function waitHttpOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'not attempted'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) {
        const body = await response.json() as { status?: string }
        if (body.status === 'ok') return
        lastError = `status=${body.status}`
      } else lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`service not ready at ${url}: ${lastError}`)
}

async function waitRefused(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) })
    } catch {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error(`service still responding at ${url}`)
}

async function waitToolReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'not attempted'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) {
        const body = await response.json() as { ok?: boolean; tool?: string }
        if (body.ok === true && body.tool === 'migrate-v127') return
        lastError = `body=${JSON.stringify(body)}`
      } else lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error(`migration tool not ready at ${url}: ${lastError}`)
}

/** 剥离 journey 运行时注入的 TRAINER_x / PORT / TDX_ROOT 等环境变量：老包 launcher 的 env 覆盖优先于 --config，
 *  泄漏会把老服务的数据库静默指到 journey 运行库（实测踩过：数据目录只剩 server.log）。 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('TRAINER_') || key === 'TDX_ROOT' || key === 'PORT' || key === 'HOST' || key === 'OPEN_BROWSER') delete env[key]
  }
  return env
}

function runBackground(nodeExe: string, args: string[]): ChildProcess {
  const child = spawn(nodeExe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: cleanEnv() })
  child.stdout?.on('data', chunk => process.stdout.write(`[old] ${chunk}`))
  child.stderr?.on('data', chunk => process.stderr.write(`[old] ${chunk}`))
  return child
}

/** 旧 origin 页面上按 v1.2.7 IndexedDB 行形状播种（legacy sessions + compact 头/行 + imports） */
async function seedOldRecordingDatabase(page: Page, dbName: string, importsName: string, seeds: {
  legacy: unknown
  compactFiles: Array<ReturnType<typeof v127Recording>>
  imported: ReturnType<typeof v127Recording>
}): Promise<void> {
  await page.evaluate(async ({ dbName: main, importsName: imports, seeds: payload }) => {
    const openUpgrade = (name: string, version: number, createStore: (db: IDBDatabase) => void) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, version)
      request.onupgradeneeded = () => createStore(request.result)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const putAll = (db: IDBDatabase, stores: string[], rows: Array<[string, unknown]>) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite')
      for (const [store, value] of rows) tx.objectStore(store).put(value)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })

    const mainDb = await openUpgrade(main, 2, db => {
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'sessionId' })
      if (!db.objectStoreNames.contains('compactSessions')) db.createObjectStore('compactSessions', { keyPath: 'sessionId' })
      if (!db.objectStoreNames.contains('compactRecords')) db.createObjectStore('compactRecords', { keyPath: ['sessionId', 'kind', 'index'] })
    })
    const rows: Array<[string, unknown]> = [['sessions', payload.legacy]]
    for (const file of payload.compactFiles) {
      const counts = {
        events: file.events.length, checkpoints: file.checkpoints.length,
        series: file.resources.series.length, drawings: file.resources.drawings.length,
        trainingMeta: file.resources.trainingMeta.length, accounts: file.resources.accounts.length,
        trades: file.resources.trades.length, contexts: file.resources.contexts.length,
      }
      rows.push(['compactSessions', {
        format: 'trainer-session', schemaVersion: file.schemaVersion, sessionId: file.sessionId,
        createdAt: file.createdAt, app: file.app, environment: file.environment, trainingKey: file.trainingKey,
        gaps: file.gaps, complete: file.complete, counts, revision: 1, batchId: 'seed-batch',
      }])
      file.events.forEach((value, index) => rows.push(['compactRecords', { sessionId: file.sessionId, kind: 'event', index, value }]))
      file.checkpoints.forEach((value, index) => rows.push(['compactRecords', { sessionId: file.sessionId, kind: 'checkpoint', index, value }]))
      for (const [kind, list] of Object.entries(file.resources)) {
        ;(list as unknown[]).forEach((value, index) => rows.push(['compactRecords', { sessionId: file.sessionId, kind, index, value }]))
      }
    }
    await putAll(mainDb, ['sessions', 'compactSessions', 'compactRecords'], rows)
    mainDb.close()

    const importsDb = await openUpgrade(imports, 2, db => {
      if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries', { keyPath: 'sessionId' })
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'sessionId' })
    })
    const importedFile = payload.imported
    await putAll(importsDb, ['summaries', 'recordings'], [
      ['recordings', importedFile],
      ['summaries', {
        sessionId: importedFile.sessionId, source: 'imported', originalSessionId: importedFile.sessionId,
        importedAt: importedFile.createdAt, fileName: 'seed.json', createdAt: importedFile.createdAt,
        trainingKey: importedFile.trainingKey, eventCount: importedFile.events.length,
      }],
    ])
    importsDb.close()
  }, { dbName, importsName, seeds })
}

test.skip(!PACKAGE, 'MIG_V127_PACKAGE 未设置：需要本地 v1.2.7 包路径才能运行迁移真实链路')

test('v1.2.7 真实包：隔离起服→播种→导出工具→合并包→新版导入回放全链路', async ({ page }) => {
  test.setTimeout(300_000)
  const nodeExe = join(PACKAGE, 'runtime', 'node.exe')
  const launcher = join(PACKAGE, 'launcher.cjs')
  const workspace = await mkdtemp(join(tmpdir(), 'mig-v127-e2e-'))
  const dataDir = join(workspace, 'data')
  const configPath = join(workspace, 'trainer.config.json')
  const bundlePath = join(workspace, 'migration-bundle.trainer-recordings.json')
  const port = await freePortFrom(8917)
  await writeFile(configPath, JSON.stringify({ port, dataDir }, null, 2), 'utf8')
  const oldBaseURL = `http://127.0.0.1:${port}`

  let oldServer: ChildProcess | null = null
  let toolServer: ChildProcess | null = null
  try {
    // 1) 真实老包：隔离端口 + 隔离数据目录起服务（launcher --config，绝不触碰用户默认数据目录）
    oldServer = runBackground(nodeExe, [launcher, '--config', configPath, '--no-open'])
    await waitHttpOk(`${oldBaseURL}/api/health`, 90_000)

    // 2) 旧 origin 播种（1 legacy + 2 compact + 1 imported）
    await page.goto(oldBaseURL)
    const namespace = await page.evaluate(async () => {
      const response = await fetch('/api/env')
      const env = await response.json() as { recordingNamespace: string }
      return env.recordingNamespace
    })
    expect(namespace).toMatch(/^[a-f0-9-]{36}$/)
    const dbName = `trainer-recordings.${namespace.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96)}`
    const compactA = v127Recording('mig-compact-a', 'mig.key.a', '2026-01-01T00:00:00.000Z')
    const compactB = v127Recording('mig-compact-b', null, '2026-01-02T00:00:00.000Z')
    const importedFile = { ...v127Recording('imported-mig-1', 'mig.key.imported', '2026-01-03T00:00:00.000Z') }
    await seedOldRecordingDatabase(page, dbName, `${dbName}.imports`, { legacy: legacyV1, compactFiles: [compactA, compactB], imported: importedFile })

    // 3) 旧应用自己的录像库能看到全部四条（证明种子与 v1.2.7 存储格式一致）
    await page.getByRole('button', { name: '训练录像', exact: true }).click()
    await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^本机训练录像/ })).toContainText('(3)')
    await expect(page.getByRole('heading', { name: /^导入的分享录像/ })).toContainText('(1)')
    await page.screenshot({ path: evidencePath('migration-v127-old-library.png') })

    // 4) 停老服务（--stop 只结束本 launcher 记录的服务）
    const stopper = runBackground(nodeExe, [launcher, '--config', configPath, '--stop'])
    await new Promise<void>((resolveStop, rejectStop) => {
      stopper.once('exit', code => (code === 0 ? resolveStop() : rejectStop(new Error(`launcher --stop exited ${code}`))))
    })
    await waitRefused(`${oldBaseURL}/api/health`, 30_000)
    oldServer = null

    // 5) 跑迁移工具交付物：同源端口伺服导出页（显式 --data-dir 权威采用；--port 确保不依赖状态文件——
    //    launcher --stop 会清掉状态文件，端口回退链在这里不可用）
    toolServer = runBackground(nodeExe, [TOOL_CJS, '--package-root', PACKAGE, '--data-dir', dataDir, '--port', String(port), '--no-open'])
    await waitToolReady(`${oldBaseURL}/healthz`, 30_000)

    // 6) 同一浏览器上下文（同 profile）打开导出页 → 扫描 → 下载合并包
    await page.goto(oldBaseURL)
    await expect(page.locator('#detect-info')).toContainText('本机 3 场 ＋ 导入 1 场')
    await expect(page.locator('#detect-info')).toContainText(dbName)
    await expect(page.locator('#list')).toBeVisible()
    await expect(page.locator('#list-body tr')).toHaveCount(4)
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出录像合并包' }).click()
    const download = await pending
    expect(download.suggestedFilename()).toMatch(/^训练录像库-\d{12}\.trainer-recordings\.json$/)
    await download.saveAs(bundlePath)
    await page.screenshot({ path: evidencePath('migration-v127-export-page.png') })

    // 7) 合并包契约断言（REC-BULK 格式 + 四条载荷）
    const bundle = JSON.parse((await readFile(bundlePath)).toString('utf8'))
    expect(bundle.format).toBe('trainer-recordings-bundle')
    expect(bundle.version).toBe(1)
    expect(bundle.items).toHaveLength(4)
    expect(new Set(bundle.items.map((item: { sessionId: string }) => item.sessionId)))
      .toEqual(new Set(['mig-compact-a', 'mig-compact-b', 'imported-mig-1', 'mig-legacy-v1']))

    // 8) 新版本（当前 main＝模拟 v1.3.0）录像库批量导入 → 可见且可回放
    await page.goto('/')
    const active = (await (await page.request.get('/api/trainings/active')).json()).training
    if (active) await page.request.post(`/api/trainings/${active.id}/abandon`)
    await page.getByRole('button', { name: '训练录像', exact: true }).click()
    await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
    // 新版录像库命名空间初始化（/api/env）与导入存在竞态：过早导入报「尚未完成安装隔离初始化」。
    // 该错误发生在任何条目落库之前，清空文件后重试安全（已导入条目由去重口径保护）。
    let imported = false
    for (let attempt = 0; attempt < 6 && !imported; attempt++) {
      await page.getByLabel('导入录制', { exact: true }).setInputFiles(bundlePath)
      try {
        await expect(page.getByRole('status').filter({ hasText: '批量导入完成：成功 4' })).toBeVisible({ timeout: 5000 })
        imported = true
      } catch (error) {
        const alert = page.getByRole('alert')
        const text = (await alert.count()) > 0 ? await alert.first().textContent() : ''
        if (text && text.includes('尚未完成安装隔离初始化')) {
          await page.getByLabel('导入录制', { exact: true }).setInputFiles([])
          await page.waitForTimeout(600)
          continue
        }
        throw error
      }
    }
    expect(imported).toBe(true)
    await expect(page.locator('[data-recording-source="imported"] .recording-history-item')).toHaveCount(4)
    // 与 recording-bulk 同口径：新导入录像经「返回训练→重开录像库」刷新父列表后回放
    await page.getByRole('button', { name: '返回训练', exact: true }).click()
    await page.getByRole('button', { name: '训练录像', exact: true }).click()
    await expect(page.getByRole('heading', { name: '训练录像', exact: true })).toBeVisible()
    await page.locator('[data-recording-source="imported"] .recording-history-open').first().click()
    await expect(page.getByRole('button', { name: '关闭回放', exact: true })).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: evidencePath('migration-v127-new-replay.png') })
  } finally {
    for (const child of [toolServer, oldServer]) {
      if (child && child.exitCode === null) child.kill()
    }
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
})
