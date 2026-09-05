import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticFiles from '@fastify/static'
import { registerApi } from './api.js'
import { loadConfig } from './config.js'
import { ensureDatabaseDirectory, migrateDatabase, openDatabase } from './db.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const config = await loadConfig()
await ensureDatabaseDirectory(config.databasePath)
const database = openDatabase(config.databasePath)
migrateDatabase(database)

const app = Fastify({ logger: true })
await app.register(cors, { origin: true })
await registerApi(app, config, database)

const serverDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = join(serverDirectory, '..', '..', 'web', 'dist')
// wildcard 模式：按请求读文件，rebuild 换 hash 后无需重启即可服务新资产
await app.register(staticFiles, { root: webDirectory })

await app.listen({ port: config.port, host: config.host })
const url = `http://${config.host}:${config.port}`
console.log(`A-share K-line trainer server listening at ${url}`)

if (process.env.OPEN_BROWSER !== '0' && !process.env.VITEST) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}
