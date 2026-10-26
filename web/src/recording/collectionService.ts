/** REC-COLLECT-01 收藏目录服务层：编排存储与纯逻辑，面向录像库 UI 的稳定门面。
 * 依赖注入 storage/时钟/id（单测与 UI 均可替换）；错误消息中文字面量（仓库无 i18n 惯例）。 */
import type {
  CollectionMembership,
  CollectionsManifest,
  ImportManifestSummary,
  LibraryItemRef,
  RecordingCollection,
} from './collectionTypes'
import {
  buildCollectionsManifest,
  normalizeCollectionName,
  planManifestMerge,
  validateCollectionName,
} from './collections'
import { FAVORITES_COLLECTION_ID, FAVORITES_COLLECTION_NAME, recordingKeyOf } from './collectionTypes'
import type { CollectionStorage } from './collectionStorage'

export class CollectionCatalogService {
  constructor(
    private readonly storage: CollectionStorage,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** 目录列表：内置收藏恒在（缺失自动补建）且置顶，其余按创建时间升序。 */
  async list(): Promise<RecordingCollection[]> {
    const collections = await this.storage.listCollections()
    if (!collections.some(row => row.id === FAVORITES_COLLECTION_ID)) {
      const timestamp = this.now()
      const builtin: RecordingCollection = {
        id: FAVORITES_COLLECTION_ID,
        name: FAVORITES_COLLECTION_NAME,
        kind: 'builtin',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await this.storage.putCollection(builtin)
      collections.push(builtin)
    }
    return collections.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'builtin' ? -1 : 1
      return a.createdAt.localeCompare(b.createdAt)
    })
  }

  private async requireCollection(id: string): Promise<RecordingCollection> {
    const collection = (await this.storage.listCollections()).find(row => row.id === id)
    if (!collection) throw new Error('目录不存在')
    return collection
  }

  async create(rawName: string): Promise<RecordingCollection> {
    const existing = await this.list()
    const name = validateCollectionName(rawName, existing)
    const timestamp = this.now()
    const record: RecordingCollection = { id: this.newId(), name, kind: 'user', createdAt: timestamp, updatedAt: timestamp }
    await this.storage.putCollection(record)
    return record
  }

  async rename(id: string, rawName: string): Promise<RecordingCollection> {
    const collection = await this.requireCollection(id)
    if (collection.kind === 'builtin') throw new Error('内置收藏目录不能重命名')
    const existing = await this.list()
    const name = validateCollectionName(rawName, existing, id)
    const updated: RecordingCollection = { ...collection, name, updatedAt: this.now() }
    await this.storage.putCollection(updated)
    return updated
  }

  async remove(id: string): Promise<void> {
    const collection = await this.requireCollection(id)
    if (collection.kind === 'builtin') throw new Error('内置收藏目录不能删除')
    await this.storage.deleteMembershipsForCollection(id)
    await this.storage.deleteCollection(id)
  }

  /** 返回本次实际新增的成员数（幂等：已存在的不计）。 */
  async assign(collectionId: string, recordingKeys: string[]): Promise<number> {
    await this.requireCollection(collectionId)
    const existing = new Set((await this.storage.listMemberships(collectionId)).map(row => row.recordingKey))
    let added = 0
    for (const key of recordingKeys) {
      if (existing.has(key)) continue
      await this.storage.putMembership({ collectionId, recordingKey: key, addedAt: this.now() })
      existing.add(key)
      added++
    }
    return added
  }

  /** 返回本次实际移除的成员数。 */
  async unassign(collectionId: string, recordingKeys: string[]): Promise<number> {
    await this.requireCollection(collectionId)
    const existing = new Set((await this.storage.listMemberships(collectionId)).map(row => row.recordingKey))
    let removed = 0
    for (const key of recordingKeys) {
      if (!existing.has(key)) continue
      await this.storage.deleteMembership(collectionId, key)
      existing.delete(key)
      removed++
    }
    return removed
  }

  /** 星标切换：返回切换后是否处于内置收藏。 */
  async toggleStar(recordingKey: string): Promise<boolean> {
    await this.list()
    const members = await this.storage.listMemberships(FAVORITES_COLLECTION_ID)
    const starred = members.some(row => row.recordingKey === recordingKey)
    if (starred) {
      await this.storage.deleteMembership(FAVORITES_COLLECTION_ID, recordingKey)
      return false
    }
    await this.storage.putMembership({ collectionId: FAVORITES_COLLECTION_ID, recordingKey, addedAt: this.now() })
    return true
  }

  /** recordingKey → 所属目录 id 列表（UI 徽标/星标态渲染用）。 */
  async membershipsFor(recordingKeys: string[]): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {}
    for (const key of recordingKeys) result[key] = []
    const memberships = await this.storage.listMemberships()
    for (const membership of memberships) {
      if (membership.recordingKey in result) result[membership.recordingKey].push(membership.collectionId)
    }
    return result
  }

  async memberKeys(collectionId: string): Promise<string[]> {
    await this.requireCollection(collectionId)
    const memberships = await this.storage.listMemberships(collectionId)
    return memberships.map(row => row.recordingKey)
  }

  /** 录像删除/清空后的级联清理；返回清除的成员关系数。 */
  async cleanupRemovedRecordings(items: LibraryItemRef[]): Promise<number> {
    const keys = items.map(item => recordingKeyOf(item.source, item.sessionId))
    const before = (await this.storage.listMemberships()).length
    await this.storage.deleteMembershipsForRecordings(keys)
    const after = (await this.storage.listMemberships()).length
    return before - after
  }

  async exportManifest(): Promise<CollectionsManifest> {
    const collections = await this.list()
    const memberships = await this.storage.listMemberships()
    return buildCollectionsManifest(collections, memberships)
  }

  /** 导入合并：返回创建/合并目录数与成员解析统计（解析不到的跳过并如实计数）。 */
  async importManifest(
    manifest: CollectionsManifest,
    libraryItems: LibraryItemRef[],
  ): Promise<ImportManifestSummary> {
    const localCollections = await this.list()
    const localMemberships = await this.storage.listMemberships()
    const plan = planManifestMerge(manifest, localCollections, localMemberships, libraryItems, this.newId, this.now)
    for (const collection of plan.collectionsToPut) await this.storage.putCollection(collection)
    for (const membership of plan.membershipsToPut) await this.storage.putMembership(membership)
    return {
      createdCollections: plan.createdCollections,
      mergedCollections: plan.mergedCollections,
      resolvedMembers: plan.resolvedMembers,
      skippedMembers: plan.skippedMembers,
    }
  }
}
