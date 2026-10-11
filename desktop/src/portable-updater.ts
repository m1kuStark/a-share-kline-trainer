// PORT-UPD-01 便携版自研 exe 替换式自更新（用户拍板方案 A，2026-10-11）。
// 背景：electron-updater 官方不支持 portable target 自更新——本模块在便携形态
// （electron-builder 注入 PORTABLE_EXECUTABLE_DIR）下替换更新链后端：
//   - 检查：拉取 latest.yml（feed 复用 UPD-DESKTOP-FEED-INJECTABLE 的 env 注入口径），
//     版本比较沿用 server version.ts compareVersions 单一口径（controller 侧 mapCheckView 复核）；
//   - 下载：落 <dataDir>/update-staging/<便携产物名>（数据目录与 exe 分离，替换不触数据），
//     sha512(base64)+size 按 latest.yml 条目校验，fail-closed：失败删除 staging 文件绝不应用；
//   - 应用：退出管线 exit 分支调 quitAndInstall → 应用前复验 staging 字节 → 渲染替换脚本
//     （cmd，ASCII+CRLF，路径烘焙不经 argv）写入 staging → detached spawn → 退出主进程；
//     脚本轮询等待旧 pid 消失→旧 exe 改 .old→staging 移入原路径→删 .old（不阻塞）→启动新 exe；
//     staging 移入失败时回滚 .old→原路径，旧 exe 始终可用；
//   - 残留：启动时清理 staging 与 exe 旁 .old（cleanupPortableUpdateLeftovers，非便携 no-op）。
// 依赖全注入（网络/spawn/退出回调/版本/路径），纯逻辑 vitest 直测；替换脚本另有真实 spawn 冒烟。
// 注意：latest.yml 解析器与 desktop/scripts/release-desktop-lib.mjs 同形状但独立实现——
// 运行包只带 desktop/dist/**（lib 不入包），沿 server zip.ts「零依赖自实现」先例。
// 网络层（P0-3）：Node 原生 http/https，绝不用全局 fetch（undici）——真机截断场景 undici
// 内部断言经异步路径抛出不可捕获会崩主进程；截断/非 2xx/请求错误全部转人话 Error 冒泡。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { normalizeTagVersion, compareVersions } from '../../server/dist/update/version.js'
import { normalizeUpdaterError, resolveUpdateFeed, type DesktopUpdaterAdapter, type UpdateFeed } from './desktop-updates.js'

/** staging 目录名（数据目录下，与 exe 分离） */
export const PORTABLE_STAGING_DIR_NAME = 'update-staging'
/** 渲染后的替换脚本名（写入 staging，随下次下载/启动清理） */
export const REPLACE_SCRIPT_NAME = 'update-replace.cmd'
/** 替换日志名（脚本 append，诊断用） */
export const REPLACE_LOG_NAME = 'replace.log'
/** 等待旧进程退出的轮询次数上限（每轮约 1 秒） */
export const REPLACE_WAIT_SECONDS = 30

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

/** 便携形态识别：PORTABLE_EXECUTABLE_DIR 由 electron-builder portable target 注入（NSIS/dev 无此变量） */
export function isPortableExecution(env: NodeJS.ProcessEnv): boolean {
  return typeof env.PORTABLE_EXECUTABLE_DIR === 'string' && env.PORTABLE_EXECUTABLE_DIR.trim() !== ''
}

