import Fastify from 'fastify'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from '../src/db.js'
import { registerDataDirSettingsRoutes, parseDataDirPut } from '../src/settings/data-dir.js'
import type { AppConfig } from '../src/config.js'

// V1.2.6：训练数据目录设置 API（GET/PUT /api/settings/data-dir）。
// 独立 Fastify 实例直注册被测模块；全部使用临时目录，不触碰用户主目录与真实安装目录。

const roots: string[] = []

async function createApp(options?: { launcherConfigPath?: string | null; presetConfig?: string }) {
  const root = await mkdtemp(join(tmpdir(), 'settings-data-dir-'))
  roots.push(root)
  await mkdir(join(root, 'current-data'), { recursive: true })
  const databasePath = join(root, 'current-data', 'trainer.sqlite')
  const database = new DatabaseSync(databasePath)
  migrateDatabase(database)
  const app = Fastify()
  const launcherConfigPath = options?.launcherConfigPath === undefined
    ? join(root, 'trainer.config.json')
    : options.launcherConfigPath
  if (launcherConfigPath && options?.presetConfig !== undefined) {
    await writeFile(launcherConfigPath, options.presetConfig, 'utf8')
  }
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    databasePath,
    tdxRoot: null,
    launcherConfigPath,
  }
  registerDataDirSettingsRoutes(app, config)
  return { app, root, launcherConfigPath, database }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('parseDataDirPut 严格校验', () => {
  it('只接受恰好 { dataDir: 绝对路径 }（同步 throw HttpError）', () => {
    expect(parseDataDirPut({ dataDir: join(tmpdir(), 'train-data') })).toBe(join(tmpdir(), 'train-data'))
    expect(() => parseDataDirPut({ dataDir: 'relative/path' })).toThrow('绝对路径')
    expect(() => parseDataDirPut({ dataDir: '  ' })).toThrow()
    expect(() => parseDataDirPut({ dataDir: 'x', extra: 1 })).toThrow()
    expect(() => parseDataDirPut('nope')).toThrow()
  })
})

describe('GET /api/settings/data-dir', () => {
  it('返回生效目录、数据库文件名、默认目录（包根 data）与旧版主目录提示', async () => {
    const { app, database, launcherConfigPath } = await createApp()
    const response = await app.inject({ method: 'GET', url: '/api/settings/data-dir' })
    expect(response.statusCode).toBe(200)
    const view = response.json()
    expect(view.effectiveDir).toContain('current-data')
    expect(view.databaseFile).toBe('trainer.sqlite')
    expect(view.configuredDir).toBeNull()
    expect(view.defaultDir).toBe(join(dirname(launcherConfigPath), 'data'))
    expect(view.legacyDefaultDir).toBe(join(homedir(), '.a-share-kline-trainer'))
    await app.close()
    database.close()
  })

  it('启动器配置含 dataDir 时返回自定义值', async () => {
    const { app, database } = await createApp({ presetConfig: JSON.stringify({ dataDir: 'D:/my-train-data', port: 9000 }) })
    const response = await app.inject({ method: 'GET', url: '/api/settings/data-dir' })
    expect(response.statusCode).toBe(200)
    expect(response.json().configuredDir).toBe('D:/my-train-data')
    await app.close()
    database.close()
  })

  it('独立运行（无启动器配置路径）不提供默认/自定义目录', async () => {
    const { app, database } = await createApp({ launcherConfigPath: null })
    const response = await app.inject({ method: 'GET', url: '/api/settings/data-dir' })
    expect(response.statusCode).toBe(200)
    const view = response.json()
    expect(view.configuredDir).toBeNull()
    expect(view.defaultDir).toBeNull()
    expect(view.effectiveDir).toContain('current-data')
    await app.close()
    database.close()
  })
})

describe('PUT /api/settings/data-dir', () => {
  it('保存到启动器配置：创建目录、合并保留既有字段、清除 databasePath 覆盖', async () => {
    const { app, database, root } = await createApp({ presetConfig: JSON.stringify({ tdxRoot: 'D:/new-tdx', port: 8800, databasePath: 'D:/old-absolute/trainer.sqlite' }) })
    const target = join(root, 'my-data')
    const response = await app.inject({ method: 'PUT', url: '/api/settings/data-dir', payload: { dataDir: target } })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toMatchObject({ savedDir: target, restartRequired: true })
    expect(body.effectiveDir).toContain('current-data')

    const saved = JSON.parse(await readFile(join(root, 'trainer.config.json'), 'utf8'))
    expect(saved).toEqual({ tdxRoot: 'D:/new-tdx', port: 8800, dataDir: target })
    // 目标目录已创建（重启后 SQLite 可直接落库）
    expect((await stat(target)).isDirectory()).toBe(true)
    await app.close()
    database.close()
  })

  it('配置文件不存在时新建仅含 dataDir 的配置', async () => {
    const { app, database, root } = await createApp()
    const target = join(root, 'fresh-data')
    const response = await app.inject({ method: 'PUT', url: '/api/settings/data-dir', payload: { dataDir: target } })
    expect(response.statusCode).toBe(200)
    const saved = JSON.parse(await readFile(join(root, 'trainer.config.json'), 'utf8'))
    expect(saved).toEqual({ dataDir: target })
    await app.close()
    database.close()
  })

  it('独立运行返回 409 结构化错误，不落任何盘', async () => {
    const { app, database } = await createApp({ launcherConfigPath: null })
    const response = await app.inject({ method: 'PUT', url: '/api/settings/data-dir', payload: { dataDir: join(tmpdir(), 'somewhere') } })
    // 独立实例无全局 HttpError 处理器（中文正文由 registerApi 层包装），此处断言状态码语义
    expect(response.statusCode).toBe(409)
    await app.close()
    database.close()
  })

  it('相对路径 400 零写', async () => {
    const { app, database, root } = await createApp()
    const response = await app.inject({ method: 'PUT', url: '/api/settings/data-dir', payload: { dataDir: 'relative/dir' } })
    expect(response.statusCode).toBe(400)
    await expect(readFile(join(root, 'trainer.config.json'))).rejects.toThrow()
    await app.close()
    database.close()
  })
})
