<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { appMaSettings, MA_MAX_PERIOD, MA_PRESETS, maPreset, maValidationError, saveMaSettings } from '../maSettings'

const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const firstInput = ref<HTMLInputElement[]>([])
const draft = ref({ version: 1 as const, lines: appMaSettings.value.lines.map(line => ({ ...line })) })
const error = ref('')
const previousFocus = document.activeElement as HTMLElement | null
onMounted(() => { dialog.value?.showModal(); firstInput.value[0]?.focus() })
onUnmounted(() => { dialog.value?.close(); previousFocus?.focus() })
function apply(): void {
  error.value = maValidationError(draft.value) ?? ''
  if (error.value) return
  try { saveMaSettings(draft.value); emit('close') }
  catch { error.value = '无法保存均线设置，请检查浏览器是否允许本地存储后重试。' }
}
function preset(periods?: readonly number[]): void { draft.value = maPreset(periods); error.value = '' }
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="ma-dialog" aria-labelledby="ma-title" aria-describedby="ma-description" @cancel.prevent="emit('close')" @keydown.stop>
      <form @submit.prevent="apply" novalidate>
        <header><h2 id="ma-title">均线参数</h2><button type="button" aria-label="关闭均线设置" @click="emit('close')">×</button></header>
        <p id="ma-description">日、周、月共用 · 0 表示关闭</p>
        <div class="ma-presets" aria-label="常用均线组合"><button v-for="item in MA_PRESETS" :key="item.label" type="button" @click="preset(item.periods)">{{ item.label }}</button></div>
        <div class="ma-columns"><span>均线</span><span>周期（K 线根数）</span><span>颜色</span></div>
        <label v-for="(line, index) in draft.lines" :key="index" class="ma-row">
          <span>第 {{ index + 1 }} 条</span>
          <input ref="firstInput" v-model.number="line.period" :aria-label="`第 ${index + 1} 条均线周期`" type="number" min="0" :max="MA_MAX_PERIOD" step="1">
          <input v-model="line.color" :aria-label="`第 ${index + 1} 条均线颜色`" type="color">
        </label>
        <p class="ma-note">按收盘价计算简单移动平均；历史不足时暂不显示数值。</p>
        <p v-if="error" class="ma-error" role="alert">{{ error }}</p>
        <footer><button type="button" @click="preset()">恢复默认</button><span></span><button type="button" @click="emit('close')">取消</button><button type="submit" class="ma-apply">应用</button></footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.ma-dialog { width: min(430px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); overflow: auto; margin: auto; padding: 22px; border: 1px solid var(--surface-border); border-radius: 12px; background: var(--surface-background); color: var(--text-primary); box-shadow: 0 20px 70px #0006; }
.ma-dialog::backdrop { background: #0007; }
header, footer { display: flex; align-items: center; gap: 10px; }
h2 { font-size: 18px; margin: 0; flex: 1; }
button { border: 1px solid var(--surface-border); border-radius: 5px; background: var(--control-background); color: var(--text-primary); padding: 7px 10px; font-size: 12px; }
button:hover { background: var(--surface-hover); }
button:focus-visible, input:focus-visible { outline: 2px solid #54b8cc; outline-offset: 2px; }
header button { border: 0; font-size: 22px; padding: 0 6px; }
p { color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.ma-presets { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0; }
.ma-columns, .ma-row { display: grid; grid-template-columns: 65px 1fr 52px; align-items: center; gap: 12px; }
.ma-columns { font-size: 11px; color: var(--text-secondary); margin-bottom: 8px; }
.ma-row { padding: 5px 0; font-size: 13px; }
input { width: 100%; min-width: 0; height: 32px; border: 1px solid var(--surface-border); border-radius: 4px; background: var(--control-background); color: var(--text-primary); padding: 4px 8px; }
input[type=color] { padding: 3px; cursor: pointer; }
.ma-note { margin: 14px 0; }
.ma-error { color: #ef4444; }
footer { padding-top: 12px; border-top: 1px solid var(--surface-border); }
footer span { flex: 1; }
.ma-apply { background: #26798c; border-color: #26798c; color: #fff; }
</style>