/**
 * 便携自更新替换目标解析（P0 修复，PORT-UPD-01 真机验收发现）：
 * electron-builder portable 壳启动时把真实应用解压到 %TEMP%\{uuid}\，process.execPath 指向
 * 该临时副本；用户实际双击的 exe 由壳注入的 PORTABLE_EXECUTABLE_FILE 给出。替换目标必须
 * 取后者——替换临时副本＝更新无效（replace.log 指向 %TEMP%、用户 exe 字节不变的实证）。
 *   - 便携形态（PORTABLE_EXECUTABLE_DIR 非空白）且 PORTABLE_EXECUTABLE_FILE 非空白 → 返回后者；
 *   - 非便携（NSIS/dev）→ 原样返回 execPath（原语义零改动）；
 *   - 便携形态但 PORTABLE_EXECUTABLE_FILE 缺失/空白 → fail-closed throw：绝不回退 execPath
 *     （会重现 P0），调用方视为初始化失败上报（与 sha512 校验 fail-closed 同哲学）。
 */
export function resolvePortableTargetExe(env: NodeJS.ProcessEnv, execPath: string): string {
  if (!isPortableExecution(env)) return execPath
  const target = env.PORTABLE_EXECUTABLE_FILE
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('便携形态缺少 PORTABLE_EXECUTABLE_FILE（无法定位用户实际启动的 exe），已拒绝以自解压临时副本为替换目标')
  }
  return target
}

/** 便携产物名（PACK-05 desktopArtifactNames 冻结命名契约的运行时对应） */
export function portableArtifactName(version: string): string {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`版本号必须是三段号（X.Y.Z），收到：${JSON.stringify(version)}`)
  }
  return `kline-trainer-desktop-v${version}-windows-x64.exe`
}

export interface PortableFeedFile {
  url: string
  sha512: string
  size: number
}

function parseScalar(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * latest.yml 最小 fail-closed 解析（只认我们生成与 electron-builder 产出的形状；
 * 缺 version/files、条目缺 url/sha512/size、版本非三段号即 throw，不做部分解读）。
 */
export function parsePortableLatestYml(text: string): { version: string, files: PortableFeedFile[] } {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('更新源 latest.yml 为空')
  const scalar = /^([A-Za-z0-9_]+):\s*(.*)$/
  let version: string | null = null
  const files: PortableFeedFile[] = []
  let currentFile: { url?: string, sha512?: string, size?: number } | null = null
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (line.startsWith('  - ')) {
      const match = scalar.exec(line.slice(4))
      if (match && match[1] === 'url') {
        if (currentFile) files.push(currentFile as PortableFeedFile)
        currentFile = { url: parseScalar(match[2]) }
      }
      continue
    }
    if (line.startsWith('    ')) {
      const match = scalar.exec(line.trim())
      if (match && currentFile) {
        if (match[1] === 'sha512') currentFile.sha512 = parseScalar(match[2])
        if (match[1] === 'size') {
          const size = Number(parseScalar(match[2]))
          if (!Number.isInteger(size) || size < 0) throw new Error(`latest.yml files size 非法：${match[2]}`)
          currentFile.size = size
        }
      }
      continue
    }
    const match = scalar.exec(line)
    if (!match) continue
    if (match[1] === 'version') version = parseScalar(match[2])
  }
  if (currentFile) files.push(currentFile as PortableFeedFile)
  if (version === null) throw new Error('更新源 latest.yml 缺少 version（版本）字段')
  if (normalizeTagVersion(version) === null) throw new Error(`更新源 latest.yml 版本号无法识别：${version}`)
  if (files.length === 0) throw new Error('更新源 latest.yml 缺少 files 条目')
  for (const file of files) {
    if (!file.url || !file.sha512 || typeof file.size !== 'number') {
      throw new Error(`latest.yml files 条目缺 url/sha512/size（${file.url ?? '(匿名)'}）`)
    }
  }
  return { version, files }
}

/** 按精确名选便携产物条目；没有则 null（不猜其他资产） */
export function selectPortableEntry(files: PortableFeedFile[], version: string): PortableFeedFile | null {
  const wanted = portableArtifactName(version)
  return files.find(file => file.url === wanted) ?? null
}

