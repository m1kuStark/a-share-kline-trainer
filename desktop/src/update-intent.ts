// UPD-NSIS-INTENT-RETRY（冷审 P1-2 修复，用户 2026-10-19 批复 2「无感自动诊断与处理」）：
// NSIS 静默安装中断（冷审 A6/A7 窗口——live 主链唯一直接损坏应用本体的点，repo 无观测无恢复）
// 的自愈决策层。不 import electron（vitest 直测）；口径来源＝任务卡 UPD-NSIS-RETRY-01＋矩阵行：
//   - quitAndInstall 发起前（排空收敛后的安装分支）在 <dataDir>/update-intent.json 落「更新
//     意图标记」（fromVersion/toVersion/startedAt/attempts；同步原子写——退出路径不等异步 fs）；
//   - 启动三分支：无标记→照旧；版本==target→清标记收尾（清失败仅日志不阻断）；版本≠target
//     且未超界→先持久化计数+1 再静默重走 check→download→verify→install 既有编排（复用既有
//     controller/守卫，主进程侧单发）；计数达上界（默认 3，proposed_default）→人话指引经
//     更新状态既有事件面呈现后清标记收尾；
//   - 损坏容忍＝视为无标记（参照 data-home 损坏容忍先例：desktop 自有原子写文件，写坏≠
//     用户配置错误，不得 brick 启动）；
//   - 不改 GAP1 冻结的诊断字段集（DESKTOP-DIAG-CLIPBOARD EARS）——信息呈现走更新事件面。
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compareVersions } from '../../server/dist/update/version.js'

export const UPDATE_INTENT_FILE = 'update-intent.json'

/** 有界重试上界（proposed_default 待追认）：安装中断后自愈重走链至多 3 次，防无限循环 */
export const UPDATE_INTENT_MAX_RETRIES = 3

export interface UpdateIntentRecord {
  version: 1
  /** 发起安装时的现行版本 */
  fromVersion: string
  /** 本次意图的目标版本（downloaded 事件捕获） */
  toVersion: string
  startedAt: string
  /** 已消耗的自愈重试次数（quitAndInstall 续装同目标时保留，新目标归零） */
  attempts: number
}

/** 严格解析：形状不合（version!=1 / 字段缺失或类型错 / attempts 非非负整数）一律 null（损坏容忍） */
export function parseUpdateIntentRecord(raw: unknown): UpdateIntentRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.version !== 1) return null
  if (typeof value.fromVersion !== 'string' || value.fromVersion.trim() === '') return null
  if (typeof value.toVersion !== 'string' || value.toVersion.trim() === '') return null
  if (typeof value.startedAt !== 'string' || value.startedAt === '') return null
  if (!Number.isInteger(value.attempts) || (value.attempts as number) < 0) return null
  return {
    version: 1,
    fromVersion: value.fromVersion,
    toVersion: value.toVersion,
    startedAt: value.startedAt,
    attempts: value.attempts as number,
  }
}

