<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Download, FolderPlus, Pencil, Star, Trash2, Upload } from 'lucide-vue-next'
import { fetchTrainingSnapshot } from '../api'
import { bulkImportRecordingFiles, exportRecordingBundleFile, isRecordingBundleFile } from '../recording/bundle'
import {
  assignToCollection,
  collectionMembershipsFor,
  createCollection,
  exportCollectionsManifest,
  importCollectionsManifest,
  importRecording,
  listCollections,
  listRecordingLibrary,
  loadLibraryRecording,
  removeCollection,
  renameCollection,
  toggleCollectionStar,
  unassignFromCollection,
} from '../recording/recordingRepository'
import { FAVORITES_COLLECTION_ID } from '../recording/collectionTypes'
import type { CollectionsManifest, RecordingCollection } from '../recording/collectionTypes'
import type { CompactRecordingFile } from '../recording/compactTypes'
import type { RecordingLibraryItem, RecordingSource } from '../recording/recordingRepository'

const props = withDefaults(defineProps<{
  items: RecordingLibraryItem[]
  busy?: boolean
  initializing?: boolean
  error?: string
  activeSessionIds?: string[]
}>(), { busy: false, initializing: false, error: '', activeSessionIds: () => [] })

// RF-05：随机模式录像要在录像库可见「随机模式」tag 与真实标的。标注按 trainingKey 前缀
// （＝训练 id）经 GET /api/trainings/:id 读取训练快照派生，best-effort——训练已删除或服务
// 不可达时保持既有信息量（仅日期与事件数），不影响打开与回放。
interface RecordingBrief { stock: string; random: boolean }
const briefs = ref<Record<string, RecordingBrief>>({})
async function loadBriefs(items: RecordingLibraryItem[]): Promise<void> {
  const keys = [...new Set(items.map(item => item.trainingKey).filter((key): key is string => typeof key === 'string'))]
  await Promise.all(keys.map(async key => {
    if (briefs.value[key] !== undefined) return
    const id = Number(key.split('.')[0])
    if (!Number.isSafeInteger(id) || id < 1) return
    try {
      const snapshot = await fetchTrainingSnapshot(id)
      const training = snapshot.training
      briefs.value = { ...briefs.value, [key]: { stock: training.code ? `${training.name ?? ''} · ${training.code}` : '', random: training.range?.mode === 'random' } }
    } catch { /* 已删除/不可达：不标注 */ }
  }))
}

const emit = defineEmits<{
  replay: [sessionId: string]
  import: [file: File]
  remove: [sessionId: string]
  clear: [source: RecordingSource]
  close: []
}>()

// REC-BULK-01：批量导出/导入。录像库列表数据由父页面持有（进入录像库时刷新），
// 批量导入的新条目先以本地补充行呈现保证即时可见；父列表下次刷新后自然收编。
const bulkBusy = ref(false)
const bulkNotice = ref('')
const bulkNoticeIsError = ref(false)
const extraItems = ref<RecordingLibraryItem[]>([])
const rowKey = (item: RecordingLibraryItem) => `${item.source}:${item.sessionId}`
const displayItems = computed(() => {
  const known = new Set(props.items.map(rowKey))
  return [...props.items, ...extraItems.value.filter(item => !known.has(rowKey(item)))]
})
onMounted(() => { void loadBriefs(displayItems.value); void refreshCollections() })
watch(displayItems, items => { void loadBriefs(items); void refreshCollections() })
watch(() => props.items, () => { void pruneExtras() })
async function pruneExtras(): Promise<void> {
  if (!extraItems.value.length) return
  try {
    const alive = new Set((await withNamespaceRetry(listRecordingLibrary)).map(rowKey))
    extraItems.value = extraItems.value.filter(item => alive.has(rowKey(item)))
  } catch { /* 列表不可达时保留现有补充行 */ }
}
// 录像库壳层可能先于安装隔离初始化渲染（与 App 单条导入的 recordingNamespaceReady 守卫同语义）；
// 对「尚未完成安装隔离初始化」做短重试，其余错误原样抛出。
async function withNamespaceRetry<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await action() }
    catch (error) {
      if (attempt < 30 && error instanceof Error && error.message.includes('尚未完成安装隔离初始化')) {
        await new Promise(resolve => setTimeout(resolve, 100))
        continue
      }
      throw error
    }
  }
}
// REC-COLLECT-01：收藏目录与星标。目录索引存 IndexedDB（与录像库同 namespace），
// 呈现＝目录条（内置收藏星标置顶＋用户目录＋新建）＋条目星标/归档操作＋按目录过滤。
const collections = ref<RecordingCollection[]>([])
const membershipsBy = ref<Record<string, string[]>>({})
const selectedCollectionId = ref<string | null>(null)
const collectionsError = ref('')
const collectionBusy = ref(false)
let collectionsRefreshQueued = false
const collectionForm = ref<{ mode: 'create' | 'rename'; id?: string; name: string; error: string } | null>(null)
const archivingKey = ref('')

