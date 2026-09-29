<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch, watchEffect } from 'vue'
import {
  applySetupChoice, fetchActiveTraining, fetchEnv, fetchRestartStatus, fetchSetupCandidates,
  inspectSetupRoot, saveSetupChoice, selectSetupDirectory,
} from './api'
import type { SetupCandidate, TdxCandidateCheck, TrainingSnapshot } from './api'
import { applyThemeClass, theme, toggleTheme } from './theme'
import { cancelDataWatchers, checkDataStatus, dataRefreshError, dataStatus, dataUpdating, onDataActive, refreshDataNow, startStatusTicker, stopStatusTicker } from './dataStatus'
import { closeTrainingSettings, openTrainingSettings, trainingSettingsOpen } from './settingsPanel'
import { Moon, Sun } from 'lucide-vue-next'
import Launcher from './views/Launcher.vue'
import Training from './views/Training.vue'
import SessionReplay from './views/SessionReplay.vue'
import TrainingSettings from './components/TrainingSettings.vue'
import { recordingStorage, loadLocalRecording } from './recording/recordingRepository'
import { readRecordingFile } from './recording/recordingFile'
import type { RecordingSummary } from './recording/types'
import type { CompactRecordingFile } from './recording/compactTypes'

type View = 'loading' | 'launcher' | 'training' | 'library' | 'replay'
const view = ref<View>('loading')
const trainingRef = ref<InstanceType<typeof Training> | null>(null)
const libraryBusy = ref(false)
const snapshot = ref<TrainingSnapshot | null>(null)
const env = ref<Awaited<ReturnType<typeof fetchEnv>> | null>(null)
const envError = ref('')
const recordingOptions = ref<{ enabled: boolean; params?: Record<string, unknown> }>({ enabled: true })
const replay = shallowRef<CompactRecordingFile | null>(null)
const recentRecordings = ref<RecordingSummary[]>([])
const recordingError = ref('')
async function loadRecordings(): Promise<void> {
  try { recentRecordings.value = (await recordingStorage.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  catch (error) { recordingError.value = error instanceof Error ? error.message : '无法读取本机录制' }
}
watch(view, value => { if (value === 'launcher' || value === 'library') void loadRecordings() })
async function showLibrary(): Promise<void> {
  if (libraryBusy.value) return
  libraryBusy.value = true
  try {
    if (view.value === 'training') {
      if (!await trainingRef.value?.prepareForLibrary()) return
    }
    replay.value = null
    view.value = 'library'
  } finally { libraryBusy.value = false }
}
async function returnToTraining(): Promise<void> {
  if (view.value === 'training') return
  replay.value = null
  await refresh()
}
async function onCreated(options: { enabled: boolean; params: Record<string, unknown> }): Promise<void> {
  recordingOptions.value = options
  await refresh()
}
async function importRecording(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  recordingError.value = ''
  try {
    replay.value = await readRecordingFile(file)
    view.value = 'replay'
  } catch (error) { recordingError.value = error instanceof Error ? error.message : '无法导入录制文件' }
}
async function openRecording(id: string): Promise<void> {
  recordingError.value = ''
  try {
    replay.value = await loadLocalRecording(id)
    if (!replay.value) throw new Error('找不到这份本机录制')
    view.value = 'replay'
  } catch (error) { recordingError.value = error instanceof Error ? error.message : '无法打开录制' }
}

watchEffect(() => applyThemeClass())

async function refresh(): Promise<void> {
  try {
    const requested = new URL(location.href).searchParams.get('training')
    const result = requested && /^[1-9]\d*$/.test(requested)
      ? await fetch(`/api/trainings/${requested}`).then(async response => { if (!response.ok) throw new Error('训练不存在'); return await response.json() as TrainingSnapshot })
      : await fetchActiveTraining()
    if ('training' in result && result.training === null) {
      snapshot.value = null
      view.value = 'launcher'
    } else {
      snapshot.value = result as TrainingSnapshot
      view.value = 'training'
    }
  } catch (error) {
    envError.value = error instanceof Error ? error.message : '无法连接本地服务'
    view.value = 'launcher'
  }
}

// ===== 日线数据状态接线 =====
// 启动立即检查一次；focus / visibilitychange→visible 交给 store 的 60s 节流；
// 隐藏时不检查不轮询（store 内部守卫）。卸载时监听器成对移除＋轮询清理。
function onDataFocus(): void {
  onDataActive()
}
function onDataVisibilityChange(): void {
  if (document.visibilityState === 'visible') onDataActive()
  else stopStatusTicker()
}

// 首页顶栏"更新日线"控件状态机（DATA-05）：绿色"已最新"只对应官方离线日历判定的
// freshness.current；unknown 一律显示"数据截至…最新交易日待确认"，不得绿色；
// stale 提示先去通达信完成盘后下载、再回来重新读取本地日线（不联网）。
// needsUpdate 是兼容提示，不再驱动界面断言"已最新"。
const dataWidgetState = computed<'legacy' | 'ok' | 'running' | 'failed' | 'attention' | 'unavailable' | 'unknown'>(() => {
  const status = dataStatus.value
  if (!status) return 'legacy'
  if (dataUpdating.value) return 'running'
  if (status.state === 'failed' || status.lastResult?.outcome === 'failed') return 'failed'
  if (!status.tdx.available && !status.online.configured) return 'unavailable'
  const freshness = status.freshness
  if (!freshness) return 'legacy'
  if (freshness.state === 'current') return 'ok'
  if (freshness.state === 'stale') return 'attention'
  return 'unknown'
})
const dataCutoffText = computed(() => dataStatus.value?.sourceMaxDate ?? env.value?.dataCutoff ?? 'N/A')
// stale 的可行动提示：先去通达信下载盘后日线，再回来重新读取（不暗示联网下载）
const STALE_HINT = '请先在通达信完成盘后数据下载，再点击重新读取本地日线（不联网）'
const attentionTitle = computed(() => {
  const reason = dataStatus.value?.freshness?.reason
  return reason ? `${reason}${STALE_HINT}` : STALE_HINT
})
// 常驻手动入口：ok/unknown 状态下始终提供"重新读取本地日线"（attention/failed 已有主按钮）
const showManualReread = computed(() => dataWidgetState.value === 'ok' || dataWidgetState.value === 'unknown')
function updateData(): void {
  void refreshDataNow()
}

// 醒目按钮的摇晃重触发：入场由 CSS 播 3 次，此后每约 12s 换 key 重挂载重播（尊重 prefers-reduced-motion）
const shakeTick = ref(0)
let shakeTimer: ReturnType<typeof setInterval> | undefined
watch(dataWidgetState, state => {
  if (shakeTimer !== undefined) { clearInterval(shakeTimer); shakeTimer = undefined }
  if (state === 'attention') shakeTimer = setInterval(() => { shakeTick.value++ }, 12_000)
}, { immediate: true })

// ===== 首次接入向导（SETUP-01）：未连接时在首页提供"连接你的通达信" =====
// 自动发现 → 一键确认 / 原生选目录 → 检查确认 → 保存并生效（受控重启）。
// 浏览器同源可直接调用 /api/setup/*（不需要令牌）；取消、失败都停留在可重试状态。
const wizardOpen = ref(false)
const wizardBusy = ref(false)
const wizardError = ref('')
const wizardNote = ref('')
const wizardCandidates = ref<SetupCandidate[]>([])
const wizardProcessHint = ref('')
const wizardUsable = computed(() => wizardCandidates.value.filter(item => item.check.recognized && item.check.readable))
const wizardInspect = ref<{ check: TdxCandidateCheck; suggestions: TdxCandidateCheck[] } | null>(null)
const wizardChosenRoot = ref('')
const wizardManualRoot = ref('')
const wizardApplying = ref(false)
const disconnected = computed(() => env.value?.tdx?.connected === false)
const connectedSourceLabel = computed(() => {
  const source = env.value?.tdx?.source
  if (!source) return ''
  return { env: '环境变量', 'explicit-config': '配置文件', 'saved-choice': '已保存选择', 'auto-discovered': '自动发现' }[source] ?? source
})
let wizardAutoOpened = false
async function reloadEnv(): Promise<void> {
  try { env.value = await fetchEnv() } catch { /* 保留旧值；错误由 envError 呈现 */ }
}
function openWizard(): void {
  wizardOpen.value = true
  wizardError.value = ''
  wizardNote.value = ''
  void loadWizardCandidates()
}
function closeWizard(): void {
  if (wizardApplying.value) return
  wizardOpen.value = false
}
async function loadWizardCandidates(): Promise<void> {
  wizardBusy.value = true
  wizardError.value = ''
  try {
    const result = await fetchSetupCandidates()
    wizardCandidates.value = result.candidates
    wizardProcessHint.value = result.processReason ?? (result.processStatus !== 'ok' ? `运行中的通达信探测：${result.processStatus}` : '')
  } catch (error) {
    wizardError.value = error instanceof Error ? error.message : '无法获取候选列表'
  } finally { wizardBusy.value = false }
}
async function inspectWizardRoot(root: string): Promise<void> {
  const trimmed = root.trim()
  if (!trimmed || wizardBusy.value) return
  wizardBusy.value = true
  wizardError.value = ''
  try {
    const result = await inspectSetupRoot(trimmed)
    wizardInspect.value = result
    wizardChosenRoot.value = result.check.recognized && result.check.readable ? result.check.root : ''
    if (wizardChosenRoot.value) wizardNote.value = ''
  } catch (error) {
    wizardError.value = error instanceof Error ? error.message : '检查目录失败'
  } finally { wizardBusy.value = false }
}
async function chooseWizardFolder(): Promise<void> {
  if (wizardBusy.value) return
  wizardBusy.value = true
  wizardError.value = ''
  try {
    const picked = await selectSetupDirectory()
    if (picked.status === 'selected' && picked.path) {
      wizardBusy.value = false
      await inspectWizardRoot(picked.path)
      return
    }
    if (picked.status !== 'cancelled') {
      wizardError.value = picked.reason ?? `目录选择不可用（${picked.status}）`
    }
  } catch (error) {
    wizardError.value = error instanceof Error ? error.message : '目录选择失败'
  } finally { wizardBusy.value = false }
}
async function saveAndApplyWizard(): Promise<void> {
  const root = wizardChosenRoot.value
  if (!root || wizardBusy.value) return
  wizardBusy.value = true
  wizardError.value = ''
  wizardNote.value = ''
  try {
    const saved = await saveSetupChoice(root)
    if (!saved.apply.available) {
      wizardNote.value = `已保存选择。${saved.apply.reason ?? ''}`
      await reloadEnv()
      return
    }
    wizardApplying.value = true
    await applySetupChoice(root, crypto.randomUUID())
    // 受控重启轮询：端口与数据库不变；期间页面请求可能短暂失败，持续重试到终态
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 700))
      let status: Awaited<ReturnType<typeof fetchRestartStatus>> | null = null
      try { status = await fetchRestartStatus() } catch { status = null }
      if (status?.done) {
        if (status.phase === 'ready') {
          wizardNote.value = '已切换到新的通达信目录。'
          await reloadEnv()
          await checkDataStatus({ force: true })
          wizardOpen.value = false
        } else {
          wizardError.value = status.reason ?? `重启未完成（${status.phase}），保存的选择已回滚`
          await reloadEnv()
        }
        return
      }
    }
    wizardError.value = '重启确认超时：服务可能仍在切换，请稍后刷新页面查看连接状态'
    await reloadEnv()
  } catch (error) {
    wizardError.value = error instanceof Error ? error.message : '保存或生效失败'
    await reloadEnv()
  } finally {
    wizardApplying.value = false
    wizardBusy.value = false
  }
}
watch(disconnected, value => {
  // 首次发现未连接时自动展开向导（每会话一次；用户关闭后不再打扰）
  if (value && view.value === 'launcher' && !wizardAutoOpened) {
    wizardAutoOpened = true
    openWizard()
  }
})
watch(view, value => { if (value !== 'launcher') wizardOpen.value = false })

