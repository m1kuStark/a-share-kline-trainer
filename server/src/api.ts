import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readDayFileRange, readLastDayDate, isDayDate } from './tdx/dayfile.js'
import { aggregateBars, type Timeframe } from './tdx/kline.js'
import type { AppConfig } from './config.js'
import { refreshStockCatalog } from './tdx/catalog.js'
import { loadAdjustmentEvents, refreshAdjustmentCache } from './tdx/adjustment-cache.js'
import { applyForwardAdjustment } from './tdx/gbbq.js'
import { parseTdxSymbol } from './tdx/symbol.js'
import { buildStockSearchIndex, searchStockIndex, type StockSearchIndex } from './tdx/stock-search.js'
import { getActiveTraining } from './train/engine.js'
import { registerTrainingSettingsRoutes } from './settings/training.js'
import { DRAWINGS_BODY_LIMIT, readDrawings, writeDrawings } from './drawings.js'
import { createDataRefreshCoordinator } from './data/refresh.js'
import { registerRecordingContextRoutes } from './recording-context.js'
import {
  HttpError, TIERS, abandonTraining, advanceTraining, buildChartSpace, createTraining,
  equityCurveOf, previewTrainingRange, settleTraining, tradeTraining, trainingBars, trainingBarsBefore, trainingSnapshot, TRAINING_LOAD_BARS,
} from './train/engine.js'
import { drawingPriceBasis } from './train/drawing-price-basis.js'
import { validateSetupRequest } from './setup/control-guard.js'
import { collectTdxCandidateDiagnostics } from './tdx/candidate-diagnostics.js'
import { collectProcessClues, defaultProcessQuery, appendBounded, appendBoundedChunk, flushBoundedChunk, type BoundedOutput } from './tdx/process-clues.js'
import type { DrainGate } from './setup/drain-controller.js'
import { collectNearbyCandidateRoots, defaultTdxCandidates, NEARBY_SUGGESTION_LIMIT } from './tdx/discover.js'
import { inspectTdxCandidate, inspectTdxCandidates, type TdxCandidateCheck } from './tdx/inspect.js'
import { readSavedTdxChoice, saveTdxChoice, type SavedTdxChoice, type TdxRootSource } from './setup/saved-choice.js'
import { spawn } from 'node:child_process'

// ===== 受保护 setup 能力（SETUP-01 接线）=====
// 这些端点全部经 validateSetupRequest 防护（Host/Origin/Sec-Fetch-Site/控制令牌），
// 只服务本应用页面与本机助手；浏览器路径不要求令牌，助手路径要求逐字令牌。

const TRAINER_APP_ID = 'a-share-kline-trainer'
const ATTEMPT_FILE = 'setup-restart-attempt.json'
const RESTART_STATUS_FILE = 'setup-restart-status.json'
const SETUP_ROOT_MAX_LENGTH = 500
/** 原生目录选择框的有界等待：超时结束子进程并按 timeout 上报，不无限等待 */
const DIRECTORY_PICKER_TIMEOUT_MS = 300_000

export interface DirectoryPickerResult {
  status: 'selected' | 'cancelled' | 'timeout' | 'denied' | 'unavailable' | 'not_applicable'
  /** 仅在 selected 时返回用户自己选择的目录；其余状态绝不携带路径 */
  path?: string
  reason?: string
}

/** 受控本机桥：固定字面 PowerShell 脚本弹出 Windows 原生目录选择框。
 * 只接收选择动作，不拼接任何用户输入；输出有界、超时有限、失败分态。 */
export function defaultDirectoryPicker(): Promise<DirectoryPickerResult> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ status: 'not_applicable' })
  }
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = '请选择通达信安装根目录（包含 vipdoc 与 T0002 文件夹的目录）'",
    '$dialog.ShowNewFolderButton = $false',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
  ].join('\n')
  return new Promise(resolve => {
    let settled = false
    let timedOut = false
    const output: BoundedOutput = { stdout: '', stderr: '', byteTotal: 0, truncated: false }
    const deadline = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, DIRECTORY_PICKER_TIMEOUT_MS)
    const settle = (result: DirectoryPickerResult): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(result)
    }
    const child = spawn('powershell', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true })
    const boundedAppend = (target: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      if (typeof chunk === 'string') appendBounded(output, target, chunk)
      else appendBoundedChunk(output, target, chunk)
      if (output.truncated) child.kill('SIGTERM')
    }
    child.stdout.on('data', chunk => boundedAppend('stdout', chunk))
    child.stderr.on('data', chunk => boundedAppend('stderr', chunk))
    child.on('error', error => {
      settle({ status: 'unavailable', reason: `目录选择组件启动失败：${error.message}` })
    })
    child.on('close', (exitCode, signal) => {
      flushBoundedChunk(output, 'stdout')
      flushBoundedChunk(output, 'stderr')
      if (output.truncated) {
        settle({ status: 'unavailable', reason: '目录选择输出超过有界上限，结果不完整' })
        return
      }
      if (timedOut) {
        settle({ status: 'timeout', reason: '目录选择框超时未返回（超过 5 分钟），已自动取消' })
        return
      }
      const detail = output.stderr.trim().slice(0, 200)
      if (exitCode !== 0) {
        const denied = /拒绝|denied|access/i.test(detail)
        settle({ status: denied ? 'denied' : 'unavailable', reason: detail || `目录选择未完成（exit ${exitCode ?? signal}）` })
        return
      }
      const selected = output.stdout.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0)
      if (!selected) {
        settle({ status: 'cancelled' })
        return
      }
      if (selected.length > SETUP_ROOT_MAX_LENGTH || (!selected.includes('\\') && !selected.includes('/'))) {
        settle({ status: 'unavailable', reason: '目录选择返回了意外内容，已忽略' })
        return
      }
      settle({ status: 'selected', path: selected })
    })
  })
}

/** 原子写小文件：同目录随机临时文件（wx）+ rename；失败保留旧目标（与 saved-choice 同口径）。 */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { flag: 'wx', encoding: 'utf8' })
  await rename(temporary, path)
}

