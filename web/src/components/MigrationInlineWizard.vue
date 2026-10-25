<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

// MIG-INLINE-01 v1.2.7 内置迁移向导（用户 2026-10-25 拍板：首启弹一次可跳过＋设置页常驻入口；
// 历史全自动迁移；录像＝旧地址自动起导出页+浏览器自动上传回流；完成页含安全卸载指引）。
// 桌面窄桥 desktopMigration（同通道 inline-* 五方法）；纯浏览器形态不渲染（fail-closed 探测）。
interface InlineBridge {
  inspectLegacy(root: string): Promise<{ ok: true, trainings: number, trades: number, originPort: number, recordingNamespace: string | null } | { ok: false, error: string }>
  migrateLegacyHistory(root: string): Promise<{ ok: true, imported: number, skipped: number } | { ok: false, error: string }>
  startLegacyExport(root: string): Promise<{ ok: true, url: string } | { ok: false, error: string }>
  legacyExportStatus(): Promise<{ ok: true, state: { phase: string, itemCount?: number, summary?: { imported?: number, skipped?: number, failed?: number }, error?: string } }>
  stopLegacyExport(): Promise<{ ok: true }>
  pickLegacyRoot(): Promise<{ ok: true, root: string } | { ok: false, canceled?: boolean, error?: string }>
}
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [], completed: [], 'dismiss-forever': [] }>()

const bridge = (window as unknown as { desktopMigration?: InlineBridge }).desktopMigration
const step = ref<'path' | 'summary' | 'history' | 'recordings' | 'done'>('path')
const rootInput = ref('')
const inspecting = ref(false)
const inspectResult = ref<{ ok: true, trainings: number, trades: number, originPort: number, recordingNamespace: string | null } | null>(null)
const inspectError = ref('')
const migrating = ref(false)
const historyResult = ref<{ ok: true, imported: number, skipped: number } | null>(null)
const historyError = ref('')
const exportStarting = ref(false)
const exportError = ref('')
const exportState = ref<{ phase: string, itemCount?: number, summary?: { imported?: number, skipped?: number, failed?: number }, error?: string } | null>(null)
let statusTimer: ReturnType<typeof setInterval> | undefined

const recordSummaryText = computed(() => {
  if (!exportState.value) return ''
  const s = exportState.value
  if (s.phase === 'imported' && s.summary) {
    return `已导入 ${s.summary.imported ?? '?'} 条录像（跳过 ${s.summary.skipped ?? 0} 条、失败 ${s.summary.failed ?? 0} 条）`
  }
  if (s.phase === 'skipped') return '旧浏览器里没有找到训练录像（已自动跳过）'
  if (s.phase === 'uploaded') return `录像包已回流（${s.itemCount ?? '?'} 条），正在导入…`
  if (s.phase === 'serving') return '导出页已打开，等待浏览器完成自动上传…'
  if (s.phase === 'failed') return `录像导入失败：${s.error ?? '未知原因'}（可稍后在设置里重试）`
  return ''
})

function reset(): void {
  step.value = 'path'
  inspectResult.value = null
  inspectError.value = ''
  historyResult.value = null
  historyError.value = ''
  exportError.value = ''
  exportState.value = null
  if (statusTimer !== undefined) { clearInterval(statusTimer); statusTimer = undefined }
}

function close(): void {
  reset()
  if (bridge) void bridge.stopLegacyExport().catch(() => {})
  emit('close')
}

function dismissForever(): void {
  localStorage.setItem('mig-inline-dismissed', '1')
  close()
  emit('dismiss-forever')
}

async function browse(): Promise<void> {
  if (!bridge) return
  // 真机缺陷修复（2026-10-25）：原生目录选择器（openDirectory）。早前误接旧外置工具的
  // pick()＝「迁移清单.json」文件选择器，用户点开必见系统「找不到文件」提示。
  const picked = await bridge.pickLegacyRoot()
  if (picked.ok) rootInput.value = picked.root
  // 取消＝无事发生；error 形态静默（用户仍可手填路径，不打扰）
}

async function inspect(): Promise<void> {
  if (!bridge || inspecting.value) return
  inspecting.value = true
  inspectError.value = ''
  inspectResult.value = null
  try {
    const r = await bridge.inspectLegacy(rootInput.value.trim())
    if (r.ok) { inspectResult.value = r; step.value = 'summary' }
    else inspectError.value = r.error
  } catch (error) {
    inspectError.value = error instanceof Error ? error.message : '校验失败，可重试'
  } finally { inspecting.value = false }
}

