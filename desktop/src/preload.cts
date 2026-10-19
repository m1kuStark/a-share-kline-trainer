// PACK-04 preload（最小 IPC 面；打破 PACK-02「无 preload」决策的唯一例外，仅更新相关窄接口）。
// 形态＝.cts（CommonJS 源，tsc 产出 preload.cjs）：sandboxed preload 不能用 ESM imports
// （Electron 官方 ESM 文档），而 webPreferences.sandbox 保持 true（PACK-02 安全基线不动），
// 故 preload 以 CJS 形态编译（desktop/tsconfig.json 的 include 覆盖 src/**/*.ts 含 .cts）。
// 约束（UPD-DESKTOP-IPC-MINIMAL）：contextIsolation/sandbox 保持开；本文件只经 contextBridge
// 暴露窄接口对象、无任何业务逻辑——PACK-04 为 desktopUpdates；DATA-ARCH-01 新增第二个
// 对象 desktopRecordings（单一方法 archiveRecording：录像归档写入，主进程实现于
// archive-recording.ts）。channel() 同步语义：invoke 是异步的，故启动时预取一次并缓存
// （isPackaged 在主进程启动即定，值恒定不漂移）；未就绪/失败时保守回 dev（渲染端回落
// 既有 http 流程，fail-closed）。
import { contextBridge, ipcRenderer } from 'electron'

let cachedChannel: { kind: 'packaged' | 'dev' } = { kind: 'dev' }

void ipcRenderer.invoke('desktop-update:invoke', { method: 'channel' })
  .then((value: unknown) => {
    if (value && typeof value === 'object' && typeof (value as { kind?: unknown }).kind === 'string') {
      cachedChannel = value as { kind: 'packaged' | 'dev' }
    }
  })
  .catch(() => { /* 主进程未注册（dev 窗口等）→保守 dev，渲染端走既有 http 流程 */ })

contextBridge.exposeInMainWorld('desktopUpdates', {
  channel: (): { kind: 'packaged' | 'dev' } => cachedChannel,
  checkForUpdates: () => ipcRenderer.invoke('desktop-update:invoke', { method: 'checkForUpdates' }) as Promise<{
    currentVersion: string | null
    latestVersion: string | null
    updateAvailable: boolean
    releaseNotes: string | null
    error: string | null
  }>,
  downloadAndInstall: () => ipcRenderer.invoke('desktop-update:invoke', { method: 'downloadAndInstall' }) as Promise<{ ok: true } | { ok: false, error: string }>,
  onUpdateEvent: (callback: (event: unknown) => void): (() => void) => {
    const listener = (_event: unknown, payload: unknown): void => { callback(payload) }
    ipcRenderer.on('desktop-update:event', listener)
    return () => { ipcRenderer.off('desktop-update:event', listener) }
  },
})

// DATA-ARCH-01 录像归档窄接口：渲染端组装语义化文件名＋gzip 载荷，主进程写 <dataDir>/recordings/。
// 仅一个方法；结果结构化返回（ok:false 带中文错误），渲染端据此降级提示、绝不因归档阻塞结算。
contextBridge.exposeInMainWorld('desktopRecordings', {
  archiveRecording: (fileName: string, bytes: Uint8Array) => ipcRenderer.invoke('desktop-archive-recording:invoke', {
    method: 'archive',
    fileName,
    bytes,
  }) as Promise<{ ok: true; path: string } | { ok: false; error: string }>,
})

// MIG-EXT-01 v1.2.7 训练历史迁移窄接口（三方法；主进程实现于 desktop/src/mig-import.ts）：
// pick＝原生文件选择迁移清单.json；inspect＝包体检读计数；importHistory＝暂存导入（重启后
// 合并生效，MIG-MERGE-01；skipped＝按业务键预查将跳过的局数，importing＝将新导入局数）。
// 与归档同一纪律：结果结构化返回（ok:false 带中文原因），绝不向渲染端抛异常。
contextBridge.exposeInMainWorld('desktopMigration', {
  pick: () => ipcRenderer.invoke('desktop-migration:invoke', { method: 'pick' }) as Promise<
    { ok: true; manifestPath: string } | { ok: false; error: string }
  >,
  inspect: (manifestPath: string) => ipcRenderer.invoke('desktop-migration:invoke', { method: 'inspect', manifestPath }) as Promise<
    { ok: true; counts: Record<string, number>; sqlitePath: string } | { ok: false; error: string }
  >,
  importHistory: (manifestPath: string) => ipcRenderer.invoke('desktop-migration:invoke', { method: 'import', manifestPath }) as Promise<
    { ok: true; requiresRestart: boolean; trainings: number; skipped: number; importing: number } | { ok: false; error: string }
  >,
})

// GAP1-DIAG（用户 2026-10-19 拍板 G1）：第四个窄对象 desktopDiagnostics（单一方法
// copyDiagnostics：主进程组装纯文本诊断——版本/平台/数据目录/更新通道与最近检查结果/
// 最近错误/日志尾部，绝不包含训练与交易数据——并写入系统剪贴板）。同一纪律：结果
// 结构化返回（ok:false 带中文原因），绝不向渲染端抛异常。
contextBridge.exposeInMainWorld('desktopDiagnostics', {
  copyDiagnostics: () => ipcRenderer.invoke('desktop-diagnostics:invoke', { method: 'copy' }) as Promise<
    { ok: true } | { ok: false; error: string }
  >,
})
