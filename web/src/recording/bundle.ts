// REC-BULK-01：录像库批量导出/导入的合并包格式与导入编排。
// 契约：docs/engineering 不新增，落在 web/src/recording/recording-file.md「录像合并包」节；
// 只用浏览器标准 API（Blob/TextDecoder/DecompressionStream 复用 readRecordingFile），无新依赖。
// 导出包为明文 JSON（迁移工具核心场景是单文件拷贝移动，压缩交给文件系统/用户）；
// 导入逐条容错（损坏跳过计数），重复（trainingKey/originalSessionId 相同）跳过不覆盖。
import type { CompactRecordingFile } from './compactTypes'
import { validateCompactRecording } from './compactValidation'
import { readRecordingFile } from './recordingFile'
import type { RecordingLibraryItem } from './libraryTypes'
import { fail, isRecord } from './validation'

export const RECORDING_BUNDLE_FORMAT = 'trainer-recordings-bundle'
export const RECORDING_BUNDLE_VERSION = 1

/** 录像合并包：items 为现有单条导出 JSON 的载荷（v2/v3 紧凑录制文件） */
export interface RecordingBundle {
  format: typeof RECORDING_BUNDLE_FORMAT
  version: typeof RECORDING_BUNDLE_VERSION
  exportedAt: string
  items: CompactRecordingFile[]
}

/** 单条导入结果（成功）；重复与损坏见 skipped/failed */
export interface BulkImportOutcome {
  imported: RecordingLibraryItem[]
  skipped: Array<{ label: string; reason: string }>
  failed: Array<{ label: string; reason: string }>
}

/** 导入依赖面（生产＝RecordingLibraryRepository；测试注入内存实现） */
export interface BulkImportDeps {
  list(): Promise<RecordingLibraryItem[]>
  import(file: CompactRecordingFile, fileName: string): Promise<RecordingLibraryItem>
}

function duplicateKey(item: Pick<RecordingLibraryItem, 'sessionId' | 'originalSessionId' | 'trainingKey'>): string[] {
  // trainingKey 缺失（null）不参与去重：旧录像/无训练关联无法判定身份，按新条目导入
  const keys: string[] = []
  if (typeof item.trainingKey === 'string' && item.trainingKey) keys.push(`key:${item.trainingKey}`)
  if (item.originalSessionId) keys.push(`orig:${item.originalSessionId}`)
  else keys.push(`orig:${item.sessionId}`)
  return keys
}

/** 组装合并包：先逐条 validateCompactRecording（导出自洽，不产出读不回的包），再放行 */
export function buildRecordingBundle(files: CompactRecordingFile[], now: Date = new Date()): RecordingBundle {
  if (!files.length) fail('录像合并包', '库中没有录像，无法导出合并包')
  return {
    format: RECORDING_BUNDLE_FORMAT,
    version: RECORDING_BUNDLE_VERSION,
    exportedAt: now.toISOString(),
    items: files.map(file => validateCompactRecording(file)),
  }
}

/** 序列化合并包为明文 JSON Blob（application/json） */
export async function exportRecordingBundleFile(files: CompactRecordingFile[], now: Date = new Date()): Promise<Blob> {
  const bundle = buildRecordingBundle(files, now)
  return new Blob([JSON.stringify(bundle)], { type: 'application/json' })
}

/** 解析合并包载荷：结构校验（format/version/exportedAt/items），条目业务校验留给逐条导入容错 */
export function parseRecordingBundle(value: unknown): CompactRecordingFile[] {
  if (!isRecord(value) || value.format !== RECORDING_BUNDLE_FORMAT) {
    fail('录像合并包', '该文件不是录像合并包（缺少 format: trainer-recordings-bundle），请选择合并包或单条录像文件')
  }
  if (value.version !== RECORDING_BUNDLE_VERSION) {
    fail('合并包版本', `不支持的录像合并包版本（收到 ${JSON.stringify(value.version)}），仅支持 ${RECORDING_BUNDLE_VERSION}`)
  }
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) {
    fail('exportedAt', '录像合并包缺少合法的导出时间（exportedAt）')
  }
  if (!Array.isArray(value.items)) {
    fail('items', '录像合并包的 items 必须是数组')
  }
  return value.items
}

/** 读一个候选文件为待导入条目集合：合并包展开多条，其余按单条录像文件（gzip/明文/v1 兼容）处理 */
async function readCandidates(file: File): Promise<Array<{ label: string; value: unknown }>> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const isGzip = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b
  if (!isGzip) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(await file.arrayBuffer()))
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      fail(file.name, `不是合法 JSON（${error instanceof Error ? error.message : String(error)}）`)
    }
    if (isRecord(parsed) && parsed.format === RECORDING_BUNDLE_FORMAT) {
      return parseRecordingBundle(parsed).map((item, index) => ({ label: `${file.name} 第 ${index + 1} 条`, value: item }))
    }
  }
  // 单条路径复用 readRecordingFile：gzip、明文 v2/v3、v1 迁移与全部预算口径保持一致
  return [{ label: file.name, value: await readRecordingFile(file) }]
}

/** 轻量识别：该文件是否为合并包（gzip 一律视为单条录像文件；解析失败也按非合并包交回单条路径报错） */
export async function isRecordingBundleFile(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (head.length === 2 && head[0] === 0x1f && head[1] === 0x8b) return false
  try {
    const text = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()))
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) && parsed.format === RECORDING_BUNDLE_FORMAT
  } catch {
    return false
  }
}

/** 批量导入编排：逐条校验/去重/落库；损坏与重复计数报告，绝不整批失败、绝不覆盖既有录像 */
export async function bulkImportRecordingFiles(files: File[], deps: BulkImportDeps): Promise<BulkImportOutcome> {
  const outcome: BulkImportOutcome = { imported: [], skipped: [], failed: [] }
  const known = new Set<string>()
  for (const item of await deps.list()) for (const key of duplicateKey(item)) known.add(key)
  for (const file of files) {
    let candidates: Array<{ label: string; value: unknown }>
    try {
      candidates = await readCandidates(file)
    } catch (error) {
      outcome.failed.push({ label: file.name, reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    for (const candidate of candidates) {
      try {
        const recording = validateCompactRecording(candidate.value)
        const keys = duplicateKey({ sessionId: recording.sessionId, trainingKey: recording.trainingKey })
        if (keys.some(key => known.has(key))) {
          outcome.skipped.push({ label: candidate.label, reason: 'trainingKey 重复' })
          continue
        }
        const item = await deps.import(recording, file.name)
        for (const key of duplicateKey(item)) known.add(key)
        outcome.imported.push(item)
      } catch (error) {
        outcome.failed.push({ label: candidate.label, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return outcome
}
