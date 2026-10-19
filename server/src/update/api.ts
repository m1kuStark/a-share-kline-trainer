// UPD-01 在线更新 API（契约见 docs/verification/2026-10/UPD-01/design.md §2）。
// GET  /api/update/check  —— 检查更新（网络失败 200＋人话 error，不抛 5xx）
// POST /api/update/apply —— 受理更新（202）后异步 下载→校验→准备更新器→spawn
//                           detached 更新器（服务端不换自己的文件，Windows 现实）
// GET  /api/update/status —— 状态机轮询（dataDir/update-status.json，跨重启窗口可读）
// 注入面：manifestFetch / downloadFetch / packageRoot / env / launchUpdater /
// updaterEntryPath / getActiveTraining / trackTask——测试零网络、零真实进程。

import type { FastifyInstance } from 'fastify'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from '../config.js'
import { CN_MIRROR_BASE, fetchUpdateManifest, resolveManifestPlan, resolveManifestUrl, type ManifestFetchText, type ManifestPlanEntry, type UpdateManifest } from './manifest.js'
import { readUpdateSourceSetting, writeUpdateSourceSetting, parseUpdateSourceSetting } from './update-source.js'
import { safeGetText, safeRequest } from './safe-http.js'
import { isBusyUpdateState, readUpdateStatus, reconcileUpdateStatus, resolveStaleBusyMs, writeUpdateStatus } from './status.js'
import type { UpdatePlan } from './updater-core.js'
import { APP_ROOT, compareVersions, serverVersion } from './version.js'
import { verifyZipArtifact } from './zip.js'

const BACKUP_KEEP = 5

export interface DownloadResponseLike {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
  body?: unknown
}

export type DownloadFetch = (url: string) => Promise<DownloadResponseLike>

export interface RegisterUpdateApiOptions {
  /** 清单拉取器（返回清单文本；抛错＝网络失败）。默认 safe-http 原生层（GitHub API UA＋30 秒超时）。 */
  manifestFetch?: ManifestFetchText
  /** 下载器（zip 与 SHA256SUMS 资产）。默认 safe-http 原生层（900 秒总预算）。 */
  downloadFetch?: DownloadFetch
  /** 显式覆盖清单 URL（测试）；缺省按 env>config>release>默认 解析。 */
  manifestUrl?: string
  /** CN-FEED-01：镜像 base（默认 CN_MIRROR_BASE 常量；测试注入 fixture 值） */
  mirrorBase?: string
  /** 包根（含 package.json/release.json）；默认从本模块位置推导。 */
  packageRoot?: string
  env?: Record<string, string | undefined>
  getActiveTraining?: () => { id: number } | null
  /** 更新器拉起（默认 spawn detached node updater.js）；测试内联 runFromPlan。 */
  launchUpdater?: (plan: UpdatePlan, workDir: string) => Promise<{ started: boolean }> | { started: boolean }
  /** 更新器入口脚本路径（默认编译产物 server/dist/update/updater.js）。 */
  updaterEntryPath?: string
  /** 后台任务收集器（测试等待异步流程结束）。 */
  trackTask?: (task: Promise<unknown>) => void
  log?: { error(...args: unknown[]): void }
}

interface ReleaseJson {
  version: string
  nodeVersion: string | null
  publicURL: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readCurrentRelease(packageRoot: string): Promise<ReleaseJson | null> {
  try {
    const value = JSON.parse(await readFile(join(packageRoot, 'release.json'), 'utf8')) as Record<string, unknown>
    if (typeof value?.version !== 'string') return null
    return {
      version: value.version,
      nodeVersion: typeof value.nodeVersion === 'string' ? value.nodeVersion : null,
      publicURL: typeof value.publicURL === 'string' ? value.publicURL : null,
    }
  } catch {
    return null
  }
}

/** SHA256SUMS 文本中按文件名取唯一校验和（与 build.mjs 发布格式同源）。 */
export function parseSumsLine(sumsText: string, fileName: string): { ok: true, sha256: string } | { ok: false, error: string } {
  const found = new Set<string>()
  for (const line of sumsText.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})[ \t]+\*?(.+)$/.exec(line.trim())
    if (match && match[2] === fileName) found.add(match[1].toLowerCase())
  }
  if (found.size === 0) return { ok: false, error: `SHA256SUMS 资产未列出 ${fileName}，无法校验，已拒绝应用` }
  if (found.size > 1) return { ok: false, error: `SHA256SUMS 资产对 ${fileName} 列出了多个不同的校验和，已拒绝应用` }
  return { ok: true, sha256: [...found][0] }
}

