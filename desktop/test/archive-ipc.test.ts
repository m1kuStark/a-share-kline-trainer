// DATA-ARCH-01 录像归档 IPC·desktop/src/archive-recording.ts 单测（矩阵行
// ARCH-IPC-WRITE-ATOMIC / ARCH-IPC-CONFLICT-SUFFIX / ARCH-IPC-NAME-SANDBOX /
// ARCH-IPC-NOT-READY）。oracle＝任务简报实现语义 2/3 条：Electron 环境经 main IPC
// `archive-recording` 把导出格式录像原子写入 <dataDir>/recordings/，同名冲突加
// 序号后缀，文件名只接受裸文件名（防路径穿越），目录不可用时如实报错不抛异常。
// fs 经 deps 注入（真实临时目录验证，先例 data-home-fs.test.ts；不触碰用户目录）。
import { describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerArchiveIpc } from '../src/archive-recording.js'

const GZ = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03, 0x04])

interface CapturedIpc {
  handlers: Map<string, (event: unknown, request: unknown) => unknown>
  invoke(channel: string, request: unknown): Promise<unknown>
}

function captureIpc(): CapturedIpc {
  const handlers = new Map<string, (event: unknown, request: unknown) => unknown>()
  return {
    handlers,
    invoke: (channel, request) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`no handler for ${channel}`)
      return Promise.resolve(handler({}, request))
    },
  }
}

function realFs() {
  return {
    mkdir: (path: string) => mkdir(path, { recursive: true }),
    writeFile: (path: string, data: Uint8Array, options: { flag: string }) => writeFile(path, data, options),
    rename: (oldPath: string, newPath: string) => rename(oldPath, newPath),
    access: (path: string) => access(path),
  }
}

const NAME = '贵州茅台-经典-1Y-20260901-收益+12.34%.trainer-session.json.gz'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'archive-ipc-'))
  const dataDir = join(root, 'data')
  await mkdir(dataDir, { recursive: true })
  const ipc = captureIpc()
  registerArchiveIpc({
    ipcMain: { handle: (channel, listener) => ipc.handlers.set(channel, listener) },
    recordingsDir: () => join(dataDir, 'recordings'),
    fs: realFs(),
    logger: { warn: () => {}, error: () => {} },
  })
  return { root, dataDir, ipc, invoke: (request: unknown) => ipc.invoke('desktop-archive-recording:invoke', request) }
}

describe('archive IPC 写入', () => {
  it('ARCH-IPC-WRITE-ATOMIC：创建 recordings 目录并原子写入 gzip 字节，返回完整路径', async () => {
    const { root, dataDir, invoke } = await setup()
    try {
      const result = await invoke({ method: 'archive', fileName: NAME, bytes: GZ }) as { ok: boolean; path?: string }
      expect(result.ok).toBe(true)
      const target = join(dataDir, 'recordings', NAME)
      expect(result.path).toBe(target)
      expect([...await readFile(target)]).toEqual([...GZ])
      // 原子性：目录内不残留任何临时文件
      expect(await readdir(join(dataDir, 'recordings'))).toEqual([NAME])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('ARCH-IPC-CONFLICT-SUFFIX：同名冲突依次 -2/-3，既有文件字节不被覆盖', async () => {
    const { root, dataDir, invoke } = await setup()
    try {
      const original = new Uint8Array([1, 2, 3])
      await mkdir(join(dataDir, 'recordings'), { recursive: true })
      await writeFile(join(dataDir, 'recordings', NAME), original)
      const result = await invoke({ method: 'archive', fileName: NAME, bytes: GZ }) as { ok: boolean; path?: string }
      expect(result.ok).toBe(true)
      expect(result.path).toBe(join(dataDir, 'recordings', NAME.replace('.trainer-session.json.gz', '-2.trainer-session.json.gz')))
      expect([...await readFile(join(dataDir, 'recordings', NAME))]).toEqual([...original])
      expect([...await readFile(result.path!)]).toEqual([...GZ])
      const second = await invoke({ method: 'archive', fileName: NAME, bytes: GZ }) as { ok: boolean; path?: string }
      expect(second.path).toBe(join(dataDir, 'recordings', NAME.replace('.trainer-session.json.gz', '-3.trainer-session.json.gz')))
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('ARCH-IPC-NAME-SANDBOX：拒绝路径穿越/分隔符/绝对路径/非字符串/超长文件名', async () => {
    const { root, invoke } = await setup()
    try {
      for (const fileName of ['../evil.gz', 'a/b.gz', 'a\\b.gz', 'C:\\x\\y.gz', '', 42, null, `${'x'.repeat(200)}.trainer-session.json.gz`]) {
        const result = await invoke({ method: 'archive', fileName, bytes: GZ }) as { ok: boolean; error?: string }
        expect(result.ok, `fileName=${String(fileName)}`).toBe(false)
        expect(result.error).toBeTruthy()
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('拒绝空载荷与未知 method；结构化返回错误而非抛异常', async () => {
    const { root, invoke } = await setup()
    try {
      expect(await invoke({ method: 'archive', fileName: NAME, bytes: new Uint8Array(0) })).toMatchObject({ ok: false })
      expect(await invoke({ method: 'unknown', fileName: NAME, bytes: GZ })).toMatchObject({ ok: false })
      expect(await invoke(null)).toMatchObject({ ok: false })
      expect(await invoke(undefined)).toMatchObject({ ok: false })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('ARCH-IPC-NOT-READY：数据目录未知（dev 窗口/未就绪）时返回可读错误，不抛异常', async () => {
    const ipc = captureIpc()
    registerArchiveIpc({
      ipcMain: { handle: (channel, listener) => ipc.handlers.set(channel, listener) },
      recordingsDir: () => null,
      fs: realFs(),
      logger: { warn: () => {}, error: () => {} },
    })
    const result = await ipc.invoke('desktop-archive-recording:invoke', { method: 'archive', fileName: NAME, bytes: GZ }) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('未就绪')
  })

  it('写入失败（目录不可写）如实返回错误', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-ipc-'))
    try {
      const ipc = captureIpc()
      registerArchiveIpc({
        ipcMain: { handle: (channel, listener) => ipc.handlers.set(channel, listener) },
        recordingsDir: () => join(root, 'recordings'),
        fs: {
          mkdir: async () => { throw new Error('EACCES: permission denied') },
          writeFile: async () => {},
          rename: async () => {},
          access: async () => {},
        },
        logger: { warn: () => {}, error: () => {} },
      })
      const result = await ipc.invoke('desktop-archive-recording:invoke', { method: 'archive', fileName: NAME, bytes: GZ }) as { ok: boolean; error?: string }
      expect(result.ok).toBe(false)
      expect(result.error).toContain('EACCES')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