export interface RegisterApiOptions {
  /** 受保护 setup 端点的可注入依赖（测试用合成 stub，生产缺省走真实查询） */
  setup?: {
    processQuery?: () => Promise<import('./tdx/process-clues.js').ProcessQueryResult>
    inspect?: (roots: readonly string[]) => Promise<import('./tdx/inspect.js').TdxCandidateCheck[]>
    /** 单目录复验（保存/检查端点用）；默认 inspectTdxCandidate */
    inspectOne?: (root: string) => Promise<import('./tdx/inspect.js').TdxCandidateCheck>
    /** 原生目录选择桥；默认 defaultDirectoryPicker */
    directoryPicker?: () => Promise<DirectoryPickerResult>
    /** apply 的可注入实现（测试用）；默认走启动器监管进程 */
    applyRestart?: (attempt: SetupRestartAttempt) => Promise<{ started: boolean }>
  }
  /** REL-LAUNCH-UX-01：页面"保存并退出"生命周期协议。controller/shutdown 与
   * /api/setup/control/* 共用同一冻结排空实现（index.ts 注入）；now 可注入时钟。 */
  lifecycle?: {
    controller: import('./setup/drain-controller.js').DrainController
    shutdown: () => void | Promise<void>
    now?: () => number
  }
  /** SETUP-DRAIN-01：业务接纳 gate。提供时全部 /api/ 业务路由（含 GET 隐式缓存写）
   * 在注册阶段统一包装：gate 关闭后新业务 503 SERVER_DRAINING；已接纳 handler 在其
   * Promise 真正完成前持有租约（客户端 abort 不提前放行）。/api/health、
   * /api/setup/control/* 与 /api/lifecycle/* 豁免；非 /api/ 路径（静态资源）不受
   * gate 影响。 */
  drain?: DrainGate
}

/** 受控重启交接文件（写入 dataDir，由启动器监管模式消费；不含控制令牌） */
export interface SetupRestartAttempt {
  version: 1
  appId: string
  attemptId: string
  createdAt: string
  old: {
    runId: string
    pid: number
    port: number
    databasePath: string
    origin: string
    dataDir: string
  }
  planned: {
    dataDir: string
    databasePath: string
    port: number
    origin: string
    tdxRoot: string
    source: 'explicit-env' | 'recalculate'
  }
  target: { runId: string; port: number; origin: string }
  /** 本次保存前的旧选择（可能为 null）；回滚时按它原样恢复或删除 */
  previousSavedChoice: SavedTdxChoice | null
  /** 旧生效来源（仅解释用；回滚恢复服务时参考） */
  oldEffective: { tdxRoot: string | null; source: TdxRootSource | null }
}

