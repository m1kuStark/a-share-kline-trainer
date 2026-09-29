// 内容指纹与「纯追加 / 追加同时改写」分类（DATA-03 可读取的历史版本保护）。
// 元数据（size/mtime/maxDate）无法区分「纯追加」与「追加同时改写历史」：日线文件只会
// 在尾部追加记录，因此对「新文件前 prev.rows 条记录」计算前缀哈希、与上一版本整文件
// 哈希比较，即可判定历史记录是否被逐字节保留。全部为纯函数，便于独立交叉验证。

import { createHash } from 'node:crypto'

/** TDX .day 单条记录字节数（与 tdx/dayfile.ts 的 RECORD_SIZE 一致） */
export const DAY_RECORD_SIZE = 32

/** 单个日线文件某一版本的内容指纹：rows 条记录的完整 SHA-256 */
export interface ContentFingerprint {
  rows: number
  sha256: string
}

export type ContentChangeClass =
  | 'identical' // 内容逐字节一致（rows 与哈希均相同）
  | 'appended' // 纯追加：新文件前 prev.rows 条记录哈希等于上一版本整文件哈希
  | 'rewritten' // 历史被改写：前缀哈希对不上（含追加同时改写、原地改写）
  | 'shrunk' // 记录数收缩：历史被截断/重写为更短序列
  | 'unverifiable' // 缺少内容证据（任一侧无哈希），不得虚构结论

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * 新文件前 rows 条记录的前缀哈希。
 * 文件不足 rows 条记录（历史被截断）时前缀不存在，返回 null。
 */
export function prefixSha256Hex(bytes: Uint8Array, rows: number): string | null {
  if (!Number.isSafeInteger(rows) || rows < 0) {
    throw new Error(`前缀记录数必须是非负安全整数，收到 ${String(rows)}`)
  }
  const byteLength = rows * DAY_RECORD_SIZE
  if (bytes.byteLength < byteLength) return null
  return sha256Hex(bytes.subarray(0, byteLength))
}

/**
 * 判定当前文件相对上一版本指纹的内容变化类别。
 * 证据不足（任一侧无 sha256）一律 unverifiable，调用方必须退回元数据口径，不得推断。
 */
export function classifyContentChange(
  previous: { rows: number; sha256?: string | null } | null | undefined,
  current: { rows: number; sha256?: string | null; prefixSha256?: string | null },
): ContentChangeClass {
  if (!previous?.sha256 || !current.sha256) return 'unverifiable'
  if (current.rows < previous.rows) return 'shrunk'
  if (current.sha256 === previous.sha256) return 'identical'
  if (current.prefixSha256 != null && current.prefixSha256 === previous.sha256) return 'appended'
  return 'rewritten'
}
