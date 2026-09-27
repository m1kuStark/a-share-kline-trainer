<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchTrainingSettings, putTrainingSettings, type TrainingSettingsView } from '../api'

// TRAIN-01 训练默认设置面板：局部弹层（不卸载正在录制的训练）。
// 保存成功给明确反馈；取消/失败不假称保存，也不改变任何进行中的训练。
// 默认只影响之后新建的训练；本局规则在创建时冻结。

const emit = defineEmits<{ close: [] }>()

const panelRef = ref<HTMLElement | null>(null)
const settings = ref<TrainingSettingsView | null>(null)
const loadError = ref('')
const saveError = ref('')
const saveSuccess = ref('')
const saving = ref(false)
const feesEnabled = ref(false)
const tPlusOne = ref(true)

onMounted(async () => {
  panelRef.value?.focus()
  try {
    const current = await fetchTrainingSettings()
    settings.value = current
    feesEnabled.value = current.feesEnabled
    tPlusOne.value = current.tPlusOne
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '无法读取训练默认设置'
  }
})

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  saveError.value = ''
  saveSuccess.value = ''
  try {
    const saved = await putTrainingSettings({ feesEnabled: feesEnabled.value, tPlusOne: tPlusOne.value })
    settings.value = saved
    feesEnabled.value = saved.feesEnabled
    tPlusOne.value = saved.tPlusOne
    saveSuccess.value = '已保存：新默认将应用于之后新建的训练，当前训练不受影响'
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败，设置未更改'
  } finally {
    saving.value = false
  }
}

function close(): void {
  // 取消不保存：本局与默认都不因关闭而改变
  emit('close')
}
</script>

<template>
  <div class="settings-mask" @click.self="close">
    <div ref="panelRef" class="settings-panel" role="dialog" aria-modal="true" aria-label="训练默认设置" tabindex="-1" @keydown.esc.prevent="close" @keydown.stop>
      <header class="settings-head">
        <h2>训练默认设置</h2>
        <button class="ghost-button" aria-label="关闭" title="关闭" @click="close">✕</button>
      </header>
      <p class="settings-note">这里的默认只影响新训练；进行中的训练按创建时冻结的规则继续。</p>
      <p v-if="loadError" class="error-text" role="alert">{{ loadError }}</p>
      <template v-if="settings">
        <label class="settings-row">
          <input v-model="feesEnabled" type="checkbox" aria-label="新训练收取手续费（佣金/印花税）" />
          <span class="settings-row-text">
            <strong>收取手续费</strong>
            <small>佣金万分之 2.5（最低 5 元），卖出另收万分之 5 印花税。默认关闭。</small>
          </span>
        </label>
        <label class="settings-row">
          <input v-model="tPlusOne" type="checkbox" aria-label="新训练启用 T+1（当日买入次日可卖）" />
          <span class="settings-row-text">
            <strong>T+1 限制</strong>
            <small>当日买入的股票次一交易日才能卖出。默认开启。</small>
          </span>
        </label>
        <div class="settings-fixed">
          <span>固定口径（不可修改）：一手 {{ settings.lotSize }} 股 · 买入仓位按总权益 · 按当日原始收盘价成交</span>
        </div>
        <p v-if="saveError" class="error-text" role="alert">{{ saveError }}</p>
        <p v-if="saveSuccess" class="settings-saved" role="status">{{ saveSuccess }}</p>
        <div class="settings-actions">
          <button class="trade-action buy" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
          <button class="ghost-button" :disabled="saving" @click="close">取消</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.settings-mask { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 32, 0.45); }
.settings-panel { width: min(460px, calc(100vw - 40px)); max-height: min(560px, calc(100dvh - 60px)); overflow-y: auto; padding: 18px 20px; border-radius: 10px; background: var(--surface-background, #fff); border: 1px solid var(--surface-border, #dfe5eb); color: var(--text-primary, #1c2733); box-shadow: 0 18px 48px rgba(15, 23, 32, 0.25); outline: none; }
.settings-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 6px; }
.settings-head h2 { margin: 0; font-size: 17px; }
.settings-note { margin: 0 0 14px; font-size: 12px; color: var(--text-secondary, #51637a); }
.settings-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-top: 1px solid var(--surface-border, #eef2f6); cursor: pointer; }
.settings-row-text { display: flex; flex-direction: column; gap: 2px; }
.settings-row-text small { font-size: 11px; color: var(--text-secondary, #51637a); }
.settings-fixed { margin-top: 10px; font-size: 11px; color: var(--text-secondary, #51637a); }
.settings-saved { margin: 10px 0 0; font-size: 12px; color: #1d7a3d; }
:global(body.dark) .settings-saved { color: #57bd7c; }
.settings-actions { display: flex; gap: 10px; margin-top: 14px; }
</style>