const isMember = (collectionId: string, key: string) => (membershipsBy.value[key] ?? []).includes(collectionId)
const isStarred = (item: RecordingLibraryItem) => isMember(FAVORITES_COLLECTION_ID, rowKey(item))
function memberCount(collectionId: string): number {
  return displayItems.value.filter(item => isMember(collectionId, rowKey(item))).length
}
function passesCollectionFilter(item: RecordingLibraryItem): boolean {
  return selectedCollectionId.value === null || isMember(selectedCollectionId.value, rowKey(item))
}
async function refreshCollections(): Promise<void> {
  if (collectionBusy.value) { collectionsRefreshQueued = true; return }
  collectionBusy.value = true
  try {
    collections.value = await withNamespaceRetry(listCollections)
    membershipsBy.value = await withNamespaceRetry(() => collectionMembershipsFor(displayItems.value.map(rowKey)))
    collectionsError.value = ''
  } catch (error) {
    collectionsError.value = error instanceof Error ? error.message : '收藏目录加载失败'
  } finally {
    collectionBusy.value = false
    if (collectionsRefreshQueued) { collectionsRefreshQueued = false; void refreshCollections() }
  }
}
async function runCollectionAction(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await withNamespaceRetry(action)
    await refreshCollections()
    return true
  } catch (error) {
    collectionsError.value = error instanceof Error ? error.message : '收藏目录操作失败'
    await refreshCollections()
    return false
  }
}
async function toggleStar(item: RecordingLibraryItem): Promise<void> {
  await runCollectionAction(() => toggleCollectionStar(rowKey(item)))
}
function toggleArchivePanel(item: RecordingLibraryItem): void {
  archivingKey.value = archivingKey.value === rowKey(item) ? '' : rowKey(item)
}
async function onArchiveChange(collection: RecordingCollection, item: RecordingLibraryItem, event: Event): Promise<void> {
  const checked = (event.target as HTMLInputElement).checked
  const ok = await runCollectionAction(() => checked
    ? assignToCollection(collection.id, [rowKey(item)])
    : unassignFromCollection(collection.id, [rowKey(item)]))
  if (!ok) await refreshCollections() // 失败时以存储真实态回正勾选框
}
function openCreateForm(): void {
  collectionForm.value = { mode: 'create', name: '', error: '' }
}
function openRenameForm(collection: RecordingCollection): void {
  collectionForm.value = { mode: 'rename', id: collection.id, name: collection.name, error: '' }
}
async function submitCollectionForm(): Promise<void> {
  const form = collectionForm.value
  if (!form) return
  try {
    if (form.mode === 'create') await withNamespaceRetry(() => createCollection(form.name))
    else await withNamespaceRetry(() => renameCollection(form.id!, form.name))
    collectionForm.value = null
    await refreshCollections()
  } catch (error) {
    collectionForm.value = { ...form, error: error instanceof Error ? error.message : String(error) }
  }
}
const pendingCollectionRemoval = ref<RecordingCollection | null>(null)
function confirmCollectionRemoval(): void {
  const target = pendingCollectionRemoval.value
  pendingCollectionRemoval.value = null
  if (target) void doRemoveCollection(target.id)
}
async function doRemoveCollection(id: string): Promise<void> {
  try {
    await withNamespaceRetry(() => removeCollection(id))
    if (selectedCollectionId.value === id) selectedCollectionId.value = null
    await refreshCollections()
  } catch (error) {
    collectionsError.value = error instanceof Error ? error.message : '删除目录失败'
  }
}

