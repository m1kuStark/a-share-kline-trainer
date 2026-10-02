import { computed, ref } from 'vue'
import { fetchDataStatus, postDataRefresh, type DataRefreshResult, type DataStatus } from './api'
import { appAutoDataCheck, ensureAppSettingsLoaded } from './appSettings'

// ===== 日线数据状态：响应式单例 store =====
// 节流口径（用户拍板）：应用启动立即检查一次；窗口回到前台（focus/visibilitychange）
// 距上次检查 ≥60s 才再检查；页面隐藏时不检查也不轮询；发现 state=running 后以约 1s
// 间隔轮询 GET /api/data/status 直到非 running（上限 120s）。手动更新走 POST
// /api/data/refresh（绕过节流，服务端会合并任务），随后进入同样的轮询。
// DATA-05 新鲜度重判：可见页面每 60s 一次廉价 GET /api/data/status（服务端按官方
// 离线日历逐次重算 freshness，跨 15:00/跨日/跨休市即时重判）；隐藏停止计时，
// 回前台恢复并立即按节流检查；卸载清理。定时器只 GET，绝不定时 POST 扫描。
// M5-01 应用偏好：设置里关闭「自动检查日线数据」（autoDataCheck=false）后，自动路径
// （启动/回前台/60s 重判）一律跳过；手动路径（「更新日线」及其后的 running 轮询、
// 设置面板「重新检查」）不受影响。偏好异步预取（ensureAppSettingsLoaded，缺省 true＝现状），
// 设置面板保存后即时生效；偏好尚未读到时的首次自动检查按现状放行（缺省 true），
// 后续自动检查按已读到的偏好执行。集成阶段可在 App 启动时更早预取以收窄这一窗口。

/** 前台激活后再次检查的最小间隔（60s 节流），同时是可见页面廉价重判 GET 的周期 */
export const DATA_CHECK_THROTTLE_MS = 60_000
/** running 状态轮询间隔（约 1s） */
const DATA_POLL_INTERVAL_MS = 1_000
/** 轮询上限：超过 120s 放弃（等下次前台激活重新接管） */
const DATA_POLL_TIMEOUT_MS = 120_000

/** 最近一次 /api/data/status 的结果（null＝尚未检查过） */
export const dataStatus = ref<DataStatus | null>(null)
/** 正在进行的一次状态检查（含轮询中的单次请求） */
export const dataChecking = ref(false)
/** POST /api/data/refresh 请求本身进行中 */
export const dataRefreshing = ref(false)
/** 轮询循环激活中（等待任务从 running 走向终态） */
export const dataPolling = ref(false)
/** 手动刷新失败时透出的中文原因（如 409 无可用来源） */
export const dataRefreshError = ref('')
/** 最近一次更新任务的扫描结果与下一步提示，保留到下一次手动更新 */
export const dataRefreshMessage = ref('')
/** 最近一次到达的终态结果（供训练页小按钮做"✓"轻提示） */
export const dataRefreshOutcome = ref<Extract<DataRefreshResult['outcome'], 'updated' | 'unchanged' | 'failed'> | null>(null)
/** 每次终态到达自增，训练页 watch 它触发闪烁 */
export const dataOutcomeSeq = ref(0)

/** 更新进行中（任一信号命中即可：refresh 在途 / 轮询循环激活 / 服务端报 running） */
export const dataUpdating = computed(() => dataRefreshing.value || dataPolling.value || dataStatus.value?.state === 'running')

