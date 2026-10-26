/** REC-COLLECT-01 收藏目录存储层：IndexedDB 实现（与录像库同域独立库 `.collections`）
 * ＋内存实现（单测替身与降级场景）。封装惯例沿用 importedStorage.ts（事务 Promise 化）。 */
import type { CollectionMembership, RecordingCollection } from './collectionTypes'

export interface CollectionStorage {
  listCollections(): Promise<RecordingCollection[]>
  putCollection(record: RecordingCollection): Promise<void>
  deleteCollection(id: string): Promise<void>
  listMemberships(collectionId?: string): Promise<CollectionMembership[]>
  putMembership(record: CollectionMembership): Promise<void>
  deleteMembership(collectionId: string, recordingKey: string): Promise<void>
  deleteMembershipsForCollection(collectionId: string): Promise<void>
  deleteMembershipsForRecordings(recordingKeys: string[]): Promise<void>
  close?(): void
}

interface MemberRow extends CollectionMembership {
  /** 组合主键（collectionId::recordingKey）作 IndexedDB inline key，另建双索引供范围删。 */
  id: string
}

function memberRow(membership: CollectionMembership): MemberRow {
  return { ...membership, id: `${membership.collectionId}::${membership.recordingKey}` }
}

export class IndexedDbCollectionStorage implements CollectionStorage {
  private connection: Promise<IDBDatabase> | null = null
  constructor(private readonly databaseName: string) {}

  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB，无法访问收藏目录'))
        return
      }
      let settled = false
      const request = indexedDB.open(this.databaseName, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('members')) {
          const store = db.createObjectStore('members', { keyPath: 'id' })
          store.createIndex('byCollection', 'collectionId')
          store.createIndex('byRecording', 'recordingKey')
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => { db.close(); if (this.connection === opening) this.connection = null }
        if (settled) { db.close(); return }
        settled = true
        resolve(db)
      }
      request.onerror = () => {
        if (settled) return
        settled = true
        reject(new Error(`打开收藏目录库失败：${request.error?.message ?? '未知错误'}`))
      }
      request.onblocked = () => {
        if (settled) return
        settled = true
        reject(new Error('收藏目录库被其他页面占用，请关闭其他训练器页面后重试'))
      }
    })
    this.connection = opening
    void opening.catch(() => { if (this.connection === opening) this.connection = null })
    return opening
  }

  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    operation: (tx: IDBTransaction) => () => T,
  ): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      tx.onerror = () => reject(new Error(`处理收藏目录失败：${tx.error?.message ?? '未知错误'}`))
      tx.onabort = () => reject(new Error(`收藏目录事务已中止：${tx.error?.message ?? '未知错误'}`))
      try {
        const result = operation(tx)
        tx.oncomplete = () => resolve(result())
      } catch (error) {
        tx.abort()
        reject(error)
      }
    })
  }

  async listCollections(): Promise<RecordingCollection[]> {
    return this.transaction(['collections'], 'readonly', tx => {
      const request = tx.objectStore('collections').getAll() as IDBRequest<RecordingCollection[]>
      return () => request.result
    })
  }
  async putCollection(record: RecordingCollection): Promise<void> {
    await this.transaction(['collections'], 'readwrite', tx => {
      tx.objectStore('collections').put(record)
      return () => undefined
    })
  }
  async deleteCollection(id: string): Promise<void> {
    await this.transaction(['collections'], 'readwrite', tx => {
      tx.objectStore('collections').delete(id)
      return () => undefined
    })
  }
  async listMemberships(collectionId?: string): Promise<CollectionMembership[]> {
    return this.transaction(['members'], 'readonly', tx => {
      const store = tx.objectStore('members')
      const request = collectionId
        ? store.index('byCollection').getAll(collectionId) as IDBRequest<MemberRow[]>
        : store.getAll() as IDBRequest<MemberRow[]>
      return () => request.result.map(stripRow)
    })
  }
  async putMembership(record: CollectionMembership): Promise<void> {
    await this.transaction(['members'], 'readwrite', tx => {
      tx.objectStore('members').put(memberRow(record))
      return () => undefined
    })
  }
  async deleteMembership(collectionId: string, recordingKey: string): Promise<void> {
    await this.transaction(['members'], 'readwrite', tx => {
      tx.objectStore('members').delete(`${collectionId}::${recordingKey}`)
      return () => undefined
    })
  }
  async deleteMembershipsForCollection(collectionId: string): Promise<void> {
    await this.transaction(['members'], 'readwrite', tx => {
      const index = tx.objectStore('members').index('byCollection')
      const request = index.openCursor(IDBKeyRange.only(collectionId))
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) { cursor.delete(); cursor.continue() }
      }
      return () => undefined
    })
  }
  async deleteMembershipsForRecordings(recordingKeys: string[]): Promise<void> {
    if (!recordingKeys.length) return
    await this.transaction(['members'], 'readwrite', tx => {
      const index = tx.objectStore('members').index('byRecording')
      for (const key of recordingKeys) {
        const request = index.openCursor(IDBKeyRange.only(key))
        request.onsuccess = () => {
          const cursor = request.result
          if (cursor) { cursor.delete(); cursor.continue() }
        }
      }
      return () => undefined
    })
  }
  close(): void {
    const connection = this.connection
    this.connection = null
    void connection?.then(db => db.close()).catch(() => {})
  }
}

function stripRow(row: MemberRow): CollectionMembership {
  const { id: _id, ...membership } = row
  return membership
}

export class MemoryCollectionStorage implements CollectionStorage {
  readonly collections = new Map<string, RecordingCollection>()
  readonly members = new Map<string, MemberRow>()
  async listCollections(): Promise<RecordingCollection[]> { return [...this.collections.values()].map(row => ({ ...row })) }
  async putCollection(record: RecordingCollection): Promise<void> { this.collections.set(record.id, { ...record }) }
  async deleteCollection(id: string): Promise<void> { this.collections.delete(id) }
  async listMemberships(collectionId?: string): Promise<CollectionMembership[]> {
    const rows = collectionId
      ? [...this.members.values()].filter(row => row.collectionId === collectionId)
      : [...this.members.values()]
    return rows.map(stripRow)
  }
  async putMembership(record: CollectionMembership): Promise<void> {
    const row = memberRow(record)
    this.members.set(row.id, row)
  }
  async deleteMembership(collectionId: string, recordingKey: string): Promise<void> {
    this.members.delete(`${collectionId}::${recordingKey}`)
  }
  async deleteMembershipsForCollection(collectionId: string): Promise<void> {
    for (const [id, row] of [...this.members]) if (row.collectionId === collectionId) this.members.delete(id)
  }
  async deleteMembershipsForRecordings(recordingKeys: string[]): Promise<void> {
    const drop = new Set(recordingKeys)
    for (const [id, row] of [...this.members]) if (drop.has(row.recordingKey)) this.members.delete(id)
  }
}
