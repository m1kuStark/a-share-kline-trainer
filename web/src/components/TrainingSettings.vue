<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { fetchTrainingSettings, putTrainingSettings, selectSetupDirectory, type TrainingSettingsView } from '../api'
import { notifySettingsSaved } from '../settingsPanel'
import {
  RECONNECT_MAX_ATTEMPTS, UPDATE_STATE_TEXT, decidePollStep, detectUpdateChannel, desktopEventToApplyView,
  DESKTOP_APPLY_STATE_TEXT, isBusyUpdatePhase, updateGuardText, versionLabel,
  type DesktopApplyState, type DesktopUpdatesApi, type UpdateFlowState,
} from '../updateFlow'
import {
  fetchAppSettings, putAppSettings, fetchTdxPathSettings, validateTdxPath, putTdxPath,
  fetchKeyboardShortcuts, putKeyboardShortcuts, type TdxPathSettingsView, type TdxCandidateCheckInfo,
  fetchDataDirSettings, putDataDir, type DataDirSettingsView,
  appOdoMotion, setOdoMotion,
} from '../appSettings'
import { DRAW_TOOLS } from '../drawTools'
import { DEFAULT_FAVORITE_TOOLS, DEFAULT_TOOL_STYLE, loadFavoriteTools, loadToolStylePreferences, saveFavoriteTools, saveToolStylePreferences, type ToolStylePreference, type ToolStylePreferences } from '../toolFavorites'
import {
  SHORTCUT_ACTIONS, SHORTCUT_ACTION_LABELS,
  clonePreferences, formatShortcut, loadKeyboardShortcuts, normalizeShortcut,
  notifyKeyboardShortcutsChanged, saveKeyboardShortcuts, shortcutConflict, validateKeyboardShortcuts,
  type KeyboardShortcutPreferences, type ShortcutAction,
} from '../keyboardShortcuts'

// TRAIN-01/M5-DEFAULTS 训练默认设置面板：局部弹层（不卸载正在录制的训练）。
// 四字段一起原子保存：费用开关、T+1、默认初始资金（0.01..1,000,000,000 元、至多两位小数）、
// 默认复权（forward/raw）。保存成功给明确反馈；取消/失败不假称保存，也不改变任何进行中的训练。
// 默认只影响之后新建的训练；本局规则在创建时冻结。弹层只保留标题栏关闭出口。
// 损坏默认（409 TRAINING_DEFAULTS_UNREADABLE）不是死局：面板即修复入口，完整保存即可修复。
// M5-01 新增两个区块：应用偏好（自动检查日线数据，即时保存即时生效）与
// 数据目录（通达信）（查看/校验/保存，保存后需重启应用生效；失败保留原选择）。

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
const activeSection = ref<'defaults' | 'preferences' | 'animation' | 'data' | 'about'>('defaults')
const favoriteToolNames = ref(loadFavoriteTools(localStorage))
const toolPreferences = ref<ToolStylePreferences>(loadToolStylePreferences(localStorage))
const selectedTool = ref(favoriteToolNames.value[0] ?? DEFAULT_FAVORITE_TOOLS[0])
const selectedToolPreference = ref<ToolStylePreference>({ ...DEFAULT_TOOL_STYLE })
const fixedArrowTools = new Set(['bullArrow', 'bearArrow'])
const keyboardShortcuts = ref<KeyboardShortcutPreferences>(loadKeyboardShortcuts(localStorage))
const shortcutRecording = ref<{ action: ShortcutAction; slot: number } | null>(null)
const shortcutCaptureKeys = ref<string[]>([])
const shortcutError = ref('')
const shortcutSaved = ref('')
const shortcutSaving = ref(false)
const shortcutFormDirty = ref(false)
const shortcutPressedKeys = new Set<string>()
function loadSelectedToolPreference(): void {
  selectedToolPreference.value = { ...DEFAULT_TOOL_STYLE, ...(toolPreferences.value[selectedTool.value] ?? {}) }
}
loadSelectedToolPreference()
function persistToolPreferences(): void {
  toolPreferences.value = { ...toolPreferences.value, [selectedTool.value]: { ...selectedToolPreference.value } }
  saveFavoriteTools(localStorage, favoriteToolNames.value)
  saveToolStylePreferences(localStorage, toolPreferences.value)
}
function selectTool(name: string): void { selectedTool.value = name; loadSelectedToolPreference() }
function toggleFavoriteTool(name: string): void {
  favoriteToolNames.value = favoriteToolNames.value.includes(name)
    ? favoriteToolNames.value.filter(item => item !== name)
    : [...favoriteToolNames.value, name]
  if (!favoriteToolNames.value.length) favoriteToolNames.value = [name]
  if (!favoriteToolNames.value.includes(selectedTool.value)) selectedTool.value = favoriteToolNames.value[0]!
  persistToolPreferences()
}
function resetToolPreference(): void { selectedToolPreference.value = { ...DEFAULT_TOOL_STYLE }; persistToolPreferences() }

function isFixedArrowTool(name: string): boolean { return fixedArrowTools.has(name) }

function shortcutDisplay(action: ShortcutAction, slot: number): string {
  return formatShortcut(keyboardShortcuts.value[action]?.[slot] ?? []) || '未设置'
}
function hasShortcut(action: ShortcutAction, slot: number): boolean {
  return Boolean(keyboardShortcuts.value[action]?.[slot])
}
function isRecordingShortcut(action: ShortcutAction, slot: number): boolean {
  return shortcutRecording.value?.action === action && shortcutRecording.value.slot === slot
}
function recordingLabel(action: ShortcutAction, slot: number): string {
  return isRecordingShortcut(action, slot)
    ? (shortcutCaptureKeys.value.length ? formatShortcut(shortcutCaptureKeys.value) : '请按键')
    : shortcutDisplay(action, slot)
}

function stopShortcutCapture(): void {
  document.removeEventListener('keydown', onShortcutCaptureKeydown, true)
  document.removeEventListener('keyup', onShortcutCaptureKeyup, true)
  shortcutRecording.value = null
  shortcutCaptureKeys.value = []
  shortcutPressedKeys.clear()
}