// 契约锁定（frontend-contract M2）：两列分别自 displayItems 过滤（props.items＋批量导入补充行）；
// REC-COLLECT-01 目录过滤在其下游叠加（选中目录时仅显示成员，跨两列）
const localItemsAll = computed(() => displayItems.value.filter(item => item.source === 'local'))
const importedItemsAll = computed(() => displayItems.value.filter(item => item.source === 'imported'))
const localItems = computed(() => localItemsAll.value.filter(passesCollectionFilter))
const importedItems = computed(() => importedItemsAll.value.filter(passesCollectionFilter))
async function exportAll(): Promise<void> {
  if (props.busy || bulkBusy.value || !displayItems.value.length) return
  bulkBusy.value = true
  bulkNotice.value = ''
  bulkNoticeIsError.value = false
  try {
    const files: CompactRecordingFile[] = []
    for (const item of await withNamespaceRetry(listRecordingLibrary)) {
      const file = await loadLibraryRecording(item)
      if (file) files.push(file)
    }
    if (!files.length) throw new Error('录像库为空，没有可导出的录像')
    // REC-COLLECT-01：全部导出携带收藏结构；清单不可达时如实降级提示（不阻塞录像本体导出）
    let manifest: CollectionsManifest | undefined
    let structureNote = '（含收藏结构）'
    try {
      manifest = await withNamespaceRetry(exportCollectionsManifest)
    } catch (error) {
      structureNote = `（未包含收藏结构：${error instanceof Error ? error.message : String(error)}）`
    }
    const blob = await exportRecordingBundleFile(files, new Date(), manifest)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `训练录像库-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '')}.trainer-recordings.json`
    anchor.click()
    URL.revokeObjectURL(url)
    bulkNotice.value = `已导出 ${files.length} 份录像为合并包文件${structureNote}`
  } catch (error) {
    bulkNotice.value = error instanceof Error ? error.message : '无法导出录像库'
    bulkNoticeIsError.value = true
  } finally { bulkBusy.value = false }
}
const confirming = ref<{ kind: 'item' | 'source'; id?: string; source?: RecordingSource; label: string } | null>(null)
const isActive = (id: string) => props.activeSessionIds.includes(id)
const askRemove = (item: RecordingLibraryItem) => {
  if (isActive(item.sessionId)) return
  confirming.value = { kind: 'item', id: item.sessionId, label: new Date(item.createdAt).toLocaleString() }
}
const askClear = (source: RecordingSource, count: number) => {
  if (!count) return
  confirming.value = { kind: 'source', source, label: source === 'local' ? '本机训练录像' : '导入的分享录像' }
}
const confirmRemoval = () => {
  const action = confirming.value
  confirming.value = null
  if (!action) return
  if (action.kind === 'item' && action.id) emit('remove', action.id)
  if (action.kind === 'source' && action.source) emit('clear', action.source)
}
const onImport = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  // 单条非合并包文件保持既有单条导入路径（校验/报错/导入后直接回放不变）
  if (files.length === 1 && !await isRecordingBundleFile(files[0]!)) {
    emit('import', files[0]!)
    return
  }
  if (props.busy || bulkBusy.value) return
  bulkBusy.value = true
  bulkNoticeIsError.value = false
  bulkNotice.value = `正在批量导入 ${files.length} 个文件…`
  try {
    const outcome = await bulkImportRecordingFiles(files, {
      list: () => withNamespaceRetry(listRecordingLibrary),
      import: (file, fileName) => withNamespaceRetry(() => importRecording(file, fileName)),
    })
    extraItems.value = [...extraItems.value, ...outcome.imported]
    const parts = [`成功 ${outcome.imported.length}`]
    if (outcome.skipped.length) parts.push(`跳过 ${outcome.skipped.length}`)
    if (outcome.failed.length) parts.push(`失败 ${outcome.failed.length}`)
    let notice = `批量导入完成：${parts.join(' / ')}`
    if (outcome.failed.length) notice += `（${[...new Set(outcome.failed.map(failure => `${failure.label}：${failure.reason}`))].join('；')}）`
    if (outcome.skipped.length) notice += '；重复录像已跳过，未覆盖库中既有条目'
    if (outcome.imported.length) notice += '；新导入录像可返回训练后重新打开录像库回放'
    // REC-COLLECT-01：合并包携带收藏清单时，导入完成后按目录名合并（重名并集不丢成员）
    let mergeFailed = false
    if (outcome.collections?.length) {
      try {
        const items = await withNamespaceRetry(listRecordingLibrary)
        const summaries: string[] = []
        for (const manifest of outcome.collections) {
          const summary = await withNamespaceRetry(() => importCollectionsManifest(manifest, items))
          summaries.push(`收藏目录已合并：新建目录 ${summary.createdCollections} 个、合并目录 ${summary.mergedCollections} 个、恢复成员 ${summary.resolvedMembers} 条`
            + (summary.skippedMembers ? `（跳过无法解析成员 ${summary.skippedMembers} 条）` : ''))
        }
        notice += `；${summaries.join('；')}`
        await refreshCollections()
      } catch (error) {
        notice += `；收藏目录合并失败：${error instanceof Error ? error.message : String(error)}`
        mergeFailed = true
      }
    }
    bulkNotice.value = notice
    bulkNoticeIsError.value = outcome.failed.length > 0 || mergeFailed
  } catch (error) {
    bulkNotice.value = error instanceof Error ? error.message : '无法批量导入录像'
    bulkNoticeIsError.value = true
  } finally { bulkBusy.value = false }
}
const formatDate = (value: string) => new Date(value).toLocaleString()
</script>

