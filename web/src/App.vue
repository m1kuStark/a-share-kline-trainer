<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch, watchEffect } from 'vue'
import {
  applySetupChoice, cancelLifecycleExit, confirmLifecycleExit, createLifecycleSession, fetchActiveTraining,
  fetchEnv, fetchLifecycleStatus, fetchRestartStatus, fetchSetupCandidates, heartbeatLifecycle,
  inspectSetupRoot, requestLifecycleExit, saveSetupChoice, selectSetupDirectory,
} from './api'
import type { LifecyclePendingExit, LifecycleSessionView, SetupCandidate, TdxCandidateCheck, TrainingSnapshot } from './api'
import { applyThemeClass, theme, toggleTheme } from './theme'
import { cancelDataWatchers, checkDataStatus, dataRefreshError, dataStatus, dataUpdating, onDataActive, refreshDataNow, startStatusTicker, stopStatusTicker } from './dataStatus'
import { closeTrainingSettings, openTrainingSettings, trainingSettingsOpen } from './settingsPanel'
import { Moon, Sun } from 'lucide-vue-next'
import Launcher from './views/Launcher.vue'
import Training from './views/Training.vue'
import SessionReplay from './views/SessionReplay.vue'
import History from './views/History.vue'
import Rankings from './views/Rankings.vue'
import TrainingSettings from './components/TrainingSettings.vue'
import { recordingStorage, loadLocalRecording } from './recording/recordingRepository'
import { readRecordingFile } from './recording/recordingFile'
import type { RecordingSummary } from './recording/types'
import type { CompactRecordingFile } from './recording/compactTypes'

