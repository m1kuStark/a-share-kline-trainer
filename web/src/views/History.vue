<script setup lang="ts">
// M4-HISTORY-01 历史训练列表：只读分页查询 + 稳定排序展示。
// 请求版本守卫：迟到/失败响应不得覆盖新状态，也不得留下永续 loading（FM-014 教训）。
// 运行中训练存在时服务端 409 HISTORY_ACTIVE_TRAINING：展示守卫说明，可经侧栏返回当前训练。
import { computed, onMounted, ref } from 'vue'
import { ApiError, deleteTrainingHistory, fetchTrainingHistory, type HistoryItem } from '../api'
import HistoryReport from '../components/HistoryReport.vue'
import { buildHistoryRecordingLinks, type HistoryRecordingLink } from '../recording/historyLink'
import type { RecordingLibraryItem } from '../recording/libraryTypes'
import { listRecordingLibrary, loadLibraryRecording } from '../recording/recordingRepository'
import { writeRecordingFile } from '../recording/recordingFile'
import { downloadRecording } from '../recording/useRecording'

const props = defineProps<{ replayError?: string }>()
const emit = defineEmits<{ create: []; 'replay-recording': [item: RecordingLibraryItem] }>()

const items = ref<HistoryItem[]>([])
const total = ref(0)
const limit = ref(20)
const offset = ref(0)
const loading = ref(false)
const errorMessage = ref('')
const activeGuard = ref(false)
const selectedId = ref<number | null>(null)
const selectedIds = ref<number[]>([])
// FM-015/F2 三态归属：仅当"当前请求成功返回"后（loaded=true）才允许渲染空态或列表；
// 加载期间只显示加载态，不显示空态/列表/分页；失效响应不得回写任何状态。
const loaded = ref(false)
let loadVersion = 0

async function load(): Promise<void> {
  const requestVersion = ++loadVersion
  loading.value = true
  errorMessage.value = ''
  try {
    const payload = await fetchTrainingHistory({ limit: limit.value, offset: offset.value })
    if (requestVersion !== loadVersion) return
    items.value = payload.items
    total.value = payload.total
    limit.value = payload.limit
    offset.value = payload.offset
    activeGuard.value = false
    loaded.value = true
  } catch (error) {
    if (requestVersion !== loadVersion) return
    if (error instanceof ApiError && error.code === 'HISTORY_ACTIVE_TRAINING') {
      activeGuard.value = true
      items.value = []
      total.value = 0
      loaded.value = false
    } else {
      errorMessage.value = error instanceof Error ? error.message : '无法读取历史训练'
    }
  } finally {
    if (requestVersion === loadVersion) loading.value = false
  }
}
onMounted(() => { void load() })

const hasPrev = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + limit.value < total.value)
const rangeText = computed(() => total.value === 0 ? '' : `第 ${offset.value + 1}~${Math.min(offset.value + items.value.length, total.value)} 局 / 共 ${total.value} 局`)
function turnPage(direction: -1 | 1): void {
  const next = offset.value + direction * limit.value
  if (next < 0 || (direction === 1 && next >= total.value)) return
  offset.value = next
  void load()
}

const TIER_LABELS: Record<string, string> = { '1M': '1个月', '3M': '3个月', '6M': '6个月', '1Y': '1年', '2Y': '2年' }
// random＝M7 随机训练（结算后真实信息已揭晓，档位标签不再误报「自定义范围」）
const RANGE_MODE_LABELS: Record<string, string> = { preset: '自定义·预设', latest: '自定义·到最新', bars: '自定义·日K根数', random: '随机模式' }
function tierText(item: HistoryItem): string {
  return item.tier === 'RANGE' ? (RANGE_MODE_LABELS[item.rangeMode] ?? '自定义范围') : (TIER_LABELS[item.tier] ?? item.tier)
}
function classificationText(item: HistoryItem): string {
  return item.classification === 'early-settled' ? '提前结算' : '到期结算'
}
function money(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'
}
function percentText(item: HistoryItem): string {
  if (typeof item.returnRate !== 'number' || !Number.isFinite(item.returnRate)) return '--'
  const percent = item.returnRate * 100
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
}
function toggleSelected(id: number): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter(value => value !== id)
    : [...selectedIds.value, id]
}
function togglePageSelection(): void {
  const ids = items.value.map(item => item.id)
  selectedIds.value = ids.every(id => selectedIds.value.includes(id))
    ? selectedIds.value.filter(id => !ids.includes(id))
    : [...new Set([...selectedIds.value, ...ids])]
}
function isSelected(id: number): boolean { return selectedIds.value.includes(id) }
async function removeHistory(ids: number | number[]): Promise<void> {
  const list = typeof ids === 'number' ? [ids] : ids
  if (!list.length) return
  const prompt = list.length === 1 ? '确认删除这条训练记录？删除后无法恢复。' : `确认删除选中的 ${list.length} 条训练记录？删除后无法恢复。`
  if (!window.confirm(prompt)) return
  try {
    await deleteTrainingHistory(ids)
    selectedIds.value = selectedIds.value.filter(id => !list.includes(id))
    if (offset.value >= total.value - list.length && offset.value > 0) offset.value = Math.max(0, offset.value - limit.value)
    await load()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除历史记录失败'
  }
}

