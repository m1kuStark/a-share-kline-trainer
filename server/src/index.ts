import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import { registerApi } from './api.js'
import { registerSetupControlApi } from './setup/control-api.js'
import { createDrainController } from './setup/drain-controller.js'
import { getActiveTraining } from './train/engine.js'
import { loadConfig } from './config.js'
import { ensureDatabaseDirectory, migrateDatabase, openDatabase } from './db.js'
import { registerUpdateApi } from './update/api.js'
import { serverVersion } from './update/version.js'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

/**
 * PACK-01：服务入口双形态。startTrainerServer() 供进程内嵌入（Electron 主进程等）
 * 调用——完成 loadConfig→建库迁移→Fastify 组装→listen 并返回句柄；直接以 CLI 运行
 * （node server/dist/index.js / tsx server/src/index.ts）时维持原有顶层行为：
 * ready 文件、SIGINT/SIGTERM、trainer:shutdown IPC、disconnect、浏览器打开语义不变。
 * 行为保持的证据＝server/test/setup-control-process.test.ts（真实子进程闭环）。
 */
export interface StartedTrainerServer {
  app: ReturnType<typeof Fastify>
  config: Awaited<ReturnType<typeof loadConfig>>
  url: string
  port: number
  shutdown(): Promise<void>
}

export async function startTrainerServer(): Promise<StartedTrainerServer> {
  const config = await loadConfig()
  await ensureDatabaseDirectory(config.databasePath)
  const database = openDatabase(config.databasePath)
  migrateDatabase(database)

  const app = Fastify({ logger: true })
  const drainController = createDrainController({
    getActiveTraining: () => getActiveTraining(database),
  })
  // UPD-01（UPD-VERSION-EXPOSE）：currentVersion 来自包根 package.json（构建时写入），
  // 不改 status/runId/pid 三身份字段（launcher isTrainerHealth 只认这三者）。
  app.get('/api/health', async () => ({ status: 'ok', runId: config.runId ?? null, pid: process.pid, currentVersion: serverVersion() }))
  await app.register(cors, { origin: true })
  await registerApi(app, config, database, {
    drain: drainController.gate,
    // REL-LAUNCH-UX-01：页面"保存并退出"与控制桥共用同一冻结排空实现与真实关闭函数
    lifecycle: { controller: drainController, shutdown: () => shutdown() },
  })
  // UPD-01 在线更新端点（check/apply/status）；活跃训练查询复用业务口径
  await registerUpdateApi(app, config, { getActiveTraining: () => getActiveTraining(database) })
  await registerSetupControlApi(app, {
    controller: drainController,
    config,
    shutdown: () => shutdown(),
  })
  app.addHook('onClose', async () => { drainController.gate.close() })

  const serverDirectory = dirname(fileURLToPath(import.meta.url))
  const webDirectory = config.staticDirectory ?? join(serverDirectory, '..', '..', 'web', 'dist')
  // wildcard 模式：按请求读文件，rebuild 换 hash 后无需重启即可服务新资产
  await app.register(staticFiles, { root: webDirectory })

  let closing: Promise<void> | undefined
  async function shutdown() {
    return closing ??= (async () => {
      await app.close()
      database.close()
      if (config.readyFile) await rm(config.readyFile, { force: true })
      if (process.connected) process.disconnect()
    })()
  }

  const url = await app.listen({ port: config.port, host: config.host })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Server did not bind a TCP port')
  return { app, config, url, port: address.port, shutdown }
}

/** 直接以进程入口运行本文件（而非被 import）时才执行 CLI 行为。 */
function isCliInvocation(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href
  } catch {
    return false
  }
}

if (isCliInvocation()) {
  const started = await startTrainerServer()
  const { config, port, url } = started
  const shutdown = () => started.shutdown()
  if (config.readyFile) {
    const temporary = `${config.readyFile}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ runId: config.runId ?? null, pid: process.pid, baseURL: url, port }), { flag: 'wx' })
    await rename(temporary, config.readyFile)
  }
  console.log(`A-share K-line trainer server listening at ${url}`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void started.shutdown().catch(error => { console.error(error); process.exitCode = 1 }) })
  }
  process.on('message', message => {
    if (message && typeof message === 'object' && 'type' in message && 'runId' in message
      && message.type === 'trainer:shutdown' && message.runId === config.runId) {
      void started.shutdown().catch(error => { console.error(error); process.exitCode = 1 })
    }
  })
  process.once('disconnect', () => { void started.shutdown().catch(error => { console.error(error); process.exitCode = 1 }) })

  if (process.env.OPEN_BROWSER !== '0' && !process.env.VITEST) {
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  }
}