async function migrateHistory(): Promise<void> {
  if (!bridge || migrating.value) return
  migrating.value = true
  historyError.value = ''
  step.value = 'history'
  try {
    const r = await bridge.migrateLegacyHistory(rootInput.value.trim())
    if (r.ok) { historyResult.value = r; step.value = 'recordings' }
    else { historyError.value = r.error; step.value = 'summary' }
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : '迁移失败，可重试'
    step.value = 'summary'
  } finally { migrating.value = false }
}

async function startRecordingExport(): Promise<void> {
  if (!bridge || exportStarting.value) return
  exportStarting.value = true
  exportError.value = ''
  try {
    const r = await bridge.startLegacyExport(rootInput.value.trim())
    if (!r.ok) { exportError.value = r.error; return }
    exportState.value = { phase: 'serving' }
    statusTimer = setInterval(() => { void pollStatus() }, 1500)
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : '启动导出失败，可重试'
  } finally { exportStarting.value = false }
}

async function pollStatus(): Promise<void> {
  if (!bridge || statusTimer === undefined) return
  try {
    const r = await bridge.legacyExportStatus()
    exportState.value = r.state
    if (r.state.phase === 'imported' || r.state.phase === 'skipped' || r.state.phase === 'failed') {
      clearInterval(statusTimer); statusTimer = undefined
      void bridge.stopLegacyExport().catch(() => {})
    }
  } catch { /* 轮询短暂失败不打断 */ }
}

function skipRecordings(): void {
  if (bridge) void bridge.stopLegacyExport().catch(() => {})
  if (statusTimer !== undefined) { clearInterval(statusTimer); statusTimer = undefined }
  step.value = 'done'
}

onUnmounted(() => { if (statusTimer !== undefined) clearInterval(statusTimer) })
</script>

<template>
  <div v-if="open && bridge" class="settings-mask" @click.self="close">
    <div class="settings-panel migration-wizard-panel" role="dialog" aria-modal="true" aria-label="从 v1.2.7 迁移" tabindex="-1" @keydown.esc="close">
      <header class="settings-head">
        <h2>从 v1.2.7 迁移老数据</h2>
        <button class="ghost-button" aria-label="关闭" title="关闭" @click="close">✕</button>
      </header>

      <!-- 第 1 步：填 v1.2.7 安装路径 -->
      <section v-if="step === 'path'" class="settings-section">
        <p class="settings-note">把训练历史和训练录像从 v1.2.7 老版本迁移到当前版本。请填写老版本的安装根目录（包含 Start.cmd 与 data 文件夹的那一层）。</p>
        <div class="settings-row settings-column">
          <label class="settings-field-label" for="mig-root-input">v1.2.7 安装根目录</label>
          <input id="mig-root-input" v-model="rootInput" type="text" spellcheck="false" aria-label="v1.2.7 安装根目录" placeholder="例如 D:\kline-trainer-v1.2.7" @keydown.enter="inspect">
        </div>
        <div class="settings-actions">
          <button class="ghost-button" @click="browse">选择文件夹…</button>
          <button class="mig-primary" :disabled="inspecting || rootInput.trim() === ''" @click="inspect">{{ inspecting ? '校验中…' : '校验该目录' }}</button>
          <button class="ghost-button" @click="dismissForever">我不用 v1.2.7，不再提示</button>
        </div>
        <p v-if="inspectError" class="error-text" role="alert">{{ inspectError }}</p>
      </section>

      <!-- 第 2 步：摘要确认 -->
      <section v-else-if="step === 'summary'" class="settings-section">
        <p class="settings-note">
          已找到 v1.2.7 训练数据：<code>{{ rootInput }}</code><br>
          训练历史 <strong>{{ inspectResult?.trainings ?? '?' }}</strong> 局（成交 {{ inspectResult?.trades ?? '?' }} 笔）；录像将尝试从旧访问地址（端口 {{ inspectResult?.originPort }}）读取。
        </p>
        <p class="settings-note">迁移采用合并导入：已存在的训练自动跳过，绝不覆盖或删除老版本里的任何数据。</p>
        <div class="settings-actions">
          <button class="ghost-button" @click="step = 'path'">返回修改路径</button>
          <button class="mig-primary" :disabled="migrating" @click="migrateHistory">{{ migrating ? '迁移中…' : '开始迁移训练历史' }}</button>
        </div>
        <p v-if="historyError" class="error-text" role="alert">{{ historyError }}</p>
      </section>

      <!-- 第 3 步：历史迁移执行 -->
      <section v-else-if="step === 'history'" class="settings-section">
        <p class="settings-note" role="status">正在迁移训练历史（只读复制老库→合并导入，导入前自动备份）…</p>
      </section>

      <!-- 第 4 步：录像（可选） -->
      <section v-else-if="step === 'recordings'" class="settings-section">
        <p class="settings-saved" role="status">训练历史迁移完成：新导入 {{ historyResult?.imported ?? 0 }} 局，跳过已存在 {{ historyResult?.skipped ?? 0 }} 局。</p>
        <p class="settings-note">训练录像存放在你当时使用的浏览器里，需要浏览器配合自动导出一次：点击下方按钮后，会用你的默认浏览器打开旧地址的导出页并<b>自动完成上传</b>，无需任何手动操作（请确保旧训练器已完全退出）。</p>
        <div class="settings-actions">
          <button v-if="!exportState || exportState.phase === 'serving'" class="mig-primary" :disabled="exportStarting" @click="startRecordingExport">{{ exportStarting ? '正在启动…' : exportState ? '等待浏览器完成…（已打开）' : '迁移训练录像（自动）' }}</button>
          <button class="ghost-button" @click="skipRecordings">{{ exportState && exportState.phase !== 'serving' ? '完成' : '跳过录像，直接完成' }}</button>
        </div>
        <p v-if="recordSummaryText" :class="exportState?.phase === 'failed' ? 'error-text' : 'settings-note'" role="status">{{ recordSummaryText }}</p>
        <p v-if="exportError" class="error-text" role="alert">{{ exportError }}</p>
      </section>

      <!-- 第 5 步：完成＋安全卸载指引 -->
      <section v-else-if="step === 'done'" class="settings-section">
        <h3>迁移完成</h3>
        <p class="settings-saved" role="status">训练历史：新导入 {{ historyResult?.imported ?? 0 }} 局、跳过已存在 {{ historyResult?.skipped ?? 0 }} 局。</p>
        <p class="settings-note">{{ recordSummaryText || '录像部分已跳过（可随时从设置里重新发起）。' }}</p>
        <div class="update-source-setting">
          <p class="update-source-label">如何安全卸载 v1.2.7 老版本？</p>
          <p class="settings-note">请先在历史与录像里抽查确认数据已完整迁移；确认无误后，<b>把 v1.2.7 版本的文件夹完整删除即可完成卸载</b>。当前版本的数据完全独立存放，删除老版本文件夹不会影响它。老版本文件夹在卸载前不会被本次迁移修改或删除任何内容。</p>
        </div>
        <div class="settings-actions">
          <button class="mig-primary" @click="close(); emit('completed')">完成</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* MIG-INLINE-01：settings-* 类名沿用设置页视觉语言，但样式在本组件自有（TrainingSettings 为
   scoped，不外溢——曾因裸用其类名导致向导无遮罩平铺，见 e2e 截图复盘）。ghost-button/
   error-text 为全局 styles.css，不在本块重复。主按钮走 UIUX-B2 后的 accent 填充语义。 */
