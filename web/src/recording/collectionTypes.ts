/** REC-COLLECT-01 录像库收藏域类型与常量（纯类型层，零运行时逻辑）。 */

export type CollectionKind = 'builtin' | 'user'

export interface RecordingCollection {
  id: string
  name: string
  kind: CollectionKind
  createdAt: string
  updatedAt: string
}

export interface CollectionMembership {
  collectionId: string
  recordingKey: string
  addedAt: string
}

export type RecordingSourceKey = 'local' | 'imported'

/** 录像库条目的最小引用（本地录像与导入录像统一按此级联清理）。 */
export interface LibraryItemRef {
  sessionId: string
  source: RecordingSourceKey
  originalSessionId?: string
}

/** 内置「收藏」目录：星标按钮的唯一目标，不可删除、不可重命名。 */
export const FAVORITES_COLLECTION_ID = 'favorites'
export const FAVORITES_COLLECTION_NAME = '收藏'

/** 成员键＝`source:sessionId`（同 sessionId 的本地录像与导入录像是两条不同条目）。 */
export function recordingKeyOf(source: RecordingSourceKey, sessionId: string): string {
  return `${source}:${sessionId}`
}

export interface CollectionsManifest {
  type: 'recording-collections-manifest'
  version: 1
  collections: Array<{ name: string; kind: CollectionKind }>
  members: Array<{ collectionName: string; recordingKey: string }>
}

export interface ImportManifestSummary {
  createdCollections: number
  mergedCollections: number
  resolvedMembers: number
  skippedMembers: number
}
