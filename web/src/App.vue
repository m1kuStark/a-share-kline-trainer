<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch, watchEffect } from 'vue'
import {
  applySetupChoice, cancelLifecycleExit, confirmLifecycleExit, createLifecycleSession, fetchActiveTraining,
  fetchEnv, fetchLifecycleStatus, fetchRestartStatus, heartbeatLifecycle,
  inspectSetupRoot, requestLifecycleExit, saveSetupChoice, selectSetupDirectory,
} from './api'
import type { LifecyclePendingExit, LifecycleSessionView, TrainingSnapshot } from './api'
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
import RecordingLibrary from './components/RecordingLibrary.vue'
import { configureRecordingNamespace, listRecordingLibrary, importRecording as saveImportedRecording, loadLibraryRecording, removeLibraryRecordings, clearRecordingSource } from './recording/recordingRepository'
import type { RecordingLibraryItem, RecordingRemovalResult, RecordingSource } from './recording/recordingRepository'
import { readRecordingFile } from './recording/recordingFile'
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
const recentRecordings = ref<RecordingLibraryItem[]>([])
const recordingError = ref('')
const recordingBusy = ref(false)
const recordingNamespaceReady = ref(false)
let recordingLoadVersion = 0
// Startup refresh is asynchronous. A user can navigate before it finishes;
// keep the late response from overwriting that explicit navigation.
let navigationVersion = 0
const activeTrainingKey = computed(() => snapshot.value?.training.status === 'running'
  ? `${snapshot.value.training.id}.${snapshot.value.training.createdAt}` : null)
const activeRecordingIds = computed(() => recentRecordings.value
  .filter(item => item.source === 'local' && item.trainingKey === activeTrainingKey.value)
  .map(item => item.sessionId))
