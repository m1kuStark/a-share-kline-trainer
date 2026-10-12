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
  resolvePortableTargetExe,
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

/** 适配器依赖工厂：网络/spawn/quitApp/env 全注入；fs 走真实临时目录（仓库 server updater 测试先例）。
 * env 缺省 {}（非便携，确定性：适配器目标回退 exePath，不受测试宿主环境影响）。 */
function makeAdapterDeps(overrides: {
  fetchText?: (url: string) => Promise<string>
  downloadToFile?: (url: string, dest: string, onProgress: (transferred: number, total: number) => void) => Promise<void>
  spawnDetached?: (command: string, args: string[]) => void
  quitApp?: () => void
  getCurrentVersion?: () => string | null
  dataDir?: string | null
  exePath?: string
  env?: NodeJS.ProcessEnv
  onApplyFailure?: (message: string) => void
} = {}) {
  const dataDir = overrides.dataDir === undefined ? null : overrides.dataDir
  const calls = { spawn: [] as Array<{ command: string, args: string[] }>, quitApp: 0, applyFailures: [] as string[] }
  const deps = {
    exePath: overrides.exePath ?? join(tmpdir(), 'apps', 'K线训练器.exe'),
    env: overrides.env ?? {},
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

// P0 修复（PORT-UPD-01，用户真机验收发现）：electron-builder portable 壳把真实应用解压到
// %TEMP%\{uuid}\，process.execPath 指向该临时副本；用户实际双击的 exe 由注入的
// PORTABLE_EXECUTABLE_FILE 给出。替换目标必须取后者——替换临时副本＝更新无效。
// oracle 独立性：USER_EXE/TEMP_COPY 路径为测试手写（electron-builder portable 运行时契约＋
// 真机 replace.log 指向 %TEMP% 的验收证据），非实现回显。
describe('PORT-UPD-01 替换目标解析 resolvePortableTargetExe（P0 绑定环境语义）', () => {
  const USER_EXE = 'D:\\Tools\\K线训练器.exe'
  const TEMP_COPY = 'C:\\Users\\u\\AppData\\Local\\Temp\\{b6b3f9e2-1111}\\K线训练器.exe'

  it('便携形态 → 目标＝PORTABLE_EXECUTABLE_FILE（用户实际启动的 exe），绝不取 execPath 自解压临时副本', () => {
    expect(resolvePortableTargetExe(
      { PORTABLE_EXECUTABLE_DIR: 'D:\\Tools', PORTABLE_EXECUTABLE_FILE: USER_EXE },
      TEMP_COPY,
    )).toBe(USER_EXE)
  })

  it('非便携（无 PORTABLE_EXECUTABLE_DIR）→ 目标＝execPath 原语义（NSIS/dev 不受影响）', () => {
    const nsisExe = 'C:\\Program Files\\K线训练器\\K线训练器.exe'
    expect(resolvePortableTargetExe({}, nsisExe)).toBe(nsisExe)
    // PORTABLE_EXECUTABLE_FILE 存在但形态非便携（无 DIR）→ 仍按非便携处理，execPath 原语义
    expect(resolvePortableTargetExe({ PORTABLE_EXECUTABLE_FILE: 'D:\\x.exe' }, nsisExe)).toBe(nsisExe)
  })

  it('便携形态但 PORTABLE_EXECUTABLE_FILE 缺失/空白 → fail-closed throw（绝不回退 execPath 临时副本）', () => {
    expect(() => resolvePortableTargetExe({ PORTABLE_EXECUTABLE_DIR: 'D:\\Tools' }, TEMP_COPY)).toThrow(/PORTABLE_EXECUTABLE_FILE/)
    expect(() => resolvePortableTargetExe({ PORTABLE_EXECUTABLE_DIR: 'D:\\Tools', PORTABLE_EXECUTABLE_FILE: '' }, TEMP_COPY)).toThrow(/PORTABLE_EXECUTABLE_FILE/)
    expect(() => resolvePortableTargetExe({ PORTABLE_EXECUTABLE_DIR: 'D:\\Tools', PORTABLE_EXECUTABLE_FILE: '   ' }, TEMP_COPY)).toThrow(/PORTABLE_EXECUTABLE_FILE/)
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

  it('旧进程等待＝ping 固定延时（P0-6：tasklist 在 detached 隐藏 cmd 挂死，探活工具不可用）', () => {
    // 固定延时秒数来自 REPLACE_WAIT_SECONDS（渲染值插值），不依赖任何进程查询工具
    expect(rendered).not.toMatch(/tasklist \/FI/)
    expect(rendered).toMatch(/ping -n \d+ 127\.0\.0\.1/)
    // 退出码语义收敛：不再有 exit 2（超时零触碰）分支
    expect(rendered).not.toMatch(/exit \/b 2/)
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

  it('UPD-QUIT-TYPEERROR-GUARD: 下载 reject(undefined) 产出人话错误而非 TypeError', async () => {
    // 外部库 reject(undefined) 形态（EventEmitter error 无参等——用户 2026-10-11 真机
    // TypeError 崩溃窗的候选生成面）：便携通道同样零无守卫读取，失败＝人话 Error。
    const root = await mkdtemp(join(tmpdir(), 'portable-upd-'))
    try {
      const dataDir = join(root, 'data')
      await mkdir(dataDir, { recursive: true })
      const fixture = happyFixture()
      const { deps } = makeAdapterDeps({
        dataDir,
        fetchText: async () => fixture.text,
        downloadToFile: async () => { throw undefined },
      })
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      await expect(adapter.downloadUpdate()).rejects.toThrow('下载新版本失败：undefined')
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

// P0 修复绑定语义锁定：适配器必须自己按 env 解析替换目标（main 绑定处的历史 bug 正是
// exePath=process.execPath＝自解压临时副本）。oracle＝electron-builder portable 运行时契约
// （PORTABLE_EXECUTABLE_FILE＝用户 exe）＋真机 replace.log 指向 %TEMP% 的验收证据。
describe('PORT-UPD-01 适配器替换目标＝env 解析的用户 exe（P0 绑定语义）', () => {
  const USER_EXE = 'D:\\Tools\\K线训练器.exe'
  const TEMP_COPY = 'C:\\Users\\u\\AppData\\Local\\Temp\\{b6b3f9e2-1111}\\K线训练器.exe'

  it('便携形态注入 PORTABLE_EXECUTABLE_FILE → apply 烘焙 EXE＝用户 exe、OLD_EXE＝其 .old（绝不为 execPath 临时副本）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-p0-'))
    try {
      const dataDir = join(root, 'data')
      const fixture = happyFixture()
      const { deps, calls } = makeAdapterDeps({
        dataDir,
        exePath: TEMP_COPY,
        env: { PORTABLE_EXECUTABLE_DIR: 'D:\\Tools', PORTABLE_EXECUTABLE_FILE: USER_EXE },
        fetchText: async () => fixture.text,
        downloadToFile: async (_url, dest) => { await writeFile(dest, NEW_EXE_BYTES) },
      })
      const adapter = createPortableUpdaterAdapter(deps)
      await adapter.checkForUpdates()
      await adapter.downloadUpdate()
      adapter.quitAndInstall(true, true)
      await until(() => calls.quitApp >= 1)
      const script = await readFile(join(dataDir, 'update-staging', 'update-replace.cmd'), 'utf8')
      expect(script).toContain(`set "EXE=${USER_EXE}"`)
      expect(script).toContain(`set "OLD_EXE=${USER_EXE}.old"`)
      expect(script).not.toContain(`set "EXE=${TEMP_COPY}"`)
      expect(script).not.toContain(TEMP_COPY)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('便携形态缺 PORTABLE_EXECUTABLE_FILE → 适配器初始化 fail-closed（throw），不 spawn 不退出不触碰任何 exe', () => {
    const { deps } = makeAdapterDeps({
      exePath: TEMP_COPY,
      env: { PORTABLE_EXECUTABLE_DIR: 'D:\\Tools' },
    })
    expect(() => createPortableUpdaterAdapter(deps)).toThrow(/PORTABLE_EXECUTABLE_FILE/)
  })
})

describe('PORT-UPD-01 主进程粘合源码契约（main.ts；沿 PACK-04 源码契约先例）', () => {
  it('setupUpdateChannel 以便携识别切换自研适配器（替换目标经 resolvePortableTargetExe 解析）；NSIS/dev 分支与排空 exit 分支原样保留', async () => {
    const source = await readFile(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
    // 便携分支：packaged 通道 ＋ isPortableExecution → createPortableUpdaterAdapter
    // （quitApp=app.quit()：P0-5 真机实证 spawn 替换脚本后 app.exit(0) 进程挂起，
    // GUI 优雅退出路径（quit 语义）两轮对照实验复现退净——2026-10-11）
    expect(source).toMatch(/updateChannelKind === 'packaged'\s*&&\s*isPortableExecution\(process\.env\)/)
    expect(source).toMatch(/createPortableUpdaterAdapter\(\{[\s\S]*?quitApp:\s*\(\)\s*=>\s*app\.quit\(\)/)
    // P0 修复绑定契约：适配器与清理的替换目标都经 resolvePortableTargetExe(process.env, process.execPath)
    // 解析（便携形态＝PORTABLE_EXECUTABLE_FILE＝用户 exe；绝不再以 process.execPath 直连 exePath）
    expect(source).toMatch(/resolvePortableTargetExe\(process\.env,\s*process\.execPath\)/)
    expect(source).toMatch(/createPortableUpdaterAdapter\(\{[\s\S]*?exePath:\s*portableTargetExe/)
    expect(source).toMatch(/cleanupPortableUpdateLeftovers\(\{[\s\S]*?exePath:\s*portableTargetExe/)
    // 日志打印解析后的目标（不再打印 process.execPath 临时副本）
    expect(source).toMatch(/portable self-update channel active \(exe: \$\{portableTargetExe\}\)/)
    // 解析失败 fail-closed：便携更新通道禁用并上报（createUnavailablePortableAdapter），不阻断启动
    expect(source).toMatch(/createUnavailablePortableAdapter\(/)
    // electron-updater 仍保留于 else 分支（dev/NSIS 零回归）
    expect(source).toMatch(/else\s*\{\s*[\s\S]*?defaultDesktopUpdater\(\)/)
    // 启动清理接线：bootServerAndOpen 回填数据目录并清理残留
    expect(source).toMatch(/portableUpdateDataDir\s*=\s*config\.dataDir/)
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
      // P0 修复后 env 对齐真实注入契约：electron-builder portable 总是同时注入
      // PORTABLE_EXECUTABLE_DIR 与 PORTABLE_EXECUTABLE_FILE（无 FILE 的分支由下方专测锁定）
      const env = { PORTABLE_EXECUTABLE_DIR: join(root, 'apps'), PORTABLE_EXECUTABLE_FILE: exePath }
      await expect(cleanupPortableUpdateLeftovers({ env, dataDir, exePath })).resolves.toBeUndefined()
      await expect(readdir(stagingDir)).rejects.toThrow()
      await expect(readFile(`${exePath}.old`)).rejects.toThrow()
      // 幂等：再来一次不抛
      await expect(cleanupPortableUpdateLeftovers({ env, dataDir, exePath })).resolves.toBeUndefined()
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

  it('便携形态清理的是用户 exe（PORTABLE_EXECUTABLE_FILE）旁的 .old 与数据目录 staging；execPath 临时副本旁不动（P0）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-p0-clean-'))
    try {
      const dataDir = join(root, 'data')
      const stagingDir = join(dataDir, 'update-staging')
      await mkdir(stagingDir, { recursive: true })
      await writeFile(join(stagingDir, 'junk.exe'), 'junk')
      const userExe = join(root, 'apps', 'K线训练器.exe')
      const tempCopy = join(root, 'temp', '{uuid}', 'K线训练器.exe')
      await mkdir(join(root, 'apps'), { recursive: true })
      await mkdir(join(root, 'temp', '{uuid}'), { recursive: true })
      await writeFile(`${userExe}.old`, 'old-bytes')
      await writeFile(`${tempCopy}.old`, 'wrong-target-old')
      await expect(cleanupPortableUpdateLeftovers({
        env: { PORTABLE_EXECUTABLE_DIR: join(root, 'apps'), PORTABLE_EXECUTABLE_FILE: userExe },
        dataDir,
        exePath: tempCopy,
      })).resolves.toBeUndefined()
      await expect(readdir(stagingDir)).rejects.toThrow()
      await expect(readFile(`${userExe}.old`)).rejects.toThrow()
      expect(await readFile(`${tempCopy}.old`, 'utf8')).toBe('wrong-target-old')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('便携形态缺 PORTABLE_EXECUTABLE_FILE → staging 照清但绝不以 execPath 临时副本为目标删 .old（fail-closed 零误删）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-p0-clean-'))
    try {
      const dataDir = join(root, 'data')
      const stagingDir = join(dataDir, 'update-staging')
      await mkdir(stagingDir, { recursive: true })
      await writeFile(join(stagingDir, 'junk.exe'), 'junk')
      const tempCopy = join(root, 'temp', '{uuid}', 'K线训练器.exe')
      await mkdir(join(root, 'temp', '{uuid}'), { recursive: true })
      await writeFile(`${tempCopy}.old`, 'wrong-target-old')
      await expect(cleanupPortableUpdateLeftovers({
        env: { PORTABLE_EXECUTABLE_DIR: join(root, 'apps') },
        dataDir,
        exePath: tempCopy,
      })).resolves.toBeUndefined()
      await expect(readdir(stagingDir)).rejects.toThrow()
      expect(await readFile(`${tempCopy}.old`, 'utf8')).toBe('wrong-target-old')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
