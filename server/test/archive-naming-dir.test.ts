// DATA-ARCH-01 录像归档目录只读暴露（GET /api/settings/recordings-dir）。
// oracle：简报实现语义第 5 条——server 经只读信息端点暴露 recordings 目录路径
// （<dataDir>/recordings，dataDir＝SQLite 训练库所在目录），写入走桌面 IPC 不经 HTTP。
// 夹具全部使用临时目录；registerApi 注册期不触发行情读取，空 tdx 根即可。
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from '../src/db.js'
import { registerApi } from '../src/api.js'
import type { AppConfig } from '../src/config.js'

describe('GET /api/settings/recordings-dir', () => {
  it('返回数据目录下的 recordings 子目录（只读信息；目录本身不因查询被创建）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-dir-'))
    const dataDir = join(root, 'data')
    const tdxRoot = join(root, 'tdx')
    await mkdir(dataDir, { recursive: true })
    await mkdir(tdxRoot, { recursive: true })
    const database = new DatabaseSync(join(dataDir, 'trainer.sqlite'))
    migrateDatabase(database)
    const app = Fastify()
    const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: join(dataDir, 'trainer.sqlite'), tdxRoot }
    await registerApi(app, config, database)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/settings/recordings-dir' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ recordingsDir: join(dataDir, 'recordings') })
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
