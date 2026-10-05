import { ref } from 'vue'
import type { KeyboardShortcutPreferences } from './keyboardShortcuts'

// M5-01：应用偏好（/api/settings/app）与 TDX 数据目录（/api/settings/tdx-path）的客户端。
// 独立成文件而不并入 web/src/api.ts：本轮该文件与 App.vue 由集成人单写（first-use-batch
// 并行调度约定），集成阶段可把这里的请求并入统一 request 助手后再删本模块的本地副本。
// 应用偏好语义（与服务端 settings/app.ts 同源）：autoDataCheck 缺省 true＝维持既有口径
// （启动/回前台/可见页 60s 自动检查 /api/data/status）；false＝只保留手动路径。
// 偏好 store 供 dataStatus.ts 门闩与设置面板共同读写；ensureAppSettingsLoaded 每会话一次
// 尽力预取，读取失败保持缺省 true（＝现状），设置面板打开时会再读并向用户展示错误。

export interface AppSettingsView {
  version: number
  autoDataCheck: boolean
}

export interface SavedTdxChoiceInfo {
  version: 1
  root: string
  savedAt: string
  inspectedAt: string
}

export interface TdxPathSettingsView {
  effectiveRoot: string | null
  savedChoice: SavedTdxChoiceInfo | null
}

export interface TdxCandidateCheckInfo {
  root: string
  recognized: boolean
  readable: boolean
  dailyFileCount: number
  latestDate: string | null
  hasAdjustment: boolean
  hasNames: boolean
  hasBenchmark: boolean
  problems: string[]
}

export interface TdxPathSaveResult {
  saved: SavedTdxChoiceInfo
  effectiveRoot: string | null
  restartRequired: true
}

export interface KeyboardShortcutsSettingsView {
  version: number
  shortcuts: KeyboardShortcutPreferences
}

class SettingsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'SettingsApiError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => ({})) as T & { error?: string; message?: string }
  if (!response.ok) throw new SettingsApiError(payload.message ?? payload.error ?? `请求失败（${response.status}）`, response.status)
  return payload
}

// ===== 应用偏好：自动检查日线数据 =====

/** 缺省 true＝现状（自动检查开启）；设置面板保存后即时更新，dataStatus 门闩据此放行/跳过 */
export const appAutoDataCheck = ref(true)
/** 预取是否已成功读到过服务端视图（未读到时 UI 侧按缺省呈现并可再次读取） */
export const appSettingsLoaded = ref(false)

let appSettingsPromise: Promise<void> | null = null

/** 每会话一次尽力预取：失败静默保持缺省 true（＝现状），不阻塞调用方 */
export function ensureAppSettingsLoaded(): Promise<void> {
  if (appSettingsPromise === null) {
    appSettingsPromise = fetchAppSettings()
      .then(view => {
        appAutoDataCheck.value = view.autoDataCheck
        appSettingsLoaded.value = true
      })
      .catch(() => { /* 保持缺省；设置面板打开时会再次读取并展示可行动错误 */ })
  }
  return appSettingsPromise
}

export function fetchAppSettings(): Promise<AppSettingsView> {
  return request('/api/settings/app')
}

export async function putAppSettings(autoDataCheck: boolean): Promise<AppSettingsView> {
  const saved = await request<AppSettingsView>('/api/settings/app', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoDataCheck }),
  })
  appAutoDataCheck.value = saved.autoDataCheck
  appSettingsLoaded.value = true
  return saved
}

export function fetchKeyboardShortcuts(): Promise<KeyboardShortcutsSettingsView> {
  return request('/api/settings/shortcuts')
}

export function putKeyboardShortcuts(shortcuts: KeyboardShortcutPreferences): Promise<KeyboardShortcutsSettingsView> {
  return request('/api/settings/shortcuts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shortcuts }),
  })
}

// ===== 应用偏好：KDJ 副图显示（M6-01） =====
// 客户端偏好（localStorage，与 trainer_theme 同层；服务端 /api/settings/app 不感知该字段）：
// 默认开启；该偏好不属于录像布局——旧录像回放按当前开关渲染，无迁移。
// 读写拆成纯函数便于服务端单测提取执行（server/test/kdj-indicator.test.ts）。

const KDJ_SUBCHART_STORAGE_KEY = 'trainer_kdj_subchart'

/** 读取 KDJ 副图偏好：'0'＝关，其余（未设置/异常值）＝默认开 */
export function readKdjSubchartPref(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(KDJ_SUBCHART_STORAGE_KEY) !== '0'
}

