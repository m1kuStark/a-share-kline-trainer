import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
// UI 轮接线层（recordingRepository）直接导入被测真实模块（recording-bundle.test.ts 同模式）；
// 新增模块级收藏 API 用命名空间导入——RED 期导出尚不存在时仅该用例失败，不拖垮整文件。
import * as repositoryModule from '../../web/src/recording/recordingRepository'
import { RecordingLibraryRepository, configureRecordingNamespace } from '../../web/src/recording/recordingRepository'
import { CollectionCatalogService } from '../../web/src/recording/collectionService'
import { MemoryCollectionStorage } from '../../web/src/recording/collectionStorage'
import { MemoryImportedRecordingStorage } from '../../web/src/recording/importedStorage'
import type { CompactRecordingFile } from '../../web/src/recording/compactTypes'

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

/** 接线层最小录像夹具（与 recording-bundle.test.ts 同形态；空事件合法录制文件） */
function wiringRecording(sessionId: string): CompactRecordingFile {
  return {
    format: 'trainer-session', schemaVersion: 2, sessionId, createdAt: '2026-10-26T00:00:00.000Z',
    app: { version: 'test', gitCommit: 'test', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1, height: 1 }, dpr: 1 }, trainingKey: `${sessionId}.key`,
    events: [], checkpoints: [], resources: { series: [], drawings: [], trainingMeta: [], accounts: [], trades: [], contexts: [] }, gaps: [], complete: true,
  }
}

function wiringLocalStorage() {
  const records = new Map<string, CompactRecordingFile>()
  return {
    records,
    async save(file: CompactRecordingFile) { records.set(file.sessionId, structuredClone(file)) },
    async load(id: string) { return records.get(id) ?? null },
    async list() { return [...records.values()].map(file => ({ sessionId: file.sessionId, trainingKey: file.trainingKey, createdAt: file.createdAt, eventCount: file.events.length })) },
    async remove(id: string) { records.delete(id) },
  }
}

describe('REC-COLLECT-01 接线层（recordingRepository 收藏面真实接线）', () => {
  it('删除录像后成员级联清理被真实调用：repository.remove 经注入的收藏服务清掉对应成员关系', async () => {
    // 独立 oracle：录像 s1 删除前在收藏与用户目录各有成员关系；删除后两者都必须清空，
    // 且 s2 的成员关系不受影响（级联只作用于被删条目的 source:sessionId 键）。
    const localStorage = wiringLocalStorage()
    await localStorage.save(wiringRecording('s1'))
    await localStorage.save(wiringRecording('s2'))
    const collectionStorage = new MemoryCollectionStorage()
    const service = new CollectionCatalogService(collectionStorage, () => '2026-10-26T00:00:00Z', () => `wire-${Math.random()}`)
    await service.toggleStar('local:s1')
    const userDir = await service.create('骑牛1买训练')
    await service.assign(userDir.id, ['local:s1', 'local:s2'])
    const repository = new RecordingLibraryRepository(localStorage, new MemoryImportedRecordingStorage(), async () => () => {}, service)
    const result = await repository.remove([{ sessionId: 's1', source: 'local' }])
    expect(result.deleted).toHaveLength(1)
    expect(result.failed).toEqual([])
    expect(await service.memberKeys('favorites')).toEqual([])
    expect(await service.memberKeys(userDir.id)).toEqual(['local:s2'])
  })

  it('级联清理失败不阻塞删除主流程：cleanup 抛错时录像仍删除成功，且清理确曾被调用（如实记录）', async () => {
    const localStorage = wiringLocalStorage()
    await localStorage.save(wiringRecording('boom'))
    let cleanupAttempts = 0
    const failingCleanup = {
      cleanupRemovedRecordings: async () => {
        cleanupAttempts++
        throw new Error('收藏库暂时不可用')
      },
    }
    const repository = new RecordingLibraryRepository(localStorage, new MemoryImportedRecordingStorage(), async () => () => {}, failingCleanup)
    const result = await repository.remove([{ sessionId: 'boom', source: 'local' }])
    expect(result.deleted).toHaveLength(1) // 主流程不被阻塞
    expect(result.failed).toEqual([])
    expect(cleanupAttempts).toBe(1) // 清理被真实调用过（失败如实记录于诊断日志）
    expect(await localStorage.load('boom')).toBeNull()
  })

  it('模块级收藏面 API 接线：namespace 未初始化走守卫错误；初始化后进入真实收藏存储链路', async () => {
    // 独立 oracle：守卫文案必须与既有录像库 storage 同一措辞（App 录像库壳层渲染早于安装隔离
    // 初始化的场景），且与 library() 同为同步抛出（UI withNamespaceRetry 的 try 内调用口径）；
    // configureRecordingNamespace 后请求进入 IndexedDbCollectionStorage 链路——Node 无 indexedDB，
    // 真实链路的拒绝消息来自收藏库 open()（仅有那条链路能产出该文案）。
    const listCollections = (repositoryModule as { listCollections?: () => Promise<unknown> }).listCollections
    expect(typeof listCollections).toBe('function')
    expect(() => listCollections!()).toThrow('录像库尚未完成安装隔离初始化')
    configureRecordingNamespace('rec-collect-wiring')
    await expect(listCollections!()).rejects.toThrow('收藏目录')
  })
})

