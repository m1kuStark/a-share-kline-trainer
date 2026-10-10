// DATA-ARCH-01 录像归档 IPC（Electron 主进程；依赖注入，vitest 可测——先例 update-ipc.ts）。
// 通道面（ARCH-IPC-MINIMAL）：ipcMain.handle('desktop-archive-recording:invoke')（method
// 路由 archive），把渲染端组装好的导出格式录像（gzip 字节）原子写入 <dataDir>/recordings/
// 下的语义化文件名（命名由渲染端 web/src/recording/archiveNaming.ts 生成；本模块只做
// 裸文件名校验＋同名冲突序号 -2/-3…＋临时文件＋rename 原子落盘，序号规则与
// resolveArchiveConflict 镜像，双方各有测试覆盖）。无其他 IPC 面；错误一律结构化
// { ok:false, error } 返回，绝不向渲染端抛异常（归档失败不阻塞结算流程）。
// 注：不 import web 模块（desktop tsconfig rootDir=src 的边界），文件名上限在此镜像同名常量。
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const ARCHIVE_CHANNEL = 'desktop-archive-recording:invoke'
/** 归档载荷上限：gzip 输入预算 25MiB（recordingFile.MAX_GZIP_INPUT_BYTES）＋余量 */
export const ARCHIVE_MAX_BYTES = 26 * 1024 * 1024
/** 文件名（含扩展名）长度上限；与 web/src/recording/archiveNaming.ts 的 ARCHIVE_FILE_NAME_MAX_CHARS 镜像 */
export const ARCHIVE_FILE_NAME_LIMIT = 150
/** 同名冲突序号上限（-2 … -99；超出视为异常路径，如实报错而非静默覆盖） */
const ARCHIVE_CONFLICT_MAX_SUFFIX = 99

export interface ArchiveWriteResult {
  ok: boolean
  path?: string
  error?: string
}

export interface ArchiveFsDeps {
  /** 递归创建目录 */
  mkdir(path: string): Promise<void>
  writeFile(path: string, data: Uint8Array, options: { flag: string }): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  /** 存在则 resolve，不存在则 reject */
  access(path: string): Promise<void>
}

export interface ArchiveIpcDeps {
  ipcMain: {
    handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void
  }
  /** 生效数据目录（config.dataDir 派生）；null＝未就绪（dev 窗口/启动早期） */
  recordingsDir: () => string | null
  fs: ArchiveFsDeps
  logger: { warn(...args: unknown[]): void, error(...args: unknown[]): void }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 裸文件名校验：非空、长度受限、无路径分隔符/盘符/控制字符（防路径穿越与非法名） */
export function isSafeArchiveFileName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > ARCHIVE_FILE_NAME_LIMIT) return false
  if (value.includes('/') || value.includes('\\') || value.includes(':')) return false
  if (/[\u0000-\u001f]/.test(value)) return false
  if (value === '.' || value === '..' || value.startsWith('.')) return false
  return true
}

/** 依次探测 基础名、-2、-3…；全部占用时报错（调用方在写入前探测，rename 前存在竞态则由重试兜底） */
async function pickTargetName(dir: string, fileName: string, fs: ArchiveFsDeps): Promise<string> {
  const exists = async (candidate: string): Promise<boolean> => {
    try { await fs.access(join(dir, candidate)); return true } catch { return false }
  }
  if (!(await exists(fileName))) return fileName
  const stem = fileName.replace(/\.trainer-session\.json\.gz$/, '')
  for (let suffix = 2; suffix <= ARCHIVE_CONFLICT_MAX_SUFFIX; suffix += 1) {
    const candidate = `${stem}-${suffix}.trainer-session.json.gz`
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`同名归档已存在且序号用尽（${stem}）：请清理 recordings 归档目录后重试`)
}

export function registerArchiveIpc(deps: ArchiveIpcDeps): void {
  const { ipcMain } = deps
  ipcMain.handle(ARCHIVE_CHANNEL, async (_event, request) => {
    try {
      const parsed = (request ?? null) as { method?: unknown; fileName?: unknown; bytes?: unknown } | null
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.method !== 'archive') {
        return { ok: false, error: `未知的归档 IPC 方法：${String(parsed?.method)}` } satisfies ArchiveWriteResult
      }
      if (!isSafeArchiveFileName(parsed.fileName)) {
        return { ok: false, error: '归档文件名不合法（仅接受不含路径的裸文件名）' } satisfies ArchiveWriteResult
      }
      const bytes = parsed.bytes
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        return { ok: false, error: '归档载荷必须是非空的二进制录像数据' } satisfies ArchiveWriteResult
      }
      if (bytes.byteLength > ARCHIVE_MAX_BYTES) {
        return { ok: false, error: `归档载荷 ${bytes.byteLength} 字节超过上限 ${ARCHIVE_MAX_BYTES} 字节` } satisfies ArchiveWriteResult
      }
      const dir = deps.recordingsDir()
      if (!dir) {
        return { ok: false, error: '数据目录未就绪（桌面归档仅在应用完成启动后可用）' } satisfies ArchiveWriteResult
      }
      try {
        await deps.fs.mkdir(dir)
      } catch (error) {
        return { ok: false, error: `无法创建归档目录：${reason(error)}` } satisfies ArchiveWriteResult
      }
      // 写入前探测同名冲突；探测后到 rename 前的竞态由 rename 覆盖失败如实暴露（单实例应用，窗口极小）
      const fileName = await pickTargetName(dir, parsed.fileName, deps.fs)
      const target = join(dir, fileName)
      const temporary = `${target}.${randomUUID()}.tmp`
      await deps.fs.writeFile(temporary, bytes, { flag: 'wx' })
      await deps.fs.rename(temporary, target)
      return { ok: true, path: target } satisfies ArchiveWriteResult
    } catch (error) {
      deps.logger.warn('[desktop] recording archive failed:', error)
      return { ok: false, error: reason(error) } satisfies ArchiveWriteResult
    }
  })
}