/** 写入 KDJ 副图偏好（'1'/'0'） */
export function writeKdjSubchartPref(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  storage.setItem(KDJ_SUBCHART_STORAGE_KEY, enabled ? '1' : '0')
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** KDJ 副图显示开关（应用偏好，默认 true）；KlineChart 据此增删副图窗格 */
export const appKdjSubchart = ref(readKdjSubchartPref(safeStorage() ?? { getItem: () => null }))

/** 切换 KDJ 副图显示：立即生效并持久化（localStorage 不可用时保持会话内生效） */
export function setKdjSubchart(enabled: boolean): void {
  appKdjSubchart.value = enabled
  try {
    const storage = safeStorage()
    if (storage) writeKdjSubchartPref(storage, enabled)
  } catch { /* 持久化失败不阻断会话内切换 */ }
}

// ===== 应用偏好：VOL/MACD 副图显示（M6-04，用户 2026-10-05 验收拍板） =====
// 与 KDJ 同层同机制（localStorage，默认全开＝现状；三键独立互不影响；不属于录像布局——
// 旧录像回放按当前开关渲染，无迁移）。读写拆成纯函数便于服务端单测提取执行
// （server/test/kdj-indicator.test.ts 的 VOL/MACD 用例）。

const VOL_SUBCHART_STORAGE_KEY = 'trainer_vol_subchart'
const MACD_SUBCHART_STORAGE_KEY = 'trainer_macd_subchart'

/** 读取 VOL 副图偏好：'0'＝关，其余（未设置/异常值）＝默认开 */
export function readVolSubchartPref(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(VOL_SUBCHART_STORAGE_KEY) !== '0'
}

/** 写入 VOL 副图偏好（'1'/'0'） */
export function writeVolSubchartPref(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  storage.setItem(VOL_SUBCHART_STORAGE_KEY, enabled ? '1' : '0')
}

/** 读取 MACD 副图偏好：'0'＝关，其余＝默认开 */
export function readMacdSubchartPref(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(MACD_SUBCHART_STORAGE_KEY) !== '0'
}

/** 写入 MACD 副图偏好（'1'/'0'） */
export function writeMacdSubchartPref(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  storage.setItem(MACD_SUBCHART_STORAGE_KEY, enabled ? '1' : '0')
}

/** VOL 副图显示开关（应用偏好，默认 true）；KlineChart 据此增删副图窗格 */
export const appVolSubchart = ref(readVolSubchartPref(safeStorage() ?? { getItem: () => null }))

/** MACD 副图显示开关（应用偏好，默认 true）；KlineChart 据此增删副图窗格 */
export const appMacdSubchart = ref(readMacdSubchartPref(safeStorage() ?? { getItem: () => null }))

/** 切换 VOL 副图显示：立即生效并持久化（localStorage 不可用时保持会话内生效） */
export function setVolSubchart(enabled: boolean): void {
  appVolSubchart.value = enabled
  try {
    const storage = safeStorage()
    if (storage) writeVolSubchartPref(storage, enabled)
  } catch { /* 持久化失败不阻断会话内切换 */ }
}

/** 切换 MACD 副图显示：立即生效并持久化（localStorage 不可用时保持会话内生效） */
export function setMacdSubchart(enabled: boolean): void {
  appMacdSubchart.value = enabled
  try {
    const storage = safeStorage()
    if (storage) writeMacdSubchartPref(storage, enabled)
  } catch { /* 持久化失败不阻断会话内切换 */ }
}

// ===== 应用偏好：账户数字滚动动效（M6-05R，用户 2026-10-05 验收反馈拍板"需要修复"） =====
// 与 KDJ/VOL/MACD 同层同机制（localStorage，默认开＝现状）。a11y 取舍（M6-05R 冻结）：
// OS prefers-reduced-motion 在用户唯一真实环境恒为 true（旧实现一票否决导致滚动全程不可见），
// 动效改为应用开关控制、OS 信号不再一票否决；功能为用户明确要求的核心反馈、幅度小
// （≤600ms、纯视觉层 aria-hidden），逃生阀＝本开关（关闭＝直显终值）。
// 读写拆成纯函数便于服务端契约测试提取执行（server/test/frontend-contract.test.ts 的 M6-05R 用例）。

const ODO_MOTION_STORAGE_KEY = 'trainer_odo_motion'

/** 读取数字滚动动效偏好：'0'＝关，其余（未设置/异常值）＝默认开 */
export function readOdoMotionPref(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(ODO_MOTION_STORAGE_KEY) !== '0'
}

/** 写入数字滚动动效偏好（'1'/'0'） */
export function writeOdoMotionPref(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  storage.setItem(ODO_MOTION_STORAGE_KEY, enabled ? '1' : '0')
}

/** 数字滚动动效开关（应用偏好，默认 true）；Training.vue 的 beginRoll 据此放行/跳过动画 */
export const appOdoMotion = ref(readOdoMotionPref(safeStorage() ?? { getItem: () => null }))

/** 切换数字滚动动效：立即生效并持久化（localStorage 不可用时保持会话内生效） */
export function setOdoMotion(enabled: boolean): void {
  appOdoMotion.value = enabled
  try {
    const storage = safeStorage()
    if (storage) writeOdoMotionPref(storage, enabled)
  } catch { /* 持久化失败不阻断会话内切换 */ }
}

// ===== TDX 数据目录：查看 / 校验 / 保存（保存后重启生效） =====

export function fetchTdxPathSettings(): Promise<TdxPathSettingsView> {
  return request('/api/settings/tdx-path')
}

export function validateTdxPath(root: string): Promise<{ check: TdxCandidateCheckInfo }> {
  return request('/api/settings/tdx-path/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root }),
  })
}

export function putTdxPath(root: string): Promise<TdxPathSaveResult> {
  return request('/api/settings/tdx-path', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root }),
  })
}

// ===== V1.2.6 训练数据目录：查看 / 保存（写回启动器配置，重启生效；独立运行 409） =====

export interface DataDirSettingsView {
  /** 当前生效数据目录（SQLite 训练库所在目录） */
  effectiveDir: string
  /** 数据库文件名（历史训练/排行/回放复盘的数据文件） */
  databaseFile: string
  /** 启动器配置中显式保存的 dataDir（null＝未自定义，使用默认安装目录下 data） */
  configuredDir: string | null
  /** 默认数据目录（安装目录下 data；独立运行为 null） */
  defaultDir: string | null
  /** 旧版本默认数据目录（用户主目录）；仅供迁移提示 */
  legacyDefaultDir: string | null
}

export interface DataDirSaveResult {
  savedDir: string
  effectiveDir: string
  restartRequired: true
}

export function fetchDataDirSettings(): Promise<DataDirSettingsView> {
  return request('/api/settings/data-dir')
}

export function putDataDir(dataDir: string): Promise<DataDirSaveResult> {
  return request('/api/settings/data-dir', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataDir }),
  })
}