type View = 'loading' | 'launcher' | 'training' | 'library' | 'replay' | 'history' | 'rankings'
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
// 历史训练（M4-HISTORY-01）：与录像库同一条离开协议（prepareForLibrary 先落盘画线与录制），
// 不新增停录或卸载当前 Training 的旁路；运行中进入历史由服务端 409 守卫并给出说明。
async function showHistory(): Promise<void> {
  if (view.value === 'training') {
    if (!await trainingRef.value?.prepareForLibrary()) return
  }
  view.value = 'history'
}
// 五档排行（M4-01）：同一条离开协议；运行中训练存在时由服务端 409 守卫并说明。
async function showRankings(): Promise<void> {
  if (view.value === 'training') {
    if (!await trainingRef.value?.prepareForLibrary()) return
  }
  view.value = 'rankings'
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
// PORT-01（REL-LAUNCH-UX-01 增量）：默认端口被系统保留/占用时启动器自动改用邻近端口；
// 页面常驻提示实际端口（数字来自 /api/env，无路径）。浏览器录像按访问地址存放，
// 端口变化后旧录像要回到原地址查看——提示里如实说明，并给出固定端口的方法。
const portFallbackNote = computed(() => {
  const launcherInfo = env.value?.launcher
  if (!launcherInfo || launcherInfo.fallbackFrom === null || launcherInfo.fallbackFrom === undefined) return ''
  const cause = launcherInfo.fallbackReason === 'reserved' ? '被系统保留（Windows 端口排除段）' : '被其他程序占用'
  return `本次服务运行在端口 ${launcherInfo.port}：默认端口 ${launcherInfo.fallbackFrom} ${cause}，已自动改用可用端口。`
    + `训练数据不受影响；浏览器历史录像按访问地址存放，端口变化后需回到原地址查看。`
    + `如需固定端口，请在 trainer.config.json 设置 port。`
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

// ===== 保存并退出训练器（REL-LAUNCH-UX-01） =====
// 退出不结算、不放弃训练：先冲刷本页画线/录像保存，再经同源受保护协议协调其他
// 页面确认，最后服务端排空、关闭 Fastify 与 SQLite 后进程自然退出；页面轮询到
// 端口不可达才显示"已退出"。任何拒绝、超时或失败都如实呈现，绝不静默强制结束。
type ExitFlowStep = 'closed' | 'confirm' | 'saving' | 'coordinating' | 'exiting' | 'exited' | 'failed'
const exitFlow = ref<ExitFlowStep>('closed')
const exitReason = ref('')
const exitRemaining = ref(0)
const exitRequestId = ref<string | null>(null)
const pendingExitRequest = ref<LifecyclePendingExit | null>(null)
const lifecycle = ref<LifecycleSessionView | null>(null)
const LIFECYCLE_STORAGE_KEY = 'trainer.lifecycle.session'
let heartbeatTimer: ReturnType<typeof setInterval> | undefined
let exitPollTimer: ReturnType<typeof setTimeout> | undefined
const exitModalOpen = computed(() => exitFlow.value !== 'closed')

function startHeartbeat(): void {
  stopHeartbeat()
  const interval = lifecycle.value?.heartbeatIntervalMs ?? 15_000
  heartbeatTimer = setInterval(() => { void beatOnce() }, interval)
}
function stopHeartbeat(): void {
  if (heartbeatTimer !== undefined) { clearInterval(heartbeatTimer); heartbeatTimer = undefined }
}
async function beatOnce(): Promise<void> {
  const session = lifecycle.value
  if (!session || exitFlow.value === 'exited') return
  try {
    const result = await heartbeatLifecycle(session.sessionId, session.exitToken)
    if (result.pendingExit && exitFlow.value === 'closed') {
      pendingExitRequest.value = result.pendingExit
    }
  } catch {
    // 会话可能因服务重启失效：重建一次；网络抖动则下次心跳自然重试
    try {
      const fresh = await createLifecycleSession()
      lifecycle.value = fresh
      sessionStorage.setItem(LIFECYCLE_STORAGE_KEY, JSON.stringify({ sessionId: fresh.sessionId, exitToken: fresh.exitToken }))
    } catch { /* 服务暂不可达（可能正在退出），停心跳避免无意义重试 */
      if (exitFlow.value === 'exiting') return
      stopHeartbeat()
    }
  }
}
async function ensureLifecycleSession(): Promise<LifecycleSessionView | null> {
  if (lifecycle.value) return lifecycle.value
  try {
    const stored = sessionStorage.getItem(LIFECYCLE_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as { sessionId?: string; exitToken?: string }
      if (parsed.sessionId && parsed.exitToken) {
        lifecycle.value = { sessionId: parsed.sessionId, exitToken: parsed.exitToken, heartbeatIntervalMs: 15_000, freshWindowMs: 90_000 }
        startHeartbeat()
        // 恢复会话后立即跳一次心跳：新打开/刷新的页面必须在秒级发现其他页面
        // 发起的退出请求，而不是等满第一个 15s 周期
        void beatOnce()
        return lifecycle.value
      }
    }
  } catch { /* 损坏的本地记录按无会话处理 */ }
  try {
    const fresh = await createLifecycleSession()
    lifecycle.value = fresh
    sessionStorage.setItem(LIFECYCLE_STORAGE_KEY, JSON.stringify({ sessionId: fresh.sessionId, exitToken: fresh.exitToken }))
    startHeartbeat()
    void beatOnce()
    return fresh
  } catch { /* 生命周期未启用/服务不可达：退出入口降级为提示 */ return null }
}
function openExitFlow(): void {
  exitReason.value = ''
  exitFlow.value = 'confirm'
}
function closeExitFlow(): void {
  if (exitFlow.value === 'exiting' || exitFlow.value === 'exited') return
  exitFlow.value = 'closed'
}
/** 冲刷本页待保存内容：训练页复用 prepareForLibrary（画线冲刷＋录像冲刷）。 */
async function flushLocalSaves(): Promise<void> {
  if (view.value === 'training' && trainingRef.value) {
    const ok = await trainingRef.value.prepareForLibrary()
    if (!ok) throw new Error('画线或录像尚未保存成功（训练页加载中、画线取点中或保存失败）')
  }
}
async function beginExit(): Promise<void> {
  const session = await ensureLifecycleSession()
  if (!session) {
    exitReason.value = '当前运行方式未启用退出协调（服务端生命周期不可用）'
    exitFlow.value = 'failed'
    return
  }
  exitFlow.value = 'saving'
  exitReason.value = ''
  try {
    await flushLocalSaves()
  } catch (error) {
    exitReason.value = error instanceof Error ? error.message : '保存失败'
    exitFlow.value = 'failed'
    return
  }
  try {
    const result = await requestLifecycleExit(session.sessionId, session.exitToken)
    if (result.phase === 'draining') {
      enterExiting()
      return
    }
    exitRequestId.value = result.requestId
    exitRemaining.value = result.remaining ?? 0
    exitFlow.value = 'coordinating'
    scheduleExitPoll()
  } catch (error) {
    exitReason.value = error instanceof Error ? error.message : '退出请求失败'
    exitFlow.value = 'failed'
  }
}
function enterExiting(): void {
  exitFlow.value = 'exiting'
  scheduleExitPoll()
}
/** 排空/退出轮询：轮询失败时用 /api/health 复核，端口确实不可达才算"已退出"。 */
function scheduleExitPoll(): void {
  if (exitPollTimer !== undefined) clearTimeout(exitPollTimer)
  exitPollTimer = setTimeout(() => { void pollExitOnce() }, 800)
}
async function pollExitOnce(): Promise<void> {
  if (exitFlow.value !== 'coordinating' && exitFlow.value !== 'exiting') return
  try {
    const status = await fetchLifecycleStatus()
    if (status.phase === 'draining') { enterExiting(); return }
    if (status.phase === 'awaiting') {
      exitRemaining.value = status.remaining ?? 0
      scheduleExitPoll()
      return
    }
    exitReason.value = status.reason ?? `退出未完成（${status.phase}），服务未停止`
    exitFlow.value = 'failed'
  } catch {
    // 状态接口不可达：复核健康端点，确实失联才宣告已退出
    try {
      await fetch('/api/health', { signal: AbortSignal.timeout(2_000) })
      scheduleExitPoll()
    } catch {
      exitFlow.value = 'exited'
      stopHeartbeat()
    }
  }
}
async function confirmPendingExit(): Promise<void> {
  const session = lifecycle.value
  const request = pendingExitRequest.value
  if (!session || !request) return
  pendingExitRequest.value = null
  exitRequestId.value = request.requestId
  exitFlow.value = 'saving'
  try {
    await flushLocalSaves()
  } catch (error) {
    exitReason.value = error instanceof Error ? error.message : '保存失败'
    exitFlow.value = 'failed'
    return
  }
  try {
    const result = await confirmLifecycleExit(session.sessionId, session.exitToken, request.requestId)
    if (result.phase === 'draining') enterExiting()
    else { exitRemaining.value = result.remaining ?? 0; exitFlow.value = 'coordinating'; scheduleExitPoll() }
  } catch (error) {
    exitReason.value = error instanceof Error ? error.message : '确认退出失败'
    exitFlow.value = 'failed'
  }
}
async function refusePendingExit(): Promise<void> {
  const session = lifecycle.value
  const request = pendingExitRequest.value
  if (!session || !request) return
  pendingExitRequest.value = null
  try { await cancelLifecycleExit(session.sessionId, session.exitToken, request.requestId) } catch { /* 拒绝语义不依赖回执 */ }
}

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
  // 退出协调会话：env 可达后注册并开始心跳（不可达时在退出流程内降级提示）
  void ensureLifecycleSession()
  await refresh()
})
onUnmounted(() => {
  window.removeEventListener('focus', onDataFocus)
  document.removeEventListener('visibilitychange', onDataVisibilityChange)
  cancelDataWatchers()
  if (shakeTimer !== undefined) { clearInterval(shakeTimer); shakeTimer = undefined }
  stopHeartbeat()
  if (exitPollTimer !== undefined) clearTimeout(exitPollTimer)
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
        <button class="rail-item" :class="{ active: view === 'rankings' }" title="五档排行" aria-label="五档排行" @click="showRankings">▲<span>排行</span></button>
        <button class="rail-item" :class="{ active: view === 'history' }" title="历史训练" aria-label="历史训练" @click="showHistory">▤<span>历史</span></button>
        <button class="rail-item" :class="{ active: view === 'library' || view === 'replay' }" title="训练录像" aria-label="训练录像" :disabled="libraryBusy" @click="showLibrary">◫<span>录像</span></button>
      </nav>
      <button class="rail-item" title="保存并退出训练器" aria-label="保存并退出训练器" @click="openExitFlow">⏻<span>退出</span></button>
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
            <button v-else-if="dataWidgetState === 'unavailable'" class="data-update-btn unavailable" title="未检测到通达信数据目录，点击选择通达信文件夹" @click="openWizard">连接通达信</button>
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

      <!-- PORT-01：默认端口不可用自动改用邻近端口时的常驻提示（所有视图可见） -->
      <div v-if="portFallbackNote" class="port-fallback-note" role="status">{{ portFallbackNote }}</div>

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
      <History v-else-if="view === 'history'" @create="returnToTraining" />
      <Rankings v-else-if="view === 'rankings'" @create="returnToTraining" />
      <Training v-else-if="view === 'training' && snapshot" ref="trainingRef" :key="snapshot.training.id" :snapshot="snapshot" :recording-options="recordingOptions" @ended="onTrainingEnded" @open-history="showHistory" />
      <div v-else class="boot-loading">正在连接本地服务…</div>
    </main>

    <!-- 训练默认设置（TRAIN-01/返修F3）：弹层挂 app-shell 根（main 之外），打开期间 rail/workspace
         inert 隔离背景焦点与原生激活；Training 保持挂载录制不中断；关闭还焦点设置入口 -->
    <TrainingSettings v-if="trainingSettingsOpen" @close="onSettingsClose" />

    <!-- 保存并退出训练器（REL-LAUNCH-UX-01）：保存→协调→排空→端口不可达才算已退出 -->
    <div v-if="exitModalOpen" class="exit-overlay" role="dialog" aria-modal="true" aria-label="退出训练器">
      <div class="exit-panel">
        <template v-if="exitFlow === 'confirm'">
          <h2>保存并退出训练器？</h2>
          <p>未结算的训练进度会保留，不会自动结算或放弃。退出前会等待画线、录像等保存完成。</p>
          <div class="exit-actions">
            <button class="exit-primary" @click="beginExit">保存并退出</button>
            <button class="exit-secondary" @click="closeExitFlow">取消</button>
          </div>
        </template>
        <template v-else-if="exitFlow === 'saving'">
          <h2>正在保存…</h2>
          <p>正在等待画线、录像与在途请求保存完成。</p>
        </template>
        <template v-else-if="exitFlow === 'coordinating'">
          <h2>等待其他页面确认…</h2>
          <p>检测到还有 {{ exitRemaining }} 个页面打开。请在其他训练器页面上确认"保存并退出"；若有页面拒绝或未响应，本次退出会自动取消，服务不会停止。</p>
          <div class="exit-actions">
            <button class="exit-secondary" @click="closeExitFlow">后台等待</button>
          </div>
        </template>
        <template v-else-if="exitFlow === 'exiting'">
          <h2>正在退出…</h2>
          <p>正在关闭数据写入并等待服务退出（端口、数据库与本机录像保持不变）。</p>
        </template>
        <template v-else-if="exitFlow === 'failed'">
          <h2>退出未完成</h2>
          <p class="exit-error" role="alert">{{ exitReason }}</p>
          <p>服务仍在运行，未保存的内容不会丢失。</p>
          <div class="exit-actions">
            <button class="exit-primary" @click="openExitFlow">重试</button>
            <button class="exit-secondary" @click="closeExitFlow">取消</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 其他页面发来的退出请求：确认保存或拒绝（拒绝后发起方会收到取消结果） -->
    <div v-if="pendingExitRequest && !exitModalOpen" class="exit-overlay" role="alertdialog" aria-modal="true" aria-label="另一页面请求退出">
      <div class="exit-panel">
        <h2>另一页面请求退出训练器</h2>
        <p>请先确认本页面的画线、录像已保存，再确认退出；选择拒绝则服务继续运行。</p>
        <div class="exit-actions">
          <button class="exit-primary" @click="confirmPendingExit">保存并退出</button>
          <button class="exit-secondary" @click="refusePendingExit">拒绝</button>
        </div>
      </div>
    </div>

    <!-- 已退出：服务已停止、端口已释放；此页只剩本地内容，可安全关闭 -->
    <div v-if="exitFlow === 'exited'" class="exit-exited-screen">
      <div class="exit-exited-panel">
        <h2>训练器已退出</h2>
        <p>服务已正常关闭，端口已释放；训练进度、数据库与本机录像都已保留。</p>
        <p>本页面已与后台断开，可以关闭此标签页。下次双击 Start.cmd 即可继续使用。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* REL-LAUNCH-UX-01 保存并退出：遮罩/面板/已退出页（双主题） */
.exit-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 90; }
.exit-panel { background: #fff; color: #1e293b; border-radius: 10px; padding: 22px 24px; width: min(440px, calc(100vw - 40px)); box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25); }
.exit-panel h2 { margin: 0 0 10px; font-size: 17px; }
.exit-panel p { margin: 6px 0; font-size: 13px; line-height: 1.6; color: #475569; }
:global(body.dark) .exit-panel { background: #10192a; color: #e2e8f0; }
:global(body.dark) .exit-panel p { color: #94a3b8; }
.exit-error { color: #a03030; font-weight: 600; }
:global(body.dark) .exit-error { color: #e0a0a0; }
.exit-actions { display: flex; gap: 10px; margin-top: 16px; }
.exit-primary { border: 1px solid #1f7a93; background: #1f7a93; color: #fff; border-radius: 4px; padding: 7px 16px; cursor: pointer; }
.exit-primary:hover { filter: brightness(1.08); }
.exit-secondary { border: 1px solid var(--surface-border, #dfe5eb); background: transparent; color: inherit; border-radius: 4px; padding: 7px 16px; cursor: pointer; }
.exit-exited-screen { position: fixed; inset: 0; background: #f6f8fa; display: flex; align-items: center; justify-content: center; z-index: 100; }
.exit-exited-panel { text-align: center; max-width: 460px; padding: 24px; }
.exit-exited-panel h2 { margin: 0 0 12px; font-size: 20px; color: #1e293b; }
.exit-exited-panel p { margin: 6px 0; font-size: 13px; line-height: 1.7; color: #475569; }
:global(body.dark) .exit-exited-screen { background: #0b1220; }
:global(body.dark) .exit-exited-panel h2 { color: #e2e8f0; }
:global(body.dark) .exit-exited-panel p { color: #94a3b8; }

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
/* PORT-01：默认端口不可用自动改用邻近端口的常驻提示（双主题；信息级样式，非错误） */
.port-fallback-note { margin: 12px 30px 0; padding: 8px 14px; background: #eef6fb; border: 1px solid #bcd8e8; color: #1c6076; font-size: 12px; border-radius: 4px; }
:global(body.dark) .port-fallback-note { background: #1b2833; border-color: #2f4a5c; color: #9ec5da; }
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
