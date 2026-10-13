// CN-FEED-01（矩阵行 UPD-FEED-SETTING）：更新源三态设置的共享形状与读写器。
// 落盘位置＝<dataDir>/update-source.json（desktop 与 zip HTTP 链共用同一配置口径：
// desktop 主进程（electron-updater feed 计划）经编译产物 import 本模块读取同一文件——
// 桌面形态下 desktop 主进程与内嵌 server 共用同一 dataDir（buildServerEnv 注入
// TRAINER_DATA_DIR），故设置一处写入两链同时生效）。
// fail-open：文件缺失/损坏/内容非法一律 null＝按内置默认（auto）下落，绝不因设置文件
// 问题阻断检查更新；写入为原子替换（tmp+rename，沿 settings/data-dir.ts 先例）。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const UPDATE_SOURCE_FILE_NAME = 'update-source.json'

export type UpdateSourceMode = 'auto' | 'official' | 'custom'

export interface UpdateSourceSetting {
  source: UpdateSourceMode
  customUrl: string | null
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value)
}

/**
 * 严格解析设置对象：source 必须为三态枚举；custom 时 customUrl 必须为 http(s) URL；
 * auto/official 时 customUrl 必须缺省或 null。任何偏差返回 null（按 auto 下落，不猜）。
 */
export function parseUpdateSourceSetting(raw: unknown): UpdateSourceSetting | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as { source?: unknown, customUrl?: unknown }
  const extra = Object.keys(value).filter(key => key !== 'source' && key !== 'customUrl')
  if (extra.length > 0) return null
  if (value.source !== 'auto' && value.source !== 'official' && value.source !== 'custom') return null
  const customUrl = value.customUrl ?? null
  if (customUrl !== null && typeof customUrl !== 'string') return null
  if (value.source === 'custom') {
    if (typeof customUrl !== 'string' || !isHttpUrl(customUrl.trim())) return null
    return { source: 'custom', customUrl: customUrl.trim() }
  }
  // auto/official：customUrl 必须缺省或 null（携带即非法，不静默丢弃）
  if (customUrl !== null) return null
  return { source: value.source, customUrl: null }
}

/** 读 <dataDir>/update-source.json；dataDir null（无处可读）/缺失/损坏/非法 → null（auto 下落） */
export async function readUpdateSourceSetting(dataDir: string | null): Promise<UpdateSourceSetting | null> {
  if (dataDir === null || dataDir.trim() === '') return null
  let text: string
  try {
    text = await readFile(join(dataDir, UPDATE_SOURCE_FILE_NAME), 'utf8')
  } catch {
    return null
  }
  try {
    return parseUpdateSourceSetting(JSON.parse(text))
  } catch {
    return null
  }
}

/** 原子写入设置（目录不存在则创建）；customUrl 仅在 source=custom 时非 null */
export async function writeUpdateSourceSetting(dataDir: string, setting: UpdateSourceSetting): Promise<void> {
  const target = join(dataDir, UPDATE_SOURCE_FILE_NAME)
  await mkdir(dataDir, { recursive: true })
  const staging = join(dirname(target), `.${UPDATE_SOURCE_FILE_NAME}.${randomUUID()}.tmp`)
  await writeFile(staging, `${JSON.stringify({ source: setting.source, customUrl: setting.customUrl }, null, 2)}\n`, 'utf8')
  await rename(staging, target)
}
