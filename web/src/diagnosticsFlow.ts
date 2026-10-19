// GAP1-DIAG 设置页「复制诊断信息」纯呈现逻辑（零 Vue/浏览器依赖，镜像 updateFlow.ts 形态；
// 单测＝server/test/diagnostics-ui.test.ts 的 transpile 模式）。
// 矩阵行 DESKTOP-DIAG-CLIPBOARD（web 侧）：纯浏览器/e2e 形态无 window.desktopDiagnostics
// →按钮不渲染（fail-closed 探测，与 desktopUpdates 的 channel gating 同模式）。
/** preload 暴露的 window.desktopDiagnostics 窄接口形状（主进程实现于 desktop/src/diagnostics.ts） */
export interface DesktopDiagnosticsBridge {
  copyDiagnostics(): Promise<{ ok: true } | { ok: false, error: string }>
}

/** 桥面形状探测：仅 copyDiagnostics 为函数才可用（缺桥/坏形状一律 null，按钮不渲染） */
export function detectDesktopDiagnostics(source: unknown): DesktopDiagnosticsBridge | null {
  if (!source || typeof source !== 'object') return null
  const candidate = source as { copyDiagnostics?: unknown }
  return typeof candidate.copyDiagnostics === 'function'
    ? candidate as DesktopDiagnosticsBridge
    : null
}

/** 已复制反馈文案（proposed_default：验收确认后冻结） */
export const DIAG_COPY_DONE_TEXT = '已复制，可粘贴到问题反馈'
/** 已复制反馈停留时长 ms（proposed_default） */
export const DIAG_FEEDBACK_MS = 3000
/** 复制失败文案前缀（人话原因由主进程结构化返回） */
export const DIAG_COPY_FAILED_PREFIX = '复制失败：'
