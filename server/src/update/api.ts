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
import { fetchUpdateManifest, resolveManifestUrl, type ManifestFetchText } from './manifest.js'
import { isBusyUpdateState, readUpdateStatus, reconcileUpdateStatus, writeUpdateStatus } from './status.js'
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
  /** 清单拉取器（返回清单文本；抛错＝网络失败）。默认真实 fetch（GitHub API UA＋15s 超时）。 */
  manifestFetch?: ManifestFetchText
  /** 下载器（zip 与 SHA256SUMS 资产）。默认真实 fetch。 */
  downloadFetch?: DownloadFetch
  /** 显式覆盖清单 URL（测试）；缺省按 env>config>release>默认 解析。 */
  manifestUrl?: string
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

function defaultManifestFetch(url: string): Promise<string> {
  return fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'a-share-kline-trainer-updater' },
    signal: AbortSignal.timeout(30_000),
  }).then(async response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.text()
  })
}

async function defaultDownloadFetch(url: string): Promise<DownloadResponseLike> {
  return await fetch(url, {
    headers: { 'user-agent': 'a-share-kline-trainer-updater' },
    signal: AbortSignal.timeout(15 * 60_000),
  })
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

  async function resolveUrl(): Promise<{ url: string, source: string }> {
    if (options.manifestUrl) return { url: options.manifestUrl, source: 'override' }
    const release = await readCurrentRelease(packageRoot)
    return resolveManifestUrl({ env, launcherConfigPath: config.launcherConfigPath ?? null, releasePublicURL: release?.publicURL ?? null })
  }

  // ===== GET /api/update/check =====
  app.get('/api/update/check', async () => {
    const currentVersion = serverVersion(packageRoot)
    const resolved = await resolveUrl()
    const result = await fetchUpdateManifest(resolved.url, manifestFetch)
    if (!result.ok) {
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseNotes: null,
        downloadUrl: null,
        downloadSize: null,
        manifestUrl: resolved.url,
        error: result.error,
      }
    }
    const manifest = result.manifest
    const available = currentVersion !== null && compareVersions(manifest.version, currentVersion) > 0
    return {
      currentVersion,
      latestVersion: manifest.version,
      updateAvailable: available,
      releaseNotes: manifest.notes,
      downloadUrl: available ? manifest.zip.url : null,
      downloadSize: available ? manifest.zip.size : null,
      manifestUrl: resolved.url,
      error: null,
    }
  })

  // ===== GET /api/update/status =====
  app.get('/api/update/status', async () => {
    const currentVersion = serverVersion(packageRoot)
    const record = await reconcileUpdateStatus(config.dataDir, currentVersion)
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
    const existing = await reconcileUpdateStatus(config.dataDir, currentVersion)
    if (activeAttempt || (existing && isBusyUpdateState(existing.state))) {
      return reply.code(409).send({ error: 'UPDATE_IN_PROGRESS', message: '已有一个更新流程在进行中，请通过更新状态查看进度' })
    }
    const resolved = await resolveUrl()
    const result = await fetchUpdateManifest(resolved.url, manifestFetch)
    if (!result.ok) {
      return reply.code(502).send({ error: 'UPDATE_MANIFEST_FAILED', message: result.error })
    }
    const manifest = result.manifest
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
