<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchTradeNote, saveTradeNote as persistTradeNote, type TradeView } from './api'
import { buildListRow, buildTradeFacts } from './tradeMarkerDetails'

const props = defineProps<{
  /** 当前聚合内全部成交（单笔时只有一条，不显示列表；标记离屏时为空，仅显示选中事实） */
  trades: TradeView[]
  selected: TradeView
  pinned: boolean
  /** fixed 定位样式（由标记条按徽标位置换算，钳制在视口内） */
  position: Record<string, string>
  trainingId?: number
}>()

const emit = defineEmits<{
  select: [seq: number]
  togglePin: []
  pin: []
  close: []
  pointerEnter: []
  pointerLeave: []
  /** Teleport 根不透传 attrs：焦点事件必须在真实 div 上绑定后显式转发（FM-011/F2） */
  focusIn: []
  focusOut: [event: FocusEvent]
  saveNote: [value: string]
}>()

// 必须随 props.selected 响应：setup 期 const 会把首次方向固定（F1：B→S 标题不更新）
const sideLabel = computed(() => (props.selected.side === 'buy' ? '买入' : '卖出'))
const activeTab = ref<'trade' | 'note'>('trade')
const noteText = ref('')
const noteError = ref('')
const noteStorageKey = computed(() => `trainer.trade-note.${props.trainingId ?? 'current'}.${props.selected.date}.${props.selected.seq}`)
let noteRequest = 0
async function loadNote(): Promise<void> {
  const request = ++noteRequest
  if (props.trainingId !== undefined) {
    try {
      const result = await fetchTradeNote(props.trainingId, props.selected.seq)
      if (request === noteRequest) noteText.value = result.note
      return
    } catch { /* fallback keeps the panel usable when the server is unavailable */ }
  }
  try { if (request === noteRequest) noteText.value = localStorage.getItem(noteStorageKey.value) ?? '' } catch { noteText.value = '' }
}
watch([noteStorageKey, () => props.trainingId], () => { void loadNote() }, { immediate: true })
function showNote(): void {
  activeTab.value = 'note'
  emit('pin')
}
async function saveNote(): Promise<void> {
  noteError.value = ''
  if (props.trainingId !== undefined) {
    try { await persistTradeNote(props.trainingId, props.selected.seq, noteText.value) }
    catch { noteError.value = '笔记保存失败，请检查连接后重试'; return }
  }
  try { localStorage.setItem(noteStorageKey.value, noteText.value) } catch { /* storage unavailable */ }
  emit('saveNote', noteText.value)
}
</script>

