<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { fetchTrainingSettings, putTrainingSettings, type TrainingSettingsView } from '../api'
import { notifySettingsSaved } from '../settingsPanel'

// TRAIN-01/M5-DEFAULTS 训练默认设置面板：局部弹层（不卸载正在录制的训练）。
// 四字段一起原子保存：费用开关、T+1、默认初始资金（0.01..1,000,000,000 元、至多两位小数）、
// 默认复权（forward/raw）。保存成功给明确反馈；取消/失败不假称保存，也不改变任何进行中的训练。
// 默认只影响之后新建的训练；本局规则在创建时冻结。
// 损坏默认（409 TRAINING_DEFAULTS_UNREADABLE）不是死局：面板即修复入口，完整保存即可修复。

const emit = defineEmits<{ close: [] }>()

const panelRef = ref<HTMLElement | null>(null)
const settings = ref<TrainingSettingsView | null>(null)
const loadError = ref('')
const saveError = ref('')
const saveSuccess = ref('')
const saving = ref(false)
const feesEnabled = ref(false)
const tPlusOne = ref(true)
const initialCashText = ref<string | number>('1000000')
const adjustMode = ref<'forward' | 'raw'>('forward')
// 返修 F4：读取/编辑/保存的时序与归属——成功保存递增 readVersion 使挂起中的初次 GET 作废；
// 用户手改过任一字段（formDirty）后迟到的 GET 一律不覆盖表单。
let readVersion = 0
let formDirty = false

/** 用户手改任一字段时标记：迟到的 GET 不覆盖表单（返修 F4）。 */
function markFormDirty(): void {
  formDirty = true
}

const INITIAL_CASH_MAX = 1_000_000_000

/** 至多两位十进制小数：基于 Number 最短字符串表示（科学记数法一律拒绝），
 * 与服务端同一语义（返修 F3：固定浮点容差会误拒 10000000.03、放过 0.010000000001）。 */
function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const text = String(value)
  if (text.includes('e') || text.includes('E')) return false
  const dot = text.indexOf('.')
  return dot === -1 || text.length - dot - 1 <= 2
}

function parseInitialCash(input: string | number): number | null {
  // v-model 在 type="number" 输入上会把 ref 自动转成数字（y.trim is not a function 的教训）：
  // 先统一字符串化再做域与两位小数校验，不取整不截断。
  const text = (typeof input === 'number' ? String(input) : input).trim()
  if (text === '') return null
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  if (value < 0.01 || value > INITIAL_CASH_MAX) return null
  if (!hasAtMostTwoDecimalPlaces(value)) return null
  return value
}

const initialCashInvalid = (): boolean => parseInitialCash(initialCashText.value) === null

onMounted(async () => {
  // 返修 F3：文档级 Esc 兜底——焦点因任何原因离开弹层（如保存期间按钮 disabled 回落 body）
  // 时仍能关闭；Tab 隔离由面板 trapFocus + 背景 inert 共同保证。
  document.addEventListener('keydown', onDocumentKeydown)
  panelRef.value?.focus()
  const version = ++readVersion
  try {
    const current = await fetchTrainingSettings()
    if (version !== readVersion || formDirty) return
    applyView(current)
    settings.value = current
  } catch (error) {
    if (version !== readVersion || formDirty) return
    // 读取失败（含损坏默认 409）：表单以内建缺省呈现，保存完整四字段即修复入口
    loadError.value = error instanceof Error ? error.message : '无法读取训练默认设置'
    initialCashText.value = '1000000'
    adjustMode.value = 'forward'
  }
})
onUnmounted(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
})
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  close()
}
function applyView(view: TrainingSettingsView): void {
  feesEnabled.value = view.feesEnabled
  tPlusOne.value = view.tPlusOne
  initialCashText.value = String(view.initialCash)
  adjustMode.value = view.adjustMode
}

async function save(): Promise<void> {
  if (saving.value) return
  const initialCash = parseInitialCash(initialCashText.value)
  if (initialCash === null) {
    saveError.value = '初始资金需在 0.01 至 1,000,000,000 元之间，且至多两位小数'
    return
  }
  saving.value = true
  saveError.value = ''
  saveSuccess.value = ''
  try {
    const saved = await putTrainingSettings({
      feesEnabled: feesEnabled.value,
      tPlusOne: tPlusOne.value,
      initialCash,
      adjustMode: adjustMode.value,
    })
    // 返修 F4：成功保存递增 readVersion——挂起中的旧 GET 迟到到达后不得回退已保存的新默认
    // 或复写“已保存”状态
    readVersion += 1
    settings.value = saved
    applyView(saved)
    saveSuccess.value = '已保存：新默认将应用于之后新建的训练，当前训练不受影响'
    notifySettingsSaved(saved)
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败，设置未更改'
  } finally {
    saving.value = false
    // 保存按钮 disabled 期间浏览器会把焦点回落到 body：完成后把焦点收回弹层
    panelRef.value?.focus()
  }
}