let lastCheckStartedAt = 0
let checkSeq = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollDeadline = 0
let statusTicker: ReturnType<typeof setInterval> | undefined
// 在途状态检查计数（ticker 廉价检查与 poll 单步共用）：用于判断"轮询循环是否还有
// 未决步骤"。任何一个检查结算时都会调用 ensurePollingAlive，保证循环不因乱序丢失排程。
let checksInFlight = 0
// 区分"单次轮询请求在途"与"隐藏暂停"：两者 pollTimer 都为空，只有暂停态允许 startPolling 重新调度
let pollInFlight = false
// POST 直接返回终态时，随后的状态同步也必须发布反馈；普通廉价状态检查不触发完成提示。
let directFeedbackPending = false

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * 可见页面 60s 廉价重判定时器：只 GET /api/data/status（服务端逐次重算 freshness），
 * 隐藏时暂停，回前台由 onDataActive 恢复；不发起任何 POST 扫描。
 * M5-01：应用偏好关闭自动检查时不启动（每次 tick 也会经 checkDataStatus 的门闩再拦一道）。
 */
export function startStatusTicker(): void {
  if (statusTicker !== undefined || isHidden()) return
  if (!appAutoDataCheck.value) {
    void ensureAppSettingsLoaded()
    return
  }
  statusTicker = setInterval(() => {
    if (isHidden()) return
    void checkDataStatus()
  }, DATA_CHECK_THROTTLE_MS)
}

/** 隐藏时停止 60s 重判计时（App visibilitychange→hidden 调用） */
export function stopStatusTicker(): void {
  if (statusTicker !== undefined) {
    clearInterval(statusTicker)
    statusTicker = undefined
  }
}

/** 清理轮询循环与未决请求标记（App 卸载时调用，监听器由 App 成对移除） */
export function cancelDataWatchers(): void {
  checkSeq++
  clearTimeout(pollTimer)
  pollTimer = undefined
  stopStatusTicker()
  dataPolling.value = false
  dataChecking.value = false
  directFeedbackPending = false
}

/**
 * 统一应用最新一次检查结果（ticker 廉价检查与 running 轮询共用）。
 * 终态时必须终止轮询循环并触发轻提示：否则当"新检查先返回终态、旧 poll 响应
 * 过期被丢弃"时，dataPolling 永远无人清理，UI 永久卡在"更新中"。
 */
function applyStatus(result: DataStatus): void {
  dataStatus.value = result
  if (result.state === 'running') {
    startPolling()
    return
  }
  if (dataPolling.value) {
    dataPolling.value = false
    onDataFinished(result)
  } else if (directFeedbackPending) {
    onDataFinished(result)
  }
  directFeedbackPending = false
}

/**
 * 启动立即检查一次（force 绕过 60s 节流）；App onMounted 调用。
 * M5-01：manual 标记手动路径（「更新日线」终态同步等），绕过应用偏好门闩；
 * 未标记的调用都是自动检查——偏好关闭时跳过（偏好本身异步预取，缺省 true＝现状）。
 */
export async function checkDataStatus(options?: { force?: boolean; manual?: boolean }): Promise<void> {
  if (isHidden()) return
  if (!options?.manual) {
    void ensureAppSettingsLoaded()
    if (!appAutoDataCheck.value) return
  }
  if (!options?.force && Date.now() - lastCheckStartedAt < DATA_CHECK_THROTTLE_MS) return
  lastCheckStartedAt = Date.now()
  const seq = ++checkSeq
  dataChecking.value = true
  checksInFlight += 1
  try {
    const result = await fetchDataStatus()
    if (seq === checkSeq) applyStatus(result)
  } catch (error) {
    if (options?.manual && directFeedbackPending) {
      directFeedbackPending = false
      dataRefreshError.value = `读取更新结果失败：${error instanceof Error ? error.message : '无法连接本地服务'}`
    }
    // 自动状态检查失败保持静默（不打扰训练），下次前台激活按节流重试
  } finally {
    checksInFlight -= 1
    if (seq === checkSeq) dataChecking.value = false
    ensurePollingAlive()
  }
}

/** 前台激活入口（focus / visibilitychange→visible）：60s 节流内不重复检查，running 任务恢复轮询，并确保重判定时器在跑 */
export function onDataActive(): void {
  if (isHidden()) return
  startStatusTicker()
  if (dataPolling.value || dataStatus.value?.state === 'running') { startPolling(); return }
  // POST may have returned a terminal state while the page became hidden before
  // its manual GET. Resume that pending manual read even when auto checks are off.
  if (directFeedbackPending) { void checkDataStatus({ force: true, manual: true }); return }
  void checkDataStatus()
}