async function loadRecordings(): Promise<void> {
  const version = ++recordingLoadVersion
  try {
    if (!recordingNamespaceReady.value) {
      await reloadEnv()
      if (!recordingNamespaceReady.value) return
    }
    const items = await listRecordingLibrary()
    if (version === recordingLoadVersion) {
      recentRecordings.value = items
      recordingError.value = ''
    }
  }
  catch (error) { if (version === recordingLoadVersion) recordingError.value = error instanceof Error ? error.message : '无法读取录像库' }
}
watch(view, value => {
  if (recordingNamespaceReady.value && (value === 'launcher' || value === 'library')) void loadRecordings()
})
watch(recordingNamespaceReady, ready => {
  if (ready && (view.value === 'launcher' || view.value === 'library')) void loadRecordings()
})
async function showLibrary(): Promise<void> {
  if (libraryBusy.value) return
  const previousView = view.value
  navigationVersion++
  libraryBusy.value = true
  // Commit navigation immediately when Training is not mounted. This keeps
  // the library responsive during startup/IndexedDB migration.
  if (previousView !== 'training') view.value = 'library'
  try {
    if (!recordingNamespaceReady.value) {
      await reloadEnv()
      if (!recordingNamespaceReady.value) return
    }
    // The view watcher may have attempted the list before reloadEnv finished;
    // retry after namespace installation so the first library view is useful.
    await loadRecordings()
    // Keep Training mounted until its pending drawing/recording writes are
    // flushed. Setting the view before this check would unmount it and make
    // prepareForLibrary unavailable.
    if (previousView === 'training') {
      if (!await trainingRef.value?.prepareForLibrary()) return
    }
    replay.value = null
    view.value = 'library'
  } finally { libraryBusy.value = false }
}
// 历史训练（M4-HISTORY-01）：与录像库同一条离开协议（prepareForLibrary 先落盘画线与录制），
// 不新增停录或卸载当前 Training 的旁路；运行中进入历史由服务端 409 守卫并给出说明。
async function showHistory(): Promise<void> {
  navigationVersion++
  if (view.value === 'training') {
    if (!await trainingRef.value?.prepareForLibrary()) return
  }
  view.value = 'history'
}
// 五档排行（M4-01）：同一条离开协议；运行中训练存在时由服务端 409 守卫并说明。
async function showRankings(): Promise<void> {
  navigationVersion++
  if (view.value === 'training') {
    if (!await trainingRef.value?.prepareForLibrary()) return
  }
  view.value = 'rankings'
}
async function returnToTraining(): Promise<void> {
  if (view.value === 'training') return
  navigationVersion++
  replay.value = null
  view.value = 'loading'
  await refresh()
}
async function onCreated(options: { enabled: boolean; params: Record<string, unknown> }): Promise<void> {
  recordingOptions.value = options
  await refresh()
}
async function importRecording(file: File): Promise<void> {
  if (recordingBusy.value) return
  recordingBusy.value = true
  recordingError.value = ''
  try {
    // The library shell can render before the initial env request completes;
    // finish namespace setup before accepting an import from that first view.
    if (!recordingNamespaceReady.value) {
      await reloadEnv()
      if (!recordingNamespaceReady.value) throw new Error('录像库尚未完成初始化，请稍后重试')
    }
    const item = await saveImportedRecording(await readRecordingFile(file), file.name)
    recentRecordings.value = [item, ...recentRecordings.value.filter(row => row.sessionId !== item.sessionId)]
    await openRecording(item.sessionId, item)
  } catch (error) { recordingError.value = error instanceof Error ? error.message : '无法导入录制文件' }
  finally { recordingBusy.value = false }
}
async function openRecording(id: string, knownItem?: RecordingLibraryItem): Promise<void> {
  recordingError.value = ''
  try {
    const item = knownItem ?? recentRecordings.value.find(row => row.sessionId === id)
    if (!item) throw new Error('找不到这份录像')
    replay.value = await loadLibraryRecording(item)
    if (!replay.value) throw new Error('找不到这份录像')
    navigationVersion++
    view.value = 'replay'
  } catch (error) { recordingError.value = error instanceof Error ? error.message : '无法打开录制' }
}
async function removeRecordings(action: () => Promise<RecordingRemovalResult>): Promise<void> {
  if (recordingBusy.value) return
  recordingBusy.value = true
  recordingError.value = ''
  try {
    const result = await action()
    await loadRecordings()
    if (result.failed.length) recordingError.value = [...new Set(result.failed.map(failure => failure.reason))].join('；')
  } catch (error) { recordingError.value = error instanceof Error ? error.message : '无法删除录像' }
  finally { recordingBusy.value = false }
}
async function removeRecording(id: string): Promise<void> {
  const item = recentRecordings.value.find(row => row.sessionId === id)
  if (item) await removeRecordings(() => removeLibraryRecordings([item], activeTrainingKey.value))
}
async function clearRecordings(source: RecordingSource): Promise<void> {
  await removeRecordings(() => clearRecordingSource(source, activeTrainingKey.value))
}

watchEffect(() => applyThemeClass())