// REC-HIST-LINK：历史训练记录 ↔ 本机训练录像 关联呈现（用户 2026-10-12 拍板：
// 有录像可播可导出、无录像置灰加说明）。关联键＝录像侧 trainingKey 的训练 id 段
// （库主键，见 recording/historyLink.ts）；录像列表一次加载建 Map，行级渲染零查询。
const recordingLinks = ref(new Map<number, HistoryRecordingLink>())
const linksLoading = ref(false)
const linksError = ref('')
const exportingId = ref<number | null>(null)
const exportError = ref('')
// 壳层可能先于安装隔离初始化渲染（与 RecordingLibrary 同语义的短重试守卫）；
// 其余错误原样呈现，不得把读取失败静默当成零录像。
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
async function loadRecordingLinks(): Promise<void> {
  linksLoading.value = true
  linksError.value = ''
  try {
    recordingLinks.value = buildHistoryRecordingLinks(await withNamespaceRetry(listRecordingLibrary))
  } catch (error) {
    recordingLinks.value = new Map()
    linksError.value = error instanceof Error ? error.message : '无法读取本机录像库'
  } finally { linksLoading.value = false }
}
onMounted(() => { void loadRecordingLinks() })
function recordingLinkOf(item: HistoryItem): HistoryRecordingLink | null {
  return recordingLinks.value.get(item.id) ?? null
}
// 用户拍板口径的置灰说明：这些训练物理上早于录像功能，没有录像可放
const NO_RECORDING_TITLE = '该训练早于录像功能，无录像'
function replayTitle(item: HistoryItem): string {
  if (linksLoading.value) return '正在读取本机录像库…'
  const link = recordingLinkOf(item)
  if (!link) return NO_RECORDING_TITLE
  // 多会话分界披露：同一训练跨页面多次录制会有多份录像，播放/导出取最新一份
  return link.count > 1 ? `该训练有 ${link.count} 份录像会话，播放/导出最新一份` : '播放/导出本局的录像'
}
function playRecording(item: HistoryItem): void {
  const link = recordingLinkOf(item)
  if (linksLoading.value || !link) return
  emit('replay-recording', link.latest)
}
async function exportRecording(item: HistoryItem): Promise<void> {
  if (exportingId.value !== null) return
  const link = recordingLinkOf(item)
  if (linksLoading.value || !link) return
  exportingId.value = item.id
  exportError.value = ''
  try {
    const file = await loadLibraryRecording(link.latest)
    if (!file) throw new Error('找不到这份录像')
    // 复用既有单条导出链路（writeRecordingFile gzip 封装），不另造格式
    const blob = await writeRecordingFile(file, true)
    downloadRecording(blob, `历史训练-${item.id}-录像.trainer-session.json.gz`)
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : '无法导出本局录像'
  } finally { exportingId.value = null }
}
const linkedOnPage = computed(() => items.value.filter(item => recordingLinkOf(item) !== null).length)
</script>