export function serializeUpdateIntentRecord(record: UpdateIntentRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

/**
 * 安装分支的标记构造：previous 同目标→attempts 延续（自愈重装再进安装分支，计数是防无限
 * 循环的根基）；previous 缺失或目标不同→新意图计数归零。
 */
export function buildInstallIntentMarker(input: {
  fromVersion: string
  toVersion: string
  startedAt: string
  previous: UpdateIntentRecord | null
}): UpdateIntentRecord {
  const carryAttempts = input.previous !== null && input.previous.toVersion === input.toVersion
    ? input.previous.attempts
    : 0
  return { version: 1, fromVersion: input.fromVersion, toVersion: input.toVersion, startedAt: input.startedAt, attempts: carryAttempts }
}

/** 重试分支的计数递增：只改 attempts，from/to/startedAt 原样（同一意图的延续） */
export function retryIntentMarker(marker: UpdateIntentRecord, nextAttempts: number): UpdateIntentRecord {
  return { ...marker, attempts: nextAttempts }
}

export type UpdateIntentAction =
  | { kind: 'none' }
  | { kind: 'complete'; marker: UpdateIntentRecord }
  | { kind: 'retry'; marker: UpdateIntentRecord; nextAttempts: number }
  | { kind: 'give-up'; marker: UpdateIntentRecord }

/** 版本相等性：server version.ts compareVersions（v 前缀容忍，与 mapCheckView 同一口径） */
function versionsEqual(a: string, b: string): boolean {
  try {
    return compareVersions(a, b) === 0
  } catch {
    // 不可比较（损坏但结构合法的 toVersion）→ 按未完成处理：交给重走链与有界预算兜底
    return false
  }
}

/**
 * 启动三分支裁决：无标记/无法确定当前版本→none；版本==target→complete（成功收尾优先于
 * 预算）；计数达上界→give-up；其余→retry（nextAttempts=attempts+1）。
 */
export function resolveUpdateIntentAction(input: {
  marker: UpdateIntentRecord | null
  currentVersion: string | null
  maxRetries?: number
}): UpdateIntentAction {
  const { marker, currentVersion } = input
  if (marker === null || currentVersion === null) return { kind: 'none' }
  if (versionsEqual(currentVersion, marker.toVersion)) return { kind: 'complete', marker }
  const maxRetries = input.maxRetries ?? UPDATE_INTENT_MAX_RETRIES
  if (marker.attempts >= maxRetries) return { kind: 'give-up', marker }
  return { kind: 'retry', marker, nextAttempts: marker.attempts + 1 }
}

/** 超界人话指引（proposed_default 文案）：告知已重试次数＋手动出路，经更新事件面呈现 */
export function updateIntentGiveUpMessage(attempts: number): string {
  return `自动更新已重试 ${attempts} 次仍未完成安装。请到 设置 → 关于与更新 手动重试，或到 GitHub Releases 下载完整安装包覆盖安装`
}

/** 重走链检查后无新版（目标已被更新源撤下）的人话说明（proposed_default 文案） */
export function updateIntentNoUpdateMessage(): string {
  return '检测到上次更新未完成，但更新源当前没有提供可用的新版本；已停止本次自动重试'
}

export interface UpdateIntentBootDeps {
  /** 损坏容忍读取（真实实现＝readUpdateIntentMarker；缺失/损坏/读失败均 null） */
  readMarker: () => Promise<UpdateIntentRecord | null>
  /** 重试计数持久化（真实实现＝persistUpdateIntentMarker 原子写） */
  persistMarker: (marker: UpdateIntentRecord) => Promise<void>
  clearMarker: () => Promise<void>
  getCurrentVersion: () => string | null
  /** 静默重走更新链（主进程侧绑既有 controller 编排；单发守卫在主进程侧） */
  runUpdateChain: () => Promise<void>
  /** 人话呈现出口（主进程侧绑 sendUpdateEvent 的 error 事件面——不改诊断字段集） */
  sendEvent: (message: string) => void
  logger: { error(...args: unknown[]): void, warn(...args: unknown[]): void, info(...args: unknown[]): void }
}

/**
 * 启动校验编排（UPD-NSIS-INTENT-RETRY 主语义）：按三分支裁决执行；任何一步失败只记日志，
 * 绝不阻断启动、绝不逃逸异常。重试计数先持久化再触发链（不计数不重试——persist 失败即
 * 放弃本轮自愈，防无限循环旁路）。
 */
export async function runUpdateIntentBootValidation(deps: UpdateIntentBootDeps): Promise<void> {
  let marker: UpdateIntentRecord | null
  try {
    marker = await deps.readMarker()
  } catch (error) {
    // 真实 readMarker 已是容忍实现（返回 null），这里再兜一层：读层抛错＝按无标记处理
    deps.logger.warn('[desktop] update intent marker read failed; treating as absent:', error instanceof Error ? error.message : String(error))
    return
  }
  const action = resolveUpdateIntentAction({ marker, currentVersion: deps.getCurrentVersion() })
  if (action.kind === 'none') return
  if (action.kind === 'complete') {
    // 成功收尾：清标记；清失败仅日志不阻断（下次启动幂等重清）
    try {
      await deps.clearMarker()
      deps.logger.info(`[desktop] update intent completed (now ${action.marker.toVersion}); marker cleared`)
    } catch (error) {
      deps.logger.error('[desktop] update intent marker clear failed (non-blocking):', error instanceof Error ? error.message : String(error))
    }
    return
  }
  if (action.kind === 'give-up') {
    // 超界：人话指引经既有事件面呈现后清标记收尾（自愈生命周期关闭，避免逐启动重复呈现）
    deps.sendEvent(updateIntentGiveUpMessage(action.marker.attempts))
    try {
      await deps.clearMarker()
    } catch (error) {
      deps.logger.error('[desktop] update intent marker clear failed (non-blocking):', error instanceof Error ? error.message : String(error))
    }
    return
  }
  // retry：先持久化计数+1（防中断后重复计数丢失），persist 失败→放弃本轮（不计数不重试）
  const next = retryIntentMarker(action.marker, action.nextAttempts)
  try {
    await deps.persistMarker(next)
  } catch (error) {
    deps.logger.error('[desktop] update intent retry-count persist failed; skipping silent retry this launch:', error instanceof Error ? error.message : String(error))
    return
  }
  deps.logger.info(`[desktop] interrupted update detected (target ${action.marker.toVersion}, attempt ${action.nextAttempts}); silently re-running update chain`)
  try {
    await deps.runUpdateChain()
  } catch (error) {
    // 链内失败已由链自身经事件面呈现；此处仅保证校验绝不逃逸
    deps.logger.error('[desktop] silent update retry chain failed (will retry on next launch until bounded):', error instanceof Error ? error.message : String(error))
  }
}

// ===== 真实 fs 适配（main.ts 粘合用；决策函数不依赖此处，单测全部注入桩＋真实边界用例） =====

function intentFilePath(dataDir: string): string {
  return join(dataDir, UPDATE_INTENT_FILE)
}

/** 原子写（临时文件＋rename，与 desktop-data-choice.json 同法） */
export async function persistUpdateIntentMarker(dataDir: string, record: UpdateIntentRecord): Promise<void> {
  const path = intentFilePath(dataDir)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, serializeUpdateIntentRecord(record), 'utf8')
  await rename(temporary, path)
}