// 返修 F3：Tab 焦点陷阱——焦点在首/末可聚焦元素时回绕到另一端，
// 配合背景 inert，保证 Tab/Shift+Tab 永远不出弹层；Esc 关闭。
function trapFocus(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key !== 'Tab') return
  const focusable = panelRef.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )
  if (!focusable || focusable.length === 0) return
  const list = Array.from(focusable)
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && (active === first || !panelRef.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !panelRef.value?.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

function close(): void {
  // 取消不保存：本局与默认都不因关闭而改变
  emit('close')
}
</script>

<template>
  <div class="settings-mask" @click.self="close">
    <div ref="panelRef" class="settings-panel" role="dialog" aria-modal="true" aria-label="训练默认设置" tabindex="-1" @keydown="trapFocus" @keydown.stop>
      <header class="settings-head">
        <h2>训练默认设置</h2>
        <button class="ghost-button" aria-label="关闭" title="关闭" @click="close">✕</button>
      </header>
      <p class="settings-note">这里的默认只影响新训练；进行中的训练按创建时冻结的规则继续。</p>
      <p v-if="loadError" class="settings-repair" role="alert">{{ loadError }}：核对以下表单并重新保存即可修复。</p>
      <label class="settings-row">
        <input v-model="feesEnabled" type="checkbox" aria-label="新训练收取手续费（佣金/印花税）" @change="markFormDirty()" />
        <span class="settings-row-text">
          <strong>收取手续费</strong>
          <small>佣金万分之 2.5（最低 5 元），卖出另收万分之 5 印花税。默认关闭。</small>
        </span>
      </label>
      <label class="settings-row">
        <input v-model="tPlusOne" type="checkbox" aria-label="新训练启用 T+1（当日买入次日可卖）" @change="markFormDirty()" />
        <span class="settings-row-text">
          <strong>T+1 限制</strong>
          <small>当日买入的股票次一交易日才能卖出。默认开启。</small>
        </span>
      </label>
      <div class="settings-row settings-column">
        <label class="settings-field-label" for="training-default-initial-cash">默认初始资金（元，仅影响新训练）</label>
        <input
          id="training-default-initial-cash" v-model="initialCashText" type="number" step="0.01" min="0.01"
          :max="1000000000" aria-label="默认初始资金（元）" @input="markFormDirty(); saveSuccess = ''"
        />
        <small>0.01 至 1,000,000,000 元，至多两位小数；默认 1,000,000。</small>
      </div>
      <div class="settings-row settings-column">
        <span class="settings-field-label" id="training-default-adjust-label">默认复权方式（仅影响新训练，创建后锁定）</span>
        <div class="settings-adjust-grid" role="radiogroup" aria-labelledby="training-default-adjust-label">
          <button
            type="button" :class="{ selected: adjustMode === 'forward' }" role="radio"
            :aria-checked="adjustMode === 'forward'" @click="adjustMode = 'forward'; markFormDirty(); saveSuccess = ''"
          >前复权</button>
          <button
            type="button" :class="{ selected: adjustMode === 'raw' }" role="radio"
            :aria-checked="adjustMode === 'raw'" @click="adjustMode = 'raw'; markFormDirty(); saveSuccess = ''"
          >不复权</button>
        </div>
        <small>默认复权用于之后新建的训练；创建时仍可显式选择覆盖。</small>
      </div>
      <div class="settings-fixed">
        <span>固定口径（不可修改）：一手 {{ settings?.lotSize ?? 100 }} 股 · 买入仓位按总权益 · 按当日原始收盘价成交</span>
      </div>
      <p v-if="initialCashInvalid()" class="error-text" role="alert">初始资金需在 0.01 至 1,000,000,000 元之间，且至多两位小数</p>
      <p v-if="saveError" class="error-text" role="alert">{{ saveError }}</p>
      <p v-if="saveSuccess" class="settings-saved" role="status">{{ saveSuccess }}</p>
      <div class="settings-actions">
        <button class="trade-action buy" :disabled="saving || initialCashInvalid()" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
        <button class="ghost-button" :disabled="saving" @click="close">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-mask { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 32, 0.45); }
.settings-panel { width: min(460px, calc(100vw - 40px)); max-height: min(640px, calc(100dvh - 60px)); overflow-y: auto; padding: 18px 20px; border-radius: 10px; background: var(--surface-background, #fff); border: 1px solid var(--surface-border, #dfe5eb); color: var(--text-primary, #1c2733); box-shadow: 0 18px 48px rgba(15, 23, 32, 0.25); outline: none; }
.settings-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 6px; }
.settings-head h2 { margin: 0; font-size: 17px; }
.settings-note { margin: 0 0 14px; font-size: 12px; color: var(--text-secondary, #51637a); }
.settings-repair { margin: 0 0 14px; padding: 8px 10px; border: 1px solid #e0b44c; border-radius: 6px; background: #fdf6e3; color: #7a5b12; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
:global(body.dark) .settings-repair { border-color: #8a6d1d; background: #2e2612; color: #d9b45c; }
.settings-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-top: 1px solid var(--surface-border, #eef2f6); cursor: pointer; }
.settings-row.settings-column { flex-direction: column; gap: 4px; cursor: default; }
.settings-field-label { font-size: 13px; font-weight: 600; }
.settings-column small { font-size: 11px; color: var(--text-secondary, #51637a); }
.settings-column input[type="number"] { width: 100%; padding: 6px 8px; border: 1px solid var(--surface-border, #d8e0e8); border-radius: 4px; background: transparent; color: inherit; font-variant-numeric: tabular-nums; }
.settings-adjust-grid { display: flex; gap: 8px; }
.settings-adjust-grid button { flex: 0 0 auto; padding: 5px 14px; border: 1px solid var(--surface-border, #d8e0e8); border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }
.settings-adjust-grid button.selected { border-color: #2b8b99; color: #1c6076; background: rgba(43, 139, 153, 0.08); }
:global(body.dark) .settings-adjust-grid button.selected { color: #7fd0dc; border-color: #2b8b99; }
.settings-fixed { margin-top: 10px; font-size: 11px; color: var(--text-secondary, #51637a); }
.settings-saved { margin: 10px 0 0; font-size: 12px; color: #1d7a3d; }
:global(body.dark) .settings-saved { color: #57bd7c; }
.settings-actions { display: flex; gap: 10px; margin-top: 14px; }
</style>
