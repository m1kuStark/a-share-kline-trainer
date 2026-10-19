// GAP1-DIAG DESKTOP-DIAG-LOG-PERSIST：自实现主进程日志落盘（追加写/按大小滚动/写失败降级）。
// oracle 独立性：期望内容全部为测试手写行文本与手算顺序（L1..L5 的滚动分布按
// 「追加前 size>=maxBytes 才滚动」口径独立推演），非实现回显；§4.2 真实边界——
// 核心用例走真实 fs（tmpdir），桩仅用于失败注入分支。默认阈值/份数为 proposed_default
// 常量断言（2 MiB × 当前＋2 旧档），验收确认后冻结。
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DIAG_LOG_DEFAULT_KEEP_FILES,
  DIAG_LOG_DEFAULT_MAX_BYTES,
  DIAG_LOG_DIR_NAME,
  DIAG_LOG_FILE_NAME,
  createDiagLogger,
  createNodeDiagLogDeps,
  createTeeConsole,
  type DiagLogDeps,
} from '../src/diag-log.js'

async function makeDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'gap1-diag-'))
}

/** 失败注入桩：appendFile（或指定项）按剧本抛错，其余透传真实 fs */
function failingDeps(overrides: Partial<DiagLogDeps>): DiagLogDeps {
  const real = createNodeDiagLogDeps()
  return { ...real, ...overrides } as DiagLogDeps
}

