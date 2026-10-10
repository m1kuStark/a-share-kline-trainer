// DATA-ARCH-01 录像自动归档·渲染端桥（web 侧）。
// Electron 环境：经 preload 暴露的 window.desktopRecordings.archiveRecording 走主进程
// IPC 写入 <dataDir>/recordings/；纯 Web/dev 环境无文件系统能力 → 降级为控制台提示，
// 不弹窗打扰（简报实现语义 2）。归档失败不阻塞结算流程——错误结构化返回，由调用方提示。
export interface DesktopRecordingsApi {
  archiveRecording(fileName: string, bytes: Uint8Array): Promise<{ ok: true; path: string } | { ok: false; degraded?: boolean; error: string }>
}

export type ArchiveAttemptResult =
  | { ok: true; path: string }
  | { ok: false; degraded: boolean; error: string }

/** 桌面归档桥探测：仅 Electron（preload 注入）存在；纯浏览器/journey 环境为 null */
export function desktopRecordingsApi(): DesktopRecordingsApi | null {
  const holder = window as unknown as { desktopRecordings?: DesktopRecordingsApi }
  return holder.desktopRecordings ?? null
}

/** 纯 Web 降级提示（一次性事实陈述；不打断任何流程） */
const DEGRADE_MESSAGE = '[录像归档] 当前为浏览器环境（无桌面文件系统），本场录像已保留在浏览器存储；可从录像库手动导出'

/** 把 gzip 录像字节归档到数据目录 recordings/；返回结构化结果，绝不抛异常 */
export async function archiveRecordingFile(fileName: string, bytes: Uint8Array): Promise<ArchiveAttemptResult> {
  const api = desktopRecordingsApi()
  if (!api) {
    console.info(DEGRADE_MESSAGE)
    return { ok: false, degraded: true, error: '浏览器环境无文件系统归档能力' }
  }
  try {
    const result = await api.archiveRecording(fileName, bytes)
    // IPC 失败不区分降级（degraded 只用于浏览器环境提示口径）
    return result.ok ? result : { ok: false, degraded: false, error: result.error }
  } catch (error) {
    return { ok: false, degraded: false, error: error instanceof Error ? error.message : String(error) }
  }}
