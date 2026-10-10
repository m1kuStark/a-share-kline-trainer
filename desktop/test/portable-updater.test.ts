// PORT-UPD-01 便携版自研 exe 替换式自更新·纯逻辑与适配器单测。
// oracle 独立性：期望值手写自 PORT-UPD-01 派发简报实现规格（用户拍板方案 A）＋PACK-05
// 冻结产物命名契约（desktopArtifactNames）；sha512/size 期望由测试侧 node:crypto 独立
// 计算；latest.yml fixture 由测试手写（非实现回显）；替换脚本模板断言来自规格第 4 条时序。
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildPortableFeedUrls,
  cleanupPortableUpdateLeftovers,
  createPortableUpdaterAdapter,
  isPortableExecution,
  parsePortableLatestYml,
  portableArtifactName,
  renderReplaceScript,
  selectPortableEntry,
} from '../src/portable-updater.js'

const sha512Base64 = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('base64')

/** quitAndInstall 为 fire-and-forget（真实调用方 main 不 await）；测试轮询等其内部异步体收敛 */
async function until(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('until: 超时')
    await new Promise(resolve => setTimeout(resolve, 15))
  }
}

/** 测试侧手写 latest.yml fixture（形状＝release-desktop-lib.mjs renderLatestYml 冻结形状） */
function latestYmlFixture(version: string, files: Array<{ url: string, sha512: string, size: number }>): string {
  return [
    `version: ${version}`,
    `path: kline-trainer-desktop-setup-v${version}-windows-x64.exe`,
    `sha512: ${files[0]?.sha512 ?? sha512Base64(new Uint8Array([1]))}`,
    "releaseDate: '2026-10-11T00:00:00.000Z'",
    'files:',
    ...files.flatMap(file => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`,
    ]),
    '',
  ].join('\n')
}

const NEW_EXE_BYTES = new Uint8Array([0x4d, 0x5a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

/** 适配器依赖工厂：网络/spawn/quitApp 全注入；fs 走真实临时目录（仓库 server updater 测试先例） */
function makeAdapterDeps(overrides: {
  fetchText?: (url: string) => Promise<string>
  downloadToFile?: (url: string, dest: string, onProgress: (transferred: number, total: number) => void) => Promise<void>
  spawnDetached?: (command: string, args: string[]) => void
  quitApp?: () => void
  getCurrentVersion?: () => string | null
  dataDir?: string | null
  exePath?: string
  onApplyFailure?: (message: string) => void
} = {}) {
  const dataDir = overrides.dataDir === undefined ? null : overrides.dataDir
  const calls = { spawn: [] as Array<{ command: string, args: string[] }>, quitApp: 0, applyFailures: [] as string[] }
  const deps = {
    exePath: overrides.exePath ?? join(tmpdir(), 'apps', 'K线训练器.exe'),
    getDataDir: () => dataDir,
    getCurrentVersion: overrides.getCurrentVersion ?? (() => '1.2.7'),
    fetchText: overrides.fetchText ?? (async () => { throw new Error('fetchText not configured') }),
    downloadToFile: overrides.downloadToFile ?? (async () => { throw new Error('downloadToFile not configured') }),
    spawnDetached: overrides.spawnDetached ?? ((command: string, args: string[]) => { calls.spawn.push({ command, args }) }),
    quitApp: overrides.quitApp ?? (() => { calls.quitApp++ }),
    pid: 4242,
    onApplyFailure: overrides.onApplyFailure ?? ((message: string) => { calls.applyFailures.push(message) }),
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  }
  return { deps, calls }
}

/** 标准 fixture：9.9.9 便携条目（sha512/size＝测试侧独立计算的 NEW_EXE_BYTES 摘要） */
function happyFixture() {
  const version = '9.9.9'
  const portableName = portableArtifactName(version)
  const files = [
    { url: `kline-trainer-desktop-setup-v${version}-windows-x64.exe`, sha512: sha512Base64(new Uint8Array([9])), size: 1 },
    { url: portableName, sha512: sha512Base64(NEW_EXE_BYTES), size: NEW_EXE_BYTES.length },
  ]
  return { version, portableName, files, text: latestYmlFixture(version, files) }
}

describe('PORT-UPD-01 便携模式识别', () => {
  it('PORTABLE_EXECUTABLE_DIR 存在且非空白 → 便携；缺失/空白 → 非便携', () => {
    expect(isPortableExecution({ PORTABLE_EXECUTABLE_DIR: 'D:\\apps' })).toBe(true)
    expect(isPortableExecution({ PORTABLE_EXECUTABLE_DIR: '   ' })).toBe(false)
    expect(isPortableExecution({})).toBe(false)
    expect(isPortableExecution({ PORTABLE_EXECUTABLE_DIR: '' })).toBe(false)
  })
})

describe('PORT-UPD-01 产物命名与清单解析', () => {
  it('portableArtifactName 沿用 PACK-05 冻结命名契约，非法版本 fail-closed', () => {
    expect(portableArtifactName('1.2.7')).toBe('kline-trainer-desktop-v1.2.7-windows-x64.exe')
    expect(() => portableArtifactName('v1.2.7')).toThrow()
    expect(() => portableArtifactName('1.2')).toThrow()
  })

  it('parsePortableLatestYml 解析冻结形状并按精确名选中便携条目', () => {
    const fixture = happyFixture()
    const parsed = parsePortableLatestYml(fixture.text)
    expect(parsed.version).toBe('9.9.9')
    expect(parsed.files).toHaveLength(2)
    const entry = selectPortableEntry(parsed.files, fixture.version)
    expect(entry).toEqual({ url: fixture.portableName, sha512: sha512Base64(NEW_EXE_BYTES), size: NEW_EXE_BYTES.length })
    // 清单里没有便携产物 → null（不猜其他资产）
    expect(selectPortableEntry(parsed.files, '1.2.8')).toBeNull()
  })

  it('parsePortableLatestYml fail-closed：缺版本/缺 files/条目缺字段/版本非三段号全部拒绝', () => {
    expect(() => parsePortableLatestYml('')).toThrow()
    expect(() => parsePortableLatestYml('files:\n  - url: a.exe\n    sha512: x\n    size: 1\n')).toThrow(/版本/)
    expect(() => parsePortableLatestYml('version: 9.9.9\n')).toThrow(/files/)
    expect(() => parsePortableLatestYml('version: 9.9.9\nfiles:\n  - url: a.exe\n    size: 1\n')).toThrow()
    expect(() => parsePortableLatestYml('version: release-9.9.9\nfiles:\n  - url: a.exe\n    sha512: x\n    size: 1\n')).toThrow()
  })
})

describe('PORT-UPD-01 feed URL 构造（复用 UPD-DESKTOP-FEED-INJECTABLE 的 env 注入口径）', () => {
  it('generic feed → base/latest.yml 与 base/<资产名>（尾斜杠归一）', () => {
    const urls = buildPortableFeedUrls({ provider: 'generic', url: 'http://127.0.0.1:3999/feed/' })
    expect(urls.latestYmlUrl).toBe('http://127.0.0.1:3999/feed/latest.yml')
    expect(urls.assetUrl('a.exe')).toBe('http://127.0.0.1:3999/feed/a.exe')
  })

  it('github feed → Releases latest download 常量路径', () => {
    const urls = buildPortableFeedUrls({ provider: 'github', owner: 'm1kuStark', repo: 'a-share-kline-trainer' })
    expect(urls.latestYmlUrl).toBe('https://github.com/m1kuStark/a-share-kline-trainer/releases/latest/download/latest.yml')
    expect(urls.assetUrl('x.exe')).toBe('https://github.com/m1kuStark/a-share-kline-trainer/releases/latest/download/x.exe')
  })
})

describe('PORT-UPD-01 替换脚本渲染（规格第 4 条时序）', () => {
  const rendered = renderReplaceScript({
    exePath: 'C:\\apps\\K线训练器.exe',
    stagingExe: 'C:\\Users\\u\\AppData\\trainer\\update-staging\\kline-trainer-desktop-v9.9.9-windows-x64.exe',
    oldExe: 'C:\\apps\\K线训练器.exe.old',
    logPath: 'C:\\Users\\u\\AppData\\trainer\\update-staging\\replace.log',
    pid: 4242,
  })

  it('CRLF 批处理；路径/PID 以引号变量烘焙（不经 argv 传参）', () => {
    expect(rendered).toContain('\r\n')
    expect(rendered).toContain('set "EXE=C:\\apps\\K线训练器.exe"')
    expect(rendered).toContain('set "STAGING_EXE=')
    expect(rendered).toContain('set "OLD_EXE=C:\\apps\\K线训练器.exe.old"')
    expect(rendered).toContain('set "WAIT_PID=4242"')
  })

  it('先轮询等待旧进程退出（tasklist 过滤＋findstr 字面匹配），超时不触碰 exe 直接退出', () => {
    expect(rendered).toMatch(/tasklist \/FI "PID eq %WAIT_PID%" \/NH/)
    expect(rendered).toContain('findstr /C:"%WAIT_PID%"')
    expect(rendered).toMatch(/exit \/b 2/)
  })

  it('替换时序：旧 exe→.old → staging→原路径；失败回滚 .old→原路径；删 .old 不阻塞；启动新 exe', () => {
    const moveOld = rendered.indexOf('move /y "%EXE%" "%OLD_EXE%"')
    const moveNew = rendered.indexOf('move /y "%STAGING_EXE%" "%EXE%"')
    const rollback = rendered.indexOf('move /y "%OLD_EXE%" "%EXE%"', moveNew)
    const cleanup = rendered.indexOf('del /f /q "%OLD_EXE%"')
    const launch = rendered.indexOf('start "" /B "%EXE%"')
    expect(moveOld).toBeGreaterThanOrEqual(0)
    expect(moveNew).toBeGreaterThan(moveOld)
    expect(rollback).toBeGreaterThan(moveNew)
    // 清理与启动都在回滚分支之后（成功路径：替换→删 .old→启动）
    expect(cleanup).toBeGreaterThan(rollback)
    expect(launch).toBeGreaterThan(cleanup)
    // 回滚失败分支退出码 4；重命名失败退出码 3
    expect(rendered).toMatch(/exit \/b 3/)
    expect(rendered).toMatch(/exit \/b 4/)
  })
})

describe('PORT-UPD-01 适配器·检查（复用 compareVersions 单一口径）', () => {
  it('9.9.9 > 1.2.7 → updateAvailable true＋版本原样＋无 notes', async () => {
    const fixture = happyFixture()
    const { deps } = makeAdapterDeps({ fetchText: async () => fixture.text })
    const adapter = createPortableUpdaterAdapter(deps)
    await expect(adapter.checkForUpdates()).resolves.toEqual({ updateAvailable: true, version: '9.9.9', releaseNotes: null })
  })

  it('平版 → updateAvailable false（1.2.7==1.2.7）', async () => {
    const { deps } = makeAdapterDeps({ fetchText: async () => latestYmlFixture('1.2.7', [
      { url: portableArtifactName('1.2.7'), sha512: sha512Base64(NEW_EXE_BYTES), size: NEW_EXE_BYTES.length },
    ]) })
    const adapter = createPortableUpdaterAdapter(deps)
    await expect(adapter.checkForUpdates()).resolves.toMatchObject({ updateAvailable: false, version: '1.2.7' })
  })

  it('网络失败 → 人话错误（不抛裸异常给 IPC）', async () => {
    const { deps } = makeAdapterDeps({ fetchText: async () => { throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }) } })
    const adapter = createPortableUpdaterAdapter(deps)
    await expect(adapter.checkForUpdates()).rejects.toThrow(/无法检查更新/)
  })

  it('清单无便携条目 → 人话拒绝（fail-closed，不猜 setup 资产）', async () => {
    const text = latestYmlFixture('9.9.9', [
      { url: 'kline-trainer-desktop-setup-v9.9.9-windows-x64.exe', sha512: sha512Base64(new Uint8Array([9])), size: 1 },
    ])
    const { deps } = makeAdapterDeps({ fetchText: async () => text })
    const adapter = createPortableUpdaterAdapter(deps)
    await expect(adapter.checkForUpdates()).rejects.toThrow(/便携/)
  })
})

describe('PORT-UPD-01 适配器·下载与校验（fail-closed）', () => {
  it('下载落 <dataDir>/update-staging/<便携产物名>，sha512+size 过 → 返回版本；下载前清空旧 staging；进度事件透传', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const dataDir = join(root, 'data')
      const stagingDir = join(dataDir, 'update-staging')
      await mkdir(stagingDir, { recursive: true })
      await writeFile(join(stagingDir, 'stale-download.exe'), 'stale')
      const fixture = happyFixture()
      const progress: Array<{ transferred: number, total: number }> = []
      const { deps } = makeAdapterDeps({
        dataDir,
        fetchText: async () => fixture.text,
        downloadToFile: async (_url, dest, onProgress) => {
          await writeFile(dest, NEW_EXE_BYTES)
          onProgress(5, NEW_EXE_BYTES.length)
          onProgress(NEW_EXE_BYTES.length, NEW_EXE_BYTES.length)
        },
      })
      const adapter = createPortableUpdaterAdapter(deps)
      adapter.onDownloadProgress(p => { progress.push({ transferred: p.transferred, total: p.total }) })
      await adapter.checkForUpdates()
      await expect(adapter.downloadUpdate()).resolves.toEqual({ version: '9.9.9' })
      const stagingEntries = await readdir(stagingDir)
      expect(stagingEntries).toContain(fixture.portableName)
      expect(stagingEntries).not.toContain('stale-download.exe')
      expect(progress.at(-1)).toEqual({ transferred: NEW_EXE_BYTES.length, total: NEW_EXE_BYTES.length })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('sha512 不符 → 删除 staging 产物并拒绝（绝不应用）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const dataDir = join(root, 'data')
      const fixture = happyFixture()
      const tampered = new Uint8Array([...NEW_EXE_BYTES, 0xff])
      const { deps } = makeAdapterDeps({
        dataDir,
        fetchText: async () => fixture.text,
        downloadToFile: async (_url, dest) => { await writeFile(dest, tampered) },
      })
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      await expect(adapter.downloadUpdate()).rejects.toThrow(/校验/)
      expect(await readdir(join(dataDir, 'update-staging'))).not.toContain(fixture.portableName)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('size 不符 → 同样 fail-closed 删除并拒绝', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const dataDir = join(root, 'data')
      const fixture = happyFixture()
      const files = fixture.files.map(f => f.url === fixture.portableName ? { ...f, size: NEW_EXE_BYTES.length + 999 } : f)
      const { deps } = makeAdapterDeps({
        dataDir,
        fetchText: async () => latestYmlFixture(fixture.version, files),
        downloadToFile: async (_url, dest) => { await writeFile(dest, NEW_EXE_BYTES) },
      })
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      await expect(adapter.downloadUpdate()).rejects.toThrow(/校验|大小/)
      expect(await readdir(join(dataDir, 'update-staging'))).not.toContain(fixture.portableName)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('下载中断（写了部分文件后抛错）→ 部分文件删除＋人话错误', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const dataDir = join(root, 'data')
      const fixture = happyFixture()
      const { deps } = makeAdapterDeps({
        dataDir,
        fetchText: async () => fixture.text,
        downloadToFile: async (_url, dest) => {
          await writeFile(dest, NEW_EXE_BYTES.subarray(0, 4))
          throw new Error('network reset mid-download')
        },
      })
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      await expect(adapter.downloadUpdate()).rejects.toThrow()
      expect(await readdir(join(dataDir, 'update-staging'))).not.toContain(fixture.portableName)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('未检查先下载 / 数据目录未就绪 → 人话守卫', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const { deps: unchecked } = makeAdapterDeps({ dataDir: join(root, 'data') })
      const adapter = createPortableUpdaterAdapter(unchecked)
      await expect(adapter.downloadUpdate()).rejects.toThrow(/检查更新/)
      const { deps: noDataDir } = makeAdapterDeps({ dataDir: null })
      const adapter2 = createPortableUpdaterAdapter(noDataDir)
      await expect(adapter2.downloadUpdate()).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('PORT-UPD-01 适配器·应用（排空退出管线末端的 quitAndInstall 语义）', () => {
  it('应用前复验 staging 字节 → 渲染脚本落 staging → detached spawn cmd → 退出主进程', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const dataDir = join(root, 'data')
      const exePath = join(root, 'apps', 'trainer.exe')
      await mkdir(join(root, 'apps'), { recursive: true })
      await writeFile(exePath, 'OLD-EXE')
      const fixture = happyFixture()
      const order: string[] = []
      const { deps, calls } = makeAdapterDeps({
        dataDir,
        exePath,
        fetchText: async () => fixture.text,
        downloadToFile: async (_url, dest) => { await writeFile(dest, NEW_EXE_BYTES) },
        spawnDetached: (command, args) => { order.push('spawn'); calls.spawn.push({ command, args }) },
        quitApp: () => { order.push('quit') },
      })
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      await adapter.downloadUpdate()
      adapter.quitAndInstall(true, true)
      await until(() => order.includes('quit'))
      expect(calls.spawn).toHaveLength(1)
      expect(calls.spawn[0].command).toMatch(/cmd\.exe$/i)
      expect(order).toEqual(['spawn', 'quit'])
      // 脚本文件已写进 staging 且内容为渲染模板（路径烘焙）
      const script = await readFile(join(dataDir, 'update-staging', 'update-replace.cmd'), 'utf8')
      expect(script).toContain(`set "EXE=${exePath}"`)
      expect(script).toContain(`set "STAGING_EXE=${join(dataDir, 'update-staging', fixture.portableName)}"`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('staging 在下载后被篡改 → 不 spawn、上报失败、仍退出主进程（不悬挂）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const dataDir = join(root, 'data')
      const exePath = join(root, 'apps', 'trainer.exe')
      await mkdir(join(root, 'apps'), { recursive: true })
      await writeFile(exePath, 'OLD-EXE')
      const fixture = happyFixture()
      const { deps, calls } = makeAdapterDeps({
        dataDir,
        exePath,
        fetchText: async () => fixture.text,
        downloadToFile: async (_url, dest) => { await writeFile(dest, NEW_EXE_BYTES) },
      })
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      await adapter.downloadUpdate()
      await writeFile(join(dataDir, 'update-staging', fixture.portableName), 'TAMPERED')
      adapter.quitAndInstall(true, true)
      await until(() => calls.quitApp >= 1)
      expect(calls.spawn).toHaveLength(0)
      expect(calls.quitApp).toBe(1)
      expect(calls.applyFailures.join('\n')).toMatch(/校验|更新/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('PORT-UPD-01 主进程粘合源码契约（main.ts；沿 PACK-04 源码契约先例）', () => {
  it('setupUpdateChannel 以便携识别切换自研适配器；NSIS/dev 分支与排空 exit 分支原样保留', async () => {
    const source = await readFile(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
    // 便携分支：packaged 通道 ＋ isPortableExecution → createPortableUpdaterAdapter（exe=execPath、quitApp=exit）
    expect(source).toMatch(/updateChannelKind === 'packaged'\s*&&\s*isPortableExecution\(process\.env\)/)
    expect(source).toMatch(/createPortableUpdaterAdapter\(\{[\s\S]*?exePath:\s*process\.execPath/)
    expect(source).toMatch(/createPortableUpdaterAdapter\(\{[\s\S]*?quitApp:\s*\(\)\s*=>\s*app\.exit\(0\)/)
    // electron-updater 仍保留于 else 分支（dev/NSIS 零回归）
    expect(source).toMatch(/else\s*\{\s*[\s\S]*?defaultDesktopUpdater\(\)/)
    // 启动清理接线：bootServerAndOpen 回填数据目录并清理残留
    expect(source).toMatch(/portableUpdateDataDir\s*=\s*config\.dataDir/)
    expect(source).toMatch(/cleanupPortableUpdateLeftovers\(/)
    // 既有排空安装守卫未被触碰（UPD-DESKTOP-INSTALL-DRAINS-FIRST 源码契约仍成立）
    expect(source).toMatch(/quit-and-install[\s\S]{0,200}quitAndInstall/)
  })
})

describe('PORT-UPD-01 启动清理（数据保留＋残留清空）', () => {
  it('清掉 <dataDir>/update-staging 与 exe 旁的 .old 残留；路径不存在也不抛', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const dataDir = join(root, 'data')
      const stagingDir = join(dataDir, 'update-staging')
      await mkdir(stagingDir, { recursive: true })
      await writeFile(join(stagingDir, 'junk.exe'), 'junk')
      const exePath = join(root, 'apps', 'trainer.exe')
      await mkdir(join(root, 'apps'), { recursive: true })
      await writeFile(`${exePath}.old`, 'old-bytes')
      await expect(cleanupPortableUpdateLeftovers({ env: { PORTABLE_EXECUTABLE_DIR: join(root, 'apps') }, dataDir, exePath })).resolves.toBeUndefined()
      await expect(readdir(stagingDir)).rejects.toThrow()
      await expect(readFile(`${exePath}.old`)).rejects.toThrow()
      // 幂等：再来一次不抛
      await expect(cleanupPortableUpdateLeftovers({ env: { PORTABLE_EXECUTABLE_DIR: join(root, 'apps') }, dataDir, exePath })).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('非便携形态（无 PORTABLE_EXECUTABLE_DIR）不清理（NSIS/dev 零触碰）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const dataDir = join(root, 'data')
      const stagingDir = join(dataDir, 'update-staging')
      await mkdir(stagingDir, { recursive: true })
      await writeFile(join(stagingDir, 'junk.exe'), 'junk')
      const exePath = join(root, 'apps', 'trainer.exe')
      await expect(cleanupPortableUpdateLeftovers({ env: {}, dataDir, exePath })).resolves.toBeUndefined()
      expect(await readdir(stagingDir)).toContain('junk.exe')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
