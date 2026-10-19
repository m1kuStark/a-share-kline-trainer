// GAP1-DIAG（用户 2026-10-19 拍板 G1＋拍板 8）主进程日志落盘·自实现零新依赖。
// 矩阵行 DESKTOP-DIAG-LOG-PERSIST：<dataDir>/logs/main.log 追加写；启动建目录；
// 按大小滚动保留最近有限份（proposed_default：单文件 2 MiB，当前＋2 旧档共 3 份）；
// 写失败降级 console 绝不崩进程、绝不阻断启动（逐次降级不熔断——下次写入继续尝试）。
// 形态镜像 data-home.ts：决策与 IO 全部经 DiagLogDeps 注入（vitest 直测；真实适配器
// createNodeDiagLogDeps），本模块不触碰 Electron。tee（createTeeConsole）＝console 透传
// ＋落盘＋error 级错误环回调，供 main.ts 把全部日志调用收口到同一管线（attach 前仅 console）。
import { format } from 'node:util'
import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const DIAG_LOG_DIR_NAME = 'logs'
export const DIAG_LOG_FILE_NAME = 'main.log'
/** 单文件滚动阈值（proposed_default，验收确认后冻结） */
export const DIAG_LOG_DEFAULT_MAX_BYTES = 2 * 1024 * 1024
/** 保留份数＝当前文件＋旧档数（proposed_default：main.log＋.1＋.2） */
export const DIAG_LOG_DEFAULT_KEEP_FILES = 3

export interface DiagLogDeps {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  appendFile(path: string, data: string): Promise<void>
  readFile(path: string): Promise<string>
  stat(path: string): Promise<{ size: number }>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options: { force: true }): Promise<void>
  /** 写失败/滚动失败的降级出口（缺省不降级输出，仅吞掉） */
  fallback?: { warn(...args: unknown[]): void }
}

export type DiagTailResult = { ok: true, lines: string[] } | { ok: false, reason: string }

export interface DiagLogger {
  readonly dirPath: string
  readonly filePath: string
  readonly maxBytes: number
  readonly keepFiles: number
  append(line: string): Promise<void>
  readTail(maxLines: number): Promise<DiagTailResult>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '(unstringifiable error)'
  }
}

