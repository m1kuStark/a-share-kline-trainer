/** REC-COLLECT-01 收藏目录纯逻辑层：命名校验、导出清单构建、导入合并计划。
 * 零 IO、零依赖（仅类型与常量），供 collectionService 组装与 server/test 提取单测。 */
import type {
  CollectionMembership,
  CollectionsManifest,
  LibraryItemRef,
  RecordingCollection,
} from './collectionTypes'
import {
  FAVORITES_COLLECTION_ID,
  FAVORITES_COLLECTION_NAME,
  recordingKeyOf,
} from './collectionTypes'

/** 名称规范化：仅去首尾空白（内部空白保留，目录名是用户原文）。 */
export function normalizeCollectionName(raw: string): string {
  return raw.trim()
}

/** 新建/重命名校验：空白拒绝；与既有目录（含内置收藏）重名拒绝（重命名时排除自身）。 */
export function validateCollectionName(
  raw: string,
  existing: Array<Pick<RecordingCollection, 'id' | 'name'>>,
  selfId?: string,
): string {
  const name = normalizeCollectionName(raw)
  if (!name) throw new Error('目录名称不能为空')
  const clash = existing.some(row => row.name === name && row.id !== selfId)
  if (clash) throw new Error(`已存在同名目录：${name}`)
  return name
}

/** 导出清单：以目录名承载结构（不携带机器本地 id）；内置收藏以 builtin 收录。 */
export function buildCollectionsManifest(
  collections: RecordingCollection[],
  memberships: CollectionMembership[],
): CollectionsManifest {
  const byId = new Map(collections.map(row => [row.id, row]))
  const members: CollectionsManifest['members'] = []
  for (const membership of memberships) {
    const collection = byId.get(membership.collectionId)
    if (collection) members.push({ collectionName: collection.name, recordingKey: membership.recordingKey })
  }
  return {
    type: 'recording-collections-manifest',
    version: 1,
    collections: collections.map(row => ({ name: row.name, kind: row.kind })),
    members,
  }
}

/** 一条录像库条目可被清单引用的全部候选键（导入项的 sessionId 在本机已变，须回溯 originalSessionId）。 */
export function recordingKeyCandidates(item: LibraryItemRef): string[] {
  const keys = [recordingKeyOf(item.source, item.sessionId)]
  if (item.source === 'imported') {
    keys.push(recordingKeyOf('imported', item.originalSessionId ?? ''))
    keys.push(recordingKeyOf('local', item.originalSessionId ?? ''))
  }
  return keys.filter(key => !key.endsWith(':'))
}

/** 导入合并计划：重名用户目录（含内置收藏映射）合并成员并集；新名目录新建；
 * 成员键经候选键解析到本机实际键，解析不到跳过。返回待落库的集合（调用方负责执行）。 */
export interface ManifestMergePlan {
  collectionsToPut: RecordingCollection[]
  membershipsToPut: CollectionMembership[]
  createdCollections: number
  mergedCollections: number
  resolvedMembers: number
  skippedMembers: number
}

export function planManifestMerge(
  manifest: CollectionsManifest,
  localCollections: RecordingCollection[],
  localMemberships: CollectionMembership[],
  libraryItems: LibraryItemRef[],
  makeId: () => string,
  now: () => string,
): ManifestMergePlan {
  const plan: ManifestMergePlan = {
    collectionsToPut: [],
    membershipsToPut: [],
    createdCollections: 0,
    mergedCollections: 0,
    resolvedMembers: 0,
    skippedMembers: 0,
  }
  const resolveKey = new Map<string, string>()
  for (const item of libraryItems) {
    const actual = recordingKeyOf(item.source, item.sessionId)
    for (const candidate of recordingKeyCandidates(item)) resolveKey.set(candidate, actual)
  }
  const byName = new Map(localCollections.map(row => [row.name, row]))
  const memberExists = new Set(localMemberships.map(row => `${row.collectionId}::${row.recordingKey}`))
  const idForName = (name: string, kind: 'builtin' | 'user'): string => {
    const existing = byName.get(name)
    if (kind === 'builtin') return FAVORITES_COLLECTION_ID
    if (existing && existing.kind === 'user') return existing.id
    const id = makeId()
    const record: RecordingCollection = { id, name, kind: 'user', createdAt: now(), updatedAt: now() }
    plan.collectionsToPut.push(record)
    byName.set(name, record)
    plan.createdCollections++
    return id
  }
  for (const entry of manifest.collections ?? []) {
    if (entry.kind === 'builtin') {
      if (entry.name !== FAVORITES_COLLECTION_NAME) continue
      plan.mergedCollections++
      continue
    }
    const target = byName.get(entry.name)
    if (target?.kind === 'user') plan.mergedCollections++
    else idForName(entry.name, 'user')
  }
  const pendingNames = new Set(plan.collectionsToPut.map(row => row.name))
  for (const member of manifest.members ?? []) {
    const collection = byName.get(member.collectionName)
    const isBuiltinTarget = member.collectionName === FAVORITES_COLLECTION_NAME
    if (!collection && !isBuiltinTarget) { plan.skippedMembers++; continue }
    const collectionId = isBuiltinTarget ? FAVORITES_COLLECTION_ID : collection!.id
    if (!isBuiltinTarget && !pendingNames.has(member.collectionName) && !localCollections.some(row => row.id === collectionId)) {
      plan.skippedMembers++
      continue
    }
    const actualKey = resolveKey.get(member.recordingKey)
    if (!actualKey) { plan.skippedMembers++; continue }
    const dedupe = `${collectionId}::${actualKey}`
    if (memberExists.has(dedupe)) { plan.resolvedMembers++; continue }
    memberExists.add(dedupe)
    plan.membershipsToPut.push({ collectionId, recordingKey: actualKey, addedAt: now() })
    plan.resolvedMembers++
  }
  return plan
}