/** feed → latest.yml 与资产 URL（generic base 归一尾斜杠；github → Releases latest download 常量） */
export function buildPortableFeedUrls(feed: UpdateFeed): { latestYmlUrl: string, assetUrl: (name: string) => string } {
  const base = feed.provider === 'generic'
    ? feed.url.replace(/\/+$/, '')
    : `https://github.com/${feed.owner}/${feed.repo}/releases/latest/download`
  return {
    latestYmlUrl: `${base}/latest.yml`,
    assetUrl: (name: string) => `${base}/${name}`,
  }
}

export interface RenderReplaceScriptInput {
  /** 当前便携 exe 全路径（替换目标） */
  exePath: string
  /** staging 新 exe 全路径 */
  stagingExe: string
  /** 旧 exe 暂存路径（exe 同名 .old） */
  oldExe: string
  /** 脚本日志路径（staging 内） */
  logPath: string
  /** 等待退出的主进程 pid */
  pid: number
  /** 旧进程退出固定等待秒数（默认 REPLACE_WAIT_SECONDS；P0-6 后语义＝ping 计时延时） */
  maxTries?: number
}

/**
 * 替换脚本渲染（规格第 4 条时序；ASCII＋CRLF；路径烘焙为引号变量，不经 argv——
 * 规避 cmd 引号歧义）。goto 分支而非括号块，规避 echo 文本中的括号陷阱。
 * 旧进程等待＝ping 计时固定延时（默认 REPLACE_WAIT_SECONDS 秒）：P0-6 真机实证（2026-10-11
 * 最小复现）tasklist 在 detached+windowsHide 的 cmd 里挂死（stdio pipe/windowsHide:false/
 * 非 detached 均不救；ping 正常）——探活工具不可用，改固定延时；异常情况下旧进程届时
 * 仍存活由新实例的端口冲突处理（ask-on-conflict）兜底，替换仍零触碰回滚语义。
 * 退出码：0 成功；3 旧 exe 重命名失败（现场保留）；4 新 exe 移入失败（回滚 .old→原路径，
 * 旧 exe 可用）。
 */
export function renderReplaceScript(input: RenderReplaceScriptInput): string {
  const waitSeconds = input.maxTries ?? REPLACE_WAIT_SECONDS
  if (!Number.isInteger(waitSeconds) || waitSeconds < 1) throw new Error(`waitSeconds 必须为正整数：${waitSeconds}`)
  const lines = [
    '@echo off',
    'rem PORT-UPD-01 portable self-update replace script - rendered per update, do not hand-edit.',
    'setlocal',
    `set "EXE=${input.exePath}"`,
    `set "STAGING_EXE=${input.stagingExe}"`,
    `set "OLD_EXE=${input.oldExe}"`,
    `set "LOG=${input.logPath}"`,
    `set "WAIT_PID=${input.pid}"`,
    '',
    `>>"%LOG%" echo [%DATE% %TIME%] replace start pid=%WAIT_PID%; fixed wait ${waitSeconds}s (tasklist hangs in detached hidden cmd, see P0-6)`,
    `ping -n ${waitSeconds + 1} 127.0.0.1 >nul 2>&1`,
    'move /y "%EXE%" "%OLD_EXE%" >>"%LOG%" 2>&1',
    'if not errorlevel 1 goto renamed_ok',
    '>>"%LOG%" echo [%DATE% %TIME%] failed to rename current exe; keeping everything as-is',
    'exit /b 3',
    '',
    ':renamed_ok',
    'move /y "%STAGING_EXE%" "%EXE%" >>"%LOG%" 2>&1',
    'if not errorlevel 1 goto placed_ok',
    '>>"%LOG%" echo [%DATE% %TIME%] failed to move new exe into place; restoring old exe',
    'move /y "%OLD_EXE%" "%EXE%" >>"%LOG%" 2>&1',
    'exit /b 4',
    '',
    ':placed_ok',
    'del /f /q "%OLD_EXE%" >nul 2>&1',
    '>>"%LOG%" echo [%DATE% %TIME%] replaced ok; launching new version',
    'start "" /B "%EXE%"',
    '>>"%LOG%" echo [%DATE% %TIME%] done',
    'exit /b 0',
  ]
  return `${lines.join('\r\n')}\r\n`
}

