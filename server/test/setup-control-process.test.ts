// SETUP-DRAIN-01（control-handoff-20260927-30）：真实服务子进程闭环测试。
// 使用本项目实际 server 入口（server/src/index.ts，经 tsx 运行），临时 DB/static/ready、
// 独立 runId/token、PORT=0 动态端口、TDX_ROOT 空。验证：健康可读 → prepare 200 →
// shutdown 202 → 所属子进程正常退出（exit 0）→ 端口可重新绑定 → ready 已清理 →
// 重新打开临时 SQLite 数据完整；无 closed-database / unhandled rejection。
import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { DatabaseSync } from 'node:sqlite'

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const ROOT = process.cwd()
const SERVER_ENTRY = join(ROOT, 'server', 'src', 'index.ts')

interface HttpResult {
  statusCode: number
  body: Record<string, unknown>
}

function request(port: number, method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const request = net.connect({ port, host: '127.0.0.1' }, () => {
      const headers = [
        `${method} ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Connection: close',
      ]
      if (token !== undefined) headers.push(`x-control-token: ${token}`)
      if (payload !== null) {
        headers.push('Content-Type: application/json')
        headers.push(`Content-Length: ${Buffer.byteLength(payload)}`)
      }
      request.write(headers.join('\r\n') + '\r\n\r\n' + (payload ?? ''))
    })
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('error', reject)
    request.on('close', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const separator = raw.indexOf('\r\n\r\n')
      const head = separator >= 0 ? raw.slice(0, separator).toString('utf8') : raw
      const bodyText = separator >= 0 ? raw.slice(separator + 4) : ''
      const statusMatch = /HTTP\/1\.1 (\d+)/.exec(head)
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(bodyText) as Record<string, unknown> } catch { /* 空体或非 JSON */ }
      resolve({ statusCode: statusMatch ? Number(statusMatch[1]) : 0, body: parsed })
    })
  })
}

async function waitForReadyFile(readyFile: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const text = await readFile(readyFile, 'utf8')
      return JSON.parse(text) as Record<string, unknown>
    } catch (error) {
      if (Date.now() > deadline) throw error
      await delay(100)
    }
  }
}

function canBindPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => { probe.close(() => resolve(true)) })
    probe.listen({ port, host: '127.0.0.1' })
  })
}

describe('SETUP-DRAIN-01：真实服务子进程排空与优雅退出闭环', () => {
  it('健康→prepare 200→shutdown 202→子进程 exit 0→端口可重绑→ready 清理→SQLite 数据完整', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'setup-drain-'))
    const dbPath = join(dir, 'trainer.sqlite')
    const readyFile = join(dir, 'ready.json')
    const staticDir = join(dir, 'static')
    await mkdir(staticDir, { recursive: true })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const runId = `run-drain-${Date.now()}`
    const attemptId = `attempt-${Date.now()}`

    const logHandle = await open(join(dir, 'server-stdout.log'), 'a')
    const child = spawn(process.execPath, ['--import', 'tsx', SERVER_ENTRY], {
      cwd: ROOT,
      stdio: ['ignore', logHandle.fd, 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PORT: '0',
        HOST: '127.0.0.1',
        TRAINER_RUN_ID: runId,
        TRAINER_DB: dbPath,
        TRAINER_READY_FILE: readyFile,
        TRAINER_STATIC_DIR: staticDir,
        TRAINER_CONTROL_TOKEN: 'tok-drain-e2e',
        TDX_ROOT: '',
        OPEN_BROWSER: '0',
      },
    })
    child.stderr?.on('data', chunk => {
      if (stderrChunks.reduce((sum, c) => sum + c.length, 0) < 262_144) stderrChunks.push(chunk as Buffer)
    })
    const exitPromise = new Promise<number | null>(resolve => {
      child.once('exit', (code, signal) => resolve(code ?? (signal ? -1 : null)))
    })

    try {
      const ready = await waitForReadyFile(readyFile)
      const port = Number(ready.port)
      expect(Number.isFinite(port) && port > 0).toBe(true)
      expect(ready.runId).toBe(runId)
      expect(ready.pid).toBe(child.pid)

      const health = await request(port, 'GET', '/api/health')
      expect(health.statusCode).toBe(200)
      expect(health.body.runId).toBe(runId)

      const prepare = await request(port, 'POST', '/api/setup/control/prepare',
        { runId, attemptId }, 'tok-drain-e2e')
      expect(prepare.statusCode).toBe(200)
      expect(prepare.body).toMatchObject({ phase: 'prepared', runId, attemptId })
      expect(typeof prepare.body.expiresAtMs).toBe('number')

      const shutdown = await request(port, 'POST', '/api/setup/control/shutdown',
        { runId, attemptId }, 'tok-drain-e2e')
      expect(shutdown.statusCode).toBe(202)
      expect(shutdown.body).toMatchObject({ phase: 'closing', runId, attemptId })

      const exitCode = await Promise.race([
        exitPromise,
        delay(20_000).then(() => 'timeout'),
      ])
      expect(exitCode).toBe(0)

      // 端口已释放：可立即重新绑定
      expect(await canBindPort(port)).toBe(true)
      // ready 已随 shutdown 清理
      await expect(readFile(readyFile, 'utf8')).rejects.toThrow()
      // 重新打开临时 SQLite：迁移表在、数据可读，无 closed-database 症状
      const reopened = new DatabaseSync(dbPath)
      const tables = reopened.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='trainings'",
      ).get()
      expect(tables).toBeTruthy()
      reopened.close()

      const stderrText = Buffer.concat(stderrChunks).toString('utf8')
      expect(stderrText).not.toContain('closed database')
      expect(stderrText.toLowerCase()).not.toContain('unhandled rejection')
    } finally {
      await logHandle.close()
      if (child.exitCode === null && child.signalCode === null) child.kill()
      // 证据落盘（headroom 缓存目录），随后清理临时目录
      const evidenceDir = process.env.DRAIN_EVIDENCE_DIR
      if (evidenceDir) {
        const { writeFile } = await import('node:fs/promises')
        await writeFile(join(evidenceDir, 'drain-process-stdout.log'), Buffer.concat(stdoutChunks)).catch(() => {})
        await writeFile(join(evidenceDir, 'drain-process-stderr.log'), Buffer.concat(stderrChunks)).catch(() => {})
      }
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }, 40_000)
})