<template>
  <Teleport to="body">
    <div
      class="trade-marker-details"
      :style="props.position"
      role="dialog"
      aria-label="成交详情"
      data-testid="trade-marker-details"
      @keydown.stop
      @keydown.esc.prevent="emit('close')"
      @pointerenter="emit('pointerEnter')"
      @pointerleave="emit('pointerLeave')"
      @focusin="emit('focusIn')"
      @focusout="emit('focusOut', $event)"
    >
      <div class="details-head">
        <strong>{{ sideLabel }}{{ props.trades.length > 1 ? ` · ${props.trades.length} 笔` : '' }}</strong>
        <span class="details-actions">
          <button
            type="button"
            class="details-pin"
            :aria-pressed="props.pinned ? 'true' : 'false'"
            :title="props.pinned ? '解除固定' : '固定'"
            @click="emit('togglePin')"
          >{{ props.pinned ? '已固定' : '固定' }}</button>
          <button type="button" class="details-close" aria-label="关闭" title="关闭" @click="emit('close')">✕</button>
        </span>
      </div>
      <div class="details-tabs" role="tablist" aria-label="成交信息与笔记">
        <button type="button" role="tab" :aria-selected="activeTab === 'trade'" :class="{ active: activeTab === 'trade' }" @click="activeTab = 'trade'">买卖数据</button>
        <button type="button" role="tab" :aria-selected="activeTab === 'note'" :class="{ active: activeTab === 'note' }" @click="showNote">笔记</button>
      </div>
      <ol v-if="props.trades.length > 1" class="details-list">
        <li v-for="item in props.trades" :key="item.seq">
          <button
            type="button"
            :class="{ selected: item.seq === props.selected.seq }"
            :aria-pressed="item.seq === props.selected.seq ? 'true' : 'false'"
            @click="emit('select', item.seq)"
          >{{ buildListRow(item) }}</button>
        </li>
      </ol>
      <dl v-if="activeTab === 'trade'" class="details-facts">
        <div v-for="fact in buildTradeFacts(props.selected)" :key="fact.label">
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
        </div>
      </dl>
      <div v-else class="details-note">
        <label for="trade-marker-note">本次交易笔记</label>
        <textarea id="trade-marker-note" v-model="noteText" rows="5" placeholder="记录买卖理由、盘面观察或复盘要点" />
        <p v-if="noteError" class="details-note-error" role="alert">{{ noteError }}</p>
        <button type="button" class="note-save" @click="saveNote">保存笔记</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.trade-marker-details {
  position: fixed;
  z-index: 40;
  width: 288px;
  max-width: calc(100vw - 16px);
  max-height: min(320px, calc(100vh - 16px));
  display: grid;
  gap: 6px;
  padding: 10px;
  overflow-y: auto;
  box-sizing: border-box;
  background: var(--surface-background, #ffffff);
  border: 1px solid var(--surface-border, #dfe5eb);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, .14);
  color: var(--text-primary, #334155);
  font-size: 12px;
}

.details-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.details-actions {
  display: inline-flex;
  gap: 6px;
}

.details-actions button {
  border: 1px solid var(--surface-border, #dfe5eb);
  background: var(--control-background, #ffffff);
  color: inherit;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
}

.details-actions button:hover {
  background: var(--surface-hover, #eef2f7);
}

.details-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--surface-border, #dfe5eb); }
.details-tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-secondary, #64748b); padding: 5px 8px; font: inherit; cursor: pointer; }
.details-tabs button.active { color: var(--text-primary, #334155); border-bottom-color: #2b8b99; font-weight: 650; }
.details-note { display: grid; gap: 6px; }
.details-note-error { margin: 0; color: #b3413a; font-size: 11px; }
.details-note label { color: var(--text-secondary, #64748b); }
.details-note textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 88px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 4px; padding: 7px; background: var(--control-background, #fff); color: var(--text-primary, #334155); font: inherit; }
.note-save { justify-self: end; border: 1px solid #2b8b99; border-radius: 4px; padding: 5px 10px; background: var(--surface-selected, #eaf5f6); color: var(--text-primary, #1c6076); cursor: pointer; }

.details-pin[aria-pressed="true"] {
  background: var(--surface-selected, #eef2f7);
  font-weight: 650;
}

.details-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 2px;
}

.details-list button {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 4px 6px;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.details-list button:hover {
  background: var(--surface-hover, #eef2f7);
}

.details-list button.selected {
  background: var(--surface-selected, #e8f1fb);
  font-weight: 650;
}

.details-facts {
  margin: 0;
  display: grid;
  gap: 3px;
}

.details-facts div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.details-facts dt {
  color: var(--text-secondary, #64748b);
}

.details-facts dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

:global(body.dark .trade-marker-details) {
  background: var(--surface-background, #16181d);
  border-color: var(--surface-border, #34383f);
  color: var(--text-primary, #e5e7eb);
}

:global(body.dark .details-actions button) {
  background: var(--control-background, #22252b);
  border-color: var(--surface-border, #34383f);
  color: var(--text-primary, #e5e7eb);
}

:global(body.dark .details-actions button:hover),
:global(body.dark .details-list button:hover) {
  background: #2a2e35;
}

/* F4：列表行浅色主题文字色不得带入深色主题（深字叠深底不可读） */
:global(body.dark .details-list button) {
  color: var(--text-primary, #e5e7eb);
}

:global(body.dark .details-list button.selected) {
  background: #263445;
}

:global(body.dark .details-facts dt) {
  color: var(--text-secondary, #9ca3af);
}

:global(body.dark .details-note-error) { color: #e08a80; }
</style>
