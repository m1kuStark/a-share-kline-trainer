<script setup lang="ts">
import { Pencil, Trash2 } from 'lucide-vue-next'
import type { RecordingCollection } from '../../recording/collectionTypes'
import AnchoredPopover from './AnchoredPopover.vue'

/** REC-COLLECT-01 UI v2 目录 chip 溢出菜单（Gmail 标签 ⋮ 同构）：浏览态零常驻管理按钮，
 * 重命名/删除仅在用户显式打开本菜单后出现；删除走父层既有确认对话框（文案不变）。
 * portal 渲染以逃出目录条 overflow-x 滚动容器的裁剪。 */
defineProps<{ anchor: HTMLElement; collection: RecordingCollection }>()
const emit = defineEmits<{ close: []; rename: []; remove: [] }>()
</script>

<template>
  <AnchoredPopover :anchor="anchor" @close="emit('close')">
    <div class="chip-menu" role="menu" :aria-label="`管理目录：${collection.name}`">
      <button type="button" role="menuitem" @click="emit('rename')"><Pencil :size="13" aria-hidden="true" />重命名目录</button>
      <button type="button" role="menuitem" class="chip-menu-danger" @click="emit('remove')"><Trash2 :size="13" aria-hidden="true" />删除目录</button>
    </div>
  </AnchoredPopover>
</template>

<style scoped>
.chip-menu { display: grid; min-width: 148px; padding: 4px; }
.chip-menu button { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; text-align: left; font-size: var(--font-size-sm, 12px); }
.chip-menu button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.chip-menu-danger { color: #e47777; }
</style>
