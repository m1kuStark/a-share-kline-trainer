<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, Trash2, Upload } from 'lucide-vue-next'
import type { RecordingLibraryItem, RecordingSource } from '../recording/recordingRepository'

const props = withDefaults(defineProps<{
  items: RecordingLibraryItem[]
  busy?: boolean
  error?: string
  activeSessionIds?: string[]
}>(), { busy: false, error: '', activeSessionIds: () => [] })

const emit = defineEmits<{
  replay: [sessionId: string]
  import: [file: File]
  remove: [sessionId: string]
  clear: [source: RecordingSource]
  close: []
}>()

const localItems = computed(() => props.items.filter(item => item.source === 'local'))
const importedItems = computed(() => props.items.filter(item => item.source === 'imported'))
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
const onImport = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('import', file)
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
        <input type="file" accept=".json,.gz,.trainer-session" aria-label="导入录制" :disabled="busy" @change="onImport" />
      </label>
      <span v-if="busy" role="status">正在处理录像…</span>
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
              <strong>{{ formatDate(item.createdAt) }}</strong><span>{{ item.eventCount }} 个事件 · 查看回放 →</span>
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
              <strong>{{ item.fileName || formatDate(item.createdAt) }}</strong><span>{{ item.eventCount }} 个事件 · {{ formatDate(item.createdAt) }} · 查看回放 →</span>
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
.recording-delete, .danger-button { color: #e47777; }
.recording-confirm-overlay { position: fixed; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / .55); z-index: 20; }
.recording-confirm-panel { width: min(420px, calc(100vw - 32px)); padding: 20px; border: 1px solid var(--surface-border, #444); border-radius: 8px; background: var(--surface-background, #181818); color: var(--text-primary, #eee); }
.recording-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
@media (max-width: 900px) { .recording-library-columns { grid-template-columns: 1fr; } }
</style>