async function refresh(options: { preserveNavigation?: boolean } = {}): Promise<void> {
  const requestedNavigationVersion = navigationVersion
  if (!recordingNamespaceReady.value) {
    await reloadEnv()
    if (!recordingNamespaceReady.value) return
  }
  try {
    const requested = new URL(location.href).searchParams.get('training')
    const result = requested && /^[1-9]\d*$/.test(requested)
      ? await fetch(`/api/trainings/${requested}`).then(async response => { if (!response.ok) throw new Error('训练不存在'); return await response.json() as TrainingSnapshot })
      : await fetchActiveTraining()
    if (requestedNavigationVersion !== navigationVersion) return
    // The first refresh runs while the shell is already interactive. Preserve
    // a rail navigation made before the async request completed.
    if (options.preserveNavigation && view.value !== 'loading') return
    if ('training' in result && result.training === null) {
      snapshot.value = null
      view.value = 'launcher'
    } else {
      snapshot.value = result as TrainingSnapshot
      view.value = 'training'
    }
  } catch (error) {
    // A failed late refresh must obey the same navigation guard as a
    // successful response; otherwise a transient startup/network error can
    // still replace an explicitly opened library or replay view.
    if (requestedNavigationVersion !== navigationVersion) return
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

// ===== 通达信连接：用户点击顶栏后直接选择目录并连接 =====
// 不自动发现安装目录、不查询进程线索；选择器结果只做单目录校验，成功后保存并受控重启。
const wizardBusy = ref(false)
const wizardError = ref('')
const wizardNote = ref('')
const wizardChosenRoot = ref('')
const wizardApplying = ref(false)
const disconnected = computed(() => env.value?.tdx?.connected === false)
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
async function reloadEnv(): Promise<void> {
  try {
    const next = await fetchEnv()
    configureRecordingNamespace(next.recordingNamespace)
    recordingNamespaceReady.value = true
    env.value = next
    envError.value = ''
  } catch (error) { envError.value = error instanceof Error ? error.message : '无法连接本地服务' }
}
function openWizard(): void {
  wizardError.value = ''
  wizardNote.value = ''
  void chooseWizardFolder()
}
async function chooseWizardFolder(): Promise<void> {
  if (wizardBusy.value) return
  wizardBusy.value = true
  wizardError.value = ''
  try {
    const picked = await selectSetupDirectory()
    if (picked.status === 'selected' && picked.path) {
      const result = await inspectSetupRoot(picked.path)
      if (!(result.check.recognized && result.check.readable)) {
        wizardError.value = result.check.problems.join('；') || '所选目录不符合通达信数据目录要求，请重新选择'
        return
      }
      wizardChosenRoot.value = result.check.root
      wizardBusy.value = false
      await saveAndApplyWizard()
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
async function cancelExitCoordination(): Promise<void> {
  const session = lifecycle.value
  const requestId = exitRequestId.value
  if (session && requestId && exitFlow.value === 'coordinating') {
    try { await cancelLifecycleExit(session.sessionId, session.exitToken, requestId) } catch { /* 服务已不可达时由下一次心跳恢复 */ }
  }
  pendingExitRequest.value = null
  exitRequestId.value = null
  exitRemaining.value = 0
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
  const startupNavigationVersion = navigationVersion
  window.addEventListener('focus', onDataFocus)
  document.addEventListener('visibilitychange', onDataVisibilityChange)
  void checkDataStatus({ force: true })
  startStatusTicker()
  await reloadEnv()
  if (navigationVersion !== startupNavigationVersion) return
  // 退出协调会话：env 可达后注册并开始心跳（不可达时在退出流程内降级提示）
  void ensureLifecycleSession()
  await refresh({ preserveNavigation: true })
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
function onTrainingRetrained(next: TrainingSnapshot): void {
  snapshot.value = next
  view.value = 'training'
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
      <button class="rail-item" title="保存并退出训练器" aria-label="保存并退出训练器" :disabled="wizardBusy || wizardApplying || exitFlow !== 'closed'" @click="openExitFlow">⏻<span>退出</span></button>
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
              <button v-if="disconnected" class="data-reread-btn" title="重新连接数据：选择通达信目录" @click="openWizard">连接通达信</button>
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

      <div v-if="envError && view !== 'replay'" class="env-error">{{ envError }} <button class="data-reread-btn" @click="() => refresh()">重新连接</button></div>

      <div v-if="wizardBusy" class="picker-blocker" role="dialog" aria-modal="true" aria-label="通达信目录选择">
        <div class="picker-blocker-panel">
          <h2>{{ wizardApplying ? '正在切换通达信目录' : '正在打开通达信目录选择器' }}</h2>
          <p>{{ wizardApplying ? '正在校验并应用目录，请稍候。' : '请在前置的 Windows 目录选择器中选择通达信根目录；取消选择后可继续使用训练器。' }}</p>
          <span class="picker-blocker-hint">训练器当前页面已锁定，避免在目录选择期间误触退出。</span>
        </div>
      </div>

      <template v-if="view === 'launcher'">
        <p v-if="wizardError" class="setup-connection-error" role="alert">{{ wizardError }} <button class="data-reread-btn" @click="openWizard">重新选择目录</button></p>
        <p v-if="wizardNote" class="setup-connection-note" role="status">{{ wizardNote }}</p>
        <Launcher @created="onCreated" />
      </template>
      <RecordingLibrary v-else-if="view === 'library'" :items="recentRecordings" :busy="recordingBusy" :error="recordingError" :active-session-ids="activeRecordingIds" @replay="openRecording" @import="importRecording" @remove="removeRecording" @clear="clearRecordings" @close="returnToTraining" />
      <SessionReplay v-else-if="view === 'replay' && replay" :recording="replay" @close="view = 'library'; replay = null" />
      <History v-else-if="view === 'history'" @create="returnToTraining" />
      <Rankings v-else-if="view === 'rankings'" @create="returnToTraining" />
      <Training v-else-if="view === 'training' && snapshot" ref="trainingRef" :key="snapshot.training.id" :snapshot="snapshot" :recording-options="recordingOptions" @ended="onTrainingEnded" @open-history="showHistory" @retrained="onTrainingRetrained" />
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
            <button class="exit-secondary" @click="cancelExitCoordination">后台等待</button>
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
    <div v-if="exitFlow === 'exited'" class="exit-exited-screen" :class="{ 'dark-exited': theme === 'dark' }">
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
.exit-panel { background: var(--surface-background, #fff); color: var(--text-primary, #1e293b); border-radius: 10px; padding: 22px 24px; width: min(440px, calc(100vw - 40px)); box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25); }
.exit-panel h2 { margin: 0 0 10px; font-size: 17px; }
.exit-panel p { margin: 6px 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary, #475569); }
.exit-panel .exit-error { color: #a03030; font-weight: 600; }
:global(body.dark .exit-panel .exit-error) { color: #e0a0a0; }
.exit-actions { display: flex; gap: 10px; margin-top: 16px; }
.exit-primary { border: 1px solid #1f7a93; background: #1f7a93; color: #fff; border-radius: 4px; padding: 7px 16px; cursor: pointer; }
.exit-primary:hover { filter: brightness(1.08); }
.exit-secondary { border: 1px solid var(--surface-border, #dfe5eb); background: transparent; color: inherit; border-radius: 4px; padding: 7px 16px; cursor: pointer; }
.exit-exited-screen { position: fixed; inset: 0; background: var(--surface-background, #f6f8fa); color: var(--text-primary, #1e293b); display: flex; align-items: center; justify-content: center; z-index: 100; }
.exit-exited-panel { text-align: center; max-width: 560px; padding: 24px; }
.exit-exited-panel h2 { margin: 0 0 12px; font-size: 20px; color: var(--text-primary, #1e293b); }
.exit-exited-panel p { margin: 6px 0; font-size: 13px; line-height: 1.7; color: var(--text-secondary, #475569); }
.exit-exited-screen.dark-exited { background: #151515; color: #e4e4e4; }
.exit-exited-screen.dark-exited .exit-exited-panel h2 { color: #e4e4e4; }
.exit-exited-screen.dark-exited .exit-exited-panel p { color: #b8b8b8; }
.picker-blocker { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; background: rgba(15, 23, 42, .48); }
.picker-blocker-panel { width: min(440px, calc(100vw - 40px)); padding: 22px 24px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 8px; background: var(--surface-background, #fff); color: var(--text-primary, #1c2733); box-shadow: 0 18px 48px rgba(0, 0, 0, .25); }
.picker-blocker-panel h2 { margin: 0 0 10px; font-size: 17px; }
.picker-blocker-panel p { margin: 6px 0; line-height: 1.6; color: var(--text-secondary, #51637a); }
.picker-blocker-hint { display: block; margin-top: 12px; color: var(--text-muted, #7b8794); font-size: 12px; }
:global(body.dark) .picker-blocker { background: rgba(0, 0, 0, .68); }

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
.recording-store-note { margin: 6px 0 0; color: var(--text-secondary, #6b7c8d); font-size: 12px; line-height: 1.5; }
.recording-history-item { display: flex; justify-content: space-between; gap: 12px; border: 1px solid var(--surface-border, #dfe5eb); padding: 14px; background: transparent; color: inherit; text-align: left; }
</style>
