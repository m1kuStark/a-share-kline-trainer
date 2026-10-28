<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

/** REC-COLLECT-01 UI v2 锚定浮层壳：portal（Teleport to body）＋fixed 锚定触发器可视矩形，
 * 下方空间不足向上翻转；列表滚动/窗口缩放时重定位，触发器脱离文档即关闭；
 * Esc/点外部关闭（关闭后的焦点返回由父层负责——壳只报告关闭意图）。
 * 同一时刻仅一个浮层由父层单实例状态保证（开新关旧）。 */
const props = defineProps<{ anchor: HTMLElement }>()
const emit = defineEmits<{ close: [] }>()
const shell = ref<HTMLElement | null>(null)
const placement = ref({ left: '-9999px', top: '-9999px' })

function reposition(): void {
  const host = shell.value
  if (!host) return
  const anchorEl = props.anchor
  if (!anchorEl.isConnected) { emit('close'); return }
  const rect = anchorEl.getBoundingClientRect()
  const margin = 6
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - host.offsetWidth - 8))
  let top = rect.bottom + margin
  if (top + host.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - host.offsetHeight - margin)
  placement.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }
}
function onDocKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  emit('close')
}
function onDocPointerDown(event: PointerEvent): void {
  const target = event.target as Node | null
  if (!target) return
  if (shell.value?.contains(target) || props.anchor.contains(target)) return
  emit('close')
}
onMounted(() => {
  void nextTick(reposition)
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, true)
  document.addEventListener('keydown', onDocKeydown, true)
  document.addEventListener('pointerdown', onDocPointerDown, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', reposition)
  window.removeEventListener('scroll', reposition, true)
  document.removeEventListener('keydown', onDocKeydown, true)
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <Teleport to="body">
    <div ref="shell" class="anchored-popover" :style="placement" @keydown.esc.stop.prevent="emit('close')">
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.anchored-popover { position: fixed; z-index: 30; min-width: 220px; max-width: min(380px, calc(100vw - 16px)); border: 1px solid var(--surface-border, #dfe5eb); border-radius: 8px; background: var(--surface-background, #fff); color: var(--text-primary, inherit); box-shadow: 0 10px 28px rgb(0 0 0 / .18); }
</style>