function isNoEnt(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * 追加写经内部 promise 链串行化（时序稳定，测试可确定性断言行序）；
 * 任何一步失败→fallback.warn 降级后吞掉（绝不抛出、绝不阻断调用方）。
 */
export function createDiagLogger(options: {
  dataDir: string
  deps: DiagLogDeps
  maxBytes?: number
  keepFiles?: number
}): DiagLogger {
  const maxBytes = options.maxBytes ?? DIAG_LOG_DEFAULT_MAX_BYTES
  const keepFiles = Math.max(1, options.keepFiles ?? DIAG_LOG_DEFAULT_KEEP_FILES)
  const dirPath = join(options.dataDir, DIAG_LOG_DIR_NAME)
  const filePath = join(dirPath, DIAG_LOG_FILE_NAME)
  const deps = options.deps
  let queue: Promise<void> = Promise.resolve()

  const warnDegraded = (error: unknown): void => {
    deps.fallback?.warn('[desktop] 日志落盘失败（降级仅控制台）:', errorMessage(error))
  }

  /** 滚动：删最旧 → 逐档后移（1→2、…）→ 当前转 .1；单步失败降级告警并继续追加当前文件 */
  const rotate = async (): Promise<void> => {
    await deps.rm(join(dirPath, `${DIAG_LOG_FILE_NAME}.${keepFiles - 1}`), { force: true })
    for (let i = keepFiles - 2; i >= 1; i -= 1) {
      try {
        await deps.rename(join(dirPath, `${DIAG_LOG_FILE_NAME}.${i}`), join(dirPath, `${DIAG_LOG_FILE_NAME}.${i + 1}`))
      } catch (error) {
        if (!isNoEnt(error)) warnDegraded(error)
      }
    }
    await deps.rename(filePath, join(dirPath, `${DIAG_LOG_FILE_NAME}.1`))
  }

  const appendLine = async (line: string): Promise<void> => {
    try {
      await deps.mkdir(dirPath, { recursive: true })
      try {
        const info = await deps.stat(filePath)
        if (info.size >= maxBytes) {
          // 滚动失败（Windows 文件占用等）不阻断当次追加——保日志优先，当前文件允许暂超阈值
          try {
            await rotate()
          } catch (error) {
            warnDegraded(error)
          }
        }
      } catch (error) {
        if (!isNoEnt(error)) throw error // stat 自身异常（非缺文件）按写失败降级
      }
      const data = line.endsWith('\n') ? line : `${line}\n`
      await deps.appendFile(filePath, data)
    } catch (error) {
      warnDegraded(error)
    }
  }

  return {
    dirPath,
    filePath,
    maxBytes,
    keepFiles,
    append(line: string): Promise<void> {
      queue = queue.then(() => appendLine(line))
      return queue
    },
    async readTail(maxLines: number): Promise<DiagTailResult> {
      if (maxLines < 1) return { ok: true, lines: [] }
      let raw: string
      try {
        raw = await deps.readFile(filePath)
      } catch (error) {
        if (isNoEnt(error)) return { ok: true, lines: [] } // 全新安装尚无日志＝正常空
        return { ok: false, reason: errorMessage(error) }
      }
      const lines = raw.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      return { ok: true, lines: maxLines >= lines.length ? lines : lines.slice(-maxLines) }
    },
  }
}

/** 真实 fs 适配（main.ts 粘合用；测试注入桩直测决策，真实边界用例也走本适配） */
export function createNodeDiagLogDeps(fallback?: { warn(...args: unknown[]): void }): DiagLogDeps {
  return {
    mkdir: async (path, options) => { await mkdir(path, options) },
    appendFile: async (path, data) => { await appendFile(path, data, 'utf8') },
    readFile: async path => readFile(path, 'utf8'),
    stat: async path => stat(path).then(info => ({ size: info.size })),
    rename: async (from, to) => { await rename(from, to) },
    rm: async (path, options) => { await rm(path, options) },
    fallback,
  }
}

// ===== tee console（main.ts 日志收口：console 透传＋落盘＋错误环回调） =====

export interface TeeConsole {
  log(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface TeeConsoleOptions {
  /** sink 惰性取值（attach 前为 null＝仅 console） */
  getSink: () => DiagLogger | null
  /** error 级别行回调（main 侧最近错误环；可选） */
  onErrorLine?: (line: string) => void
  /** 注入点（测试桩；缺省全局 console） */
  console?: { log(...args: unknown[]): void, info(...args: unknown[]): void, warn(...args: unknown[]): void, error(...args: unknown[]): void }
  now?: () => string
}

/**
 * console＋落盘双写：原始参数原样透传 console（不改变既有可观察行为），同时以
 * 「ISO [level] 格式化文本」行落盘；error 级别额外交 onErrorLine。attach 前仅 console。
 */
export function createTeeConsole(options: TeeConsoleOptions): TeeConsole {
  const consoleSink = options.console ?? console
  const now = options.now ?? (() => new Date().toISOString())
  const write = (level: 'log' | 'info' | 'warn' | 'error', args: unknown[], passthrough: 'log' | 'info' | 'warn' | 'error'): void => {
    const line = `${now()} [${level}] ${format(...args)}`
    consoleSink[passthrough](...args)
    if (level === 'error') options.onErrorLine?.(line)
    void options.getSink()?.append(line)
  }
  return {
    log: (...args) => write('log', args, 'log'),
    info: (...args) => write('info', args, 'info'),
    warn: (...args) => write('warn', args, 'warn'),
    error: (...args) => write('error', args, 'error'),
  }
}