<template>
  <section class="history-page" aria-label="历史训练">
    <header class="history-header">
      <div>
        <h1>历史训练</h1>
        <p>只读事实成绩单：来自已结算训练的持久记录，不重算、不改动。</p>
        <!-- REC-HIST-LINK 存储模型说明（proposed_default 文案）：历史与录像分处两库，
             「条数对不上」要有解释，不能让用户误以为读错目录。 -->
        <p class="history-storage-note">存储说明：训练历史保存在本机数据库，训练录像保存在浏览器的本地录像库，两者分开存储——历史条数多于录像条数属正常现象；有录像的训练行可直接播放或导出。</p>
      </div>
      <button class="ghost-button" @click="emit('create')">返回创建训练</button>
    </header>

    <div v-if="activeGuard" class="history-guard" role="status">
      <strong>结束当前训练后可查看历史</strong>
      <p>当前有进行中的训练。为避免旧局相同股票的记录泄漏当前局的未来行情，历史查询在训练进行期间关闭；可经左侧「训练」返回当前训练。</p>
    </div>

    <div v-else-if="errorMessage" class="history-error" role="alert">
      <p>{{ errorMessage }}</p>
      <button class="ghost-button" @click="load()">重试</button>
    </div>

    <!-- FM-015/F2：请求未完成时只显示加载态；仅成功响应后按 total 渲染空态或列表 -->
    <p v-else-if="loading" class="history-loading" role="status">加载中…</p>

    <template v-else>
      <p v-if="!total" class="history-empty">暂无已结算训练</p>
      <div v-else class="history-content">
        <p v-if="linksError" class="history-link-status" role="alert">本机录像库暂不可读：{{ linksError }}（录像关联暂不可用，不影响历史记录查看）</p>
        <p v-else-if="!linksLoading && items.length" class="history-link-status" role="status">本页 {{ linkedOnPage }}/{{ items.length }} 局有本机录像；其余训练早于录像功能，或录像已删除/未保留。</p>
        <p v-if="props.replayError" class="history-link-status" role="alert">{{ props.replayError }}</p>
        <p v-if="exportError" class="history-link-status" role="alert">{{ exportError }}</p>
        <div v-if="items.length" class="history-batch-actions">
          <label class="history-select-all"><input type="checkbox" :checked="items.every(item => isSelected(item.id))" @change="togglePageSelection" />全选本页</label>
          <button class="danger-button" :disabled="!selectedIds.length" @click="removeHistory(selectedIds)">删除选中（{{ selectedIds.length }}）</button>
        </div>
        <div class="history-list">
        <div v-for="item in items" :key="item.id" class="history-row" :class="{ unavailable: item.integrity === 'unavailable' }" :data-training-id="item.id" role="button" tabindex="0" @click="selectedId = item.id" @keydown.enter="selectedId = item.id">
          <input class="history-row-check" type="checkbox" :checked="isSelected(item.id)" :aria-label="`选择第 ${item.id} 局`" @click.stop @change="toggleSelected(item.id)" />
          <span class="history-row-title"><strong>{{ item.code }}</strong> {{ item.name }}<small v-if="item.rangeMode !== 'random'" class="history-range-label">{{ tierText(item) }}</small><small v-else class="random-mode-tag" title="本局来自随机模式训练">{{ tierText(item) }}</small></span>
          <span class="history-row-dates">{{ item.startDate }} ~ {{ item.settleDate ?? '未知' }}</span>
          <span class="history-row-classification" :class="item.classification">{{ classificationText(item) }}</span>
          <span class="history-row-money">{{ money(item.finalEquity) }}</span>
          <span class="history-row-return" :class="{ up: (item.returnRate ?? 0) > 0, down: (item.returnRate ?? 0) < 0 }">{{ percentText(item) }}</span>
          <span class="history-row-count">{{ item.tradeCount }} 笔</span>
          <span v-if="item.integrity === 'unavailable'" class="history-row-integrity" :title="item.integrityReason">不可认证</span>
          <button class="history-row-replay" type="button" :disabled="linksLoading || !recordingLinkOf(item)" :title="replayTitle(item)" :aria-label="`播放第 ${item.id} 局的录像`" @click.stop="playRecording(item)">播放录像</button>
          <button class="history-row-export" type="button" :disabled="linksLoading || !recordingLinkOf(item) || exportingId === item.id" :title="replayTitle(item)" :aria-label="`导出第 ${item.id} 局的录像`" @click.stop="exportRecording(item)">{{ exportingId === item.id ? '导出中…' : '导出录像' }}</button>
          <button class="history-row-delete" type="button" title="删除训练记录" aria-label="删除训练记录" @click.stop="removeHistory(item.id)">删除</button>
        </div>
        </div>
      </div>

      <div v-if="total" class="history-pagination">
        <button class="ghost-button" :disabled="!hasPrev || loading" @click="turnPage(-1)">上一页</button>
        <span class="history-range">{{ rangeText }}</span>
        <button class="ghost-button" :disabled="!hasNext || loading" @click="turnPage(1)">下一页</button>
      </div>
    </template>

    <!-- 详情与列表共存：可在多局间直接切换（A→B 迟到响应由版本守卫丢弃，不留永续 loading） -->
    <div v-if="selectedId !== null" class="report-modal-mask" role="presentation" @click.self="selectedId = null">
      <HistoryReport :id="selectedId" @close="selectedId = null" @back="selectedId = null" />
    </div>
  </section>
</template>

<style scoped>
/* RF-05 随机模式训练在历史列表中的 tag（胶囊形态区别于普通范围文字标签） */
.random-mode-tag { display: inline-flex; margin-left: 6px; padding: 1px 7px; border-radius: 999px; border: 1px solid #b7d9d0; background: #eef8f4; color: #1f7a5c; font-size: 10px; font-weight: 600; }
:global(body.dark) .random-mode-tag { border-color: #2b5c49; background: #14271f; color: #7ec8a8; }
/* REC-HIST-LINK：存储模型说明与录像关联状态行 */
.history-storage-note { margin: 6px 0 0; color: var(--text-secondary, #64748b); font-size: 12px; }
.history-link-status { margin: 0 0 10px; color: var(--text-secondary, #64748b); font-size: 12px; }
.history-link-status[role='alert'] { color: #a83535; }
:global(body.dark) .history-link-status[role='alert'] { color: #ffaaaa; }
/* 行级播放/导出按钮（样式对齐 history-row-delete 的轻量文字按钮；styles.css 不在本卡授权范围） */
.history-row-replay, .history-row-export { border: 0; background: transparent; color: #3a6ea5; cursor: pointer; font-size: 12px; white-space: nowrap; padding: 4px 6px; }
.history-row-replay:hover:not(:disabled), .history-row-export:hover:not(:disabled) { text-decoration: underline; }
.history-row-replay:disabled, .history-row-export:disabled { color: var(--text-secondary, #94a3b8); cursor: not-allowed; opacity: .55; }
:global(body.dark) .history-row-replay, :global(body.dark) .history-row-export { color: #7fa8d9; }
</style>