export async function registerApi(
  app: FastifyInstance,
  config: AppConfig,
  database: DatabaseSync,
  options: RegisterApiOptions = {},
): Promise<void> {
  const drainGate = options.drain ?? null
  const exemptFromGate = (url: string): boolean =>
    url === '/api/health' || url.startsWith('/api/setup/control/')
    || url.startsWith('/api/lifecycle/') || !url.startsWith('/api/')
  const restoreRouteDecorators = (() => {
    if (!drainGate) return () => {}
    const methods = ['get', 'post', 'put', 'delete'] as const
    const restores: Array<() => void> = []
    for (const method of methods) {
      const instance = app as unknown as Record<string, unknown>
      const original = instance[method]
      if (typeof original !== 'function') continue
      const bound = (original as (...args: unknown[]) => unknown).bind(app)
      const wrapper = (url: string, opts: unknown, handler?: unknown) => {
        const actualHandler = typeof opts === 'function' ? opts : handler
        const routeOptions = typeof opts === 'function' ? undefined : opts
        if (typeof actualHandler !== 'function' || exemptFromGate(url)) {
          return routeOptions === undefined
            ? bound(url, actualHandler)
            : bound(url, routeOptions, actualHandler)
        }
        const gated = async (request: unknown, reply: {
          code(statusCode: number): { send(payload: unknown): unknown }
        }) => {
          const admission = drainGate.admit()
          if (!admission.ok) {
            return reply.code(503).send({ error: 'SERVER_DRAINING' })
          }
          try {
            return await (actualHandler as (request: unknown, reply: unknown) => unknown)(request, reply)
          } finally {
            admission.release()
          }
        }
        return routeOptions === undefined
          ? bound(url, gated)
          : bound(url, routeOptions, gated)
      }
      instance[method] = wrapper
      restores.push(() => { instance[method] = original })
    }
    return () => { for (const restore of restores) restore() }
  })()
  await registerRecordingContextRoutes(app, config, database)
  // TRAIN-01：训练默认设置（费用/T+1）GET/PUT；经统一注册进入 drain 门闩
  registerTrainingSettingsRoutes(app, database)
  let stockCache: Awaited<ReturnType<typeof refreshStockCatalog>>['stocks'] | null = null
  let stockRefresh: Promise<Awaited<ReturnType<typeof refreshStockCatalog>>> | null = null
  let adjustmentRefresh: Promise<Awaited<ReturnType<typeof refreshAdjustmentCache>>> | null = null
  // 搜索索引随目录引用一次构建（UI-03）：目录刷新整体替换引用后下一次查询才重建
  let searchIndexCache: { source: unknown; index: StockSearchIndex } | null = null

  function searchIndexFor(stocks: NonNullable<typeof stockCache>): StockSearchIndex {
    if (!searchIndexCache || searchIndexCache.source !== stocks) {
      searchIndexCache = { source: stocks, index: buildStockSearchIndex(stocks) }
    }
    return searchIndexCache.index
  }

  async function getStocks(): Promise<Awaited<ReturnType<typeof refreshStockCatalog>>['stocks']> {
    if (!config.tdxRoot) return []
    if (!stockRefresh) {
      stockRefresh = refreshStockCatalog(database, config.tdxRoot)
        .then(result => {
          stockCache = result.stocks
          return result
        })
        .finally(() => { stockRefresh = null })
    }
    await stockRefresh
    return stockCache ?? []
  }

  async function ensureAdjustmentCache() {
    if (!config.tdxRoot) return { refreshed: false, events: 0 }
    if (!adjustmentRefresh) {
      adjustmentRefresh = refreshAdjustmentCache(database, config.tdxRoot)
        .finally(() => { adjustmentRefresh = null })
    }
    return adjustmentRefresh
  }

  // 全局错误映射：业务错误（HttpError）与 Fastify 内建 4xx 都返回真实 message，
  // 否则前端只能看到默认的 "Bad Request"，丢失具体原因。
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      // 携带业务错误码的失败（如 RANGE 预览/RANGE_PREVIEW_STALE）把 code 一并下发，前端据此分流
      return reply.code(error.statusCode).send(error.code ? { error: error.message, code: error.code } : { error: error.message })
    }
    const statusCode = (error as { statusCode?: number }).statusCode
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: (error as Error).message || 'Bad Request' })
    }
    app.log.error(error)
    return reply.code(500).send({ error: '服务器内部错误' })
  })

  // ===== 受保护 setup 防护（SETUP-API-01 冻结合同的共享封装）=====
  // guard 先行，失败不调用任何诊断/文件操作；expectedHost 由配置监听地址构造，
  // 不从请求 Host 反推。响应绝不回显控制令牌。
  function setupGuard(
    request: { host: string; headers: Record<string, unknown> },
    reply: { code(statusCode: number): { send(payload: unknown): unknown } },
  ): boolean {
    const expectedHost = `${config.host}:${config.port}`
    const guard = validateSetupRequest({
      host: request.host,
      origin: request.headers.origin as string | undefined,
      // 这两个头是单值语义；Fastify 类型给 string|string[]，取首值并按 undefined 保留
      secFetchSite: Array.isArray(request.headers['sec-fetch-site'])
        ? (request.headers['sec-fetch-site'] as string[])[0]
        : request.headers['sec-fetch-site'] as string | undefined,
      controlToken: Array.isArray(request.headers['x-control-token'])
        ? (request.headers['x-control-token'] as string[])[0]
        : request.headers['x-control-token'] as string | undefined,
      expectedHost,
      expectedOrigin: `http://${expectedHost}`,
      expectedToken: config.controlToken ?? '',
    })
    if (!guard.ok) {
      void reply.code(guard.statusCode).send({ error: guard.code })
      return false
    }
    return true
  }

  /** 请求体目录字段校验：非空字符串、长度有界；失败返回 null（由调用方回 400） */
  function parseRootBody(body: unknown): string | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const root = (body as Record<string, unknown>).root
    if (typeof root !== 'string') return null
    const trimmed = root.trim()
    if (!trimmed || trimmed.length > SETUP_ROOT_MAX_LENGTH) return null
    return trimmed
  }

  // 受保护候选诊断只读端点（SETUP-API-01）：诊断异常结构化 503，
  // 不把失败伪装成空候选。响应可含本机路径（用户主动请求候选时展示安装位置），
  // 绝不回显控制令牌。
  app.get('/api/setup/candidates', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    const processQuery = options.setup?.processQuery ?? defaultProcessQuery
    const inspect = options.setup?.inspect
    try {
      // 注入点替换的是"查询"，clues 提取固定走 collectProcessClues（五态/去重/白名单）
      const processResult = await collectProcessClues(processQuery)
      const diagnostics = await collectTdxCandidateDiagnostics(
        { process: processResult, manualRoots: defaultTdxCandidates() },
        inspect,
      )
      const body: Record<string, unknown> = {
        processStatus: diagnostics.processStatus,
        candidates: diagnostics.candidates,
      }
      if (diagnostics.processReason !== undefined) {
        body.processReason = diagnostics.processReason
      }
      return body
    } catch {
      return reply.code(503).send({ error: 'SETUP_DIAGNOSTICS_UNAVAILABLE' })
    }
  })

  // 原生目录选择桥（SETUP-01）：固定字面脚本弹 Windows 原生目录选择框，只接收
  // 选择动作。取消是正常结果（不报错）；结果不做任何自动采用——用户必须经
  // /api/setup/inspect 看到检查结果并确认后才可能保存。
  app.post('/api/setup/select-directory', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    const picker = options.setup?.directoryPicker ?? defaultDirectoryPicker
    try {
      return await picker()
    } catch (error) {
      return { status: 'unavailable', reason: `目录选择组件调用失败：${error instanceof Error ? error.message : String(error)}` }
    }
  })

  // 检查用户提供的目录（选择框结果或手动输入）：返回完整检查结果；误选上层目录/
  // vipdoc 时只在附近有限范围识别根目录，识别出的候选仅供用户确认，不自动采用。
  app.post('/api/setup/inspect', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    const root = parseRootBody(request.body)
    if (root === null) {
      return reply.code(400).send({ error: 'root 必须是 1~500 字符的目录路径' })
    }
    const inspectOne = options.setup?.inspectOne ?? inspectTdxCandidate
    const inspectMany = options.setup?.inspect ?? inspectTdxCandidates
    let check: TdxCandidateCheck
    try {
      check = await inspectOne(root)
    } catch {
      return reply.code(503).send({ error: 'SETUP_DIAGNOSTICS_UNAVAILABLE' })
    }
    let suggestions: TdxCandidateCheck[] = []
    if (!check.recognized) {
      try {
        const nearbyRoots = await collectNearbyCandidateRoots(root)
        const nearbyChecks = nearbyRoots.length > 0 ? await inspectMany(nearbyRoots) : []
        const selectedKey = check.root.toLowerCase()
        suggestions = nearbyChecks
          .filter(item => item.recognized && item.root.toLowerCase() !== selectedKey)
          .slice(0, NEARBY_SUGGESTION_LIMIT)
      } catch {
        suggestions = []
      }
    }
    return { check, suggestions }
  })

  // 保存用户确认的目录（SETUP-SAVE-01 冻结模块）：保存前复验，原子写入 dataDir；
  // 失败保留旧选择并返回可行动错误。响应不含除用户自选目录以外的本机路径。
  let lastSavedChoice: { root: string; previous: SavedTdxChoice | null } | null = null
  app.post('/api/setup/save-choice', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    const root = parseRootBody(request.body)
    if (root === null) {
      return reply.code(400).send({ error: 'root 必须是 1~500 字符的目录路径' })
    }
    if (!config.dataDir) {
      return reply.code(503).send({ error: 'SETUP_SAVE_UNAVAILABLE', message: '当前运行未配置数据目录，无法保存选择' })
    }
    let previous: SavedTdxChoice | null
    try {
      previous = await readSavedTdxChoice(config.dataDir)
    } catch {
      previous = null
    }
    try {
      const saved = await saveTdxChoice(config.dataDir, root, options.setup?.inspectOne)
      lastSavedChoice = { root: saved.root, previous }
      return {
        saved: true,
        root: saved.root,
        savedAt: saved.savedAt,
        apply: describeApplyAvailability(),
      }
    } catch (error) {
      // saveTdxChoice 复验失败：旧文件原样保留，错误信息已含具体问题
      throw new HttpError(400, error instanceof Error ? error.message : '保存选择失败')
    }
  })

  /** 保存后能否在本会话内完成受控重启生效；不能时给出一句话原因 */
  function describeApplyAvailability(): { available: boolean; reason?: string } {
    if (!config.runId || !process.env.TRAINER_LAUNCHER_CJS) {
      return { available: false, reason: '当前为手动/开发运行方式，保存的目录将在下次启动服务时生效' }
    }
    if (config.tdxSource === 'env' || config.tdxSource === 'explicit-config') {
      return { available: false, reason: '当前行情目录来自环境变量/配置文件的显式指定，保存的选择不会覆盖它' }
    }
    if (getActiveTraining(database)) {
      return { available: false, reason: '有进行中的训练，结束后再切换数据目录' }
    }
    return { available: true }
  }

  // 受控重启受理（SETUP-01）：仅启动器托管的会话可用。受理后写入交接文件并拉起
  // 启动器监管模式（detached），由监管进程按 restart-plan 冻结状态机完成
  // 复验→排空→优雅退出→拉起新服务→健康确认（失败回滚）。202 只表示已受理。
  let restartAttemptActive: string | null = null
  app.post('/api/setup/apply', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    if (!config.runId) {
      return reply.code(503).send({ error: 'SETUP_RESTART_UNAVAILABLE', message: '当前为手动/开发运行方式，请重启开发服务使保存的目录生效' })
    }
    // 语义冲突先于能力缺失：显式覆盖/活动训练下任何重启都不被允许（409），
    // 之后才判断本会话是否具备自动重启能力（503）
    if (config.tdxSource === 'env' || config.tdxSource === 'explicit-config') {
      return reply.code(409).send({ error: 'SETUP_SOURCE_EXPLICIT', message: '当前行情目录来自环境变量/配置文件的显式指定，保存的选择不会生效' })
    }
    if (getActiveTraining(database)) {
      return reply.code(409).send({ error: 'ACTIVE_TRAINING', message: '有进行中的训练，结束后再切换数据目录' })
    }
    const launcherPath = process.env.TRAINER_LAUNCHER_CJS?.trim() || ''
    if (!launcherPath || !(await access(launcherPath).then(() => true, () => false)) || !config.dataDir) {
      return reply.code(503).send({ error: 'SETUP_RESTART_UNAVAILABLE', message: '当前运行方式不支持自动重启；保存的目录将在下次启动服务时生效' })
    }
    if (restartAttemptActive) {
      // 上一次受理若已到达终态（监管进程写 done），允许发起新的受理；仍在进行中则拒绝
      const previous = await readFile(join(config.dataDir, RESTART_STATUS_FILE), 'utf8')
        .then(raw => JSON.parse(raw) as Record<string, unknown>)
        .catch(() => null)
      if (previous && previous.attemptId === restartAttemptActive && previous.done !== true) {
        return reply.code(409).send({ error: 'CONTROL_BUSY', message: '已有一个重启流程在进行中' })
      }
      restartAttemptActive = null
    }
    const body = request.body as { attemptId?: unknown; root?: unknown }
    const attemptId = typeof body?.attemptId === 'string' && body.attemptId.trim() && body.attemptId.length <= 128
      ? body.attemptId.trim()
      : null
    const root = parseRootBody(body)
    if (attemptId === null || root === null) {
      return reply.code(400).send({ error: 'attemptId 与 root 必填（root 为 1~500 字符目录路径）' })
    }
    // 必须先保存过且磁盘上的选择与请求一致：apply 不隐式落盘
    const savedOnDisk = await readSavedTdxChoice(config.dataDir).catch(() => null)
    if (!lastSavedChoice || !savedOnDisk
      || lastSavedChoice.root.toLowerCase() !== root.trim().toLowerCase()
      || savedOnDisk.root.toLowerCase() !== root.trim().toLowerCase()) {
      return reply.code(409).send({ error: 'SETUP_SAVE_MISMATCH', message: '请先保存该目录，再执行生效' })
    }

    const port = config.port
    const origin = `http://127.0.0.1:${port}`
    const attempt: SetupRestartAttempt = {
      version: 1,
      appId: TRAINER_APP_ID,
      attemptId,
      createdAt: new Date().toISOString(),
      old: {
        runId: config.runId,
        pid: process.pid,
        port,
        databasePath: config.databasePath,
        origin,
        dataDir: config.dataDir,
      },
      planned: {
        dataDir: config.dataDir,
        databasePath: config.databasePath,
        port,
        origin,
        tdxRoot: savedOnDisk.root,
        source: 'explicit-env',
      },
      target: { runId: `run-${randomUUID()}`, port, origin },
      previousSavedChoice: lastSavedChoice.previous,
      oldEffective: { tdxRoot: config.tdxRoot, source: config.tdxSource },
    }
    const attemptPath = join(config.dataDir, ATTEMPT_FILE)
    const statusPath = join(config.dataDir, RESTART_STATUS_FILE)
    try {
      await writeFileAtomic(attemptPath, `${JSON.stringify(attempt, null, 2)}\n`)
      await writeFileAtomic(statusPath, `${JSON.stringify({
        version: 1, appId: TRAINER_APP_ID, attemptId,
        phase: 'preflight', stage: 'preflight', reason: '已受理重启请求，正在核对身份', updatedAt: new Date().toISOString(), done: false,
      }, null, 2)}\n`)
    } catch (error) {
      return reply.code(503).send({ error: 'SETUP_RESTART_UNAVAILABLE', message: `无法写入重启交接文件：${error instanceof Error ? error.message : String(error)}` })
    }
    const apply = options.setup?.applyRestart
      ? await options.setup.applyRestart(attempt)
      : await spawnRestartSupervisor(launcherPath, attemptPath)
    if (!apply.started) {
      restartAttemptActive = null
      return reply.code(503).send({ error: 'SETUP_RESTART_UNAVAILABLE', message: '无法启动重启监管进程，保存已生效但需手动重启训练器' })
    }
    restartAttemptActive = attemptId
    return reply.code(202).send({ phase: 'restart-initiated', attemptId, runId: config.runId })
  })

  /** 拉起 detached 监管进程（启动器 --setup-restart-attempt 模式）；env 原样继承
   * （含控制令牌，不落盘、不回显）；spawn 失败只影响本次受理，不抛出。 */
  function spawnRestartSupervisor(launcherPath: string, attemptPath: string): Promise<{ started: boolean }> {
    return new Promise(resolve => {
      let settled = false
      const finish = (started: boolean): void => {
        if (settled) return
        settled = true
        resolve({ started })
      }
      try {
        const child = spawn(process.execPath, [launcherPath, '--setup-restart-attempt', attemptPath], {
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
          env: process.env,
        })
        child.once('error', () => finish(false))
        child.once('spawn', () => finish(true))
        child.unref()
      } catch {
        finish(false)
      }
    })
  }

  // 重启状态查询：读监管进程写入的状态文件（旧/新服务指向同一 dataDir，重启窗口
  // 前后都可读）。无文件时按 idle 报告；文件内容不含路径与令牌。
  app.get('/api/setup/restart-status', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    if (!config.dataDir) return { phase: 'idle', done: false }
    try {
      const raw = await readFile(join(config.dataDir, RESTART_STATUS_FILE), 'utf8')
      const value = JSON.parse(raw) as Record<string, unknown>
      if (!value || typeof value !== 'object') return { phase: 'idle', done: false }
      return {
        attemptId: typeof value.attemptId === 'string' ? value.attemptId : null,
        phase: typeof value.phase === 'string' ? value.phase : 'unknown',
        stage: typeof value.stage === 'string' ? value.stage : null,
        // 有界透出：状态原因面向进度解释，不携带完整本机路径或令牌
        reason: typeof value.reason === 'string' ? value.reason.slice(0, 300) : null,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
        done: value.done === true,
      }
    } catch {
      return { phase: 'idle', done: false }
    }
  })

  // ===== 页面"保存并退出"生命周期（REL-LAUNCH-UX-01） =====
  // 与 /api/setup/control/* 复用同一冻结排空控制器：退出不结算、不放弃训练；
  // 排空控制器对活动训练的阻断是唯一权威。多页协调：会话注册＋续约；有其他
  // 活跃页面时广播退出请求、逐页确认保存，拒绝或限时无响应一律不停止服务。
  // 会话令牌是每会话随机串，公开 /api/health 里的 runId 不能替代它。
  // 本组端点豁免业务 gate（排空期间心跳/状态/确认必须可达）。
  const lifecycleNow = options.lifecycle?.now ?? Date.now
  const LIFECYCLE_HEARTBEAT_MS = 15_000
  // 活跃判定窗：必须覆盖后台标签被浏览器节流到每分钟一次心跳的情形
  const LIFECYCLE_FRESH_MS = 90_000
  // 其他页面确认限时：超时如实判失败，绝不转强制结束
  const LIFECYCLE_EXIT_TTL_MS = 120_000
  interface LifecycleSession { id: string; token: string; createdAt: number; lastSeenAt: number }
  interface LifecycleExitRequest {
    id: string
    requestedBy: string
    requestedAt: number
    live: string[]
    confirmed: Set<string>
  }
  type LifecycleExitState =
    | { phase: 'idle' }
    | { phase: 'awaiting'; request: LifecycleExitRequest }
    | { phase: 'draining'; request: LifecycleExitRequest | null; attemptId: string }
    | { phase: 'failed' | 'cancelled'; request: LifecycleExitRequest | null; reason: string }
  const lifecycleSessions = new Map<string, LifecycleSession>()
  let lifecycleExit: LifecycleExitState = { phase: 'idle' }
  let lifecycleShutdownInvoked = false

  function lifecycleGcSessions(now: number): void {
    for (const [id, session] of lifecycleSessions) {
      if (now - session.lastSeenAt > 3 * LIFECYCLE_FRESH_MS) lifecycleSessions.delete(id)
    }
  }

  /** 读取当前退出状态（函数边界规避控制流收窄：evaluate 会在内部改写状态）。 */
  function lifecycleCurrent(): LifecycleExitState {
    return lifecycleExit
  }

  /** 协调看门狗：请求超时、发起页失联，或活跃成员的会话已被垃圾回收（长时间静默，
   * 只能是页面已关闭或浏览器整体冻结）时，保守取消本次退出；确认例外见实现。 */
  function lifecycleEvaluate(now: number): void {
    if (lifecycleExit.phase !== 'awaiting') return
    const request = lifecycleExit.request
    const requester = lifecycleSessions.get(request.requestedBy)
    if (now - request.requestedAt > LIFECYCLE_EXIT_TTL_MS) {
      lifecycleExit = { phase: 'failed', request: null, reason: `其他页面未在 ${Math.round(LIFECYCLE_EXIT_TTL_MS / 1000)} 秒内确认保存，已停止本次退出（服务未停止）` }
      return
    }
    if (!requester || now - requester.lastSeenAt > LIFECYCLE_FRESH_MS) {
      lifecycleExit = { phase: 'cancelled', request: null, reason: '发起退出的页面已关闭或失联，已停止本次退出（服务未停止）' }
      return
    }
    // 已被 GC 的成员（静默远超节流上限）视为已关闭页面，不再阻塞；其余成员必须显式确认
    for (const memberId of [...request.live]) {
      if (memberId === request.requestedBy || request.confirmed.has(memberId)) continue
      if (!lifecycleSessions.has(memberId)) request.live = request.live.filter(id => id !== memberId)
    }
    if (request.live.every(id => id === request.requestedBy || request.confirmed.has(id))) {
      lifecycleExit = { phase: 'draining', request, attemptId: `lifecycle-${request.id}` }
    }
  }

  /** 进入排空：状态置 draining，真正的 prepare→shutdown 在本次响应完成后触发
   * （202 先可读）。prepare 的活动训练/超时结果如实写回状态；任何失败都不转强制结束。 */
  function lifecycleBeginDraining(request: LifecycleExitRequest | null): string {
    if (lifecycleExit.phase === 'draining') return lifecycleExit.attemptId
    const attemptId = `lifecycle-${request?.id ?? randomUUID()}`
    lifecycleExit = { phase: 'draining', request, attemptId }
    return attemptId
  }

  /** 若当前处于 draining，则在本响应完成后触发一次排空+关闭（幂等）。 */
  function lifecycleArmShutdown(reply: { raw: { once(event: string, listener: () => void): unknown } }): void {
    if (lifecycleExit.phase !== 'draining') return
    const attemptId = lifecycleExit.attemptId
    let scheduled = false
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      lifecycleInvokeShutdownOnce(attemptId)
    }
    reply.raw.once('finish', schedule)
    reply.raw.once('close', schedule)
  }

  function lifecycleInvokeShutdownOnce(attemptId: string): void {
    if (lifecycleShutdownInvoked) return
    lifecycleShutdownInvoked = true
    const controller = options.lifecycle!.controller
    const shutdown = options.lifecycle!.shutdown
    Promise.resolve()
      .then(() => controller.prepare(attemptId))
      .then(outcome => {
        if (outcome.kind !== 'prepared') {
          const reason = outcome.kind === 'active-training'
            ? '有进行中的训练，已停止退出（本局进度保留）'
            : outcome.kind === 'drain-timeout'
              ? '在途请求未能在限时内排空，已停止退出（服务未停止）'
              : '排空控制器拒绝本次退出，服务未停止'
          lifecycleExit = { phase: 'failed', request: null, reason }
          return
        }
        return Promise.resolve()
          .then(() => shutdown())
          .catch(error => {
            lifecycleExit = { phase: 'failed', request: null, reason: `关闭服务失败：${error instanceof Error ? error.message : String(error)}` }
          })
      })
      .catch(error => {
        lifecycleExit = { phase: 'failed', request: null, reason: `排空过程发生错误：${error instanceof Error ? error.message : String(error)}` }
      })
  }

  function lifecycleBody<T extends { sessionId?: unknown; exitToken?: unknown; requestId?: unknown }>(body: unknown): T | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const record = body as Record<string, unknown>
    for (const key of ['sessionId', 'exitToken', 'requestId'] as const) {
      const value = record[key]
      if (value !== undefined && (typeof value !== 'string' || value.length === 0 || value.length > 128)) return null
    }
    return record as T
  }

  function lifecycleAuth(body: { sessionId?: string; exitToken?: string } | null): LifecycleSession | null {
    if (!body?.sessionId || !body.exitToken) return null
    const session = lifecycleSessions.get(body.sessionId)
    if (!session || session.token !== body.exitToken) return null
    return session
  }

  function lifecycleView(): Record<string, unknown> {
    const now = lifecycleNow()
    lifecycleEvaluate(now)
    if (lifecycleExit.phase === 'awaiting') {
      const request = lifecycleExit.request
      const remaining = request.live.filter(id => id !== request.requestedBy && !request.confirmed.has(id)).length
      return { phase: 'awaiting', requestId: request.id, remaining }
    }
    if (lifecycleExit.phase === 'draining') return { phase: 'draining', requestId: lifecycleExit.request?.id ?? null }
    if (lifecycleExit.phase === 'failed' || lifecycleExit.phase === 'cancelled') {
      return { phase: lifecycleExit.phase, reason: lifecycleExit.reason }
    }
    return { phase: 'idle' }
  }

  app.post('/api/lifecycle/session', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    if (!options.lifecycle) {
      return reply.code(503).send({ error: 'LIFECYCLE_UNAVAILABLE', message: '当前运行方式未启用生命周期管理' })
    }
    const now = lifecycleNow()
    lifecycleGcSessions(now)
    const session: LifecycleSession = {
      id: randomUUID(),
      token: randomUUID(),
      createdAt: now,
      lastSeenAt: now,
    }
    lifecycleSessions.set(session.id, session)
    return {
      sessionId: session.id,
      exitToken: session.token,
      heartbeatIntervalMs: LIFECYCLE_HEARTBEAT_MS,
      freshWindowMs: LIFECYCLE_FRESH_MS,
    }
  })

  app.post('/api/lifecycle/heartbeat', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    if (!options.lifecycle) {
      return reply.code(503).send({ error: 'LIFECYCLE_UNAVAILABLE', message: '当前运行方式未启用生命周期管理' })
    }
    const body = lifecycleBody<{ sessionId: string; exitToken: string }>(request.body)
    const session = lifecycleAuth(body)
    if (!session) return reply.code(403).send({ error: 'SESSION_TOKEN_INVALID' })
    session.lastSeenAt = lifecycleNow()
    lifecycleGcSessions(session.lastSeenAt)
    const view = lifecycleView()
    lifecycleArmShutdown(reply)
    const pending = lifecycleExit.phase === 'awaiting' && lifecycleExit.request.live.includes(session.id)
      && !lifecycleExit.request.confirmed.has(session.id)
      ? { requestId: lifecycleExit.request.id, requestedByMe: lifecycleExit.request.requestedBy === session.id }
      : null
    return { ok: true, phase: view.phase, pendingExit: pending }
  })

  app.post('/api/lifecycle/exit', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    if (!options.lifecycle) {
      return reply.code(503).send({ error: 'LIFECYCLE_UNAVAILABLE', message: '当前运行方式未启用生命周期管理' })
    }
    const body = lifecycleBody<{ sessionId: string; exitToken: string }>(request.body)
    const session = lifecycleAuth(body)
    if (!session) return reply.code(403).send({ error: 'SESSION_TOKEN_INVALID' })
    const now = lifecycleNow()
    session.lastSeenAt = now
    lifecycleGcSessions(now)
    if (lifecycleExit.phase === 'draining') {
      return reply.code(202).send({ phase: 'draining', requestId: lifecycleExit.request?.id ?? null })
    }
    if (lifecycleExit.phase === 'awaiting') {
      const view = lifecycleView()
      return reply.code(202).send({ phase: 'awaiting', requestId: lifecycleExit.request.id, remaining: view.remaining })
    }
    // 冻结"请求时刻的活跃页面集合"：其中每一页都必须显式确认；不因超时自动放行
    const live = [...lifecycleSessions.values()]
      .filter(candidate => now - candidate.lastSeenAt <= LIFECYCLE_FRESH_MS)
      .map(candidate => candidate.id)
    const others = live.filter(id => id !== session.id)
    const exitRequest: LifecycleExitRequest = {
      id: randomUUID(),
      requestedBy: session.id,
      requestedAt: now,
      live,
      confirmed: new Set([session.id]),
    }
    if (others.length === 0) {
      lifecycleBeginDraining(exitRequest)
      lifecycleArmShutdown(reply)
      return reply.code(202).send({ phase: 'draining', requestId: exitRequest.id, remaining: 0 })
    }
    lifecycleExit = { phase: 'awaiting', request: exitRequest }
    return reply.code(202).send({ phase: 'awaiting', requestId: exitRequest.id, remaining: others.length })
  })

  app.post('/api/lifecycle/confirm', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    if (!options.lifecycle) {
      return reply.code(503).send({ error: 'LIFECYCLE_UNAVAILABLE', message: '当前运行方式未启用生命周期管理' })
    }
    const body = lifecycleBody<{ sessionId: string; exitToken: string; requestId: string }>(request.body)
    if (!body) return reply.code(403).send({ error: 'SESSION_TOKEN_INVALID' })
    const session = lifecycleAuth(body)
    if (!session) return reply.code(403).send({ error: 'SESSION_TOKEN_INVALID' })
    session.lastSeenAt = lifecycleNow()
    if (lifecycleExit.phase !== 'awaiting' || !body.requestId || lifecycleExit.request.id !== body.requestId) {
      return { phase: lifecycleExit.phase === 'draining' ? 'draining' : 'idle' }
    }
    const exitRequest = lifecycleExit.request
    if (!exitRequest.live.includes(session.id)) {
      return reply.code(409).send({ error: 'NOT_PARTICIPATING', message: '本页面不在本次退出协调范围内' })
    }
    exitRequest.confirmed.add(session.id)
    lifecycleEvaluate(lifecycleNow())
    if (lifecycleCurrent().phase === 'draining') {
      lifecycleArmShutdown(reply)
      return { phase: 'draining', requestId: exitRequest.id }
    }
    const view = lifecycleView()
    return { phase: view.phase, requestId: exitRequest.id, remaining: view.remaining }
  })

  app.post('/api/lifecycle/cancel-exit', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    if (!options.lifecycle) {
      return reply.code(503).send({ error: 'LIFECYCLE_UNAVAILABLE', message: '当前运行方式未启用生命周期管理' })
    }
    const body = lifecycleBody<{ sessionId: string; exitToken: string; requestId: string }>(request.body)
    const session = lifecycleAuth(body)
    if (!session) return reply.code(403).send({ error: 'SESSION_TOKEN_INVALID' })
    session.lastSeenAt = lifecycleNow()
    if (lifecycleExit.phase !== 'awaiting') return { phase: lifecycleExit.phase }
    lifecycleExit = { phase: 'cancelled', request: null, reason: '有页面拒绝了退出，已停止本次退出（服务未停止）' }
    return { phase: 'cancelled' }
  })

  app.get('/api/lifecycle/status', async (request, reply) => {
    if (!setupGuard(request, reply)) return reply
    if (!options.lifecycle) {
      return reply.code(503).send({ error: 'LIFECYCLE_UNAVAILABLE', message: '当前运行方式未启用生命周期管理' })
    }
    const view = lifecycleView()
    lifecycleArmShutdown(reply)
    return view
  })

  app.get('/api/env', async () => {
    const [stocks] = await Promise.all([getStocks(), ensureAdjustmentCache()])
    const active = getActiveTraining(database)
    return {
      status: 'ok',
      // 隐私边界（SETUP-01）：开放端点只返回连接状态与来源标签，不回传完整本机路径
      tdx: { connected: config.tdxRoot !== null, source: config.tdxSource ?? null },
      dataCutoff: stocks.map(stock => stock.lastDate).filter(Boolean).sort().at(-1) ?? null,
      stockCount: stocks.length,
      capabilities: { day: true, forwardAdjust: true, benchmark: true, catalogCache: true, training: true },
      activeTrainingId: active?.id ?? null,
    }
  })

  app.get('/api/stocks', async request => {
    if (!config.tdxRoot) return { items: [], total: 0, error: 'TDX directory not found' }
    const stocks = await getStocks()
    const query = request.query as { market?: string; q?: string }
    const items = searchStockIndex(searchIndexFor(stocks), query.q ?? '', query.market)
    return { items: items.slice(0, 100), total: items.length }
  })

  // 原始行情接口：训练进行中关闭，保证前端拿不到任何训练日之后的 K 线（防未来的根）
  app.get('/api/kline/:code', async (request, reply) => {
    if (getActiveTraining(database)) {
      return reply.code(409).send({ error: '训练进行中，原始行情接口已关闭；训练行情请使用训练接口' })
    }
    if (!config.tdxRoot) return reply.code(503).send({ error: 'TDX directory not found' })
    const params = request.params as { code: string }
    const query = request.query as { from?: string; to?: string; tf?: Timeframe; adjust?: 'forward' | 'raw' }
    if (query.tf && !['1D', '1W', '1M'].includes(query.tf)) {
      return reply.code(400).send({ error: `Unsupported timeframe: ${query.tf}` })
    }
    if (query.adjust && !['forward', 'raw'].includes(query.adjust)) {
      return reply.code(400).send({ error: `Unsupported adjustment mode: ${query.adjust}` })
    }
    if ((query.from && !isDayDate(query.from)) || (query.to && !isDayDate(query.to))) {
      return reply.code(400).send({ error: 'from and to must be valid dates in YYYY-MM-DD format' })
    }
    if (query.from && query.to && query.from > query.to) {
      return reply.code(400).send({ error: `from date ${query.from} must not be after to date ${query.to}` })
    }
    let parsed
    try {
      parsed = parseTdxSymbol(params.code)
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid symbol' })
    }
    const path = join(config.tdxRoot, 'vipdoc', parsed.market, 'lday', `${parsed.symbol}.day`)
    try {
      const daily = await readDayFileRange(path, query.from, query.to)
      const adjustmentMode = query.adjust ?? 'forward'
      let adjusted = daily
      if (adjustmentMode === 'forward') {
        await ensureAdjustmentCache()
        const baseDate = await readLastDayDate(path)
        adjusted = applyForwardAdjustment(daily, loadAdjustmentEvents(database, parsed.market, parsed.code), baseDate ?? undefined)
      }
      const timeframe = query.tf ?? '1D'
      return {
        code: parsed.code,
        market: parsed.market,
        symbol: parsed.symbol,
        timeframe,
        adjustmentMode,
        bars: aggregateBars(adjusted, timeframe),
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === 'ENOENT') return reply.code(404).send({ error: `TDX data not found for ${parsed.symbol}` })
      throw error
    }
  })

  // TRAIN-02 范围预览：只返回日期元信息与指纹，不含任何OHLC/收益；创建时据此复核。
  app.post('/api/training-ranges/preview', async (request, reply) => {
    if (!config.tdxRoot) return reply.code(503).send({ error: 'TDX directory not found' })
    const body = request.body as { code?: string; market?: string; range?: unknown; adjustMode?: string }
    return previewTrainingRange(database, config, body)
  })

  app.post('/api/trainings', async (request, reply) => {
    if (!config.tdxRoot) return reply.code(503).send({ error: 'TDX directory not found' })
    const body = request.body as {
      tier?: string; code?: string; start_date?: string
      initial_cash?: number; blind?: boolean; adjust_mode?: string
      range?: unknown; previewId?: string
    }
    // 新范围模式：range/previewId 与 tier 互斥，复核失败返回 409 RANGE_PREVIEW_STALE
    if (body.range !== undefined || body.previewId !== undefined) {
      const training = await createTraining(database, config, {
        tier: body.tier,
        range: body.range,
        previewId: body.previewId,
        code: body.code,
        initial_cash: body.initial_cash,
        blind: body.blind,
        adjust_mode: body.adjust_mode,
      })
      return reply.code(201).send({ training })
    }
    if (!body.tier || !TIERS.includes(body.tier as never)) {
      return reply.code(400).send({ error: `tier 必须是 ${TIERS.join(' / ')} 之一` })
    }
    if (!body.code || !body.start_date) {
      return reply.code(400).send({ error: 'code 与 start_date 必填' })
    }
    const training = await createTraining(database, config, {
      tier: body.tier,
      code: body.code,
      start_date: body.start_date,
      initial_cash: body.initial_cash,
      blind: body.blind,
      adjust_mode: body.adjust_mode,
    })
    return reply.code(201).send({ training })
  })

  app.get('/api/trainings/active', async () => {
    const training = getActiveTraining(database)
    if (!training) return { training: null }
    const snapshot = trainingSnapshot(database, training.id)
    return snapshot
  })

  app.get('/api/trainings/:id', async request => {
    const { id } = request.params as { id: string }
    const trainingId = Number(id)
    if (!Number.isSafeInteger(trainingId) || trainingId < 1) throw new HttpError(400, 'id 必须是正整数')
    return trainingSnapshot(database, trainingId)
  })

  app.get('/api/trainings/:id/drawings', async request => {
    const { id } = request.params as { id: string }
    return { drawings: readDrawings(database, Number(id)) }
  })

  app.put('/api/trainings/:id/drawings', { bodyLimit: DRAWINGS_BODY_LIMIT }, async request => {
    const { id } = request.params as { id: string }
    return { drawings: writeDrawings(database, Number(id), request.body) }
  })

  app.get('/api/trainings/:id/bars', async (request, reply) => {
    const params = request.params as { id: string }
    const query = request.query as { tf?: Timeframe; before?: string; count?: string }
    const timeframe = query.tf ?? '1D'
    if (!['1D', '1W', '1M'].includes(timeframe)) {
      return reply.code(400).send({ error: `Unsupported timeframe: ${timeframe}` })
    }
    // 动态历史加载：before/count 分批取更早历史；before 接受 YYYY-MM（月 K）或 YYYY-MM-DD
    let chunk: { bars: Awaited<ReturnType<typeof trainingBars>>; hasMore: boolean } | null = null
    if (query.before !== undefined) {
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(query.before)) {
        return reply.code(400).send({ error: 'before 必须是 YYYY-MM 或 YYYY-MM-DD 格式' })
      }
      const count = query.count === undefined ? 300 : Number(query.count)
      if (!Number.isInteger(count) || count < 1 || count > 1000) {
        return reply.code(400).send({ error: 'count 必须是 1~1000 的整数' })
      }
      const id = Number(params.id)
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id 必须是整数' })
      try {
        chunk = await trainingBarsBefore(database, config, id, timeframe, query.before, count)
      } catch (error) {
        if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message })
        throw error
      }
    }
    const id = Number(params.id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id 必须是整数' })
    try {
      const snapshot = trainingSnapshot(database, id)
      const bars = chunk ? chunk.bars : await trainingBars(database, config, id, timeframe)
      const chart = buildChartSpace(database, id, snapshot.trades)
      return {
        ...snapshot,
        trades: chart.trades,
        chartCostPrice: chart.costPrice,
        timeframe,
        bars,
        // 画线前复权基准：bars 计算后读取（权息缓存已刷新）；与 bars 同次返回，不含未来权息。
        drawingPriceBasis: drawingPriceBasis(database, id),
        hasMore: chunk ? chunk.hasMore : bars.length >= TRAINING_LOAD_BARS,
      }
    } catch (error) {
      if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message })
      throw error
    }
  })

  app.post('/api/trainings/:id/next', async (request, reply) => {
    const params = request.params as { id: string }
    const id = Number(params.id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id 必须是整数' })
    try {
      return await advanceTraining(database, config, id)
    } catch (error) {
      if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message })
      throw error
    }
  })

  app.post('/api/trainings/:id/trade', async (request, reply) => {
    const params = request.params as { id: string }
    const id = Number(params.id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id 必须是整数' })
    const body = request.body as { side?: string; shares?: number; weightPct?: number }
    try {
      return await tradeTraining(database, id, {
        side: body.side,
        shares: body.shares === undefined ? undefined : Number(body.shares),
        weightPct: body.weightPct === undefined ? undefined : Number(body.weightPct),
      })
    } catch (error) {
      if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message })
      throw error
    }
  })

  app.post('/api/trainings/:id/settle', async (request, reply) => {
    const params = request.params as { id: string }
    const id = Number(params.id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id 必须是整数' })
    try {
      const training = settleTraining(database, id)
      void training
      return { ...trainingSnapshot(database, id), equityCurve: equityCurveOf(database, id) }
    } catch (error) {
      if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message })
      throw error
    }
  })

  app.post('/api/trainings/:id/abandon', async (request, reply) => {
    const params = request.params as { id: string }
    const id = Number(params.id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id 必须是整数' })
    try {
      const training = abandonTraining(database, id)
      return { training, equityCurve: equityCurveOf(database, id) }
    } catch (error) {
      if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message })
      throw error
    }
  })

  // ===== R1 统一日线更新服务：状态查询 + 手动/启动/激活共用的单飞行刷新任务 =====
  const dataRefresh = createDataRefreshCoordinator(database, config)
  // SETUP-DRAIN-01：202 返回后的完整刷新任务纳入排空等待（源头 track，无竞态窗口）
  drainGate?.registerTaskSource(() => dataRefresh.pendingTasks())

  app.get('/api/data/status', async () => dataRefresh.getStatus())

  app.post('/api/data/refresh', async (_request, reply) => {
    const started = await dataRefresh.start()
    if (!started) return reply.code(409).send({ error: '未检测到通达信数据目录，且未配置在线数据源' })
    return reply.code(started.joined ? 200 : 202).send({ taskId: started.taskId, state: started.state, joined: started.joined })
  })

  restoreRouteDecorators()
}
