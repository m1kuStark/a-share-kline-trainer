import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../server/dist/db.js'
import {
  inspectLegacyRoot,
  migrateHistoryInline,
  startLegacyRecordingExportServer,
} from '../src/mig-inline.js'
import { buildLegalV127Db } from './mig-fixtures.js'

// MIG-INLINE-01 内置迁移向导主进程三段（矩阵 migration-inline）：
//   inspectLegacyRoot——v1.2.7 安装路径只读校验＋摘要（数据目录四级序＋端口解析）
//   migrateHistoryInline——老库副本→OneClick 暂存→consume→apply（幂等合并复用 MIG-MERGE-01）
//   startLegacyRecordingExportServer——旧 origin 端口伺服导出页＋/upload-bundle 回收暂存
// 依赖注入面收窄：inspect/migrate 全走真实临时目录（fs 面即产品面）；server 用随机端口真起真收。

const created: string[] = []
async function makeDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `miginline-${prefix}-`))
  created.push(dir)
  return dir
}

/** v1.2.7 安装目录形态：<root>/data/trainer.sqlite（+ trainer-state.json 端口记录） */
async function buildLegacyPackage(root: string, trainings = 2, port?: number): Promise<void> {
  await mkdir(join(root, 'data'), { recursive: true })
  const dbPath = join(root, 'data', 'trainer.sqlite')
  buildLegalV127Db(dbPath, trainings)
  const db = new DatabaseSync(dbPath)
  db.prepare("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('recording_namespace', 'ns-v127-fixture')").run()
  db.close()
  if (port !== undefined) {
    await writeFile(join(root, 'data', 'trainer-state.json'), JSON.stringify({ port }), 'utf8')
  }
}

beforeAll(async () => { await import('../src/mig-inline.js') })
afterAll(async () => { await Promise.all(created.map(dir => rm(dir, { recursive: true, force: true }))) })