function beginShortcutCapture(action: ShortcutAction, slot: number): void {
  stopShortcutCapture()
  shortcutError.value = ''
  shortcutSaved.value = ''
  shortcutRecording.value = { action, slot }
  shortcutFormDirty.value = true
  document.addEventListener('keydown', onShortcutCaptureKeydown, true)
  document.addEventListener('keyup', onShortcutCaptureKeyup, true)
}

function isModifierCode(code: string): boolean { return ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(code) }

function onShortcutCaptureKeydown(event: KeyboardEvent): void {
  if (!shortcutRecording.value) return
  event.preventDefault()
  event.stopPropagation()
  const code = event.code || event.key
  if (!code || event.isComposing) return
  if (!shortcutPressedKeys.has(code)) shortcutPressedKeys.add(code)
  shortcutCaptureKeys.value = normalizeShortcut([...shortcutPressedKeys])
  if (shortcutCaptureKeys.value.length > 2) {
    shortcutError.value = '一个快捷键最多包含两个同时按下的按键'
    return
  }
  if (isModifierCode(code)) return
  const candidate = shortcutCaptureKeys.value
  const { action, slot } = shortcutRecording.value
  const conflict = shortcutConflict(keyboardShortcuts.value, action, candidate, slot)
  if (conflict) {
    shortcutError.value = `与“${SHORTCUT_ACTION_LABELS[conflict]}”重复，请换一个组合`
    return
  }
  const next = clonePreferences(keyboardShortcuts.value)
  const bindings = next[action].filter((_, index) => index !== slot)
  bindings.splice(Math.min(slot, bindings.length), 0, candidate)
  next[action] = bindings.slice(0, 2)
  void persistKeyboardShortcuts(next, keyboardShortcuts.value)
  stopShortcutCapture()
}

function onShortcutCaptureKeyup(event: KeyboardEvent): void {
  shortcutPressedKeys.delete(event.code || event.key)
}

function clearShortcut(action: ShortcutAction, slot: number): void {
  const next = clonePreferences(keyboardShortcuts.value)
  next[action] = next[action].filter((_, index) => index !== slot)
  shortcutFormDirty.value = true
  void persistKeyboardShortcuts(next, keyboardShortcuts.value)
}

async function persistKeyboardShortcuts(next: KeyboardShortcutPreferences, previous: KeyboardShortcutPreferences): Promise<void> {
  if (!validateKeyboardShortcuts(next)) {
    shortcutError.value = '快捷键保存失败：存在重复或非法组合'
    return
  }
  shortcutSaving.value = true
  shortcutError.value = ''
  shortcutSaved.value = ''
  try {
    const saved = await putKeyboardShortcuts(next)
    keyboardShortcuts.value = saved.shortcuts
    shortcutFormDirty.value = false
    saveKeyboardShortcuts(localStorage, saved.shortcuts)
    notifyKeyboardShortcutsChanged()
    shortcutSaved.value = '已保存'
  } catch (error) {
    keyboardShortcuts.value = previous
    shortcutError.value = error instanceof Error ? error.message : '快捷键保存失败，服务端未更新'
  } finally {
    shortcutSaving.value = false
  }
}
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
  void loadAppSections()
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
  stopShortcutCapture()
  stopUpdatePolling()
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

// ===== M5-01 应用偏好：自动检查日线数据（即时保存，失败还原开关） =====
const autoDataCheckForm = ref(true)
const appPrefLoadError = ref('')
const appPrefSaving = ref(false)
const appPrefError = ref('')
const appPrefSaved = ref('')

async function loadAppSections(): Promise<void> {
  appPrefLoadError.value = ''
  try {
    const view = await fetchAppSettings()
    autoDataCheckForm.value = view.autoDataCheck
  } catch (error) {
    // 含损坏偏好 409：表单按缺省呈现，重新切换并保存即修复（服务端 message 已含指引）
    appPrefLoadError.value = error instanceof Error ? error.message : '无法读取应用偏好'
    autoDataCheckForm.value = true
  }
  try {
    const view = await fetchKeyboardShortcuts()
    if (!shortcutFormDirty.value) {
      keyboardShortcuts.value = view.shortcuts
      saveKeyboardShortcuts(localStorage, view.shortcuts)
    }
  } catch (error) {
    shortcutError.value = error instanceof Error ? error.message : '无法读取快捷键设置，将使用本机缓存'
  }
  tdxLoadError.value = ''
  try {
    const view = await fetchTdxPathSettings()
    tdxView.value = view
    if (view.savedChoice !== null && !tdxPathTouched.value) tdxPathInput.value = view.savedChoice.root
  } catch (error) {
    tdxLoadError.value = error instanceof Error ? error.message : '无法读取数据目录设置'
  }
  dataDirLoadError.value = ''
  try {
    const view = await fetchDataDirSettings()
    dataDirView.value = view
    if (!dataDirTouched.value) dataDirInput.value = view.configuredDir ?? view.effectiveDir
  } catch (error) {
    dataDirLoadError.value = error instanceof Error ? error.message : '无法读取训练数据目录设置'
  }
}

async function onAutoDataCheckChange(): Promise<void> {
  if (appPrefSaving.value) return
  const previous = !autoDataCheckForm.value
  appPrefSaving.value = true
  appPrefError.value = ''
  appPrefSaved.value = ''
  try {
    const saved = await putAppSettings(autoDataCheckForm.value)
    autoDataCheckForm.value = saved.autoDataCheck
    appPrefSaved.value = saved.autoDataCheck
      ? '已保存：自动检查保持开启'
      : '已保存：将只在点击「更新日线 / 重新读取」时检查日线数据'
  } catch (error) {
    autoDataCheckForm.value = previous
    appPrefError.value = error instanceof Error ? error.message : '保存失败，偏好未更改'
  } finally {
    appPrefSaving.value = false
  }
}

