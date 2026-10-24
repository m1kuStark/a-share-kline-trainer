import type { DirectoryPickerResult, TdxRootSource } from './api'

// 数据目录呈现层纯函数（2026-10-24 bug-loop，矩阵 tdx-path-settings）：顶栏 attention
// 提示与设置页目录选择器反馈的文案决策集中于此，独立于组件可单测（测试落 server/test，
// 同 randomDatePresentation 模式）。

/** 既有口径（自 App.vue 迁入，逐字不变）：非钉死形态下引导用户先去通达信下载盘后数据 */
export const STALE_DOWNLOAD_HINT = '请先在通达信完成盘后数据下载，再点击重新读取本地日线（不联网）'

/** 钉死形态提示：目录由启动方式显式指定（如验收包随包冻结样本），应用内改不了也更新不了 */
const PINNED_SOURCE_HINT = '当前数据目录由启动方式显式指定（如随包冻结样本），应用内无法更新或切换'

/** 目录来源是否属「启动方式显式钉死」（保存选择不会覆盖它、应用内更新对它无意义） */
export function tdxSourceLocked(source: TdxRootSource | null | undefined): boolean {
  return source === 'env' || source === 'explicit-config'
}

/** 顶栏 attention 提示：钉死形态说明根因；其余形态保持既有拼接口径（逐字不回归） */
export function attentionHint(source: TdxRootSource | null | undefined, freshnessReason: string | null | undefined): string {
  if (tdxSourceLocked(source)) {
    return freshnessReason ? `${freshnessReason}；${PINNED_SOURCE_HINT}` : PINNED_SOURCE_HINT
  }
  return freshnessReason ? `${freshnessReason}${STALE_DOWNLOAD_HINT}` : STALE_DOWNLOAD_HINT
}

/** 设置页目录选择器反馈：selected（正常继续）与 cancelled（用户主动取消）不提示；
 * 失败态给结构化原因——与首配向导（App.vue chooseWizardFolder）同一分态口径，不再静默吞结果。 */
export function directoryPickFeedback(result: Pick<DirectoryPickerResult, 'status' | 'reason'>): string | null {
  if (result.status === 'selected' || result.status === 'cancelled') return null
  return result.reason ?? `目录选择不可用（${result.status}）`
}