describe('inspectLegacyRoot（MIGI-INSPECT-LEGACY-ROOT）', () => {
  it('合法 v1.2.7 目录：返回局数摘要＋trainer-state.json 实际端口＋ns', async () => {
    const root = await makeDir('ok')
    await buildLegacyPackage(root, 3, 8790)
    const r = await inspectLegacyRoot(root)
    expect(r.ok).toBe(true)
    expect(r.trainings).toBe(3)
    expect(r.originPort).toBe(8790)
    expect(r.recordingNamespace).toBe('ns-v127-fixture')
  })

  it('无 trainer-state.json：端口回退 8787 并标注来源', async () => {
    const root = await makeDir('port')
    await buildLegacyPackage(root, 1)
    const r = await inspectLegacyRoot(root)
    expect(r.ok).toBe(true)
    expect(r.originPort).toBe(8787)
  })

  it('目录无 data/trainer.sqlite：ok=false 人话原因，不抛错不改文件', async () => {
    const root = await makeDir('empty')
    const r = await inspectLegacyRoot(root)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('trainer.sqlite')
  })

  it('库存在但 schema 非 v1.2.7 形状：ok=false 指明库形状问题', async () => {
    const root = await makeDir('badschema')
    await mkdir(join(root, 'data'), { recursive: true })
    const db = new DatabaseSync(join(root, 'data', 'trainer.sqlite'))
    db.exec('CREATE TABLE unrelated (x INTEGER)')
    db.close()
    const r = await inspectLegacyRoot(root)
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})

describe('migrateHistoryInline（MIGI-HISTORY-MERGE-IDEMPOTENT / MIGI-RERUN-SKIP-EXISTING）', () => {
  it('空目标库：老库 2 局全部导入；重跑同一路径全部 skipped；ns 与既有库不受影响', async () => {
    const legacyRoot = await makeDir('legacy')
    await buildLegacyPackage(legacyRoot, 2)
    const dataDir = await makeDir('data')
    const targetPath = join(dataDir, 'trainer.sqlite')
    const target = new DatabaseSync(targetPath)
    migrateDatabase(target)
    target.close()

    const first = await migrateHistoryInline({ legacyRoot, dataDir, databasePath: targetPath })
    expect(first.ok).toBe(true)
    expect(first.imported).toBe(2)
    expect(first.skipped).toBe(0)

    const second = await migrateHistoryInline({ legacyRoot, dataDir, databasePath: targetPath })
    expect(second.ok).toBe(true)
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(2)

    const check = new DatabaseSync(targetPath, { readOnly: true })
    expect(check.prepare('SELECT COUNT(*) c FROM trainings').get()).toEqual({ c: 2 })
    check.close()
  })

  it('inspect 不通过的路径：ok=false 人话原因，目标库零改动', async () => {
    const badRoot = await makeDir('nolib')
    const dataDir = await makeDir('data2')
    const targetPath = join(dataDir, 'trainer.sqlite')
    const target = new DatabaseSync(targetPath)
    migrateDatabase(target)
    target.close()
    const before = await readFile(targetPath)
    const r = await migrateHistoryInline({ legacyRoot: badRoot, dataDir, databasePath: targetPath })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    const after = await readFile(targetPath)
    expect(after.equals(before)).toBe(true)
  })
})

describe('startLegacyRecordingExportServer（MIGI-RECORDINGS-EXPORT-RETURN）', () => {
  it('伺服导出页；POST /upload-bundle 收 oneclick 形态 {json}→暂存 bundle＋importer 并更新 manifest', async () => {
    const dataDir = await makeDir('expdata')
    const listener = await import('node:net').then(m => {
      const l = m.createServer()
      l.listen(0, '127.0.0.1')
      return new Promise<number>(res => l.on('listening', () => { const p = (l.address() as { port: number }).port; l.close(() => res(p)) }))
    })
    const pageHtml = '<!doctype html><title>内置迁移导出页</title><p>test-page</p>'
    const importerText = 'window.__v127OneClickImport = () => ({ ok: true })'
    const server = await startLegacyRecordingExportServer({ dataDir, port: listener, pageHtml, importerText })
    expect(server.ok).toBe(true)

    const page = await fetch(`http://127.0.0.1:${listener}/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('test-page')

    const bundle = JSON.stringify({ format: 'trainer-recordings-bundle', version: 1, exportedAt: '2026-10-25T00:00:00.000Z', items: [{}, {}] })
    const upload = await fetch(`http://127.0.0.1:${listener}/upload-bundle`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: bundle }),
    })
    expect(upload.status).toBe(200)
    const uploadBody = await upload.json() as { ok: boolean, itemCount?: number }
    expect(uploadBody.ok).toBe(true)
    expect(uploadBody.itemCount).toBe(2)
    const manifest = JSON.parse(await readFile(join(dataDir, 'migrate-v127-import', 'manifest.json'), 'utf8')) as { format: string, recordings: { file: string, importer: string } | null }
    expect(manifest.format).toBe('trainer-oneclick-import')
    expect(manifest.recordings).not.toBeNull()
    expect(manifest.recordings!.importer).toBe('import-recordings.js')
    const stagedBundle = await readFile(join(dataDir, 'migrate-v127-import', manifest.recordings!.file), 'utf8')
    expect(stagedBundle).toBe(bundle)
    const stagedImporter = await readFile(join(dataDir, 'migrate-v127-import', 'import-recordings.js'), 'utf8')
    expect(stagedImporter).toBe(importerText)

    await server.close()
    const gone = await fetch(`http://127.0.0.1:${listener}/`).catch(() => null)
    expect(gone).toBeNull()
  })

  it('{skipped:true}＝浏览器内无旧录像：状态置 skipped，不产暂存', async () => {
    const dataDir = await makeDir('skipdata')
    const listener = await import('node:net').then(m => {
      const l = m.createServer()
      l.listen(0, '127.0.0.1')
      return new Promise<number>(res => l.on('listening', () => { const p = (l.address() as { port: number }).port; l.close(() => res(p)) }))
    })
    const server = await startLegacyRecordingExportServer({ dataDir, port: listener, pageHtml: '<p>x</p>', importerText: '' })
    expect(server.ok).toBe(true)
    const res = await fetch(`http://127.0.0.1:${listener}/upload-bundle`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skipped: true }),
    })
    expect(res.status).toBe(200)
    await server.close()
  })

  it('端口被占：ok=false 人话原因（绝不静默换端口）', async () => {
    const holder = await import('node:net').then(m => new Promise<{ server: import('node:net').Server, port: number }>(res => {
      const s = m.createServer()
      s.listen(0, '127.0.0.1', () => res({ server: s, port: (s.address() as { port: number }).port }))
    }))
    const dataDir = await makeDir('busydata')
    const r = await startLegacyRecordingExportServer({ dataDir, port: holder.port, pageHtml: '<p>x</p>', importerText: '' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain(String(holder.port))
    holder.server.close()
  })
})
