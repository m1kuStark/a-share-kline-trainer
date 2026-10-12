// REC-HIST-LINK 历史训练记录 ↔ 本机训练录像 的关联纯函数。
// 关联键沿用录像侧 trainingKey（useRecording 的 trainingKeyOf 生成
// `<训练id>.<训练createdAt>`，createdAt 为 ISO 串）——训练 id 为库主键，取键首个
// '.' 前的数字段即可唯一定位训练，与 RecordingLibrary.loadBriefs 的派生口径一致
// （RF-05 先例）。历史列表 API 不返回 createdAt（本任务红线：server 只读核实、
// 不改 API 形状），而 id 即主键，故 id 前缀关联不需要扩展 server。
// 无 trainingKey 的旧录像（早于键功能的年代）无法关联——best-effort，不入映射。
import type { RecordingLibraryItem } from './libraryTypes'

/** 一条历史训练在录像库中的关联结果 */
export interface HistoryRecordingLink {
  /** 最新一份录像（同一训练跨页面多次录制会形成多份会话，按录像 createdAt 取最新） */
  latest: RecordingLibraryItem
  /** 该训练在录像库中的会话份数 */
  count: number
}

/** 从 trainingKey 解析训练 id；首段非正整数（空串、非数字、零、负数）返回 null */
export function trainingIdOfKey(trainingKey: string): number | null {
  const id = Number(trainingKey.split('.')[0])
  return Number.isSafeInteger(id) && id >= 1 ? id : null
}

const epochOf = (value: string): number => {
  const time = Date.parse(value)
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}

/**
 * 录像列表一次性归桶：训练 id → { 最新一份, 份数 }。
 * 排序按录像会话 createdAt（epoch）降序；同刻平手按 sessionId 降序取得确定结果
 * （秒级与毫秒级 ISO 串 Date.parse 等价，字符串比较则会误序，故用 epoch）。
 * 本机与导入条目同口径参与（导入条目保留文件内 trainingKey 与原会话 createdAt）。
 */
export function buildHistoryRecordingLinks(recordings: readonly RecordingLibraryItem[]): Map<number, HistoryRecordingLink> {
  const buckets = new Map<number, RecordingLibraryItem[]>()
  for (const item of recordings) {
    const key = item.trainingKey
    if (typeof key !== 'string') continue
    const id = trainingIdOfKey(key)
    if (id === null) continue
    const bucket = buckets.get(id)
    if (bucket) bucket.push(item)
    else buckets.set(id, [item])
  }
  const links = new Map<number, HistoryRecordingLink>()
  for (const [id, bucket] of buckets) {
    const sorted = [...bucket].sort((a, b) =>
      epochOf(b.createdAt) - epochOf(a.createdAt)
      || (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0))
    links.set(id, { latest: sorted[0]!, count: sorted.length })
  }
  return links
}