/**
 * 便携启动清理：删除 <dataDir>/update-staging（含上次下载/脚本/日志）与用户 exe 旁 .old 残留。
 * .old 目标＝resolvePortableTargetExe 解析结果（P0 修复：残留 beside 用户 exe，非 execPath
 * 自解压临时副本）；便携形态解析失败 → staging 照清但 .old 零触碰（fail-closed 不猜目标）。
 * 非便携形态（无 PORTABLE_EXECUTABLE_DIR）no-op——NSIS/dev 零触碰；任何失败仅吞掉（不阻断启动）。
 */
export async function cleanupPortableUpdateLeftovers(deps: {
  env: NodeJS.ProcessEnv
  dataDir: string
  exePath: string
}): Promise<void> {
  if (!isPortableExecution(deps.env)) return
  try {
    await rm(join(deps.dataDir, PORTABLE_STAGING_DIR_NAME), { recursive: true, force: true })
  } catch { /* best-effort：残留清理失败不阻断启动，下次启动再试 */ }
  try {
    const targetExe = resolvePortableTargetExe(deps.env, deps.exePath)
    await rm(`${targetExe}.old`, { force: true })
  } catch { /* best-effort：.old 目标解析失败/删除失败都不阻断启动 */ }
}

// ===== 默认 IO 实现（可注入替换；测试注入 fetchText/downloadToFile/spawnDetached/quitApp） =====

// P0-3 修复（PORT-UPD-01 真机崩溃）：默认网络层用 Node 原生 http/https，绝不用全局
// fetch（undici）。用户真机（Electron 44）下载 117MB exe 时响应流被截断，undici 在
// socket 异常结束路径从内部异步抛 AssertionError [ERR_ASSERTION] assert(this.paused)
// （Parser.finish→Socket.onHttpSocketEnd）→ 主进程 uncaught exception 弹 Error 窗——
// 该异常不经任何可 await 的路径，try/catch 不可拦。原生层把同类截断转为普通人话
// Error（含已收/应收字节），请求错误原样冒泡（保留 ECONNREFUSED 等 code 供
// normalizeUpdaterError 归类）。
const UPDATER_USER_AGENT = 'a-share-kline-trainer-portable-updater'
/** 跟随重定向上限（GitHub releases/latest/download → 签名 CDN 为一跳；防循环兜底） */
const UPDATER_MAX_REDIRECTS = 5

/** 按 URL protocol 选原生模块（http:// 本地验收 feed；https:// GitHub/CDN；其余 fail-closed） */
function requestUpdaterUrl(url: string, callback: (res: IncomingMessage) => void): ClientRequest {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`更新源 URL 无法解析：${url}`)
  }
  const options = { headers: { 'user-agent': UPDATER_USER_AGENT } }
  if (parsed.protocol === 'http:') return httpRequest(url, options, callback)
  if (parsed.protocol === 'https:') return httpsRequest(url, options, callback)
  throw new Error(`更新源协议不支持（仅 http/https）：${parsed.protocol}`)
}

/**
 * 打开更新源响应（含 3xx 重定向跟随——全局 fetch 的默认语义，GitHub latest/download
 * 302 → CDN 必需；原实现无此能力即回归）。resolve＝最终响应；reject＝请求错误（原样
 * 冒泡保留 code）／重定向超限。destroyCurrent 供超时中止当前跳（总预算语义）。
 */