onMounted(async () => {
  window.addEventListener('focus', onDataFocus)
  document.addEventListener('visibilitychange', onDataVisibilityChange)
  void checkDataStatus({ force: true })
  startStatusTicker()
  try {
    env.value = await fetchEnv()
  } catch (error) {
    envError.value = error instanceof Error ? error.message : '无法连接本地服务'
  }
  await refresh()
})
onUnmounted(() => {
  window.removeEventListener('focus', onDataFocus)
  document.removeEventListener('visibilitychange', onDataVisibilityChange)
  cancelDataWatchers()
  if (shakeTimer !== undefined) { clearInterval(shakeTimer); shakeTimer = undefined }
})

// ===== 训练默认设置入口（返修 F3）：打开期间 rail 与 workspace 整体 inert（焦点+指针双隔离），
// 关闭（含 Esc/遮罩/取消）后焦点返还设置按钮；Training/录像保持挂载。 =====
const settingsButton = ref<HTMLElement | null>(null)
async function returnFocusToSettingsTrigger(): Promise<void> {
  await nextTick() // 等 inert 解除后再还焦点，否则 inert 容器内的元素不可聚焦
  settingsButton.value?.focus()
}
function onSettingsToggle(): void {
  if (trainingSettingsOpen.value) {
    closeTrainingSettings()
    void returnFocusToSettingsTrigger()
  } else {
    openTrainingSettings()
  }
}
function onSettingsClose(): void {
  closeTrainingSettings()
  void returnFocusToSettingsTrigger()
}
function onTrainingEnded(): void {
  recordingOptions.value = { enabled: true }
  history.replaceState(null, '', location.pathname)
  void refresh()
}
</script>