// ===== M6-07 动画效果分栏：数字滚动动效开关 =====
// 用户 2026-10-05 验收拍板：动画开关进设置（训练中可调），单独"动画效果"分栏，未来其它动画
// 统一在此平铺追加。首项开关即改即生效（无需保存按钮）：写 appOdoMotion 响应式引用＋
// localStorage 持久化（键沿用 trainer_odo_motion，不换键；Training.vue 的 beginRoll 据此放行/跳过）。
function onOdoMotionChange(event: Event): void {
  setOdoMotion((event.target as HTMLInputElement).checked)
}

// ===== M5-01 数据目录（通达信）：查看 / 校验 / 保存（重启生效） =====
const tdxView = ref<TdxPathSettingsView | null>(null)
const tdxLoadError = ref('')
const tdxPathInput = ref('')
const tdxPathTouched = ref(false)
const tdxChecking = ref(false)
const tdxCheck = ref<TdxCandidateCheckInfo | null>(null)
const tdxCheckError = ref('')
const tdxSaving = ref(false)
const tdxError = ref('')
const tdxSavedMessage = ref('')

// ===== V1.2.6 训练数据目录：查看 / 选择 / 保存（写回启动器配置，重启生效） =====
const dataDirView = ref<DataDirSettingsView | null>(null)
const dataDirLoadError = ref('')
const dataDirInput = ref('')
const dataDirTouched = ref(false)
const dataDirSaving = ref(false)
const dataDirError = ref('')
const dataDirSavedMessage = ref('')

// ===== UPD-02 关于与更新分栏：在线版本更新（契约=docs/verification/2026-10/UPD-01/design.md §2） =====
// 检查三态＋apply 守卫人话＋状态机轮询；决策核心在 ../updateFlow.ts（纯函数，单测锁定），
// 本组件只做薄执行：fetch→decidePollStep→渲染/排程。真实换装全流程留用户真机验收。
// PACK-04 双通道：packaged 桌面形态探测到 window.desktopUpdates（kind=packaged）时 check/apply
// 走 IPC（electron-updater 通道），进度/状态经事件映射到既有呈现；http 通道（浏览器/dev）分支零改动。
const desktopUpdatesApi = ((): DesktopUpdatesApi | undefined => {
  const holder = window as unknown as { desktopUpdates?: DesktopUpdatesApi }
  return holder.desktopUpdates
})()
/** 更新通道：desktop＝packaged 桌面 IPC；http＝既有 UPD HTTP 端点（零变化） */
const updateChannel = detectUpdateChannel(desktopUpdatesApi)
let desktopUnsubscribe: (() => void) | null = null
const updateVersion = ref<string | null>(null)
const checkPhase = ref<'idle' | 'checking' | 'available' | 'latest' | 'error'>('idle')
const checkErrorText = ref('')
const updateAvailableInfo = ref<{ latestVersion: string, releaseNotes: string | null } | null>(null)
const applyStarting = ref(false)
/** 当前呈现的状态机态（''＝未在呈现）；'reconnecting' 仅为呈现哨兵，非契约态 */
const applyPollState = ref('')
const applyPollProgress = ref<number | null>(null)
/** 断线重连尝试次数（1 起；0＝未在重连窗口） */
const applyReconnectAttempt = ref(0)
const applyGuardMessage = ref('')
const applyFailedReason = ref('')
const applyCompletedVersion = ref<string | null>(null)
let updatePollTimer: ReturnType<typeof setTimeout> | undefined
let updateFailedReconnects = 0
/** 更新流程占线（POST 受理中或状态机轮询中）：禁用「下载并更新」防重复提交 */
const updateInProgress = computed(() =>
  applyStarting.value || (applyPollState.value !== '' && !applyFailedReason.value && applyCompletedVersion.value === null))

/** 状态行文案：desktop 通道新增态（downloaded/installing）用 PACK-04 文案表；http 通道沿用 UPD-02 八态表（值不变） */
const applyStateText = computed(() => {
  const state = applyPollState.value
  if (state === '') return ''
  if (updateChannel === 'desktop') {
    const desktopText = DESKTOP_APPLY_STATE_TEXT[state as DesktopApplyState]
    if (desktopText !== undefined) return desktopText
  }
  return UPDATE_STATE_TEXT[state as UpdateFlowState] ?? ''
})

interface UpdateCheckView {
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  releaseNotes: string | null
  error: string | null
}

interface UpdateStatusView {
  state: string
  progress: number | null
  error: string | null
}

function stopUpdatePolling(): void {
  if (updatePollTimer !== undefined) {
    clearTimeout(updatePollTimer)
    updatePollTimer = undefined
  }
  // PACK-04：desktop 通道事件订阅同步退订（面板关闭/重开不残留监听）
  desktopUnsubscribe?.()
  desktopUnsubscribe = null
}

function resetUpdatePresentation(): void {
  stopUpdatePolling()
  updateFailedReconnects = 0
  applyPollState.value = ''
  applyPollProgress.value = null
  applyReconnectAttempt.value = 0
  applyGuardMessage.value = ''
  applyFailedReason.value = ''
  applyCompletedVersion.value = null
}

async function loadUpdateVersion(): Promise<void> {
  try {
    const response = await fetch('/api/health')
    const health = await response.json() as { currentVersion?: string | null }
    updateVersion.value = typeof health.currentVersion === 'string' && health.currentVersion !== '' ? health.currentVersion : null
  } catch {
    updateVersion.value = null
  }
}

