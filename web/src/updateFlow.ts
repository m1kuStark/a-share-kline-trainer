// UPD-02 在线版本更新·设置页「关于与更新」分栏的纯呈现逻辑（零 Vue/浏览器依赖，
// 便于 server/test 按 kdj 先例提取执行）。契约＝docs/verification/2026-10/UPD-01/design.md §2；
// 呈现文案与重连参数＝UPD-02 派发简报冻结（proposed_default 清单见验证记录 README）。

/** UPD-01 契约 §2.3 的状态全集（/api/update/status 的 state 字段） */
export type UpdateFlowState =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'backing_up'
  | 'applying'
  | 'restarting'
  | 'completed'
  | 'failed'

/** 状态机呈现文案（设计 §3 表；八态互不重复，由 updater-ui.test.ts 锁定） */
export const UPDATE_STATE_TEXT: Record<UpdateFlowState, string> = {
  idle: '未在更新',
  downloading: '正在下载新版本…',
  verifying: '正在校验安装包…',
  backing_up: '正在备份数据…',
  applying: '正在安装新版本…',
  restarting: '正在重启训练器…',
  completed: '更新完成',
  failed: '更新失败',
}

/** 轮询继续条件：处于任一进行中阶段（completed/failed 停，idle 停） */
export function isBusyUpdatePhase(state: string): boolean {
  return state === 'downloading' || state === 'verifying' || state === 'backing_up'
    || state === 'applying' || state === 'restarting'
}

/** 终态判定：completed/failed（轮询停止；恢复轮询时也可能直接读到 completed——契约明示） */
export function isTerminalUpdateState(state: string): boolean {
  return state === 'completed' || state === 'failed'
}

/**
 * apply 守卫码→人话（派发简报决策 3 冻结四码原文）；其余码回退服务端 message，
 * 再回退通用失败行。守卫码集＝UPD-01 契约 §2.2 前置守卫。
 */
export function updateGuardText(error: string | null | undefined, serverMessage?: string | null): string {
  switch (error) {
    case 'UPDATE_NOT_PACKAGED': return '当前为开发/源码运行，请使用发布包更新'
    case 'UPDATE_IN_PROGRESS': return '更新已在进行中'
    case 'ACTIVE_TRAINING': return '请先结束当前训练'
    case 'UPDATE_NOT_AVAILABLE': return '没有可用的更新'
    default:
      if (serverMessage && serverMessage.trim() !== '') return serverMessage
      if (error && error.trim() !== '') return `更新失败：${error}`
      return '更新失败'
  }
}

/** 断线重连间隔（秒级平退避；简报示例 2s 冻结） */
export const RECONNECT_INTERVAL_MS = 2_000
/** 断线重连最大尝试次数（简报示例 15 次冻结；约 30s 覆盖换装重启窗口） */
export const RECONNECT_MAX_ATTEMPTS = 15

/**
 * 第 attempt 次（0 起）断线重连的下次延时：未超尽返回 2000ms，超尽返回 null（放弃，
 * 由调用方呈现手动 Start.cmd 指引）。
 */
export function nextReconnectDelayMs(attempt: number): number | null {
  return attempt < RECONNECT_MAX_ATTEMPTS ? RECONNECT_INTERVAL_MS : null
}

/** status.progress（0..1，仅 downloading 有值）→ 展示用整数百分比，越界夹取 */
export function updateProgressPercent(progress: number | null): number | null {
  if (progress === null || !Number.isFinite(progress)) return null
  return Math.min(100, Math.max(0, Math.round(progress * 100)))
}

/** 版本展示：'1.2.7'→'v1.2.7'；null（journey 隔离运行等）→「未知」 */
export function versionLabel(version: string | null): string {
  return version ? `v${version}` : '未知'
}

/** 正常轮询间隔（状态机呈现刷新；与断线重连间隔不同值） */
export const POLL_INTERVAL_MS = 1_000

/** /api/update/status 一次拉取的结果（ok=false＝fetch 异常，即断线窗口） */
export type StatusFetchResult =
  | { ok: true, view: { state: string, progress: number | null, error: string | null } }
  | { ok: false }

/**
 * 轮询决策核心（组件只做薄执行：fetch→本函数→渲染/排程）：
 * - 成功且 busy 态 → 渲染状态（downloading 附百分比）＋1s 后继续；
 * - 成功且终态（completed/failed）或 idle → 渲染状态、不再排程（continueDelayMs=null）；
 * - fetch 失败（旧服务已退/新服务未起的断线窗口）→ 第 attempt 次（1 起）2s 后重连，
 *   已失败 15 次后放弃（调用方呈现手动 Start.cmd 指引）；
 * - 断线后恢复读到 completed（契约 §2.3 明示可能）→ 按终态渲染，计数清零由调用方承接。
 */
export type PollDecision =
  | { kind: 'render-state', state: string, progressPercent: number | null, continueDelayMs: number | null }
  | { kind: 'reconnect', attempt: number, delayMs: number }
  | { kind: 'give-up' }

export function decidePollStep(failedReconnects: number, fetched: StatusFetchResult): PollDecision {
  if (!fetched.ok) {
    const delayMs = nextReconnectDelayMs(failedReconnects)
    return delayMs === null
      ? { kind: 'give-up' }
      : { kind: 'reconnect', attempt: failedReconnects + 1, delayMs }
  }
  const { state } = fetched.view
  const progressPercent = state === 'downloading' ? updateProgressPercent(fetched.view.progress) : null
  const continueDelayMs = isBusyUpdatePhase(state) ? POLL_INTERVAL_MS : null
  return { kind: 'render-state', state, progressPercent, continueDelayMs }
}