<template>
  <div class="app-shell">
    <aside class="rail" aria-label="主导航" :inert="trainingSettingsOpen">
      <div class="brand-mark">K</div>
      <nav>
        <button class="rail-item" :class="{ active: view === 'training' || view === 'launcher' }" title="训练" @click="returnToTraining">⌁<span>训练</span></button>
        <button class="rail-item" title="排行榜（M4 开放）" disabled>▤<span>排行</span></button>
        <button class="rail-item" :class="{ active: view === 'library' || view === 'replay' }" title="训练录像" aria-label="训练录像" :disabled="libraryBusy" @click="showLibrary">◫<span>录像</span></button>
      </nav>
      <button ref="settingsButton" class="rail-item rail-bottom" :class="{ active: trainingSettingsOpen }" title="训练默认设置" aria-label="训练默认设置" @click="onSettingsToggle">⚙<span>设置</span></button>
    </aside>

    <main class="workspace" :inert="trainingSettingsOpen">
      <header class="topbar" @keydown.space.stop>
        <div class="product-heading">
          <div class="product-name">A股 K线训练器</div>
          <div v-if="view === 'launcher'" class="workspace-title">创建训练</div>
        </div>
        <div class="top-actions">
          <div id="training-recording-controls"></div>
          <button class="theme-toggle" :title="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'" :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'" @click="toggleTheme">
            <Sun v-if="theme === 'dark'" :size="14" /><Moon v-else :size="14" />
          </button>
          <!-- 首页右上角"更新日线"控件（各状态见 dataWidgetState） -->
          <template v-if="view === 'launcher'">
            <span v-if="dataWidgetState === 'ok'" class="data-status-ok" role="status">
              <span class="connection-dot"></span>数据已最新 · 截止 {{ dataCutoffText }}
            </span>
            <button v-else-if="dataWidgetState === 'running'" class="data-update-btn running" disabled>更新中<span class="data-ellipsis" aria-hidden="true"><i></i><i></i><i></i></span></button>
            <button v-else-if="dataWidgetState === 'failed'" class="data-update-btn failed" :title="dataStatus?.reason || '更新失败，点击重试'" @click="updateData">更新失败 · 点击重试</button>
            <button v-else-if="dataWidgetState === 'attention'" :key="shakeTick" class="data-update-btn attention shake" :title="attentionTitle" @click="updateData">更新日线</button>
            <button v-else-if="dataWidgetState === 'unavailable'" class="data-update-btn unavailable" title="未检测到通达信数据目录，也未配置在线数据来源" @click="updateData">未检测到通达信数据</button>
            <span v-else-if="dataWidgetState === 'unknown'" class="data-status-unknown" role="status" :title="dataStatus?.freshness?.reason || ''">
              数据截至 {{ dataCutoffText }}，最新交易日待确认
            </span>
            <template v-else>
              <span class="connection-dot" :class="{ offline: !env?.tdx?.connected }"></span>
              <span class="connection-text">{{ env?.tdx?.connected ? `TDX · 截止 ${env.dataCutoff ?? 'N/A'}` : 'TDX 未连接' }}</span>
              <button v-if="disconnected && !wizardOpen" class="data-reread-btn" title="重新连接数据：自动发现或选择通达信目录" @click="openWizard">连接通达信</button>
            </template>
            <!-- 常驻手动入口：重新读取本地日线（仅扫描本地通达信日线文件，不联网下载） -->
            <button v-if="showManualReread" class="data-reread-btn" title="重新扫描本地通达信日线文件（不联网）" @click="updateData">重新读取</button>
            <span v-if="dataWidgetState === 'attention'" class="data-status-note">截止 {{ dataCutoffText }}</span>
            <span v-if="dataRefreshError" class="data-refresh-error" role="alert">{{ dataRefreshError }}</span>
            <details v-if="dataStatus?.revisionWarning" class="revision-warning">
              <summary title="数据修订警示（点击展开）">修订警示</summary>
              <p>{{ dataStatus.revisionWarning }}</p>
            </details>
          </template>
          <template v-else>
            <span class="connection-dot" :class="{ offline: !env?.tdx?.connected }"></span>
            <span class="connection-text">{{ env?.tdx?.connected ? `TDX · 截止 ${env.dataCutoff ?? 'N/A'}` : 'TDX 未连接' }}</span>
          </template>
        </div>
      </header>

      <div v-if="envError && view !== 'replay'" class="env-error">{{ envError }}：请先运行 npm run dev 或 npm start 启动后端</div>

      <template v-if="view === 'launcher'">
        <!-- 首次接入向导（SETUP-01）：仅在未连接通达信时出现；关闭后可从顶栏"连接通达信"再开 -->
        <section v-if="wizardOpen && disconnected" class="setup-wizard" aria-label="连接你的通达信">
          <header class="setup-wizard-head">
            <div>
              <h2>连接你的通达信</h2>
              <p class="setup-wizard-sub">程序只读取本机通达信行情文件，不控制交易、不写入通达信目录、不联网下载行情。</p>
            </div>
            <button class="setup-wizard-close" aria-label="关闭连接向导" :disabled="wizardApplying" @click="closeWizard">✕</button>
          </header>

          <div v-if="wizardError" class="setup-wizard-error" role="alert">{{ wizardError }}</div>
          <p v-if="wizardNote" class="setup-wizard-note" role="status">{{ wizardNote }}</p>

          <!-- 已确认可用的候选 -->
          <template v-if="wizardChosenRoot">
            <div class="setup-wizard-found">
              <span class="setup-wizard-ok-dot" aria-hidden="true"></span>
              <div class="setup-wizard-found-text">
                <strong>已找到可用的通达信目录</strong>
                <span>日线 {{ wizardInspect?.check.dailyFileCount ?? 0 }} 只 · 行情末日 {{ wizardInspect?.check.latestDate ?? '未知' }}（来源末日，不代表每只股票都最新）{{ wizardInspect?.check.hasAdjustment ? ' · 权息可用' : ' · 缺少权息数据' }}</span>
                <span class="setup-wizard-path">{{ wizardChosenRoot }}</span>
              </div>
              <button class="setup-wizard-primary" :disabled="wizardBusy || wizardApplying" @click="saveAndApplyWizard">{{ wizardApplying ? '正在切换…' : '保存并生效' }}</button>
            </div>
            <button class="setup-wizard-link" :disabled="wizardBusy" @click="wizardChosenRoot = ''; wizardInspect = null">换一个目录</button>
          </template>

          <!-- 候选列表：单个直显"使用这个数据"，多个并列由用户选择，不默认选中 -->
          <template v-else>
            <div v-if="wizardUsable.length" class="setup-wizard-candidates">
              <p v-if="wizardUsable.length === 1" class="setup-wizard-sub">已找到通达信：</p>
              <p v-else class="setup-wizard-sub">发现多个通达信安装，请选择要使用的一个：</p>
              <div v-for="item in wizardUsable" :key="item.check.root" class="setup-wizard-candidate">
                <div class="setup-wizard-candidate-text">
                  <strong>使用这个数据</strong>
                  <span>日线 {{ item.check.dailyFileCount }} 只 · 行情末日 {{ item.check.latestDate ?? '未知' }}{{ item.check.hasAdjustment ? ' · 权息可用' : ' · 缺少权息' }}</span>
                  <span class="setup-wizard-path">{{ item.check.root }}</span>
                </div>
                <button class="setup-wizard-primary" :disabled="wizardBusy" @click="inspectWizardRoot(item.check.root)">使用这个数据</button>
              </div>
            </div>

            <!-- 未找到/候选不可用：真实原因 + 三条出路 -->
            <div v-else class="setup-wizard-none">
              <p class="setup-wizard-sub">没有找到可用的通达信目录。</p>
              <ul v-if="wizardProcessHint" class="setup-wizard-problems"><li>{{ wizardProcessHint }}</li></ul>
              <div class="setup-wizard-actions">
                <button class="setup-wizard-secondary" :disabled="wizardBusy || wizardApplying" @click="loadWizardCandidates">打开通达信后重新检测</button>
                <button class="setup-wizard-secondary" :disabled="wizardBusy || wizardApplying" @click="chooseWizardFolder">选择通达信文件夹…</button>
              </div>
              <div class="setup-wizard-manual">
                <input v-model="wizardManualRoot" type="text" placeholder="或直接粘贴通达信安装目录（包含 vipdoc 的那层）" aria-label="手动输入通达信目录" :disabled="wizardBusy" @keydown.enter="inspectWizardRoot(wizardManualRoot)" />
                <button class="setup-wizard-secondary" :disabled="wizardBusy || !wizardManualRoot.trim()" @click="inspectWizardRoot(wizardManualRoot)">检查该目录</button>
              </div>
            </div>

            <!-- 检查结果：问题清单 + 附近候选建议（仅供确认，不自动采用） -->
            <template v-if="wizardInspect && !wizardChosenRoot">
              <ul v-if="wizardInspect.check.problems.length" class="setup-wizard-problems">
                <li v-for="problem in wizardInspect.check.problems" :key="problem">{{ problem }}</li>
              </ul>
              <div v-if="wizardInspect.suggestions.length" class="setup-wizard-suggestions">
                <p class="setup-wizard-sub">你选择的目录附近发现这些可能的安装，点击确认：</p>
                <button v-for="suggestion in wizardInspect.suggestions" :key="suggestion.root" class="setup-wizard-suggestion" :disabled="wizardBusy" @click="inspectWizardRoot(suggestion.root)">
                  {{ suggestion.root }}（日线 {{ suggestion.dailyFileCount }} 只{{ suggestion.hasAdjustment ? '' : ' · 缺权息' }}）
                </button>
              </div>
            </template>
          </template>

          <p v-if="wizardBusy && !wizardApplying" class="setup-wizard-note">正在检查…</p>
          <p class="setup-wizard-sub setup-wizard-offline-hint">
            暂时没有通达信也可以先导入分享的训练录像回放：左侧"录像" → 导入。
          </p>
        </section>
        <Launcher @created="onCreated" />
      </template>
      <section v-else-if="view === 'library'" class="recording-library recording-library-page" aria-label="训练录像库">
        <header><div><h1>训练录像</h1><p>本机历史保存在当前浏览器。导出录像可以备份，也可以分享给其他用户。</p></div><button class="ghost-button" @click="returnToTraining">返回训练</button></header>
        <label class="recording-import">导入分享的录像<input type="file" accept=".json,.gz,.trainer-session" aria-label="导入录制" @change="importRecording" /></label>
        <p v-if="recordingError" class="error-text" role="alert">{{ recordingError }}</p>
        <h2>本机训练历史</h2>
        <p v-if="!recentRecordings.length">还没有保存的训练录像</p>
        <div class="recording-history-list">
          <button v-for="item in recentRecordings" :key="item.sessionId" class="recording-history-item" @click="openRecording(item.sessionId)"><strong>{{ new Date(item.createdAt).toLocaleString() }}</strong><span>查看回放 →</span></button>
        </div>
      </section>
      <SessionReplay v-else-if="view === 'replay' && replay" :recording="replay" @close="view = 'library'; replay = null" />
      <Training v-else-if="view === 'training' && snapshot" ref="trainingRef" :key="snapshot.training.id" :snapshot="snapshot" :recording-options="recordingOptions" @ended="onTrainingEnded" />
      <div v-else class="boot-loading">正在连接本地服务…</div>
    </main>

    <!-- 训练默认设置（TRAIN-01/返修F3）：弹层挂 app-shell 根（main 之外），打开期间 rail/workspace
         inert 隔离背景焦点与原生激活；Training 保持挂载录制不中断；关闭还焦点设置入口 -->
    <TrainingSettings v-if="trainingSettingsOpen" @close="onSettingsClose" />
  </div>