/** 损坏容忍读取：缺失/非 JSON/形状非法均 null（视为无标记重发现） */
export async function readUpdateIntentMarker(dataDir: string): Promise<UpdateIntentRecord | null> {
  try {
    return parseUpdateIntentRecord(JSON.parse(await readFile(intentFilePath(dataDir), 'utf8')))
  } catch {
    return null
  }
}

/** 清标记（幂等；不存在也不抛） */
export async function clearUpdateIntentMarker(dataDir: string): Promise<void> {
  await rm(intentFilePath(dataDir), { force: true })
}

/**
 * 退出路径专用同步原子写（quitAndInstall 发起前）：quitAndInstall 之后进程随即退出，
 * 异步写不保证落盘——必须同步完成（writeFileSync＋renameSync，失败清理临时文件）。
 */
export function persistUpdateIntentMarkerSync(dataDir: string, record: UpdateIntentRecord): void {
  const path = intentFilePath(dataDir)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, serializeUpdateIntentRecord(record), 'utf8')
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/** 同步容忍读取（安装分支保留计数用）：缺失/损坏均 null */
export function readUpdateIntentMarkerSync(dataDir: string): UpdateIntentRecord | null {
  try {
    return parseUpdateIntentRecord(JSON.parse(readFileSync(intentFilePath(dataDir), 'utf8')))
  } catch {
    return null
  }
}
