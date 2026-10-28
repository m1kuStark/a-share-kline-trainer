<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import type { RecordingCollection } from '../../recording/collectionTypes'
import AnchoredPopover from './AnchoredPopover.vue'

/** REC-COLLECT-01 UI v2「加入目录」锚定弹层（方案 A，2026-10-29 拍板）。
 * 清单只含用户目录（父层传入前已过滤——内置收藏绝不在归类清单，星标是收藏唯一写入口）；
 * 勾选即 assign/取消即 unassign（乐观更新，失败显式回正＋底部 role=alert 就地报错）；
 * 底部「＋新建目录并加入」内联输入（重名/空白就地报错，成功即勾选新目录）；
 * 目录≥8 出过滤框（Spotify 教训）；0 目录空态引导＋新建输入首焦点；
 * Esc/点外部/✕ 关闭（焦点返回触发按钮由父层负责）。行级单键与批量多键共用本弹层。 */
const props = defineProps<{
  anchor: HTMLElement
  collections: RecordingCollection[]
  membershipsBy: Record<string, string[]>
  recordingKeys: string[]
  batch: boolean
  applyToggle: (collectionId: string, recordingKeys: string[], assign: boolean) => Promise<{ ok: boolean; message?: string }>
  applyCreate: (name: string, recordingKeys: string[]) => Promise<{ ok: boolean; message?: string; collectionId?: string }>
}>()
const emit = defineEmits<{ close: [] }>()

/** 过滤框出现阈值（拍板默认：≥8 个用户目录；目录少时保持弹层极简） */
const FILTER_THRESHOLD = 8
const filterText = ref('')
const toggleError = ref('')
const pendingId = ref('')
// 初始勾选态＝全部目标键都已加入的目录（单条=该键成员关系；批量=全选中键的共同归属）
const checkedIds = ref(new Set<string>(props.collections
  .filter(collection => props.recordingKeys.every(key => (props.membershipsBy[key] ?? []).includes(collection.id)))
  .map(collection => collection.id)))
const showFilter = computed(() => props.collections.length >= FILTER_THRESHOLD)
const filteredCollections = computed(() => {
  const needle = filterText.value.trim()
  if (!needle) return props.collections
  return props.collections.filter(collection => collection.name.includes(needle))
})
const createOpen = ref(props.collections.length === 0) // 0 目录空态：新建输入直接展开并首焦点
const createName = ref('')
const createError = ref('')
const createBusy = ref(false)
const createInput = ref<HTMLInputElement | null>(null)
const filterInput = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLUListElement | null>(null)

function focusFirstControl(): void {
  // 首焦点：过滤框（存在时）＞新建输入（空目录态）＞首个目录勾选框
  if (showFilter.value) { filterInput.value?.focus(); return }
  if (createOpen.value) { createInput.value?.focus(); return }
  ;(listEl.value?.querySelector('input[type="checkbox"]') as HTMLInputElement | null)?.focus()
}
onMounted(() => { void nextTick(focusFirstControl) })

async function onToggle(collection: RecordingCollection, event: Event): Promise<void> {
  const checked = (event.target as HTMLInputElement).checked
  toggleError.value = ''
  pendingId.value = collection.id
  // 乐观更新：先改本地勾选态；失败显式回正（存储真实态另经父层刷新兜底）
  if (checked) checkedIds.value.add(collection.id)
  else checkedIds.value.delete(collection.id)
  const result = await props.applyToggle(collection.id, props.recordingKeys, checked)
  pendingId.value = ''
  if (!result.ok) {
    if (checked) checkedIds.value.delete(collection.id)
    else checkedIds.value.add(collection.id)
    toggleError.value = result.message ?? '收藏目录操作失败'
  }
}
function openCreate(): void {
  createOpen.value = true
  void nextTick(() => createInput.value?.focus())
}
async function submitCreate(): Promise<void> {
  if (createBusy.value) return
  createError.value = ''
  createBusy.value = true
  const result = await props.applyCreate(createName.value, props.recordingKeys)
  createBusy.value = false
  if (!result.ok) {
    createError.value = result.message ?? '新建目录失败'
    return
  }
  if (result.collectionId) checkedIds.value.add(result.collectionId) // 成功即勾选新目录
  createName.value = ''
  createOpen.value = false
}
</script>

