import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { HttpError } from '../train/engine.js'
import type { AppConfig } from '../config.js'

// V1.2.6 训练数据目录设置 API：GET/PUT /api/settings/data-dir。
// 设置面板「训练数据目录」区服务端半片：查看当前生效目录（SQLite 训练库所在，历史训练、
// 排行与成绩单复盘均读该库），保存新的数据目录到启动器配置 trainer.config.json 的
// dataDir 字段（launcher 启动时消费并注入 TRAINER_DB/TRAINER_DATA_DIR）。
// 与 TDX 路径设置（saved-choice.json 存 dataDir 内）不同，本设置必须写在稳定位置——
// 数据目录本身要被改，存进去会在新目录找不到，因此落启动器配置文件。
// 保存不热切换本进程数据库；PUT 返回 restartRequired:true，重启后生效。
// 独立运行（无启动器、未知配置文件路径）返回 409：无处可写，不伪装成功。

export interface DataDirSettingsView {
  /** 当前生效数据目录（本进程数据库所在目录） */
  effectiveDir: string
  /** 数据库文件名（数据目录下用于历史训练/排行/回放复盘的 SQLite 文件） */
  databaseFile: string
  /** 启动器配置中显式保存的 dataDir（null＝未自定义，使用默认安装目录下 data） */
  configuredDir: string | null
  /** 默认数据目录（安装目录下 data；包内每个版本相互独立）；独立运行为 null */
  defaultDir: string | null
  /** 旧版本默认数据目录（用户主目录 ~/.a-share-kline-trainer）；仅供迁移提示 */
  legacyDefaultDir: string | null
}

export interface DataDirSaveView {
  savedDir: string
  /** 保存不改变当前进程；重启（启动器）后才应用新目录 */
  effectiveDir: string
  restartRequired: true
}

/** 严格校验：必须恰好是 { dataDir: 绝对路径非空字符串 }。 */
export function parseDataDirPut(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '请求体必须是对象')
  }
  const keys = Object.keys(body as Record<string, unknown>)
  if (keys.length !== 1 || keys[0] !== 'dataDir') {
    throw new HttpError(400, '必须恰好提供 dataDir 字符串字段（训练数据目录的绝对路径）')
  }
  const dataDir = (body as Record<string, unknown>).dataDir
  if (typeof dataDir !== 'string' || dataDir.trim() === '') {
    throw new HttpError(400, 'dataDir 必须是非空字符串（训练数据目录的绝对路径）')
  }
  if (!isAbsolute(dataDir)) {
    throw new HttpError(400, 'dataDir 必须是绝对路径')
  }
  return resolve(dataDir.trim())
}

/** 读启动器配置 JSON；文件不存在或损坏时返回 null（保存路径按"新建"处理，不阻塞设置）。 */
async function readLauncherConfig(configPath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** 原子写回：同目录随机临时文件 + rename（写失败保留旧文件，绝不留半截 JSON）。 */
async function writeLauncherConfig(configPath: string, config: Record<string, unknown>): Promise<void> {
  const staging = join(dirname(configPath), `${randomUUID()}.tmp`)
  await writeFile(staging, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await rename(staging, configPath)
}

export function registerDataDirSettingsRoutes(app: FastifyInstance, config: AppConfig): void {
  app.get('/api/settings/data-dir', async (): Promise<DataDirSettingsView> => {
    // launcherConfigPath 即启动器配置文件所在；默认数据目录＝安装目录（包根）下 data
    const packageRoot = config.launcherConfigPath ? dirname(config.launcherConfigPath) : null
    let configuredDir: string | null = null
    if (config.launcherConfigPath) {
      const launcherConfig = await readLauncherConfig(config.launcherConfigPath)
      const value = launcherConfig?.dataDir
      configuredDir = typeof value === 'string' && value.trim() !== '' ? value : null
    }
    return {
      effectiveDir: dirname(config.databasePath),
      databaseFile: config.databasePath.split(/[\\/]/).pop() ?? 'trainer.sqlite',
      configuredDir,
      defaultDir: packageRoot ? join(packageRoot, 'data') : null,
      legacyDefaultDir: join(homedir(), '.a-share-kline-trainer'),
    }
  })

  app.put('/api/settings/data-dir', async request => {
    const dataDir = parseDataDirPut(request.body)
    if (!config.launcherConfigPath) {
      throw new HttpError(409, '当前为独立运行（无启动器配置文件），不支持修改训练数据目录；请从安装包启动器运行')
    }
    // 新目录先建好：避免重启后 SQLite 因目录不存在启动失败
    try {
      await mkdir(dataDir, { recursive: true })
    } catch (error) {
      throw new HttpError(400, `无法创建目录：${error instanceof Error ? error.message : '未知错误'}；请检查路径与权限`)
    }
    // 合并写回：保留 tdxRoot/port 等既有字段；清除 databasePath 显式覆盖（否则它优先于
    // dataDir 派生，设置目录不生效）。设置本身原子落盘。
    const launcherConfig = (await readLauncherConfig(config.launcherConfigPath)) ?? {}
    const next: Record<string, unknown> = { ...launcherConfig, dataDir }
    delete next.databasePath
    try {
      await writeLauncherConfig(config.launcherConfigPath, next)
    } catch (error) {
      throw new HttpError(500, `保存失败（原配置未更改）：${error instanceof Error ? error.message : '未知错误'}`)
    }
    return { savedDir: dataDir, effectiveDir: dirname(config.databasePath), restartRequired: true } satisfies DataDirSaveView
  })
}
