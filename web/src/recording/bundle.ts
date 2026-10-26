// REC-BULK-01：录像库批量导出/导入的合并包格式与导入编排。
// 契约：docs/engineering 不新增，落在 web/src/recording/recording-file.md「录像合并包」节；
// 只用浏览器标准 API（Blob/TextDecoder/DecompressionStream 复用 readRecordingFile），无新依赖。
// 导出包为明文 JSON（迁移工具核心场景是单文件拷贝移动，压缩交给文件系统/用户）；
// 导入逐条容错（损坏跳过计数），重复（trainingKey/originalSessionId 相同）跳过不覆盖。
import type { CompactRecordingFile } from './compactTypes'
import { validateCompactRecording } from './compactValidation'
import { readRecordingFile } from './recordingFile'
import type { RecordingLibraryItem } from './libraryTypes'
import type { CollectionsManifest } from './collectionTypes'
import { fail, isRecord } from './validation'

export const RECORDING_BUNDLE_FORMAT = 'trainer-recordings-bundle'
export const RECORDING_BUNDLE_VERSION = 1

/** 录像合并包：items 为现有单条导出 JSON 的载荷（v2/v3 紧凑录制文件） */
export interface RecordingBundle {
  format: typeof RECORDING_BUNDLE_FORMAT
  version: typeof RECORDING_BUNDLE_VERSION
  exportedAt: string
  items: CompactRecordingFile[]
  /** REC-COLLECT-01 可选收藏目录清单：仅在携带时写入；版本保持 1（旧解析器只认必需字段，未知字段自然忽略） */
  collections?: CollectionsManifest
}

/** 单条导入结果（成功）；重复与损坏见 skipped/failed */
export interface BulkImportOutcome {
  imported: RecordingLibraryItem[]
  skipped: Array<{ label: string; reason: string }>
  failed: Array<{ label: string; reason: string }>
  /** 本批合并包携带的收藏清单（按文件顺序）；UI 在导入完成后交给 importCollectionsManifest 合并 */
  collections?: CollectionsManifest[]
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

/** 组装合并包：先逐条 validateCompactRecording（导出自洽，不产出读不回的包），再放行；
 * 可选携带收藏目录清单（REC-COLLECT-01），未提供时字段缺省保持 v1 形态。 */
export function buildRecordingBundle(
  files: CompactRecordingFile[],
  now: Date = new Date(),
  collectionsManifest?: CollectionsManifest,
): RecordingBundle {
  if (!files.length) fail('录像合并包', '库中没有录像，无法导出合并包')
  const bundle: RecordingBundle = {
    format: RECORDING_BUNDLE_FORMAT,
    version: RECORDING_BUNDLE_VERSION,
    exportedAt: now.toISOString(),
    items: files.map(file => validateCompactRecording(file)),
  }
  if (collectionsManifest) bundle.collections = collectionsManifest
  return bundle
}

/** 序列化合并包为明文 JSON Blob（application/json） */
export async function exportRecordingBundleFile(
  files: CompactRecordingFile[],
  now: Date = new Date(),
  collectionsManifest?: CollectionsManifest,
): Promise<Blob> {
  const bundle = buildRecordingBundle(files, now, collectionsManifest)
  return new Blob([JSON.stringify(bundle)], { type: 'application/json' })
}

/** collections 字段结构校验：存在即必须合法（缺省合法＝未携带）；目录/成员条目形态逐条把关 */
function validateBundleCollections(value: unknown): CollectionsManifest {
  if (!isRecord(value)
    || value.type !== 'recording-collections-manifest'
    || value.version !== 1
    || !Array.isArray(value.collections)
    || !Array.isArray(value.members)) {
    fail('collections', '录像合并包的 collections 收藏清单结构不合法（应为 recording-collections-manifest v1）')
  }
  for (const entry of value.collections) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || (entry.kind !== 'builtin' && entry.kind !== 'user')) {
      fail('collections', '录像合并包的收藏清单目录条目不合法（需要 name 与 kind=builtin|user）')
    }
  }
  for (const member of value.members) {
    if (!isRecord(member) || typeof member.collectionName !== 'string' || typeof member.recordingKey !== 'string') {
      fail('collections', '录像合并包的收藏清单成员条目不合法（需要 collectionName 与 recordingKey）')
    }
  }
  return value as unknown as CollectionsManifest
}

/** 合并包信封：items 之外透出可选收藏清单（导入编排交 UI 合并） */
export interface RecordingBundleEnvelope {
  items: CompactRecordingFile[]
  collections?: CollectionsManifest
}

/** 解析合并包载荷：结构校验（format/version/exportedAt/items，collections 存在即校验），条目业务校验留给逐条导入容错 */
export function parseRecordingBundleEnvelope(value: unknown): RecordingBundleEnvelope {
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
  const envelope: RecordingBundleEnvelope = { items: value.items }
  if (value.collections !== undefined) envelope.collections = validateBundleCollections(value.collections)
  return envelope
}

/** 解析合并包载荷（仅必需字段口径＝v1 解析器行为；collections 由信封变体透出） */
export function parseRecordingBundle(value: unknown): CompactRecordingFile[] {
  return parseRecordingBundleEnvelope(value).items
}

/** 读一个候选文件为待导入条目集合：合并包展开多条（并透出其收藏清单），其余按单条录像文件（gzip/明文/v1 兼容）处理 */
async function readCandidates(file: File): Promise<{ candidates: Array<{ label: string; value: unknown }>; manifest?: CollectionsManifest }> {
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
      const envelope = parseRecordingBundleEnvelope(parsed)
      return {
        candidates: envelope.items.map((item, index) => ({ label: `${file.name} 第 ${index + 1} 条`, value: item })),
        manifest: envelope.collections,
      }
    }
  }
  // 单条路径复用 readRecordingFile：gzip、明文 v2/v3、v1 迁移与全部预算口径保持一致
  return { candidates: [{ label: file.name, value: await readRecordingFile(file) }] }
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

/** 批量导入编排：逐条校验/去重/落库；损坏与重复计数报告，绝不整批失败、绝不覆盖既有录像；
 * 合并包携带收藏清单时按文件顺序透出（outcome.collections），由调用方在导入完成后合并。 */
export async function bulkImportRecordingFiles(files: File[], deps: BulkImportDeps): Promise<BulkImportOutcome> {
  const outcome: BulkImportOutcome = { imported: [], skipped: [], failed: [] }
  const known = new Set<string>()
  const manifests: CollectionsManifest[] = []
  for (const item of await deps.list()) for (const key of duplicateKey(item)) known.add(key)
  for (const file of files) {
    let candidates: Array<{ label: string; value: unknown }>
    try {
      const read = await readCandidates(file)
      candidates = read.candidates
      if (read.manifest) manifests.push(read.manifest)
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
  if (manifests.length) outcome.collections = manifests
  return outcome
}
