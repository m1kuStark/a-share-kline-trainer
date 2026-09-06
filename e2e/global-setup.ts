import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 隔离服务端：临时 SQLite 库＋固定端口 8791；teardown 杀进程。
// 前置要求：npm run build:journey（server/dist/index.js 与 web/dist journey 构建就绪）。
// 防呆：①启动前端口预检（占用即报错，绝不静默连到未知进程——历史教训：孤儿进程用别的库，
// 断言全乱难定位）；②轮询期间监控子进程存活，EADDRINUSE 等启动失败立即报错而非超时。
const PORT = 8791

async function portInUse(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/env`, { signal: AbortSignal.timeout(1500) })
    return r.status < 500
  } catch {
    return false
  }
}

let server: ChildProcess | null = null

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (await portInUse()) {
    throw new Error(
      `端口 ${PORT} 已被占用（疑似此前调试遗留的孤儿服务端）。` +
      `请先结束该进程：netstat -ano | findstr :${PORT} 然后 taskkill /F /PID <pid>`,
    )
  }
  const db = join(mkdtempSync(join(tmpdir(), 'journey-')), 'journey.sqlite')
  server = spawn(process.execPath, ['server/dist/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, TRAINER_DB: db, PORT: String(PORT), OPEN_BROWSER: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const stderr: string[] = []
  server.stderr?.on('data', (chunk: Buffer) => { stderr.push(String(chunk)) })
  let ready = false
  for (let i = 0; i < 150 && !ready; i++) {
    if (server.exitCode !== null) {
      throw new Error(`journey 服务端启动失败（exit ${server.exitCode}）：\n${stderr.join('')}`)
    }
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/env`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) ready = true
    } catch {
      await new Promise(r => setTimeout(r, 200))
    }
  }
  if (!ready) throw new Error('journey 服务端未就绪（30s 超时），请先 npm run build:journey')
  return async () => { server?.kill() }
}
