import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

// REC-COLLECT-01 录像库收藏与自定义目录（2026-10-26 四功能拍板第一序）。
// 独立 oracle 原则：期望全部为内嵌常量/手造夹具，本文件禁止调用被测实现生成期望。
// 提取方式沿用 kdj-indicator.test.ts 的「读取 web 源码＋ts.transpile 提取执行」模式：
// 测的是 web/src/recording/collection*.ts 的真实导出（含 MemoryCollectionStorage 真实实现），
// 不在测试里复制实现；IndexedDB 封装类不在 Node 环境执行（浏览器 e2e 轮覆盖）。

interface CollectionRecordBag { id: string; name: string; kind: string; createdAt: string; updatedAt: string }
interface MembershipBag { collectionId: string; recordingKey: string; addedAt: string }
interface ManifestBag {
  type: string
  version: number
  collections: Array<{ name: string; kind: string }>
  members: Array<{ collectionName: string; recordingKey: string }>
}

type Exports = Record<string, unknown>

/** 依次提取执行四个真实模块（types→collections→storage→service），模块间相对引用按已加载表解析 */
async function loadRecordingCollectionModules(): Promise<Exports[]> {
  const files = [
    ['collectionTypes', '../../web/src/recording/collectionTypes.ts'],
    ['collections', '../../web/src/recording/collections.ts'],
    ['collectionStorage', '../../web/src/recording/collectionStorage.ts'],
    ['collectionService', '../../web/src/recording/collectionService.ts'],
  ] as const
  const loaded = new Map<string, Exports>()
  for (const [key, rel] of files) {
    const source = await readFile(new URL(rel, import.meta.url), 'utf8')
    const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
    const module = { exports: {} as Exports }
    const require_ = (name: string): unknown => {
      const local = name.replace(/^\.\//, '').replace(/\.ts$/, '')
      const hit = loaded.get(local)
      if (hit) return hit
      throw new Error(`意外的依赖引用：${name}`)
    }
    new Function('require', 'exports', 'module', js)(require_, module.exports, module)
    loaded.set(key, module.exports)
  }
  return [...loaded.values()]
}

/** 固定时钟＋可预测 id 的服务构造（经提取的真实类） */
async function makeService(initialCollections: string[] = []) {
  const [, , storageExports, serviceExports] = await loadRecordingCollectionModules()
  const MemoryCollectionStorage = storageExports.MemoryCollectionStorage as new () => {
    listCollections(): Promise<CollectionRecordBag[]>
    putCollection(record: CollectionRecordBag): Promise<void>
    deleteCollection(id: string): Promise<void>
    listMemberships(collectionId?: string): Promise<MembershipBag[]>
    putMembership(record: MembershipBag): Promise<void>
    deleteMembership(collectionId: string, recordingKey: string): Promise<void>
    deleteMembershipsForCollection(collectionId: string): Promise<void>
    deleteMembershipsForRecordings(recordingKeys: string[]): Promise<void>
  }
  const CollectionCatalogService = serviceExports.CollectionCatalogService as new (
    storage: InstanceType<typeof MemoryCollectionStorage>,
    now?: () => string,
    newId?: () => string,
  ) => {
    list(): Promise<CollectionRecordBag[]>
    create(rawName: string): Promise<CollectionRecordBag>
    rename(id: string, rawName: string): Promise<CollectionRecordBag>
    remove(id: string): Promise<void>
    assign(collectionId: string, recordingKeys: string[]): Promise<number>
    unassign(collectionId: string, recordingKeys: string[]): Promise<number>
    toggleStar(recordingKey: string): Promise<boolean>
    membershipsFor(recordingKeys: string[]): Promise<Record<string, string[]>>
    memberKeys(collectionId: string): Promise<string[]>
    cleanupRemovedRecordings(items: Array<{ sessionId: string; source: string; originalSessionId?: string }>): Promise<number>
    exportManifest(): Promise<ManifestBag>
    importManifest(
      manifest: ManifestBag,
      libraryItems: Array<{ sessionId: string; source: string; originalSessionId?: string }>,
    ): Promise<{ createdCollections: number; mergedCollections: number; resolvedMembers: number; skippedMembers: number }>
  }
  const storage = new MemoryCollectionStorage()
  let tick = 0
  let seq = 0
  const service = new CollectionCatalogService(
    storage,
    () => `2026-10-26T00:00:${String(tick++).padStart(2, '0')}Z`,
    () => `id-${++seq}`,
  )
  for (const name of initialCollections) await service.create(name)
  return { service, storage }
}

describe('REC-COLLECT-01 收藏目录核心语义（提取执行 web/src/recording/collection*.ts）', () => {
  it('内置收藏目录自动创建且唯一：空库首访返回恰一个 builtin favorites，重复访问不重复', async () => {
    const { service } = await makeService()
    const first = await service.list()
    expect(first).toHaveLength(1)
    expect(first[0].id).toBe('favorites')
    expect(first[0].kind).toBe('builtin')
    expect(first[0].name).toBe('收藏')
    const second = await service.list()
    expect(second).toHaveLength(1)
    expect(second[0].id).toBe('favorites')
  })

  it('用户目录创建：名称去首尾空格；空白名拒绝；与既有目录重名（含内置收藏名）拒绝', async () => {
    const { service } = await makeService()
    const created = await service.create('  骑牛1买训练  ')
    expect(created.name).toBe('骑牛1买训练')
    expect(created.kind).toBe('user')
    await expect(service.create('   ')).rejects.toThrow('名称')
    await expect(service.create('骑牛1买训练')).rejects.toThrow('已存在同名目录')
    await expect(service.create('收藏')).rejects.toThrow('已存在同名目录')
  })

  it('内置目录不可重命名不可删除；用户目录可重命名且重名校验排除自身', async () => {
    const { service } = await makeService(['自选股训练'])
    const list = await service.list()
    const favorites = list.find(row => row.id === 'favorites')!
    const user = list.find(row => row.name === '自选股训练')!
    await expect(service.rename(favorites.id, 'X')).rejects.toThrow('内置')
    await expect(service.remove(favorites.id)).rejects.toThrow('内置')
    const renamed = await service.rename(user.id, ' 自选股复盘 ')
    expect(renamed.name).toBe('自选股复盘')
    // 同名自改（先改名回旧名占用方不存在）→ 排除自身：重命名为自己的现名应成功
    const again = await service.rename(user.id, '自选股复盘')
    expect(again.name).toBe('自选股复盘')
    await expect(service.rename(user.id, '收藏')).rejects.toThrow('已存在同名目录')
  })

  it('多对多成员：同一录像可属多个目录；assign 幂等；unassign 后成员清空', async () => {
    const { service } = await makeService(['骑牛1买训练', '自选股训练'])
    const list = await service.list()
    const a = list.find(row => row.name === '骑牛1买训练')!
    const b = list.find(row => row.name === '自选股训练')!
    const key = 'local:session-1'
    expect(await service.assign(a.id, [key])).toBe(1)
    expect(await service.assign(a.id, [key])).toBe(0) // 幂等：重复加入不新增
    expect(await service.assign(b.id, [key])).toBe(1)
    const memberships = await service.membershipsFor([key])
    expect(memberships[key].sort()).toEqual([a.id, b.id].sort())
    expect(await service.memberKeys(a.id)).toEqual([key])
    expect(await service.unassign(a.id, [key])).toBe(1)
    expect(await service.unassign(a.id, [key])).toBe(0)
    expect(await service.memberKeys(a.id)).toEqual([])
    expect(await service.memberKeys(b.id)).toEqual([key]) // 另一目录不受影响
  })

  it('星标切换：toggleStar 加入内置收藏再移出，返回值如实反映切换后状态', async () => {
    const { service } = await makeService()
    expect(await service.toggleStar('local:s1')).toBe(true) // 加入后处于收藏
    const favorites = (await service.list()).find(row => row.id === 'favorites')!
    expect(await service.memberKeys(favorites.id)).toEqual(['local:s1'])
    expect(await service.toggleStar('local:s1')).toBe(false) // 移出后不在收藏
    expect(await service.memberKeys(favorites.id)).toEqual([])
  })

  it('删除录像级联清理：cleanupRemovedRecordings 只清对应键的成员关系，其他保留', async () => {
    const { service } = await makeService(['骑牛1买训练'])
    const list = await service.list()
    const favorites = list.find(row => row.id === 'favorites')!
    const user = list.find(row => row.name === '骑牛1买训练')!
    await service.assign(favorites.id, ['local:s1', 'local:s2'])
    await service.assign(user.id, ['local:s2', 'imported:i1'])
    // 删除 s2（local）与 i1（imported）
    const removed = await service.cleanupRemovedRecordings([
      { sessionId: 's2', source: 'local' },
      { sessionId: 'i1', source: 'imported' },
    ])
    expect(removed).toBe(3)
    expect(await service.memberKeys(favorites.id)).toEqual(['local:s1'])
    expect(await service.memberKeys(user.id)).toEqual([])
  })

  it('删除用户目录连带其成员关系，不影响其他目录成员', async () => {
    const { service } = await makeService(['骑牛1买训练', '自选股训练'])
    const list = await service.list()
    const favorites = list.find(row => row.id === 'favorites')!
    const a = list.find(row => row.name === '骑牛1买训练')!
    const b = list.find(row => row.name === '自选股训练')!
    await service.assign(a.id, ['local:s1'])
    await service.assign(b.id, ['local:s1'])
    await service.remove(a.id)
    await expect(service.memberKeys(a.id)).rejects.toThrow() // 目录已不存在
    expect(await service.memberKeys(b.id)).toEqual(['local:s1'])
    expect(await service.memberKeys(favorites.id)).toEqual([])
    expect((await service.list()).map(row => row.name).sort()).toEqual(['收藏', '自选股训练'].sort())
  })

  it('导出清单：manifest 携带目录名与成员结构（内置收藏以 builtin 收录）', async () => {
    const { service } = await makeService(['骑牛1买训练'])
    const list = await service.list()
    const favorites = list.find(row => row.id === 'favorites')!
    const user = list.find(row => row.name === '骑牛1买训练')!
    await service.assign(favorites.id, ['local:s1'])
    await service.assign(user.id, ['local:s1', 'local:s2'])
    const manifest = await service.exportManifest()
    expect(manifest.type).toBe('recording-collections-manifest')
    expect(manifest.version).toBe(1)
    expect(manifest.collections).toEqual([
      { name: '收藏', kind: 'builtin' },
      { name: '骑牛1买训练', kind: 'user' },
    ])
    // 码点序确定性排序（localeCompare 对中文依环境不定，禁止用于断言排序）
    const byCodepoint = (x: { collectionName: string; recordingKey: string }, y: { collectionName: string; recordingKey: string }) =>
      `${x.collectionName}::${x.recordingKey}` < `${y.collectionName}::${y.recordingKey}` ? -1 : 1
    expect([...manifest.members].sort(byCodepoint)).toEqual([
      { collectionName: '收藏', recordingKey: 'local:s1' },
      { collectionName: '骑牛1买训练', recordingKey: 'local:s1' },
      { collectionName: '骑牛1买训练', recordingKey: 'local:s2' },
    ])
  })

  it('导入合并：重名用户目录并集合并；内置收藏映射本机内置；recordingKey 经 originalSessionId 解析导入项', async () => {
    // 发送端清单：目录「骑牛1买训练」含 local:s1、local:s2；内置收藏含 local:s2
    const manifest: ManifestBag = {
      type: 'recording-collections-manifest',
      version: 1,
      collections: [
        { name: '收藏', kind: 'builtin' },
        { name: '骑牛1买训练', kind: 'user' },
      ],
      members: [
        { collectionName: '骑牛1买训练', recordingKey: 'local:s1' },
        { collectionName: '骑牛1买训练', recordingKey: 'local:s2' },
        { collectionName: '收藏', recordingKey: 'local:s2' },
      ],
    }
    // 接收端：已有同名「骑牛1买训练」且已含 local:s0（既有成员不得丢）；
    // 录像库中 s1 已作为导入录像存在（sessionId 变为 imported:xyz-1，originalSessionId=s1）→ 按 originalSessionId 解析；
    // s2 既不存在（清单成员跳过并计数）；s0 在本地为 local 记录。
    const { service } = await makeService(['骑牛1买训练'])
    const list0 = await service.list()
    const localUser = list0.find(row => row.name === '骑牛1买训练')!
    await service.assign(localUser.id, ['local:s0'])
    const libraryItems = [
      { sessionId: 'xyz-1', source: 'imported', originalSessionId: 's1' },
      { sessionId: 's0', source: 'local' },
    ]
    const summary = await service.importManifest(manifest, libraryItems)
    expect(summary.createdCollections).toBe(0)
    expect(summary.mergedCollections).toBe(2) // 骑牛1买训练（同名合并）＋收藏（内置映射）
    expect(summary.resolvedMembers).toBe(1) // 仅 local:s1 → imported:xyz-1（唯一能解析到录像库的成员）
    expect(summary.skippedMembers).toBe(2) // local:s2 在两条目录成员里都解析不到
    const list = await service.list()
    const favorites = list.find(row => row.id === 'favorites')!
    const merged = list.find(row => row.name === '骑牛1买训练')!
    expect((await service.memberKeys(merged.id)).sort()).toEqual(['imported:xyz-1', 'local:s0'].sort())
    expect(await service.memberKeys(favorites.id)).toEqual([])
  })
})