async function runCheckUpdate(): Promise<void> {
  if (checkPhase.value === 'checking') return
  resetUpdatePresentation()
  checkPhase.value = 'checking'
  checkErrorText.value = ''
  try {
    // PACK-04 双通道：packaged 桌面走 IPC（同形视图，三态呈现复用）；否则既有 http 端点
    const view = updateChannel === 'desktop' && desktopUpdatesApi
      ? await desktopUpdatesApi.checkForUpdates()
      : await (async () => {
          const response = await fetch('/api/update/check')
          return await response.json() as UpdateCheckView
        })()
    updateVersion.value = typeof view.currentVersion === 'string' && view.currentVersion !== '' ? view.currentVersion : updateVersion.value
    if (view.updateAvailable && view.latestVersion) {
      updateAvailableInfo.value = { latestVersion: view.latestVersion, releaseNotes: view.releaseNotes }
      checkPhase.value = 'available'
    } else if (view.error) {
      checkErrorText.value = view.error
      checkPhase.value = 'error'
    } else {
      updateAvailableInfo.value = null
      checkPhase.value = 'latest'
    }
  } catch (error) {
    checkErrorText.value = `无法检查更新：${error instanceof Error ? error.message : String(error)}`
    checkPhase.value = 'error'
  }
}

/** completed 终态：以 /api/health 的 currentVersion 为准呈现（非 targetVersion 回显） */
async function onApplyCompleted(): Promise<void> {
  await loadUpdateVersion()
  applyCompletedVersion.value = updateVersion.value
}

async function pollUpdateStatus(): Promise<void> {
  let fetched: { ok: true, view: UpdateStatusView } | { ok: false }
  try {
    const response = await fetch('/api/update/status')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    fetched = { ok: true, view: await response.json() as UpdateStatusView }
  } catch {
    fetched = { ok: false }
  }
  const decision = decidePollStep(updateFailedReconnects, fetched)
  if (decision.kind === 'render-state') {
    updateFailedReconnects = 0
    applyReconnectAttempt.value = 0
    applyPollState.value = decision.state
    applyPollProgress.value = decision.progressPercent
    if (decision.state === 'completed') {
      await onApplyCompleted()
      return
    }
    if (decision.state === 'failed') {
      applyFailedReason.value = fetched.ok ? (fetched.view.error ?? '未知原因') : '未知原因'
      return
    }
    if (decision.continueDelayMs !== null) {
      updatePollTimer = setTimeout(() => { void pollUpdateStatus() }, decision.continueDelayMs)
    } else {
      // idle：无更新在途（防御呈现；正常流程不会走到）
      applyPollState.value = ''
    }
    return
  }
  if (decision.kind === 'reconnect') {
    updateFailedReconnects = decision.attempt
    applyReconnectAttempt.value = decision.attempt
    updatePollTimer = setTimeout(() => { void pollUpdateStatus() }, decision.delayMs)
    return
  }
  // give-up：15 次重连用尽（约 30s），包已换新但服务未恢复——指引手动启动
  applyFailedReason.value = '等待训练器恢复超时：若页面长期无响应，请手动运行 Start.cmd 启动'
}