// P0-4：默认网络实现换 safe-http 原生层（主进程内嵌运行，全局 fetch/undici 的
// 内部断言会在响应流截断时崩溃 Electron 主进程）；超时与语义保持原值。
function defaultManifestFetch(url: string): Promise<string> {
  return safeGetText(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'a-share-kline-trainer-updater' },
    timeoutMs: 30_000,
    timeoutMessage: '检查更新超时（30 秒）',
  })
}

async function defaultDownloadFetch(url: string): Promise<DownloadResponseLike> {
  const response = await safeRequest(url, {
    headers: { 'user-agent': 'a-share-kline-trainer-updater' },
    timeoutMs: 15 * 60_000,
    timeoutMessage: '下载超时（900 秒总预算）',
  })
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text: () => response.text(),
    arrayBuffer: async () => {
      const buffer = await response.buffer()
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    },
    // getReader 优先路径：增量 onProgress（downloadToBuffer 消费）；截断时 reader
    // 以含已收/应收字节的人话 Error 拒绝（不产出 done）。
    body: { getReader: () => response.reader() },
  }
}

async function downloadToBuffer(url: string, fetcher: DownloadFetch, onProgress: (received: number, total: number | null) => Promise<void>): Promise<Buffer> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}（${url}）`)
  const totalHeader = response.headers.get('content-length')
  const total = totalHeader !== null && /^\d+$/.test(totalHeader) ? Number(totalHeader) : null
  const reader = (response.body as { getReader?: () => { read(): Promise<{ done: boolean, value?: Uint8Array }> } } | undefined)?.getReader
  if (typeof reader === 'function') {
    const pull = (response.body as { getReader(): { read(): Promise<{ done: boolean, value?: Uint8Array }> } }).getReader()
    const chunks: Buffer[] = []
    let received = 0
    for (;;) {
      const { done, value } = await pull.read()
      if (done) break
      if (value) {
        chunks.push(Buffer.from(value))
        received += value.length
        await onProgress(received, total)
      }
    }
    return Buffer.concat(chunks)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await onProgress(buffer.length, total ?? buffer.length)
  return buffer
}

export async function registerUpdateApi(app: FastifyInstance, config: AppConfig, options: RegisterUpdateApiOptions = {}): Promise<void> {
  const packageRoot = options.packageRoot ?? APP_ROOT
  const env = options.env ?? process.env
  const manifestFetch = options.manifestFetch ?? defaultManifestFetch
  const downloadFetch = options.downloadFetch ?? defaultDownloadFetch
  const log = options.log ?? console
  // UPD-BUSY-HEAL-01：陈旧 busy 判定阈值（env 可覆盖，非法值回默认——fail-closed）
  const staleBusyMs = resolveStaleBusyMs(env)

  async function resolvePlan(): Promise<ManifestPlanEntry[]> {
    if (options.manifestUrl) return [{ url: options.manifestUrl, source: 'env' }]
    const release = await readCurrentRelease(packageRoot)
    const setting = await readUpdateSourceSetting(config.dataDir ?? null)
    return resolveManifestPlan({
      env,
      launcherConfigPath: config.launcherConfigPath ?? null,
      releasePublicURL: release?.publicURL ?? null,
      setting,
      ...(options.mirrorBase !== undefined ? { mirrorBase: options.mirrorBase } : {}),
    })
  }

  /**
   * CN-FEED-01 逐源清单获取（UPD-CN-FALLBACK-HTTP）：按计划顺序尝试，首个成功即用；
   * 全部失败取最后一次尝试的错误（错误取最终源）。返回的 url＝实际成功（或最后尝试）
   * 的清单地址，作为响应 manifestUrl（本次实际使用的清单源）。
   */
  async function fetchManifestWithFallback(entries: ManifestPlanEntry[]): Promise<
    { ok: true, manifest: UpdateManifest, url: string }
    | { ok: false, error: string, url: string }
  > {
    let lastUrl = entries.length > 0 ? entries[0].url : ''
    let lastError = '没有可用的更新清单源'
    for (const entry of entries) {
      lastUrl = entry.url
      const result = await fetchUpdateManifest(entry.url, manifestFetch)
      if (result.ok) return { ok: true, manifest: result.manifest, url: entry.url }
      lastError = result.error
    }
    return { ok: false, error: lastError, url: lastUrl }
  }

  // ===== GET /api/update/check =====
  app.get('/api/update/check', async () => {
    const currentVersion = serverVersion(packageRoot)
    const fetched = await fetchManifestWithFallback(await resolvePlan())
    if (!fetched.ok) {
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseNotes: null,
        downloadUrl: null,
        downloadSize: null,
        manifestUrl: fetched.url,
        error: fetched.error,
      }
    }
    const manifest = fetched.manifest
    const available = currentVersion !== null && compareVersions(manifest.version, currentVersion) > 0
    return {
      currentVersion,
      latestVersion: manifest.version,
      updateAvailable: available,
      releaseNotes: manifest.notes,
      downloadUrl: available ? manifest.zip.url : null,
      downloadSize: available ? manifest.zip.size : null,
      manifestUrl: fetched.url,
      error: null,
    }
  })

  // ===== GET/PUT /api/update/source（CN-FEED-01 / UPD-FEED-SETTING）=====
  // 更新源三态设置（auto=镜像优先回退官方 / official / custom），落 <dataDir>/update-source.json；
  // 优先级 env 注入 > 既有 trainer.config.json manifest_url 注入 > 本设置 > 内置默认（auto）。
  // desktop 与 zip HTTP 链共用该口径：desktop 主进程读同一文件决定 electron-updater feed 计划。
  app.get('/api/update/source', async () => {
    const setting = await readUpdateSourceSetting(config.dataDir ?? null)
    const fromEnv = await resolveManifestUrl({ env, launcherConfigPath: null, releasePublicURL: null })
    const envDesktopFeed = typeof env.TRAINER_DESKTOP_UPDATE_FEED === 'string' ? env.TRAINER_DESKTOP_UPDATE_FEED.trim() : ''
    const fromConfig = fromEnv.source === 'env'
      ? null
      : await resolveManifestUrl({ env: {}, launcherConfigPath: config.launcherConfigPath ?? null, releasePublicURL: null })
    let origin: 'env' | 'config' | 'setting' | 'default' = 'default'
    if (fromEnv.source === 'env' || envDesktopFeed !== '') origin = 'env'
    else if (fromConfig?.source === 'config') origin = 'config'
    else if (setting !== null) origin = 'setting'
    return {
      source: setting?.source ?? 'auto',
      customUrl: setting?.customUrl ?? null,
      origin,
      mirrorConfigured: CN_MIRROR_BASE.trim() !== '',
    }
  })

  app.put('/api/update/source', async (request, reply) => {
    const setting = parseUpdateSourceSetting(request.body)
    if (setting === null) {
      return reply.code(400).send({
        error: 'UPDATE_SOURCE_INVALID',
        message: '更新源设置非法：source 必须为 auto/official/custom；custom 必须携带 http(s) 自定义 URL；auto/official 不得携带 customUrl',
      })
    }
    if (!config.dataDir) {
      return reply.code(409).send({ error: 'UPDATE_SOURCE_NO_DATA_DIR', message: '当前运行方式无法持久化更新源设置（未知数据目录）' })
    }
    try {
      await writeUpdateSourceSetting(config.dataDir, setting)
    } catch (error) {
      return reply.code(500).send({ error: 'UPDATE_SOURCE_WRITE_FAILED', message: `保存失败（原设置未更改）：${messageOf(error)}` })
    }
    return { source: setting.source, customUrl: setting.customUrl, origin: 'setting', mirrorConfigured: CN_MIRROR_BASE.trim() !== '' }
  })

  // ===== GET /api/update/status =====
  app.get('/api/update/status', async () => {
    const currentVersion = serverVersion(packageRoot)
    // UPD-BUSY-HEAL-01：读即 reconcile——陈旧 busy（更新器被杀/断电残留）就地复位 failed，
    // 轮询方看到人话原因而非永远卡在进行中；新鲜 busy 原样返回。
    const record = await reconcileUpdateStatus(config.dataDir, currentVersion, { staleBusyMs, log })
    if (!record) {
      return { state: 'idle' as const, progress: null, error: null, attemptId: null, fromVersion: null, targetVersion: null, updatedAt: null }
    }
    return {
      state: record.state,
      progress: typeof record.progress === 'number' ? record.progress : null,
      error: record.error ?? null,
      attemptId: record.attemptId,
      fromVersion: record.fromVersion ?? null,
      targetVersion: record.targetVersion ?? null,
      updatedAt: record.updatedAt,
    }
  })

  // ===== POST /api/update/apply =====
  let activeAttempt: string | null = null

  function defaultLaunchUpdater(plan: UpdatePlan, workDir: string): Promise<{ started: boolean }> {
    return new Promise(resolveLaunch => {
      let settled = false
      const finish = (started: boolean): void => {
        if (settled) return
        settled = true
        resolveLaunch({ started })
      }
      try {
        const child = spawn(plan.nodePath, [join(workDir, 'updater.js'), join(workDir, 'plan.json')], {
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
          env: process.env, // 控制令牌经 env 传递给更新器，不落盘
        })
        child.once('error', () => finish(false))
        child.once('spawn', () => finish(true))
        child.unref()
      } catch {
        finish(false)
      }
    })
  }

  app.post('/api/update/apply', async (request, reply) => {
    const release = await readCurrentRelease(packageRoot)
    const launcherPath = typeof env.TRAINER_LAUNCHER_CJS === 'string' ? env.TRAINER_LAUNCHER_CJS.trim() : ''
    if (!release || !config.runId || !config.dataDir || !launcherPath) {
      return reply.code(503).send({
        error: 'UPDATE_NOT_PACKAGED',
        message: '当前运行方式不支持在线更新（需要发布包＋启动器托管运行）；请从 GitHub Releases 下载全量包更新（历史训练数据目录不受影响）',
      })
    }
    const currentVersion = serverVersion(packageRoot)
    if (!currentVersion) {
      return reply.code(503).send({ error: 'UPDATE_VERSION_UNKNOWN', message: '无法确定当前版本（包根 package.json 缺失或无 version 字段）' })
    }
    if (options.getActiveTraining?.()) {
      return reply.code(409).send({ error: 'ACTIVE_TRAINING', message: '有进行中的训练，结束训练（结算或放弃）后再更新' })
    }
    // UPD-BUSY-HEAL-01（UPD-STALE-BUSY-SELFHEAL）：reconcile 先判陈旧——busy 态且
    // updatedAt 超阈值（无活跃 attempt：activeAttempt 内存守卫在前覆盖本进程内进行中
    // 的下载/校验）→ 就地复位 failed（人话原因落日志），本请求继续走正常受理流程
    // （同一请求内自动重试放行，用户看到 202 而非 409）；存活到这里的 busy＝新鲜
    // 真 busy，仍按 UPDATE_IN_PROGRESS 守卫拒绝。
    const existing = await reconcileUpdateStatus(config.dataDir, currentVersion, { staleBusyMs, log })
    if (activeAttempt || (existing && isBusyUpdateState(existing.state))) {
      return reply.code(409).send({ error: 'UPDATE_IN_PROGRESS', message: '已有一个更新流程在进行中，请通过更新状态查看进度' })
    }
    const fetched = await fetchManifestWithFallback(await resolvePlan())
    if (!fetched.ok) {
      return reply.code(502).send({ error: 'UPDATE_MANIFEST_FAILED', message: fetched.error })
    }
    const manifest = fetched.manifest
    let newer: boolean
    try {
      newer = compareVersions(manifest.version, currentVersion) > 0
    } catch {
      newer = false
    }
    if (!newer) {
      return reply.code(409).send({ error: 'UPDATE_NOT_AVAILABLE', message: '当前已是最新版本，无需更新' })
    }

    const attemptId = `update-${randomUUID()}`
    activeAttempt = attemptId
    await writeUpdateStatus(config.dataDir, {
      state: 'downloading', attemptId, progress: 0, error: null,
      fromVersion: currentVersion, targetVersion: manifest.version,
    })

    const task = (async (): Promise<void> => {
      const downloadsDir = join(config.dataDir!, 'update-downloads')
      await mkdir(downloadsDir, { recursive: true })
      const zipPath = join(downloadsDir, `${attemptId}.zip`)

      let expectedSha: string | null = null
      if (manifest.checksums) {
        const sumsResponse = await downloadFetch(manifest.checksums.url)
        if (!sumsResponse.ok) throw new Error(`下载 SHA256SUMS 失败：HTTP ${sumsResponse.status}`)
        const parsed = parseSumsLine(await sumsResponse.text(), manifest.zip.name)
        if (!parsed.ok) throw new Error(parsed.error)
        expectedSha = parsed.sha256
      }

      const buffer = await downloadToBuffer(manifest.zip.url, downloadFetch, async (received, total) => {
        const progress = total && total > 0 ? Math.min(1, received / total) : null
        await writeUpdateStatus(config.dataDir!, { state: 'downloading', attemptId, progress }).catch(() => {})
      })
      await writeFile(zipPath, buffer)

      await writeUpdateStatus(config.dataDir!, { state: 'verifying', attemptId, progress: null })
      const verify = verifyZipArtifact(buffer, {
        expectedVersion: manifest.version,
        expectedSha256: expectedSha,
        currentNodeVersion: release.nodeVersion,
      })
      if (!verify.ok) throw new Error(verify.reason)

      // 更新器工作目录（包外，避开被换装文件的自锁；plan 不含令牌）
      const workDir = join(config.dataDir!, 'update-work', attemptId)
      await mkdir(workDir, { recursive: true })
      const entryPath = options.updaterEntryPath
        ?? fileURLToPath(new URL('./updater.js', import.meta.url))
      await copyFile(entryPath, join(workDir, 'updater.js'))
      if (!options.updaterEntryPath) {
        // 生产（编译产物）必需的兄弟模块；注入场景（测试）不强制存在
        await copyFile(fileURLToPath(new URL('./updater-core.js', import.meta.url)), join(workDir, 'updater-core.js'))
      }
      await writeFile(join(workDir, 'package.json'), '{"type":"module"}\n')
      const plan: UpdatePlan = {
        version: 1,
        appId: 'a-share-kline-trainer',
        attemptId,
        createdAt: new Date().toISOString(),
        packageRoot,
        dataDir: config.dataDir!,
        zipPath,
        zipSha256: expectedSha,
        expectedVersion: manifest.version,
        artifactName: manifest.zip.name,
        serverPid: process.pid,
        serverPort: config.port,
        runId: config.runId!,
        launcherPath,
        nodePath: process.execPath,
        backupKeep: BACKUP_KEEP,
      }
      await writeFile(join(workDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)

      await writeUpdateStatus(config.dataDir!, { state: 'backing_up', attemptId, progress: null })
      const launch = options.launchUpdater ?? defaultLaunchUpdater
      const outcome = await launch(plan, workDir)
      if (!outcome?.started) {
        throw new Error('无法启动更新器进程，更新已停止（服务继续运行，未改动任何文件）')
      }
      // 更新器接管：后续状态由其在 dataDir/update-status.json 推进
    })().catch(async error => {
      await writeUpdateStatus(config.dataDir!, { state: 'failed', attemptId, error: messageOf(error).slice(0, 500) }).catch(() => {})
      log.error?.(error)
    }).finally(() => {
      if (activeAttempt === attemptId) activeAttempt = null
    })
    options.trackTask?.(task)
    return reply.code(202).send({ attemptId, state: 'downloading' })
  })
}