function openUpdaterResponse(url: string): {
  promise: Promise<IncomingMessage>
  destroyCurrent: (error: Error) => void
} {
  let currentReq: ClientRequest | null = null
  const promise = new Promise<IncomingMessage>((resolve, reject) => {
    let currentUrl = url
    let remainingRedirects = UPDATER_MAX_REDIRECTS
    let settled = false
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    const attempt = (): void => {
      let req: ClientRequest
      try {
        req = requestUpdaterUrl(currentUrl, res => {
          const status = res.statusCode ?? 0
          const location = res.headers.location
          if (status >= 300 && status < 400 && typeof location === 'string' && location !== '') {
            res.resume() // 排空 3xx 响应体再跳转，释放连接
            if (remainingRedirects <= 0) {
              req.destroy()
              fail(new Error(`更新源重定向超过 ${UPDATER_MAX_REDIRECTS} 次（疑似循环），已拒绝`))
              return
            }
            remainingRedirects -= 1
            try {
              currentUrl = new URL(location, currentUrl).toString()
            } catch {
              fail(new Error(`更新源重定向地址无法解析：${location}`))
              return
            }
            attempt()
            return
          }
          settled = true
          resolve(res)
        })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
        return
      }
      currentReq = req
      req.on('error', error => { if (req === currentReq) fail(error) })
      req.end()
    }
    attempt()
  })
  return { promise, destroyCurrent: (error: Error) => { currentReq?.destroy(error) } }
}

/** 字节缺口人话描述（流提前结束/被重置→已收/应收；超时→超时消息优先） */
function truncationError(received: number, total: number, cause: unknown, timedOut: boolean, timeoutError: Error): Error {
  if (timedOut) return timeoutError
  if (total > 0 && received < total) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return new Error(`下载中断：已收 ${received}/${total} 字节（${detail}）`)
  }
  return cause instanceof Error ? cause : new Error(String(cause))
}

async function defaultFetchText(url: string): Promise<string> {
  const timeoutError = new Error('检查更新超时（15 秒）')
  let timedOut = false
  const opened = openUpdaterResponse(url)
  const timer = setTimeout(() => {
    timedOut = true
    opened.destroyCurrent(timeoutError)
  }, 15_000)
  try {
    const res = await opened.promise
    const status = res.statusCode ?? 0
    if (status < 200 || status >= 300) {
      res.resume()
      throw new Error(`HTTP ${status}`)
    }
    const total = Number(res.headers['content-length']) || 0
    const chunks: Buffer[] = []
    let received = 0
    await new Promise<void>((resolve, reject) => {
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        received += chunk.length
      })
      res.on('error', cause => reject(truncationError(received, total, cause, timedOut, timeoutError)))
      res.on('end', () => {
        if (total > 0 && received < total) reject(new Error(`下载中断：已收 ${received}/${total} 字节（连接提前结束）`))
        else resolve()
      })
    })
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    clearTimeout(timer)
  }
}