<template>
  <AnchoredPopover :anchor="anchor" @close="emit('close')">
    <div class="archive-popover" role="dialog" aria-label="加入目录">
      <div class="archive-popover-header">
        <h3>加入目录</h3>
        <p v-if="batch" class="archive-popover-sub">已选 {{ recordingKeys.length }} 项录像</p>
        <button type="button" class="icon-button" aria-label="关闭加入目录" title="关闭加入目录" @click="emit('close')"><X :size="14" aria-hidden="true" /></button>
      </div>
      <input v-if="showFilter" ref="filterInput" v-model="filterText" type="search" aria-label="过滤目录" placeholder="过滤目录…" />
      <p v-if="!collections.length" class="archive-popover-empty">还没有目录，新建一个开始整理</p>
      <ul v-else ref="listEl" class="archive-popover-list">
        <li v-for="collection in filteredCollections" :key="collection.id">
          <label>
            <input type="checkbox" :aria-label="collection.name" :checked="checkedIds.has(collection.id)" :disabled="pendingId === collection.id" @change="onToggle(collection, $event)" />
            <span>{{ collection.name }}</span>
          </label>
        </li>
        <li v-if="!filteredCollections.length" class="archive-popover-empty">无匹配目录</li>
      </ul>
      <form class="archive-popover-create" @submit.prevent="submitCreate">
        <button v-if="!createOpen" type="button" class="archive-create-toggle" @click="openCreate"><Plus :size="13" aria-hidden="true" />新建目录并加入</button>
        <template v-else>
          <input ref="createInput" v-model="createName" type="text" aria-label="新目录名称" placeholder="输入新目录名称" :disabled="createBusy" />
          <button type="submit" :disabled="createBusy">加入</button>
        </template>
        <p v-if="createError" role="alert">{{ createError }}</p>
      </form>
      <p v-if="toggleError" role="alert">{{ toggleError }}</p>
    </div>
  </AnchoredPopover>
</template>

<style scoped>
.archive-popover { display: grid; gap: 8px; padding: 10px 12px 12px; }
.archive-popover-header { display: flex; align-items: center; gap: 8px; }
.archive-popover-header h3 { margin: 0; font-size: var(--font-size-xs, 13px); }
.archive-popover-sub { margin: 0; color: var(--text-secondary, #64748b); font-size: var(--font-size-2xs, 12px); flex: 1; }
.archive-popover-header .icon-button { margin-left: auto; }
.archive-popover > input[type="search"] { padding: 5px 8px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; background: transparent; color: inherit; font-size: var(--font-size-2xs, 12px); }
.archive-popover-list { display: grid; gap: 2px; list-style: none; margin: 0; padding: 0; max-height: 264px; overflow-y: auto; }
.archive-popover-list li label { display: flex; align-items: center; gap: 8px; padding: 4px 4px; border-radius: 4px; cursor: pointer; font-size: var(--font-size-xs, 13px); }
.archive-popover-list li label:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
.archive-popover-list input { width: 15px; height: 15px; margin: 0; }
.archive-popover-empty { margin: 0; padding: 6px 4px; color: var(--text-secondary, #64748b); font-size: var(--font-size-2xs, 12px); }
.archive-popover-create { display: grid; gap: 6px; padding-top: 8px; border-top: 1px dashed var(--surface-border, #dfe5eb); }
.archive-create-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 5px 4px; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; font-size: var(--font-size-2xs, 12px); text-align: left; }
.archive-create-toggle:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.archive-popover-create input { padding: 5px 8px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; background: transparent; color: inherit; font-size: var(--font-size-2xs, 12px); }
.archive-popover-create button[type="submit"] { padding: 5px 12px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 5px; background: transparent; color: inherit; cursor: pointer; font-size: var(--font-size-2xs, 12px); }
.archive-popover p[role="alert"] { margin: 0; color: #e47777; font-size: var(--font-size-2xs, 12px); }
</style>
