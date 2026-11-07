import Fastify from 'fastify'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/config.js'
import {
  createOperationLog, sanitizeOperationData, OPERATION_LOG_FILE_NAME,
  type OperationLogDeps,
} from '../src/diagnostics/operation-log.js'
import { registerDiagnosticsApi } from '../src/diagnostics/api.js'

// DIAG-OPLOG-01：本地操作日志（验收/问题定位）。oracle 独立性：断言读真实 JSONL 文件、
// 脱敏结果按「键名黑名单＋绝对路径＋长度/深度上限」手算，不读实现内部状态。
vi.setConfig({ testTimeout: 20_000 })

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

function memoryDeps(initial = ''): { deps: OperationLogDeps, files: Map<string, string> } {
  const files = new Map<string, string>()
  if (initial) files.set('seed', initial)
  let current = initial
  const deps: OperationLogDeps = {
    mkdir: async () => undefined,
    stat: async () => ({ size: Buffer.byteLength(current, 'utf8') }),
    appendFile: async (_path, data) => { current += data },
    readFile: async () => current,
    rename: async () => { throw Object.assign(new Error('rename unavailable'), { code: 'ENOENT' }) },
    rm: async () => undefined,
    fallback: { warn: () => undefined },
  }
  return { deps, files }
}

describe('操作日志脱敏与写入', () => {
  it('键名黑名单、绝对路径与长度/深度上限', () => {
    const sanitized = sanitizeOperationData({
      token: 'abc', password: '123', authorization: 'Bearer x', cookie: 'sid=1',
      nested: { secret: 's', note: 'private note', keep: 'ok' },
      windowsPath: 'C:\\Users\\stark\\private\\vipdoc',
      uncPath: '\\\\server\\share\\file',
      long: 'x'.repeat(900),
      deep: { a: { b: { c: { d: { e: 'too deep' } } } } },
      list: Array.from({ length: 40 }, (_, i) => i),
      notString: 3.5,
    }) as Record<string, unknown>
    expect(sanitized.token).toBe('<redacted>')
    expect(sanitized.password).toBe('<redacted>')
    expect(sanitized.authorization).toBe('<redacted>')
    expect(sanitized.cookie).toBe('<redacted>')
    expect((sanitized.nested as Record<string, unknown>).secret).toBe('<redacted>')
    expect((sanitized.nested as Record<string, unknown>).keep).toBe('ok')
    expect(String(sanitized.windowsPath)).not.toContain('stark')
    expect(String(sanitized.windowsPath)).toContain('<path')
    expect(String(sanitized.uncPath)).toContain('<path')
    expect(String(sanitized.long).length).toBeLessThanOrEqual(500)
    expect((sanitized.list as unknown[]).length).toBeLessThanOrEqual(30)
    expect(sanitized.notString).toBe(3.5)
  })

  it('真实临时目录：追加 JSONL、滚动、tail 可读', async () => {
    const root = await tempRoot('diag-oplog-')
    try {
      const log = createOperationLog({ dataDir: root, maxBytes: 220, keepFiles: 3 })
      await log.append({ type: 'ui', action: 'click', source: 'web', data: { label: '开始训练' } })
      await log.append({ type: 'api', action: 'POST /api/trainings', source: 'server', status: 201 })
      await log.append({ type: 'ui', action: 'click', source: 'web', data: { label: '推进下一日' } })
      const raw = await readFile(log.filePath, 'utf8')
      const rows = raw.trim().split(/\r?\n/).map(line => JSON.parse(line))
      expect(rows.at(-1)).toMatchObject({ type: 'ui', action: 'click' })
      expect(rows.every(row => row.v === 1 && typeof row.ts === 'string')).toBe(true)
      const tail = await log.readTail(2)
      expect(tail.ok).toBe(true)
      if (tail.ok) {
        expect(tail.lines).toHaveLength(2)
        expect(tail.lines[1]).toContain('推进下一日')
      }
      expect(log.filePath.endsWith(OPERATION_LOG_FILE_NAME)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('写入失败只降级告警，绝不抛出（诊断不阻断业务）', async () => {
    const warn = vi.fn()
    const deps: OperationLogDeps = {
      mkdir: async () => undefined,
      stat: async () => ({ size: 0 }),
      appendFile: async () => { throw new Error('disk full') },
      readFile: async () => '',
      rename: async () => undefined,
      rm: async () => undefined,
      fallback: { warn },
    }
    const log = createOperationLog({ dataDir: 'C:\\unused', deps })
    await expect(log.append({ type: 'ui', action: 'click', source: 'web' })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('操作日志 HTTP API', () => {
  async function context() {
    const root = await tempRoot('diag-api-')
    const app = Fastify()
    const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: join(root, 'trainer.sqlite'), tdxRoot: null, dataDir: root }
    app.post('/api/trainings', async () => ({ ok: true }))
    registerDiagnosticsApi(app, config)
    await app.ready()
    return { app, root, config }
  }

  it('POST /api/diagnostics/events 写入真实文件；GET info/tail 可读', async () => {
    const { app, root } = await context()
    try {
      const payload = { clientId: 'c-1', sessionId: 's-1', events: [
        { type: 'ui', action: 'click', data: { label: '开始训练', token: 'leak' } },
        { type: 'error', action: 'page.error', data: { message: 'boom' } },
      ] }
      const response = await app.inject({ method: 'POST', url: '/api/diagnostics/events', payload })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ ok: true, written: 2 })
      const info = await app.inject({ method: 'GET', url: '/api/diagnostics/info' })
      expect(info.statusCode).toBe(200)
      const infoBody = info.json() as { logPath: string, enabled: boolean, version: string }
      expect(infoBody.enabled).toBe(true)
      expect(infoBody.logPath).toBe(join(root, 'logs', OPERATION_LOG_FILE_NAME))
      const tail = await app.inject({ method: 'GET', url: '/api/diagnostics/tail?limit=10' })
      const tailBody = tail.json() as { lines: string[] }
      const rows = tailBody.lines.map(line => JSON.parse(line))
      expect(rows.some(row => row.type === 'ui' && row.action === 'click')).toBe(true)
      expect(JSON.stringify(rows)).not.toContain('leak')
      expect(rows.some(row => row.type === 'error' && row.data.message === 'boom')).toBe(true)
      const raw = await readFile(join(root, 'logs', OPERATION_LOG_FILE_NAME), 'utf8')
      expect(raw).toContain('开始训练')
    } finally {
      await app.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('非法载荷 400；事件数超限 400 零写', async () => {
    const { app, root } = await context()
    try {
      const bad = await app.inject({ method: 'POST', url: '/api/diagnostics/events', payload: { events: [{ action: 'click' }] } })
      expect(bad.statusCode).toBe(400)
      const tooMany = await app.inject({ method: 'POST', url: '/api/diagnostics/events', payload: { events: Array.from({ length: 51 }, () => ({ type: 'ui', action: 'click' })) } })
      expect(tooMany.statusCode).toBe(400)
      const empty = await readFile(join(root, 'logs', OPERATION_LOG_FILE_NAME), 'utf8').catch(() => '')
      expect(empty).toBe('')
    } finally {
      await app.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('业务 API 调用被 onResponse 中间件记入操作日志（不含查询凭证）', async () => {
    const { app, root } = await context()
    try {
      const response = await app.inject({ method: 'POST', url: '/api/trainings', payload: { code: '600519', token: 'secret-token' } })
      expect(response.statusCode).toBe(200)
      // onResponse 在响应发出后异步写盘：轮询 tail，避免与响应返回竞态
      let api: Record<string, unknown> | undefined
      for (let attempt = 0; attempt < 40 && !api; attempt += 1) {
        const tail = await app.inject({ method: 'GET', url: '/api/diagnostics/tail?limit=20' })
        const rows = (tail.json() as { lines: string[] }).lines.map(line => JSON.parse(line))
        api = rows.find(row => row.type === 'api' && String(row.action).includes('POST /api/trainings'))
        if (!api) await new Promise(resolve => setTimeout(resolve, 25))
      }
      expect(api).toBeTruthy()
      expect(api.status).toBe(200)
      expect(JSON.stringify(api)).not.toContain('secret-token')
      expect(JSON.stringify(api)).toContain('600519')
    } finally {
      await app.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('桌面诊断接线（source contract）', () => {
  it('diagnostics.ts/main.ts/preload.cts 暴露操作日志路径与 openLogDir，且不读训练库', async () => {
    const read = (path: string) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    const diagnostics = await read('../../desktop/src/diagnostics.ts')
    expect(diagnostics).toContain('operationLogPath')
    expect(diagnostics).toContain("method === 'openLogDir'")
    expect(diagnostics).not.toMatch(/sqlite|trainer\.sqlite/)
    const main = await read('../../desktop/src/main.ts')
    expect(main).toContain("join(diagDataDir, 'logs', 'operations.log')")
    expect(main).toContain("shell.openPath(join(diagDataDir, 'logs'))")
    const preload = await read('../../desktop/src/preload.cts')
    expect(preload).toContain("method: 'openLogDir'")
  })
})