async function defaultDownloadToFile(
  url: string,
  dest: string,
  onProgress: (transferred: number, total: number) => void,
): Promise<void> {
  const timeoutError = new Error('下载超时（600 秒总预算）')
  let timedOut = false
  const opened = openUpdaterResponse(url)
  const timer = setTimeout(() => {
    timedOut = true
    opened.destroyCurrent(timeoutError)
  }, 600_000)
  try {
    const res = await opened.promise
    const status = res.statusCode ?? 0
    if (status < 200 || status >= 300) {
      res.resume()
      throw new Error(`HTTP ${status}`)
    }
    const total = Number(res.headers['content-length']) || 0
    const { createWriteStream } = await import('node:fs')
    const { Transform } = await import('node:stream')
    const { pipeline } = await import('node:stream/promises')
    let transferred = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferred += chunk.length
        onProgress(transferred, total)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(res, counter, createWriteStream(dest))
    } catch (cause) {
      throw truncationError(transferred, total, cause, timedOut, timeoutError)
    }
    if (total > 0 && transferred < total) {
      throw new Error(`下载中断：已收 ${transferred}/${total} 字节（连接提前结束）`)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function defaultSha512File(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('base64')
}

async function defaultFileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

function defaultSpawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

export interface PortableUpdaterDeps {
  /** 当前进程 exe 路径（process.execPath；便携形态下仅为解析回退，实际替换目标以 env 解析为准） */
  exePath: string
  /** 进程环境（缺省 process.env；便携形态用 PORTABLE_EXECUTABLE_FILE 定位用户实际启动的 exe） */
  env?: NodeJS.ProcessEnv
  /** staging 所在数据目录（bootServerAndOpen 解析后回填；null＝尚未就绪） */
  getDataDir: () => string | null
  /** 当前版本（app.getVersion()） */
  getCurrentVersion: () => string | null
  /** 更新 feed（缺省 resolveUpdateFeed(process.env)：env TRAINER_DESKTOP_UPDATE_FEED > GitHub 常量） */
  feed?: UpdateFeed
  fetchText?: (url: string) => Promise<string>
  downloadToFile?: (url: string, dest: string, onProgress: (transferred: number, total: number) => void) => Promise<void>
  spawnDetached?: (command: string, args: string[]) => void
  /** 应用动作完成（或失败）后退出主进程（main 传 () => app.exit(0)） */
  quitApp: () => void
  /** 等待退出的 pid（缺省 process.pid；测试注入） */
  pid?: number
  /** 应用失败上报（main 转 sendUpdateEvent error；无则仅日志） */
  onApplyFailure?: (message: string) => void
  logger?: { error(...args: unknown[]): void, warn(...args: unknown[]): void, info(...args: unknown[]): void }
}

interface PortableCheckCache {
  version: string
  entry: PortableFeedFile
}

/** 便携自更新适配器：实现 DesktopUpdaterAdapter，controller（排空退出管线）零改动切换 */
export function createPortableUpdaterAdapter(deps: PortableUpdaterDeps): DesktopUpdaterAdapter {
  const logger = deps.logger ?? console
  // P0 修复：替换目标由 env 解析（便携形态＝PORTABLE_EXECUTABLE_FILE＝用户实际启动的 exe；
  // process.execPath 只是自解压临时副本，替换它＝更新无效）。适配器初始化即解析——
  // 便携形态拿不到该变量 → fail-closed throw（初始化失败，绝不回退临时副本），由调用方上报。
  const targetExe = resolvePortableTargetExe(deps.env ?? process.env, deps.exePath)
  const fetchText = deps.fetchText ?? defaultFetchText
  const downloadToFile = deps.downloadToFile ?? defaultDownloadToFile
  const spawnDetached = deps.spawnDetached ?? defaultSpawnDetached
  const feed = deps.feed ?? resolveUpdateFeed(process.env)
  let currentFeed: UpdateFeed = feed
  let lastCheck: PortableCheckCache | null = null
  let progressListener: ((progress: { percent: number, transferred: number, total: number, bytesPerSecond: number }) => void) | null = null

  async function sha512AndSize(path: string): Promise<{ sha512: string, size: number }> {
    const sha512 = await defaultSha512File(path)
    const size = await defaultFileSize(path)
    return { sha512, size }
  }

  return {
    setFeedURL(next: UpdateFeed): void {
      currentFeed = next
    },

    async checkForUpdates() {
      const urls = buildPortableFeedUrls(currentFeed)
      let text: string
      try {
        text = await fetchText(urls.latestYmlUrl)
      } catch (error) {
        throw new Error(normalizeUpdaterError(error))
      }
      const parsed = parsePortableLatestYml(text)
      const entry = selectPortableEntry(parsed.files, parsed.version)
      if (!entry) {
        throw new Error(`更新源未提供便携版产物（${portableArtifactName(parsed.version)}），已拒绝更新`)
      }
      const current = deps.getCurrentVersion()
      if (current === null) {
        // controller 侧 mapCheckView 会以人话 error 呈现；这里不给可用性
        lastCheck = { version: parsed.version, entry }
        return { updateAvailable: false, version: parsed.version, releaseNotes: null }
      }
      const updateAvailable = compareVersions(parsed.version, current) > 0
      lastCheck = { version: parsed.version, entry }
      return { updateAvailable, version: parsed.version, releaseNotes: null }
    },

    async downloadUpdate() {
      if (!lastCheck) throw new Error('请先检查更新')
      const dataDir = deps.getDataDir()
      if (!dataDir) throw new Error('数据目录尚未就绪，无法下载更新（请稍后重试）')
      const stagingDir = join(dataDir, PORTABLE_STAGING_DIR_NAME)
      // 每次下载前清空 staging（上次中断的下载/脚本/日志一并清掉）
      await rm(stagingDir, { recursive: true, force: true })
      await mkdir(stagingDir, { recursive: true })
      const target = join(stagingDir, portableArtifactName(lastCheck.version))
      const url = buildPortableFeedUrls(currentFeed).assetUrl(lastCheck.entry.url)
      try {
        await downloadToFile(url, target, (transferred, total) => {
          progressListener?.({
            percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
            transferred,
            total,
            bytesPerSecond: 0,
          })
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await rm(target, { force: true }).catch(() => {})
        throw new Error(`下载新版本失败：${message}`)
      }
      // fail-closed 校验：sha512(base64)+size 对 latest.yml 条目；不符即删文件拒绝应用
      const actual = await sha512AndSize(target)
      if (actual.sha512 !== lastCheck.entry.sha512 || actual.size !== lastCheck.entry.size) {
        await rm(target, { force: true }).catch(() => {})
        throw new Error('新版本文件校验失败（sha512/size 与更新清单不符），已删除下载文件并拒绝应用')
      }
      logger.info?.(`[portable-updater] staged ${target} (${actual.size} bytes, sha512 verified)`)
      return { version: lastCheck.version }
    },

    quitAndInstall(_isSilent: boolean, _isForceRunAfter: boolean): void {
      // 排空退出管线 exit 分支调用（resolveInstallActionOnExit 守卫之后）。内部全捕获：
      // 任何失败都如实上报并正常退出（此时服务已排空关闭，不能悬挂，也不能带病替换）。
      void (async () => {
        try {
          if (!lastCheck) throw new Error('请先检查更新')
          const dataDir = deps.getDataDir()
          if (!dataDir) throw new Error('数据目录尚未就绪，无法应用更新')
          const stagingDir = join(dataDir, PORTABLE_STAGING_DIR_NAME)
          const target = join(stagingDir, portableArtifactName(lastCheck.version))
          // 应用前复验（下载与应用之间可能被篡改/删除）
          const actual = await sha512AndSize(target)
          if (actual.sha512 !== lastCheck.entry.sha512 || actual.size !== lastCheck.entry.size) {
            throw new Error('待安装文件校验失败（sha512/size 与更新清单不符），已放弃本次安装')
          }
          const script = renderReplaceScript({
            exePath: targetExe,
            stagingExe: target,
            oldExe: `${targetExe}.old`,
            logPath: join(stagingDir, REPLACE_LOG_NAME),
            pid: deps.pid ?? process.pid,
          })
          await mkdir(stagingDir, { recursive: true })
          await writeFile(join(stagingDir, REPLACE_SCRIPT_NAME), script, 'utf8')
          spawnDetached('cmd.exe', ['/d', '/s', '/c', join(stagingDir, REPLACE_SCRIPT_NAME)])
          logger.info?.('[portable-updater] replace script spawned; quitting for self-update')
          deps.quitApp()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.error('[portable-updater] apply failed:', message)
          deps.onApplyFailure?.(`便携版更新安装失败：${message}`)
          deps.quitApp()
        }
      })()
    },

    onDownloadProgress(callback: (progress: { percent: number, transferred: number, total: number, bytesPerSecond: number }) => void): void {
      progressListener = callback
    },
  }
}