// REC-COLLECT-01 UI v2（方案 A，2026-10-29 拍板）源码契约：
// e2e 锁行为全链路；此处锁「归类清单绝不含收藏」「批量 assign 全键」两条最高返工项语义的源码形态，
// 防止后续重构悄悄把内置收藏带回归类清单或把批量键退化为首键（正则按单行匹配，规避 CRLF 差异）。
describe('REC-COLLECT-01 UI v2 契约（RecordingLibrary 与归档弹层源码锁定）', () => {
  it('UI v2 契约 归档弹层清单只含用户目录且无收藏第二写入口', async () => {
    const library = await readFile(new URL('../../web/src/components/RecordingLibrary.vue', import.meta.url), 'utf8')
    const popover = await readFile(new URL('../../web/src/components/collections/ArchivePopover.vue', import.meta.url), 'utf8')
    // 目录条与弹层共用同一「仅用户目录」集合（用户否决理由一：星标是收藏唯一写入口）
    expect(library).toMatch(/const userCollections = computed\(\(\) => collections\.value\.filter\(collection => collection\.kind === 'user'\)\)/)
    expect(library).toMatch(/:collections="userCollections"/)
    // 弹层组件零收藏常量引用（不 import FAVORITES，也就不存在渲染收藏项的路径）
    expect(popover).not.toMatch(/FAVORITES_COLLECTION_ID|FAVORITES_COLLECTION_NAME/)
    // 弹层语义形态：dialog 标题＝加入目录（文案拍板），底部「新建目录并加入」入口
    expect(popover).toMatch(/role="dialog" aria-label="加入目录"/)
    expect(popover).toMatch(/新建目录并加入/)
  })

  it('UI v2 契约 批量归档对全部选中键一次 assign', async () => {
    const library = await readFile(new URL('../../web/src/components/RecordingLibrary.vue', import.meta.url), 'utf8')
    const popover = await readFile(new URL('../../web/src/components/collections/ArchivePopover.vue', import.meta.url), 'utf8')
    // 批量弹层键＝选中集合整体展开（仅取首键的退化实现打红此字面量；行为层由 e2e 批量用例锁死）
    expect(library).toMatch(/const selected = \[\.\.\.batchColumns\.value\[source\]\.keys\]/)
    expect(library).toMatch(/keys: selected, batch: true/)
    // 弹层把 props.recordingKeys 整体交给 applyToggle（一次调用覆盖全部键）
    expect(popover).toMatch(/props\.applyToggle\(collection\.id, props\.recordingKeys, checked\)/)
    expect(library).toMatch(/:apply-toggle="applyArchiveToggle"/)
  })

  it('UI v2 契约 弹层勾选失败显式回正并就地报错', async () => {
    const popover = await readFile(new URL('../../web/src/components/collections/ArchivePopover.vue', import.meta.url), 'utf8')
    // 失败分支：toggleError 就地承接服务层错误消息（该赋值只存在于失败回正分支）
    expect(popover).toMatch(/toggleError\.value = result\.message/)
    // 错误行 role=alert 存在于弹层模板（就近反馈，不打断）
    expect(popover).toMatch(/role="alert"/)
  })
})