describe('GAP1-DIAG 自实现日志落盘（DESKTOP-DIAG-LOG-PERSIST）', () => {
  it('appends lines in order to <dataDir>/logs/main.log, creating the directory（真实 fs）', async () => {
    const dataDir = await makeDataDir()
    try {
      const logger = createDiagLogger({ dataDir, deps: createNodeDiagLogDeps() })
      expect(logger.filePath).toBe(join(dataDir, DIAG_LOG_DIR_NAME, DIAG_LOG_FILE_NAME))
      await logger.append('first-line')
      await logger.append('second-line')
      // 目录已自动创建；内容按追加顺序、每行以换行收尾（手写期望，非实现回显）
      expect(await readFile(logger.filePath, 'utf8')).toBe('first-line\nsecond-line\n')
    } finally {
      await rm0(dataDir)
    }
  })

  it('rotates by size keeping exactly the bounded set（真实 fs＋注入小阈值；手算分布）', async () => {
    const dataDir = await makeDataDir()
    try {
      // 口径：追加前 stat 当前文件 size >= maxBytes 才滚动；9 字节/行（8 字符＋换行）。
      // maxBytes=18：L1 后 9、L2 后 18、L3 触发滚动（main→.1，收 L3）、L4 后 18、
      // L5 触发滚动（.1→.2，main→.1，新 main 收 L5）。
      const logger = createDiagLogger({ dataDir, deps: createNodeDiagLogDeps(), maxBytes: 18, keepFiles: 3 })
      for (const line of ['line-000', 'line-001', 'line-002', 'line-003', 'line-004']) {
        await logger.append(line)
      }
      const dir = join(dataDir, DIAG_LOG_DIR_NAME)
      expect((await readdir(dir)).sort()).toEqual(['main.log', 'main.log.1', 'main.log.2'])
      expect(await readFile(join(dir, 'main.log'), 'utf8')).toBe('line-004\n')
      expect(await readFile(join(dir, 'main.log.1'), 'utf8')).toBe('line-002\nline-003\n')
      expect(await readFile(join(dir, 'main.log.2'), 'utf8')).toBe('line-000\nline-001\n')
    } finally {
      await rm0(dataDir)
    }
  })

  it('keeps the default threshold and retention constants（proposed_default 数值断言）', () => {
    expect(DIAG_LOG_DEFAULT_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(DIAG_LOG_DEFAULT_KEEP_FILES).toBe(3)
  })

  it('degrades write failures to console and never throws nor blocks（注入桩）', async () => {
    const warn = vi.fn()
    const appendFailing = failingDeps({
      mkdir: async () => { /* 目录步骤隔离为成功，专测 appendFile 失败分支 */ },
      appendFile: async () => { throw new Error('disk full') },
    })
    // fallback 由 deps 携带：真实适配器工厂接受 fallback，桩路径直接组装
    const loggerA = createDiagLogger({
      dataDir: 'Z:/nowhere',
      deps: { ...appendFailing, fallback: { warn } },
    })
    await expect(loggerA.append('doomed')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0])).toContain('disk full')

    // 建目录失败同样降级（目录不可写＝dataDir 异常分支）
    const mkdirFailing = failingDeps({
      mkdir: async () => { throw new Error('EACCES: permission denied') },
    })
    const loggerB = createDiagLogger({ dataDir: 'Z:/locked', deps: { ...mkdirFailing, fallback: { warn } } })
    await expect(loggerB.append('doomed')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)

    // 滚动失败（rename 被占用）不阻断：当次仍追加进当前文件（真实 fs 验证）
    const dataDir = await makeDataDir()
    try {
      const real = createNodeDiagLogDeps()
      const loggerC = createDiagLogger({
        dataDir,
        deps: {
          ...real,
          rename: async (from, to) => {
            if (from.endsWith('main.log') && to.endsWith('main.log.1')) {
              throw new Error('EPERM: file in use by another process')
            }
            return rename(from, to)
          },
          fallback: { warn },
        },
        maxBytes: 9,
        keepFiles: 3,
      })
      await loggerC.append('aaaa')   // 5 字节，未到阈值
      await loggerC.append('bbbb')   // 触发滚动（5>=9? 否——5<9 不滚动）
      await loggerC.append('ccccc')  // 10>=9 触发滚动 → rename 失败降级，仍追加当前文件
      expect(await readFile(join(dataDir, DIAG_LOG_DIR_NAME, DIAG_LOG_FILE_NAME), 'utf8'))
        .toBe('aaaa\nbbbb\nccccc\n')
      expect(warn).toHaveBeenCalledTimes(3)
    } finally {
      await rm0(dataDir)
    }
  })

  it('readTail returns the last N lines; missing file＝empty ok; unreadable＝structured reason', async () => {
    const dataDir = await makeDataDir()
    try {
      const logger = createDiagLogger({ dataDir, deps: createNodeDiagLogDeps() })
      // 无文件（全新安装）：ok 且空，不报错
      const empty = await logger.readTail(5)
      expect(empty).toEqual({ ok: true, lines: [] })

      for (const line of ['t1', 't2', 't3', 't4', 't5']) await logger.append(line)
      expect(await logger.readTail(3)).toEqual({ ok: true, lines: ['t3', 't4', 't5'] })
      expect(await logger.readTail(10)).toEqual({ ok: true, lines: ['t1', 't2', 't3', 't4', 't5'] })
      expect(await logger.readTail(0)).toEqual({ ok: true, lines: [] })

      // 文件在但读失败（权限等）→ 结构化失败原因，不抛
      const unreadable = createDiagLogger({
        dataDir,
        deps: {
          ...createNodeDiagLogDeps(),
          readFile: async () => { throw new Error('EACCES: locked by scanner') },
        },
      })
      const failed = await unreadable.readTail(3)
      expect(failed.ok).toBe(false)
      if (!failed.ok) expect(failed.reason).toContain('EACCES: locked by scanner')
    } finally {
      await rm0(dataDir)
    }
  })

  it('tee console passes through to console and appends timestamped level lines（注入桩）', async () => {
    const appended: string[] = []
    const errorLines: string[] = []
    const consoleFake = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const sink = {
      filePath: 'x', dirPath: 'x', maxBytes: 1, keepFiles: 3,
      append: async (line: string) => { appended.push(line) },
      readTail: async () => ({ ok: true as const, lines: [] }),
    }
    const tee = createTeeConsole({
      getSink: () => sink,
      onErrorLine: line => { errorLines.push(line) },
      console: consoleFake,
      now: () => '2026-10-19T03:00:00.000Z',
    })
    tee.log('hello', { code: 1 })
    tee.error('bad thing')
    // 透传：console 收到原始参数
    expect(consoleFake.log).toHaveBeenCalledWith('hello', { code: 1 })
    expect(consoleFake.error).toHaveBeenCalledWith('bad thing')
    // 落盘：ISO 时间＋级别＋格式化文本；error 级别额外进错误环回调
    expect(appended).toEqual([
      '2026-10-19T03:00:00.000Z [log] hello { code: 1 }',
      '2026-10-19T03:00:00.000Z [error] bad thing',
    ])
    expect(errorLines).toEqual(['2026-10-19T03:00:00.000Z [error] bad thing'])
    // 无 sink（attach 前）＝仅 console，不抛
    const early = createTeeConsole({ getSink: () => null, console: consoleFake, now: () => '2026-10-19T03:00:00.000Z' })
    expect(() => early.warn('early line')).not.toThrow()
    expect(consoleFake.warn).toHaveBeenCalledWith('early line')
  })
})

/** 测试内清理（避免与被测模块的 rm 语义耦合） */
async function rm0(path: string): Promise<void> {
  const { rm } = await import('node:fs/promises')
  await rm(path, { recursive: true, force: true })
}