.settings-mask { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 32, 0.45); }
.settings-panel { width: min(560px, calc(100vw - 40px)); max-height: min(640px, calc(100dvh - 44px)); overflow-y: auto; display: flex; flex-direction: column; padding: 18px 20px; border-radius: 10px; background: var(--surface-background, #fff); border: 1px solid var(--surface-border, #dfe5eb); color: var(--text-primary, #1c2733); box-shadow: 0 18px 48px rgba(15, 23, 32, 0.25); outline: none; }
.settings-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 6px; }
.settings-head h2 { margin: 0; font-size: 17px; }
.settings-note { margin: 0 0 14px; font-size: var(--font-size-sm); color: var(--text-secondary, #51637a); line-height: 1.6; }
.settings-note code { overflow-wrap: anywhere; }
.settings-section { margin-top: 6px; }
.settings-section h3 { margin: 0 0 4px; font-size: var(--font-size-lg); }
.settings-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-top: 1px solid var(--surface-border, #eef2f6); }
.settings-row.settings-column { flex-direction: column; gap: 4px; }
.settings-field-label { font-size: var(--font-size-md); font-weight: 600; }
.settings-column input[type="text"] { width: 100%; padding: 7px 9px; border: 1px solid var(--surface-border, #d8e0e8); border-radius: 4px; background: transparent; color: inherit; }
.settings-column input[type="text"]:focus { outline: 1px solid var(--color-accent-fill, #1f6978); }
.settings-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.settings-saved { margin: 10px 0 0; font-size: var(--font-size-sm); color: #1d7a3d; }
.update-source-setting { margin: 14px 0 4px; padding: 10px 12px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 6px; background: var(--surface-hover, #f6f8fa); }
.update-source-setting .update-source-label { margin: 0 0 6px; font-size: var(--font-size-md); font-weight: 600; }
.update-source-setting .settings-note { margin: 0; }
.mig-primary { border: 0; height: 34px; padding: 0 18px; border-radius: var(--radius-sm); color: #fff; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); background: var(--color-accent-fill); cursor: pointer; }
.mig-primary:hover { filter: brightness(1.06); }
.mig-primary:disabled { opacity: .5; cursor: not-allowed; }
</style>
