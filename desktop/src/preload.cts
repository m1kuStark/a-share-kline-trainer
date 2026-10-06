// PACK-04 preload（最小 IPC 面；打破 PACK-02「无 preload」决策的唯一例外，仅更新相关窄接口）。
// 形态＝.cts（CommonJS 源，tsc 产出 preload.cjs）：sandboxed preload 不能用 ESM imports
// （Electron 官方 ESM 文档），而 webPreferences.sandbox 保持 true（PACK-02 安全基线不动），
// 故 preload 以 CJS 形态编译（desktop/tsconfig.json 的 include 覆盖 src/**/*.ts 含 .cts）。
// 约束（UPD-DESKTOP-IPC-MINIMAL）：contextIsolation/sandbox 保持开；本文件只经 contextBridge
// 暴露 desktopUpdates 一个对象、四成员窄接口；无任何业务逻辑。
// channel() 同步语义：invoke 是异步的，故启动时预取一次并缓存（isPackaged 在主进程启动
// 即定，值恒定不漂移）；未就绪/失败时保守回 dev（渲染端回落既有 http 流程，fail-closed）。
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