<template>
  <section class="recording-library-page" aria-label="训练录像库">
    <header class="recording-library-header">
      <div>
        <h1>训练录像</h1>
        <p>本机训练录像与导入的分享录像分开保存，互不覆盖。</p>
      </div>
      <button type="button" class="ghost-button icon-text-button" @click="emit('close')"><ArrowLeft :size="15" />返回训练</button>
    </header>

    <div class="recording-library-actions">
      <label class="recording-import"><Upload :size="15" />导入分享的录像
        <input type="file" accept=".json,.gz,.trainer-session" aria-label="导入录制" multiple :disabled="busy || bulkBusy" @change="onImport" />
      </label>
      <button type="button" class="recording-import" :disabled="busy || bulkBusy || !displayItems.length" @click="exportAll"><Download :size="15" />全部导出</button>
      <span v-if="initializing" role="status">正在准备录像库，就绪后可导入与管理录像…</span>
      <span v-else-if="busy || bulkBusy" role="status">正在处理录像…</span>
      <p v-if="bulkNotice" :class="bulkNoticeIsError ? 'error-text' : ''" :role="bulkNoticeIsError ? 'alert' : 'status'">{{ bulkNotice }}</p>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    </div>

    <nav class="recording-collections-bar" aria-label="收藏目录">
      <span class="recording-collections-title">目录</span>
      <button type="button" class="collection-chip" :class="{ 'collection-chip-active': selectedCollectionId === null }" :aria-pressed="selectedCollectionId === null" @click="selectedCollectionId = null">全部 ({{ displayItems.length }})</button>
      <span v-for="collection in collections" :key="collection.id" class="collection-chip-wrap">
        <button type="button" class="collection-chip" :class="{ 'collection-chip-active': selectedCollectionId === collection.id }" :aria-pressed="selectedCollectionId === collection.id" :data-collection-id="collection.id" @click="selectedCollectionId = selectedCollectionId === collection.id ? null : collection.id">
          <Star v-if="collection.kind === 'builtin'" :size="12" aria-hidden="true" /> {{ collection.name }} ({{ memberCount(collection.id) }})
        </button>
        <button v-if="collection.kind === 'user'" type="button" class="icon-button collection-manage" :aria-label="`重命名目录：${collection.name}`" :title="`重命名目录：${collection.name}`" @click="openRenameForm(collection)"><Pencil :size="12" aria-hidden="true" /></button>
        <button v-if="collection.kind === 'user'" type="button" class="icon-button collection-manage" :aria-label="`删除目录：${collection.name}`" :title="`删除目录：${collection.name}`" @click="pendingCollectionRemoval = collection"><Trash2 :size="12" aria-hidden="true" /></button>
      </span>
      <button type="button" class="ghost-button" @click="openCreateForm">新建目录</button>
      <form v-if="collectionForm" class="collection-form" @submit.prevent="submitCollectionForm">
        <input v-model="collectionForm.name" type="text" aria-label="目录名称" :placeholder="collectionForm.mode === 'create' ? '输入新目录名称' : '输入新的目录名称'" />
        <button type="submit" class="ghost-button">保存</button>
        <button type="button" class="ghost-button" @click="collectionForm = null">取消</button>
        <p v-if="collectionForm.error" class="error-text" role="alert">{{ collectionForm.error }}</p>
      </form>
      <p v-if="collectionsError" class="error-text" role="alert">{{ collectionsError }}</p>
    </nav>

    <div class="recording-library-columns">
      <section class="recording-library-column" data-recording-source="local" aria-labelledby="local-recordings-heading">
        <div class="recording-library-column-header">
          <h2 id="local-recordings-heading">本机训练录像 <span>({{ localItems.length }})</span></h2>
          <button type="button" class="ghost-button danger-button" :disabled="!localItems.length || busy" @click="askClear('local', localItems.length)">清空本机录像</button>
        </div>
        <p v-if="!localItems.length" class="recording-library-empty" role="status"><strong>还没有保存的本机训练录像</strong><span>训练时开启「记录操作」，结束后选择保留，即可在这里回放。</span></p>
        <ul v-else class="recording-history-list">
          <li v-for="item in localItems" :key="item.sessionId" class="recording-history-item">
            <button type="button" class="recording-star icon-button" :disabled="busy" :aria-pressed="isStarred(item)" :aria-label="isStarred(item) ? '移出收藏' : '加入收藏'" :title="isStarred(item) ? '移出收藏' : '加入收藏'" @click="toggleStar(item)"><Star :size="15" aria-hidden="true" :fill="isStarred(item) ? 'currentColor' : 'none'" /></button>
            <button type="button" class="recording-history-open" @click="emit('replay', item.sessionId)">
              <strong>{{ formatDate(item.createdAt) }}</strong>
              <span>
                <em v-if="briefs[item.trainingKey ?? '']?.stock" class="recording-item-brief">{{ briefs[item.trainingKey ?? '']?.stock }}</em>
                <span v-if="briefs[item.trainingKey ?? '']?.random" class="random-mode-badge">随机模式</span>
                {{ item.eventCount }} 个事件 · 查看回放 →
              </span>
            </button>
            <button type="button" class="icon-button" :disabled="busy" :aria-expanded="archivingKey === rowKey(item)" aria-label="归档到目录" title="归档到目录" @click="toggleArchivePanel(item)"><FolderPlus :size="15" aria-hidden="true" /></button>
            <button type="button" class="recording-delete icon-button" :disabled="busy || isActive(item.sessionId)" :title="isActive(item.sessionId) ? '活动录像不能删除' : '删除录像'" :aria-label="isActive(item.sessionId) ? '活动录像不能删除' : '删除录像'" @click="askRemove(item)"><Trash2 :size="15" /></button>
            <div v-if="archivingKey === rowKey(item)" class="recording-archive-panel" role="group" aria-label="归档到目录">
              <label v-for="collection in collections" :key="collection.id" class="recording-archive-option">
                <input type="checkbox" :aria-label="collection.name" :checked="isMember(collection.id, rowKey(item))" :disabled="collectionBusy" @change="onArchiveChange(collection, item, $event)" />
                {{ collection.name }}
              </label>
              <button type="button" class="ghost-button" @click="archivingKey = ''">收起归档</button>
            </div>
          </li>
        </ul>
      </section>

      <section class="recording-library-column" data-recording-source="imported" aria-labelledby="imported-recordings-heading">
        <div class="recording-library-column-header">
          <h2 id="imported-recordings-heading">导入的分享录像 <span>({{ importedItems.length }})</span></h2>
          <button type="button" class="ghost-button danger-button" :disabled="!importedItems.length || busy" @click="askClear('imported', importedItems.length)">清空导入录像</button>
        </div>
        <p v-if="!importedItems.length" class="recording-library-empty" role="status"><strong>还没有导入分享录像</strong><span>使用上方「导入分享的录像」，打开收到的录像文件。</span></p>
        <ul v-else class="recording-history-list">
          <li v-for="item in importedItems" :key="item.sessionId" class="recording-history-item">
            <button type="button" class="recording-star icon-button" :disabled="busy" :aria-pressed="isStarred(item)" :aria-label="isStarred(item) ? '移出收藏' : '加入收藏'" :title="isStarred(item) ? '移出收藏' : '加入收藏'" @click="toggleStar(item)"><Star :size="15" aria-hidden="true" :fill="isStarred(item) ? 'currentColor' : 'none'" /></button>
            <button type="button" class="recording-history-open" @click="emit('replay', item.sessionId)">
              <strong>{{ item.fileName || formatDate(item.createdAt) }}</strong>
              <span>
                <em v-if="briefs[item.trainingKey ?? '']?.stock" class="recording-item-brief">{{ briefs[item.trainingKey ?? '']?.stock }}</em>
                <span v-if="briefs[item.trainingKey ?? '']?.random" class="random-mode-badge">随机模式</span>
                {{ item.eventCount }} 个事件 · {{ formatDate(item.createdAt) }} · 查看回放 →
              </span>
            </button>
            <button type="button" class="icon-button" :disabled="busy" :aria-expanded="archivingKey === rowKey(item)" aria-label="归档到目录" title="归档到目录" @click="toggleArchivePanel(item)"><FolderPlus :size="15" aria-hidden="true" /></button>
            <button type="button" class="recording-delete icon-button" :disabled="busy || isActive(item.sessionId)" :title="isActive(item.sessionId) ? '活动录像不能删除' : '删除录像'" :aria-label="isActive(item.sessionId) ? '活动录像不能删除' : '删除录像'" @click="askRemove(item)"><Trash2 :size="15" /></button>
            <div v-if="archivingKey === rowKey(item)" class="recording-archive-panel" role="group" aria-label="归档到目录">
              <label v-for="collection in collections" :key="collection.id" class="recording-archive-option">
                <input type="checkbox" :aria-label="collection.name" :checked="isMember(collection.id, rowKey(item))" :disabled="collectionBusy" @change="onArchiveChange(collection, item, $event)" />
                {{ collection.name }}
              </label>
              <button type="button" class="ghost-button" @click="archivingKey = ''">收起归档</button>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <div v-if="confirming" class="recording-confirm-overlay" role="alertdialog" aria-modal="true" aria-label="确认删除录像">
      <div class="recording-confirm-panel">
        <h2>确认删除？</h2>
        <p>{{ confirming.kind === 'source' ? `将删除全部${confirming.label}，此操作不可撤销。` : `将删除 ${confirming.label}，此操作不可撤销。` }}</p>
        <div class="recording-confirm-actions">
          <button type="button" class="ghost-button" @click="confirming = null">取消</button>
          <button type="button" class="danger-button" @click="confirmRemoval">确认删除</button>
        </div>
      </div>
    </div>

    <div v-if="pendingCollectionRemoval" class="recording-confirm-overlay" role="alertdialog" aria-modal="true" aria-label="确认删除目录">
      <div class="recording-confirm-panel">
        <h2>确认删除目录？</h2>
        <p>将删除目录「{{ pendingCollectionRemoval.name }}」并移除其全部成员关系；录像本身不会被删除，此操作不可撤销。</p>
        <div class="recording-confirm-actions">
          <button type="button" class="ghost-button" @click="pendingCollectionRemoval = null">取消</button>
          <button type="button" class="danger-button" @click="confirmCollectionRemoval">确认删除</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.recording-library-page { padding: 24px; }