</template>

<style scoped>
/* SETUP-01 首次接入向导：跟随训练器面板风格（双主题，不引外部样式） */
.setup-wizard { margin: 10px 28px 0; padding: 14px 16px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 8px; font-size: 12px; }
.setup-wizard-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.setup-wizard-head h2 { margin: 0; font-size: 15px; }
.setup-wizard-sub { margin: 4px 0 8px; color: #64748b; }
:global(body.dark) .setup-wizard-sub { color: #94a3b8; }
.setup-wizard-close { border: none; background: transparent; color: inherit; font-size: 13px; cursor: pointer; padding: 2px 6px; }
.setup-wizard-error { border: 1px solid #e5b4b4; background: #fdf1f1; color: #a03030; border-radius: 4px; padding: 6px 10px; margin: 6px 0; }
:global(body.dark) .setup-wizard-error { border-color: #6b2c2c; background: #2c1414; color: #e0a0a0; }
.setup-wizard-note { margin: 4px 0; color: #2b8b99; }
:global(body.dark) .setup-wizard-note { color: #7ec8d8; }
.setup-wizard-found, .setup-wizard-candidate { display: flex; align-items: center; gap: 12px; border: 1px solid #bfe0d2; background: #f2faf6; border-radius: 6px; padding: 10px 12px; margin: 6px 0; }
:global(body.dark) .setup-wizard-found, :global(body.dark) .setup-wizard-candidate { border-color: #2b5c49; background: #14271f; }
.setup-wizard-ok-dot { width: 8px; height: 8px; border-radius: 50%; background: #1f9d61; flex: none; }
.setup-wizard-found-text, .setup-wizard-candidate-text { display: grid; gap: 2px; flex: 1; min-width: 0; }
.setup-wizard-path { color: #64748b; word-break: break-all; font-variant-numeric: tabular-nums; }
:global(body.dark) .setup-wizard-path { color: #94a3b8; }
.setup-wizard-primary { border: 1px solid #1f7a93; background: #1f7a93; color: #fff; border-radius: 4px; padding: 6px 14px; cursor: pointer; white-space: nowrap; }
.setup-wizard-primary:disabled { opacity: 0.55; cursor: default; }
.setup-wizard-secondary { border: 1px solid #94bec5; background: transparent; color: #1c6076; border-radius: 4px; padding: 6px 12px; cursor: pointer; }
.setup-wizard-secondary:disabled { opacity: 0.55; cursor: default; }
:global(body.dark) .setup-wizard-secondary { border-color: var(--surface-border); color: var(--text-secondary, #cbd5e1); }
.setup-wizard-link { border: none; background: transparent; color: #2b8b99; cursor: pointer; padding: 2px 0; font-size: 12px; }
:global(body.dark) .setup-wizard-link { color: #7ec8d8; }
.setup-wizard-actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0; }
.setup-wizard-manual { display: flex; gap: 8px; margin: 8px 0; }
.setup-wizard-manual input { flex: 1; min-width: 0; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 4px; padding: 6px 8px; background: transparent; color: inherit; font-size: 12px; }
.setup-wizard-problems { margin: 6px 0; padding-left: 18px; color: #a03030; display: grid; gap: 2px; }
:global(body.dark) .setup-wizard-problems { color: #e0a0a0; }
.setup-wizard-suggestions { display: grid; gap: 6px; margin: 8px 0; }
.setup-wizard-suggestion { text-align: left; border: 1px solid var(--surface-border, #dfe5eb); background: transparent; color: inherit; border-radius: 4px; padding: 8px 10px; cursor: pointer; word-break: break-all; }
.setup-wizard-suggestion:hover { border-color: #94bec5; }
.setup-wizard-offline-hint { margin-top: 10px; }

/* DATA-05：unknown 状态与常驻"重新读取"入口的顶栏样式（双主题；styles.css 未动） */
.data-status-unknown { display: inline-flex; align-items: center; gap: 5px; color: #8a6d1d; font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
:global(body.dark) .data-status-unknown { color: #d9b45c; }
.data-reread-btn { height: 22px; padding: 0 8px; border-radius: 3px; border: 1px solid #d8e0e8; background: transparent; color: #51637a; font-size: 11px; white-space: nowrap; cursor: pointer; }
.data-reread-btn:hover { border-color: #94bec5; color: #1c6076; }
:global(body.dark) .data-reread-btn { border-color: var(--surface-border); color: var(--text-secondary); }
:global(body.dark) .data-reread-btn:hover { border-color: #969696; color: #ffffff; }

.recording-library { margin: 10px 28px 0; padding: 10px 14px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 8px; font-size: 12px; }
.recording-import { display: inline-flex; position: relative; align-items: center; border: 1px solid #94bec5; padding: 8px 12px; border-radius: 4px; cursor: pointer; color: #2b8b99; }
.recording-import input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; cursor: pointer; }
.recording-import:focus-within { outline: 2px solid #2b8b99; outline-offset: 2px; }
.recording-library-page { overflow-y: auto; max-height: calc(100dvh - 58px); padding: 20px; }
.recording-library-page header { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.recording-library-page h1 { margin: 0; font-size: 22px; }
.recording-library-page h2 { margin-top: 24px; font-size: 16px; }
.recording-history-list { display: grid; gap: 8px; }
.recording-history-item { display: flex; justify-content: space-between; gap: 12px; border: 1px solid var(--surface-border, #dfe5eb); padding: 14px; background: transparent; color: inherit; text-align: left; }
</style>