function startPolling(): void {
  if (!dataPolling.value) {
    dataPolling.value = true
    pollDeadline = Date.now() + DATA_POLL_TIMEOUT_MS
  }
  ensurePollingAlive()
}

/**
 * 轮询循环保活：循环标记激活时必须始终存在未决步骤（定时器或在途检查）。
 * 有在途检查时不重复排程——其结算路径（finally）会再次调用本函数；
 * 全部结算后仍无未决步骤则补排程，避免乱序丢弃旧响应后循环卡死（永久"更新中"）。
 */
function ensurePollingAlive(): void {
  if (isHidden()) return
  if (!dataPolling.value) return
  if (pollTimer !== undefined || pollInFlight || checksInFlight > 0) return
  schedulePoll()
}

function schedulePoll(): void {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(() => { pollTimer = undefined; void pollOnce() }, DATA_POLL_INTERVAL_MS)
}

async function pollOnce(): Promise<void> {
  pollInFlight = true
  checksInFlight += 1
  try {
    // 页面隐藏时暂停轮询；回到前台由 onDataActive 重新接管
    if (isHidden()) return
    // 超过 120s 上限：停止轮询，等下次激活重新检查
    if (Date.now() >= pollDeadline) { dataPolling.value = false; return }
    const seq = ++checkSeq
    dataChecking.value = true
    try {
      const result = await fetchDataStatus()
      if (seq === checkSeq) applyStatus(result)
    } catch {
      // 单次轮询失败不放弃：由 finally 的 ensurePollingAlive 继续排程直到上限
    } finally {
      if (seq === checkSeq) dataChecking.value = false
    }
  } finally {
    pollInFlight = false
    checksInFlight -= 1
    ensurePollingAlive()
  }
}

function onDataFinished(result: DataStatus): void {
  const outcome = result.lastResult?.outcome ?? (result.state === 'failed' ? 'failed' : null)
  if (outcome !== 'updated' && outcome !== 'unchanged' && outcome !== 'failed') return
  dataRefreshOutcome.value = outcome
  const scanMessage = result.lastResult?.message
    ?? (outcome === 'failed' ? result.reason : '检查完成')
  dataRefreshError.value = outcome === 'failed' ? scanMessage : ''
  const freshness = result.freshness
  const freshnessNote = outcome === 'failed' ? ''
    : freshness?.state === 'stale'
      ? '请先在通达信完成盘后数据下载，再重新读取本地日线（不联网）'
      : freshness?.state === 'unknown'
        ? `最新交易日待确认：${freshness.reason}`
        : freshness?.reason ?? ''
  dataRefreshMessage.value = freshnessNote ? `${scanMessage}；${freshnessNote}` : scanMessage
  dataOutcomeSeq.value++
}

/** 手动更新：POST /api/data/refresh（绕过节流；服务端合并已有任务），成功后进入同样的轮询 */
export async function refreshDataNow(): Promise<void> {
  if (dataRefreshing.value || dataPolling.value) return
  dataRefreshing.value = true
  dataRefreshError.value = ''
  dataRefreshMessage.value = ''
  lastCheckStartedAt = Date.now()
  try {
    const started = await postDataRefresh()
    if (started.state === 'running') {
      startPolling()
    } else {
      // 服务端直接返回终态（罕见）：补一次状态检查同步 UI（manual：绕过自动检查偏好门闩）
      directFeedbackPending = true
      await checkDataStatus({ force: true, manual: true })
    }
  } catch (error) {
    directFeedbackPending = false
    // 409 等：把服务端中文 message 行内展示（Launcher 小字区，不用 alert）
    dataRefreshError.value = error instanceof Error ? error.message : '更新失败：无法连接本地服务'
  } finally {
    dataRefreshing.value = false
  }
}
