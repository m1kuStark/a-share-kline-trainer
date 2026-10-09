<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Download, Trash2, Upload } from 'lucide-vue-next'
import { fetchTrainingSnapshot } from '../api'
import { bulkImportRecordingFiles, exportRecordingBundleFile, isRecordingBundleFile } from '../recording/bundle'
import { importRecording, listRecordingLibrary, loadLibraryRecording } from '../recording/recordingRepository'
import type { CompactRecordingFile } from '../recording/compactTypes'
import type { RecordingLibraryItem, RecordingSource } from '../recording/recordingRepository'

const props = withDefaults(defineProps<{
  items: RecordingLibraryItem[]
  busy?: boolean
  error?: string
  activeSessionIds?: string[]
}>(), { busy: false, error: '', activeSessionIds: () => [] })

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
onMounted(() => { void loadBriefs(displayItems.value) })
watch(displayItems, items => { void loadBriefs(items) })
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
const localItems = computed(() => displayItems.value.filter(item => item.source === 'local'))
const importedItems = computed(() => displayItems.value.filter(item => item.source === 'imported'))
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
    const blob = await exportRecordingBundleFile(files)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `训练录像库-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '')}.trainer-recordings.json`
    anchor.click()
    URL.revokeObjectURL(url)
    bulkNotice.value = `已导出 ${files.length} 份录像为合并包文件`
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
    bulkNotice.value = notice
    bulkNoticeIsError.value = outcome.failed.length > 0
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
      <span v-if="busy || bulkBusy" role="status">正在处理录像…</span>
      <p v-if="bulkNotice" :class="bulkNoticeIsError ? 'error-text' : ''" :role="bulkNoticeIsError ? 'alert' : 'status'">{{ bulkNotice }}</p>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    </div>

    <div class="recording-library-columns">
      <section class="recording-library-column" data-recording-source="local" aria-labelledby="local-recordings-heading">
        <div class="recording-library-column-header">
          <h2 id="local-recordings-heading">本机训练录像 <span>({{ localItems.length }})</span></h2>
          <button type="button" class="ghost-button danger-button" :disabled="!localItems.length || busy" @click="askClear('local', localItems.length)">清空本机录像</button>
        </div>
        <p v-if="!localItems.length" class="recording-library-empty">还没有保存的本机训练录像。</p>
        <ul v-else class="recording-history-list">
          <li v-for="item in localItems" :key="item.sessionId" class="recording-history-item">
            <button type="button" class="recording-history-open" @click="emit('replay', item.sessionId)">
              <strong>{{ formatDate(item.createdAt) }}</strong>
              <span>
                <em v-if="briefs[item.trainingKey ?? '']?.stock" class="recording-item-brief">{{ briefs[item.trainingKey ?? '']?.stock }}</em>
                <span v-if="briefs[item.trainingKey ?? '']?.random" class="random-mode-badge">随机模式</span>
                {{ item.eventCount }} 个事件 · 查看回放 →
              </span>
            </button>
            <button type="button" class="recording-delete icon-button" :disabled="busy || isActive(item.sessionId)" :title="isActive(item.sessionId) ? '活动录像不能删除' : '删除录像'" :aria-label="isActive(item.sessionId) ? '活动录像不能删除' : '删除录像'" @click="askRemove(item)"><Trash2 :size="15" /></button>
          </li>
        </ul>
      </section>

      <section class="recording-library-column" data-recording-source="imported" aria-labelledby="imported-recordings-heading">
        <div class="recording-library-column-header">
          <h2 id="imported-recordings-heading">导入的分享录像 <span>({{ importedItems.length }})</span></h2>
          <button type="button" class="ghost-button danger-button" :disabled="!importedItems.length || busy" @click="askClear('imported', importedItems.length)">清空导入录像</button>
        </div>
        <p v-if="!importedItems.length" class="recording-library-empty">还没有导入分享录像。</p>
        <ul v-else class="recording-history-list">
          <li v-for="item in importedItems" :key="item.sessionId" class="recording-history-item">
            <button type="button" class="recording-history-open" @click="emit('replay', item.sessionId)">
              <strong>{{ item.fileName || formatDate(item.createdAt) }}</strong>
              <span>
                <em v-if="briefs[item.trainingKey ?? '']?.stock" class="recording-item-brief">{{ briefs[item.trainingKey ?? '']?.stock }}</em>
                <span v-if="briefs[item.trainingKey ?? '']?.random" class="random-mode-badge">随机模式</span>
                {{ item.eventCount }} 个事件 · {{ formatDate(item.createdAt) }} · 查看回放 →
              </span>
            </button>
            <button type="button" class="recording-delete icon-button" :disabled="busy || isActive(item.sessionId)" :title="isActive(item.sessionId) ? '活动录像不能删除' : '删除录像'" :aria-label="isActive(item.sessionId) ? '活动录像不能删除' : '删除录像'" @click="askRemove(item)"><Trash2 :size="15" /></button>
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
  </section>
</template>

<style scoped>
.recording-library-page { padding: 24px; }
.recording-library-header, .recording-library-column-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.recording-library-actions { display: flex; align-items: center; gap: 14px; margin: 18px 0; }
.recording-import, .icon-text-button { display: inline-flex; align-items: center; gap: 7px; }
.recording-import { position: relative; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; padding: 8px 12px; color: inherit; cursor: pointer; }
.recording-import input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.icon-button { display: inline-grid; place-items: center; min-width: 30px; min-height: 30px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; }
.icon-button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 12%, transparent); }
.icon-button:disabled { opacity: .45; cursor: not-allowed; }
.recording-library-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.recording-library-column { min-width: 0; padding: 16px; }
.recording-library-column h2 { margin: 0; font-size: 1rem; }
.recording-library-column h2 span { color: var(--text-secondary, #64748b); font-weight: 400; }
.recording-library-empty { color: var(--text-secondary, #64748b); }
.recording-history-list { display: grid; gap: 8px; list-style: none; padding: 0; margin: 14px 0 0; }
.recording-history-item { display: flex; align-items: center; gap: 8px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; padding: 8px 10px; }
.recording-history-open { flex: 1; min-width: 0; display: flex; justify-content: space-between; gap: 12px; color: inherit; background: transparent; border: 0; text-align: left; cursor: pointer; }
.recording-history-open span { color: var(--text-secondary, #64748b); }
/* RF-05 录像库标注：真实标的（斜体弱化）＋「随机模式」tag 胶囊 */
.recording-item-brief { font-style: normal; margin-right: 6px; color: var(--text-primary, #25364b); }
.random-mode-badge { display: inline-flex; margin-right: 6px; padding: 1px 7px; border-radius: 999px; border: 1px solid #b7d9d0; background: #eef8f4; color: #1f7a5c; font-size: 10px; font-weight: 600; }
:global(body.dark) .random-mode-badge { border-color: #2b5c49; background: #14271f; color: #7ec8a8; }
.recording-delete, .danger-button { color: #e47777; }
.recording-confirm-overlay { position: fixed; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / .55); z-index: 20; }
.recording-confirm-panel { width: min(420px, calc(100vw - 32px)); padding: 20px; border: 1px solid var(--surface-border, #444); border-radius: 8px; background: var(--surface-background, #181818); color: var(--text-primary, #eee); }
.recording-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
@media (max-width: 900px) { .recording-library-columns { grid-template-columns: 1fr; } }
</style>