.recording-library-header { align-items: flex-start; }
.recording-library-header h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: -.02em; }
.recording-library-header p { margin: 0; color: var(--text-secondary); line-height: 1.6; }
.recording-library-header > button { flex-shrink: 0; }
.recording-library-header, .recording-library-column-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.recording-library-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin: 24px 0; }
.recording-import, .icon-text-button { display: inline-flex; align-items: center; gap: 7px; }
.recording-import { position: relative; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; padding: 8px 12px; color: inherit; cursor: pointer; }
.recording-import input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.recording-import:focus-within { outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: 3px; }
.icon-button { display: inline-grid; place-items: center; min-width: 30px; min-height: 30px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; }
.icon-button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 12%, transparent); }
.icon-button:disabled { opacity: .45; cursor: not-allowed; }
.recording-library-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.recording-library-column { min-width: 0; padding: 16px; }
.recording-library-column h2 { margin: 0; font-size: 1rem; }
.recording-library-column h2 span { color: var(--text-secondary, #64748b); font-weight: 400; }
.recording-library-empty { display: grid; gap: 8px; padding: 28px 0; color: var(--text-secondary, #64748b); line-height: 1.7; }
.recording-library-empty strong { color: var(--text-primary); font-weight: 500; }
.recording-history-list { display: grid; gap: 8px; list-style: none; padding: 0; margin: 14px 0 0; }
.recording-history-item { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; padding: 8px 10px; }
.recording-history-open { flex: 1; min-width: 0; display: grid; gap: 6px; color: inherit; background: transparent; border: 0; text-align: left; cursor: pointer; overflow-wrap: anywhere; line-height: 1.6; }
.recording-history-open span { color: var(--text-secondary, #64748b); }
/* RF-05 录像库标注：真实标的（斜体弱化）＋「随机模式」tag 胶囊 */
.recording-item-brief { font-style: normal; margin-right: 6px; color: var(--text-primary, #25364b); }
.random-mode-badge { display: inline-flex; margin-right: 6px; padding: 1px 7px; border-radius: 999px; border: 1px solid #b7d9d0; background: #eef8f4; color: #1f7a5c; font-size: var(--font-size-2xs); font-weight: 600; }
:global(body.dark .random-mode-badge){ border-color: #2b5c49; background: #14271f; color: #7ec8a8; }
.recording-delete, .danger-button { color: #e47777; }
.recording-confirm-overlay { position: fixed; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / .55); z-index: 20; }
.recording-confirm-panel { width: min(420px, calc(100vw - 32px)); padding: 20px; border: 1px solid var(--surface-border, #444); border-radius: 8px; background: var(--surface-background, #181818); color: var(--text-primary, #eee); }
.recording-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
/* REC-COLLECT-01 收藏目录条与条目操作（复用既有表面边框/次级文本 token） */
.recording-collections-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 0 0 18px; }
.recording-collections-title { color: var(--text-secondary, #64748b); font-size: var(--font-size-2xs); }
.collection-chip-wrap { display: inline-flex; align-items: center; gap: 2px; }
.collection-chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 999px; background: transparent; color: inherit; cursor: pointer; font-size: var(--font-size-2xs); }
.collection-chip:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.collection-chip-active { border-color: var(--focus-ring-color); font-weight: 600; }
.collection-manage { min-width: 24px; min-height: 24px; }
.collection-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.collection-form input { padding: 5px 8px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; background: transparent; color: inherit; }
.recording-star[aria-pressed="true"] { color: #b8860b; }
:global(body.dark .recording-star[aria-pressed="true"]) { color: #f5c518; }
.recording-archive-panel { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding-top: 8px; border-top: 1px dashed var(--surface-border, #dfe5eb); }
.recording-archive-option { display: inline-flex; align-items: center; gap: 5px; font-size: var(--font-size-2xs); color: var(--text-secondary, #64748b); cursor: pointer; }
@media (max-width: 900px) { .recording-library-columns { grid-template-columns: 1fr; } }
</style>