async function startUpdateApply(): Promise<void> {
  if (updateInProgress.value) return
  if (!window.confirm('将下载新版本并自动重启训练器，更新过程中请勿关闭窗口。确定继续？')) return
  applyStarting.value = true
  applyGuardMessage.value = ''
  applyFailedReason.value = ''
  applyCompletedVersion.value = null
  try {
    // PACK-04 双通道：packaged 桌面走 IPC downloadAndInstall（下载→事件进度→排空→安装重启）
    if (updateChannel === 'desktop' && desktopUpdatesApi) {
      desktopUnsubscribe?.()
      desktopUnsubscribe = desktopUpdatesApi.onUpdateEvent(event => {
        const view = desktopEventToApplyView(event)
        applyPollState.value = view.state
        applyPollProgress.value = 'progressPercent' in view ? view.progressPercent : null
        if (view.state === 'failed') applyFailedReason.value = view.message
      })
      applyPollState.value = 'downloading'
      applyPollProgress.value = 0
      const outcome = await desktopUpdatesApi.downloadAndInstall()
      if (!outcome.ok) {
        applyGuardMessage.value = outcome.error
      }
      return
    }
    const response = await fetch('/api/update/apply', { method: 'POST' })
    if (response.status !== 202) {
      // 守卫拒绝（503/409/502）：人话呈现，不进入轮询，留在可重试态
      const payload = await response.json().catch(() => ({})) as { error?: string, message?: string }
      applyGuardMessage.value = updateGuardText(payload.error ?? null, payload.message ?? null)
      return
    }
    updateFailedReconnects = 0
    applyPollState.value = 'downloading'
    applyPollProgress.value = 0
    await pollUpdateStatus()
  } catch (error) {
    applyGuardMessage.value = `更新失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    applyStarting.value = false
  }
}

/** 分栏激活：拉当前版本＋若服务端有进行中/终态更新则恢复呈现（更新跨重启窗口，用户可能关开面板） */
async function enterAboutSection(): Promise<void> {
  await loadUpdateVersion()
  try {
    const response = await fetch('/api/update/status')
    if (!response.ok) return
    const view = await response.json() as UpdateStatusView
    if (isBusyUpdatePhase(view.state)) {
      applyPollState.value = view.state
      updateFailedReconnects = 0
      void pollUpdateStatus()
    } else if (view.state === 'completed') {
      applyPollState.value = 'completed'
      await onApplyCompleted()
    } else if (view.state === 'failed') {
      applyPollState.value = 'failed'
      applyFailedReason.value = view.error ?? '未知原因'
    }
  } catch {
    // 服务不可达＝无进行中的更新可恢复（正常启动态），静默
  }
}

watch(activeSection, section => {
  if (section === 'about') void enterAboutSection()
})

async function chooseDataDirDirectory(): Promise<void> {
  if (dataDirSaving.value) return
  dataDirError.value = ''
  dataDirSavedMessage.value = ''
  try {
    const picked = await selectSetupDirectory()
    if (picked.status !== 'selected' || !picked.path) return
    dataDirInput.value = picked.path
    dataDirTouched.value = true
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : '目录选择失败，可重试'
  }
}

async function saveDataDir(): Promise<void> {
  const candidate = dataDirInput.value.trim()
  if (dataDirSaving.value || candidate === '') return
  dataDirSaving.value = true
  dataDirError.value = ''
  dataDirSavedMessage.value = ''
  try {
    await putDataDir(candidate)
    dataDirSavedMessage.value = '已保存，重启训练器后生效；切换目录后仅能看到新目录中的历史训练与排行'
    dataDirTouched.value = false
  } catch (error) {
    dataDirError.value = error instanceof Error ? error.message : '保存失败，未更改已保存目录'
  } finally {
    dataDirSaving.value = false
  }
}

async function checkTdxPath(): Promise<void> {
  if (tdxChecking.value || tdxSaving.value) return
  const root = tdxPathInput.value.trim()
  if (root === '') {
    tdxCheckError.value = '请先填写通达信安装根目录'
    return
  }
  tdxChecking.value = true
  tdxCheckError.value = ''
  tdxSavedMessage.value = ''
  try {
    const result = await validateTdxPath(root)
    tdxCheck.value = result.check
  } catch (error) {
    tdxCheck.value = null
    tdxCheckError.value = error instanceof Error ? error.message : '检查失败，可重试'
  } finally {
    tdxChecking.value = false
  }
}

async function saveTdxPath(): Promise<void> {
  if (tdxSaving.value || tdxChecking.value) return
  const root = tdxPathInput.value.trim()
  if (root === '') {
    tdxError.value = '请先填写通达信安装根目录'
    return
  }
  tdxSaving.value = true
  tdxError.value = ''
  tdxSavedMessage.value = ''
  try {
    // 服务端保存前复验＋原子替换：失败 400 带可行动问题清单，已保存选择原样保留
    const result = await putTdxPath(root)
    tdxView.value = { effectiveRoot: result.effectiveRoot, savedChoice: result.saved }
    tdxCheck.value = null
    tdxSavedMessage.value = result.effectiveRoot === result.saved.root
      ? '已保存：与当前生效目录一致，重启应用后按此目录读取'
      : '已保存：重启应用后生效（当前会话仍使用原目录；离线导入回放不受影响）'
  } catch (error) {
    tdxError.value = error instanceof Error ? error.message : '保存失败，已保留原选择'
  } finally {
    tdxSaving.value = false
  }
}

async function chooseTdxDirectory(): Promise<void> {
  if (tdxChecking.value || tdxSaving.value) return
  tdxCheckError.value = ''
  tdxError.value = ''
  tdxSavedMessage.value = ''
  try {
    const picked = await selectSetupDirectory()
    if (picked.status !== 'selected' || !picked.path) return
    tdxPathInput.value = picked.path
    tdxPathTouched.value = true
    await checkTdxPath()
  } catch (error) {
    tdxCheckError.value = error instanceof Error ? error.message : '目录选择失败，可重试'
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
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="设置类别">
          <button type="button" :class="{ selected: activeSection === 'defaults' }" @click="activeSection = 'defaults'">默认设置</button>
          <button type="button" :class="{ selected: activeSection === 'preferences' }" @click="activeSection = 'preferences'">偏好设置</button>
          <button type="button" :class="{ selected: activeSection === 'animation' }" @click="activeSection = 'animation'">动画效果</button>
          <button type="button" :class="{ selected: activeSection === 'data' }" @click="activeSection = 'data'">数据目录</button>
          <button type="button" :class="{ selected: activeSection === 'about' }" @click="activeSection = 'about'">关于与更新</button>
        </nav>
        <div class="settings-content">
        <section v-if="activeSection === 'defaults'" class="settings-section settings-default-section" aria-label="默认设置">
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
        </section>
      <section v-if="activeSection === 'preferences'" class="settings-section" aria-label="应用偏好">
        <h3>应用偏好</h3>
        <label class="settings-row">
          <input
            v-model="autoDataCheckForm" type="checkbox" :disabled="appPrefSaving"
            aria-label="自动检查日线数据" @change="onAutoDataCheckChange"
          />
          <span class="settings-row-text">
            <strong>自动检查日线数据</strong>
            <small>开启时：应用启动、回到前台与页面停留期间自动检查本地日线状态（约 60 秒一次，只读状态，不下载数据）。关闭后仅在点击「更新日线 / 重新读取」时检查。默认开启，切换后立即保存生效。</small>
          </span>
        </label>
        <p v-if="appPrefLoadError" class="error-text" role="alert">{{ appPrefLoadError }}</p>
        <p v-if="appPrefError" class="error-text" role="alert">{{ appPrefError }}</p>
        <p v-if="appPrefSaved" class="settings-saved" role="status">{{ appPrefSaved }}</p>
        <div class="tool-preferences">
          <h4>常用画线工具</h4>
          <p class="settings-section-note">勾选会显示在训练工具条；选中工具后可设置默认颜色、线宽、线型和文本字号，下一局训练生效。</p>
          <div class="tool-preference-list">
            <label v-for="tool in DRAW_TOOLS" :key="tool.name" class="tool-preference-item">
              <input type="checkbox" :checked="favoriteToolNames.includes(tool.name)" @change="toggleFavoriteTool(tool.name)" />
              <button type="button" :class="{ selected: selectedTool === tool.name }" @click="selectTool(tool.name)">{{ tool.label }}</button>
            </label>
          </div>
          <div v-if="isFixedArrowTool(selectedTool)" class="tool-style-editor fixed-tool-style">
            <strong>{{ DRAW_TOOLS.find(tool => tool.name === selectedTool)?.label }}固定样式</strong>
            <p class="settings-section-note">看涨箭头固定为红色向上箭头，看跌箭头固定为绿色向下箭头，样式不可修改。</p>
          </div>
          <div v-else class="tool-style-editor">
            <strong>{{ DRAW_TOOLS.find(tool => tool.name === selectedTool)?.label ?? '线条' }}默认样式</strong>
            <label>线条颜色<input v-model="selectedToolPreference.color" type="color" @change="persistToolPreferences" /></label>
            <label>线条粗细<input v-model.number="selectedToolPreference.size" type="number" min="1" max="5" step="1" @change="persistToolPreferences" /></label>
            <label>线型<select v-model="selectedToolPreference.style" @change="persistToolPreferences"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
            <label>文本颜色<input v-model="selectedToolPreference.textColor" type="color" @change="persistToolPreferences" /></label>
            <label>文本字号<input v-model.number="selectedToolPreference.textSize" type="number" min="10" max="36" step="1" @change="persistToolPreferences" /></label>
            <button type="button" class="ghost-button" @click="resetToolPreference">恢复当前工具默认</button>
          </div>
        </div>
        <div class="shortcut-preferences">
          <h4>训练快捷键</h4>
          <p class="settings-section-note">每个操作最多设置两个快捷键；组合键表示同时按下，重复组合会被拒绝。点击“设置”后按下一个或两个按键即可保存。</p>
          <div class="shortcut-list">
            <div v-for="action in SHORTCUT_ACTIONS" :key="action" class="shortcut-row">
              <span class="shortcut-label">{{ SHORTCUT_ACTION_LABELS[action] }}</span>
              <div class="shortcut-bindings">
                <template v-for="slotIndex in [0, 1]" :key="slotIndex">
                  <button type="button" class="shortcut-binding" :disabled="shortcutSaving" :class="{ recording: isRecordingShortcut(action, slotIndex) }" :aria-label="`${SHORTCUT_ACTION_LABELS[action]}快捷键${slotIndex + 1}`" @click="beginShortcutCapture(action, slotIndex)">{{ recordingLabel(action, slotIndex) }}</button>
                  <button v-if="hasShortcut(action, slotIndex)" type="button" class="shortcut-clear" :disabled="shortcutSaving" :aria-label="`清除${SHORTCUT_ACTION_LABELS[action]}快捷键${slotIndex + 1}`" @click="clearShortcut(action, slotIndex)">清除</button>
                </template>
              </div>
            </div>
          </div>
          <p v-if="shortcutError" class="error-text" role="alert">{{ shortcutError }}</p>
          <p v-if="shortcutSaved" class="settings-saved" role="status">{{ shortcutSaved }}</p>
        </div>
      </section>
      <section v-if="activeSection === 'animation'" class="settings-section settings-default-section" aria-label="动画效果">
        <h3>动画效果</h3>
        <p class="settings-section-note">控制训练界面中的动画呈现，切换后立即生效并自动记住；未来其它动画设置也将收纳在此分栏。</p>
        <label class="settings-row">
          <input type="checkbox" :checked="appOdoMotion" aria-label="数字滚动动效" @change="onOdoMotionChange" />
          <span class="settings-row-text">
            <strong>数字滚动动效</strong>
            <small>开启时，训练中账户权益与收益率数值变化会以约 0.3–0.6 秒的滚动动画过渡；关闭后数值直接跳变。默认开启。</small>
          </span>
        </label>
      </section>
      <section v-if="activeSection === 'data'" class="settings-section" aria-label="数据目录">
        <h4 class="settings-subsection">训练数据目录</h4>
        <p class="settings-section-note">
          <span>当前生效：<code>{{ dataDirView ? `${dataDirView.effectiveDir}（${dataDirView.databaseFile}）` : '读取中…' }}</code></span>
          <span v-if="dataDirView?.configuredDir === null && dataDirView?.defaultDir">；未自定义（默认 {{ dataDirView.defaultDir }}，各版本安装目录相互独立）</span>
          <span v-else-if="dataDirView?.configuredDir">；已自定义：{{ dataDirView.configuredDir }}</span>
        </p>
        <div class="settings-row settings-column">
          <label class="settings-field-label" for="data-dir-input">历史训练数据保存目录</label>
          <input
            id="data-dir-input" v-model="dataDirInput" type="text" spellcheck="false"
            aria-label="历史训练数据保存目录" placeholder="可点击下方按钮选择目录"
            @input="dataDirTouched = true; dataDirSavedMessage = ''"
          />
          <small>历史模拟训练数据（含排行与成绩单复盘用的数据库文件）保存在此目录；保存后需重启训练器生效。旧版本曾默认保存于用户主目录 {{ dataDirView?.legacyDefaultDir ?? '' }}，需要沿用旧数据可填入该路径。</small>
        </div>
        <div class="settings-actions">
          <button class="ghost-button" :disabled="dataDirSaving" @click="chooseDataDirDirectory">选择文件夹…</button>
          <button class="trade-action buy" :disabled="dataDirSaving || dataDirInput.trim() === ''" @click="saveDataDir">{{ dataDirSaving ? '保存中…' : '保存训练数据目录' }}</button>
        </div>
        <p v-if="dataDirLoadError" class="error-text" role="alert">{{ dataDirLoadError }}</p>
        <p v-if="dataDirError" class="error-text" role="alert">{{ dataDirError }}</p>
        <p v-if="dataDirSavedMessage" class="settings-saved" role="status">{{ dataDirSavedMessage }}</p>

        <h4 class="settings-subsection">数据目录（通达信）</h4>
        <p class="settings-section-note">
          <span>当前生效：<code>{{ tdxView?.effectiveRoot ?? '未找到（离线导入回放仍可用）' }}</code></span>
          <span v-if="tdxView?.savedChoice">；已保存：<code>{{ tdxView.savedChoice.root }}</code><template v-if="tdxView.savedChoice.root !== tdxView.effectiveRoot">（与当前不同，重启后生效）</template></span>
          <span v-else>；尚未保存过选择</span>
        </p>
        <div class="settings-row settings-column">
          <label class="settings-field-label" for="tdx-path-input">通达信安装根目录</label>
          <input
            id="tdx-path-input" v-model="tdxPathInput" type="text" spellcheck="false"
            aria-label="通达信安装根目录" placeholder="可点击下方按钮选择目录"
            @input="tdxPathTouched = true; tdxSavedMessage = ''"
          />
          <small>选择包含 vipdoc 与 T0002 的通达信根目录；保存前会重新校验，保存失败不会改动之前的选择。</small>
        </div>
        <div class="settings-actions">
          <button class="ghost-button" :disabled="tdxChecking || tdxSaving" @click="chooseTdxDirectory">选择文件夹…</button>
          <button class="ghost-button" :disabled="tdxChecking || tdxSaving" @click="checkTdxPath">{{ tdxChecking ? '检查中…' : '检查此路径' }}</button>
          <button class="trade-action buy" :disabled="tdxSaving || tdxChecking || tdxPathInput.trim() === ''" @click="saveTdxPath">{{ tdxSaving ? '保存中…' : '保存数据目录' }}</button>
        </div>
        <div v-if="tdxCheck" class="settings-tdx-check" role="status">
          <span>
            {{ tdxCheck.recognized && tdxCheck.readable ? '✓ 该目录可用' : '✕ 该目录暂不可用' }}：
            日线文件 {{ tdxCheck.dailyFileCount }} 个<template v-if="tdxCheck.latestDate">，最新 {{ tdxCheck.latestDate }}</template>；
            权息{{ tdxCheck.hasAdjustment ? '有' : '缺' }}、股票名称{{ tdxCheck.hasNames ? '有' : '缺' }}、基准指数{{ tdxCheck.hasBenchmark ? '有' : '缺' }}
          </span>
          <ul v-if="tdxCheck.problems.length > 0">
            <li v-for="problem in tdxCheck.problems" :key="problem">{{ problem }}</li>
          </ul>
        </div>
        <p v-if="tdxCheckError" class="error-text" role="alert">{{ tdxCheckError }}</p>
        <p v-if="tdxLoadError" class="error-text" role="alert">{{ tdxLoadError }}</p>
        <p v-if="tdxError" class="error-text" role="alert">{{ tdxError }}</p>
        <p v-if="tdxSavedMessage" class="settings-saved" role="status">{{ tdxSavedMessage }}</p>
      </section>
      <section v-if="activeSection === 'about'" class="settings-section" aria-label="关于与更新">
        <h3>关于与更新</h3>
        <p class="settings-section-note">检查并安装训练器新版本；更新前会自动备份，历史训练数据保留在本地，更新完成后自动重启。</p>
        <p class="update-current-version">当前版本：{{ versionLabel(updateVersion) }}</p>
        <div class="settings-actions">
          <button class="ghost-button" :disabled="checkPhase === 'checking'" @click="runCheckUpdate">
            {{ checkPhase === 'checking' ? '检查中…' : '检查更新' }}
          </button>
          <button
            v-if="checkPhase === 'available'" class="trade-action buy" :disabled="updateInProgress"
            @click="startUpdateApply"
          >{{ applyStarting ? '正在准备更新…' : '下载并更新' }}</button>
          <button v-if="checkPhase === 'error'" class="ghost-button" @click="runCheckUpdate">重试</button>
        </div>
        <div v-if="checkPhase === 'available' && updateAvailableInfo" class="update-check-result" role="status">
          <p>发现新版本 {{ versionLabel(updateAvailableInfo.latestVersion) }}</p>
          <details v-if="updateAvailableInfo.releaseNotes" class="update-release-notes" open>
            <summary>更新内容</summary>
            <pre>{{ updateAvailableInfo.releaseNotes }}</pre>
          </details>
        </div>
        <p v-else-if="checkPhase === 'latest'" class="update-check-result" role="status">已是最新版本</p>
        <p v-if="checkPhase === 'error'" class="error-text update-check-error" role="alert">检查失败：{{ checkErrorText }}</p>
        <p v-if="applyGuardMessage" class="error-text update-apply-error" role="alert">{{ applyGuardMessage }}</p>
        <div
          v-if="applyPollState && applyPollState !== 'idle' && !applyFailedReason && applyCompletedVersion === null"
          class="update-progress" role="status"
        >
          <template v-if="applyReconnectAttempt > 0">正在重启，等待服务回来…（重连尝试 {{ applyReconnectAttempt }}/{{ RECONNECT_MAX_ATTEMPTS }}）</template>
          <template v-else>{{ applyStateText }}<template v-if="applyPollProgress !== null">（{{ applyPollProgress }}%）</template></template>
        </div>
        <p v-if="applyCompletedVersion !== null" class="settings-saved" role="status">已更新到 {{ versionLabel(applyCompletedVersion) }}</p>
        <p v-if="applyFailedReason" class="error-text" role="alert">更新失败：{{ applyFailedReason }}</p>
      </section>
      <template v-if="activeSection === 'defaults'">
        <p v-if="initialCashInvalid()" class="error-text" role="alert">初始资金需在 0.01 至 1,000,000,000 元之间，且至多两位小数</p>
        <p v-if="saveError" class="error-text" role="alert">{{ saveError }}</p>
        <p v-if="saveSuccess" class="settings-saved" role="status">{{ saveSuccess }}</p>
        <div class="settings-actions">
          <button class="trade-action buy" :disabled="saving || initialCashInvalid()" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
        </div>
      </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-mask { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 32, 0.45); }
.settings-panel { width: min(760px, calc(100vw - 40px)); height: min(680px, calc(100dvh - 44px)); min-height: min(560px, calc(100dvh - 44px)); overflow: hidden; display: flex; flex-direction: column; padding: 18px 20px; border-radius: 10px; background: var(--surface-background, #fff); border: 1px solid var(--surface-border, #dfe5eb); color: var(--text-primary, #1c2733); box-shadow: 0 18px 48px rgba(15, 23, 32, 0.25); outline: none; }
.settings-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 6px; }
.settings-head h2 { margin: 0; font-size: 17px; }
.settings-note { margin: 0 0 14px; font-size: 12px; color: var(--text-secondary, #51637a); }
.settings-layout { min-height: 0; flex: 1; display: grid; grid-template-columns: 142px minmax(0, 1fr); gap: 18px; align-items: stretch; }
.settings-nav { display: flex; flex-direction: column; gap: 4px; position: sticky; top: 0; }
.settings-nav button { border: 1px solid transparent; border-radius: 5px; padding: 10px 12px; text-align: left; background: transparent; color: var(--text-secondary, #51637a); cursor: pointer; font-size: 13px; }
.settings-nav button:hover { background: var(--surface-hover, #f2f5f7); color: var(--text-primary, #1c2733); }
.settings-nav button.selected { border-color: var(--surface-border, #cdd7df); background: var(--surface-selected, #eaf5f6); color: #1f6978; font-weight: 650; }
:global(body.dark) .settings-nav button.selected { color: #8fd9e3; background: rgba(73, 164, 178, .18); border-color: #3e8894; }
.settings-content { min-width: 0; min-height: 0; overflow-y: auto; padding-right: 4px; }
.settings-default-section { margin-top: 0; padding-top: 0; border-top: 0; }
.settings-cancel-link { margin-top: 18px; border: 0; background: transparent; color: var(--text-secondary, #51637a); cursor: pointer; padding: 4px 0; }
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
.settings-section { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--surface-border, #eef2f6); }
.settings-section h3 { margin: 0 0 4px; font-size: 14px; }
.settings-subsection { margin: 10px 0 6px; font-size: 13px; color: var(--text-primary, #25364b); }
.settings-subsection + .settings-section-note { margin-top: 0; }
.settings-section-note { margin: 0 0 8px; font-size: 11px; color: var(--text-secondary, #51637a); line-height: 1.6; overflow-wrap: anywhere; }
.settings-section-note code { font-size: 11px; overflow-wrap: anywhere; }
.settings-section .settings-actions { margin-top: 10px; }
.tool-preferences { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--surface-border, #eef2f6); }
.tool-preferences h4 { margin: 0 0 4px; font-size: 13px; }
.tool-preference-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 8px; max-height: 180px; overflow-y: auto; padding: 5px 0; }
.tool-preference-item { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tool-preference-item button { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid transparent; border-radius: 4px; padding: 5px 7px; text-align: left; background: transparent; color: var(--text-secondary, #51637a); cursor: pointer; font-size: 12px; }
.tool-preference-item button.selected { border-color: var(--surface-border, #cdd7df); background: var(--surface-selected, #eaf5f6); color: var(--text-primary, #1c6076); font-weight: 650; }
.tool-style-editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; padding: 10px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 6px; background: var(--control-background, #f7faf9); }
.tool-style-editor strong, .tool-style-editor button { grid-column: 1 / -1; }
.tool-style-editor label { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--text-secondary, #51637a); font-size: 11px; }
.tool-style-editor input[type="number"], .tool-style-editor select { width: 88px; min-height: 26px; border: 1px solid var(--surface-border, #d8e0e8); border-radius: 4px; background: var(--surface-background, #fff); color: var(--text-primary, #1c2733); padding: 3px 5px; }
.tool-style-editor input[type="color"] { width: 44px; height: 26px; padding: 1px; border: 1px solid var(--surface-border, #d8e0e8); border-radius: 4px; background: var(--surface-background, #fff); }
.fixed-tool-style { display: block; }
.fixed-tool-style .settings-section-note { margin: 7px 0 0; }
.shortcut-preferences { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--surface-border, #eef2f6); }
.shortcut-preferences h4 { margin: 0 0 4px; font-size: 13px; }
.shortcut-list { display: grid; gap: 5px; }
.shortcut-row { display: grid; grid-template-columns: minmax(132px, 1fr) minmax(230px, 1.5fr); align-items: center; gap: 10px; min-height: 34px; }
.shortcut-label { color: var(--text-secondary, #51637a); font-size: 12px; }
.shortcut-bindings { display: flex; align-items: center; gap: 5px; min-width: 0; }
.shortcut-binding { min-width: 82px; padding: 5px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--surface-border, #d8e0e8); border-radius: 4px; background: var(--control-background, #f7faf9); color: var(--text-primary, #1c2733); font-size: 11px; }
.shortcut-binding.recording { border-color: #2b8b99; background: rgba(43, 139, 153, 0.15); color: #1f6978; }
.shortcut-clear { border: 0; padding: 3px 4px; background: transparent; color: var(--text-secondary, #51637a); font-size: 10px; }
.shortcut-clear:hover { color: #b3413a; }
:global(body.dark) .shortcut-binding.recording { color: #9bdce3; }
.settings-tdx-check { margin-top: 10px; padding: 8px 10px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 6px; font-size: 12px; line-height: 1.6; }
.settings-tdx-check ul { margin: 6px 0 0; padding-left: 18px; color: var(--text-secondary, #51637a); }
/* UPD-02 关于与更新分栏 */
.update-current-version { margin: 0 0 4px; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.update-check-result p { margin: 0 0 6px; font-size: 13px; }
.update-release-notes { margin: 6px 0 0; padding: 8px 10px; border: 1px solid var(--surface-border, #dfe5eb); border-radius: 6px; font-size: 12px; }
.update-release-notes summary { cursor: pointer; color: var(--text-secondary, #51637a); }
.update-release-notes pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; line-height: 1.6; }
.update-progress { margin-top: 10px; font-size: 13px; color: #1f6978; }
:global(body.dark) .update-progress { color: #8fd9e3; }
.settings-saved { margin: 10px 0 0; font-size: 12px; color: #1d7a3d; }
:global(body.dark) .settings-saved { color: #57bd7c; }
.settings-actions { display: flex; gap: 10px; margin-top: 14px; }
@media (max-width: 640px) {
  .settings-panel { width: calc(100vw - 24px); height: min(680px, calc(100dvh - 24px)); min-height: min(520px, calc(100dvh - 24px)); padding: 14px; }
  .settings-layout { grid-template-columns: 1fr; gap: 10px; }
  .settings-nav { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); position: static; }
  .settings-nav button { text-align: center; padding: 8px 5px; }
  .tool-preference-list, .tool-style-editor { grid-template-columns: 1fr; }
  .tool-style-editor strong, .tool-style-editor button { grid-column: auto; }
  .shortcut-row { grid-template-columns: 1fr; gap: 4px; }
}
</style>
