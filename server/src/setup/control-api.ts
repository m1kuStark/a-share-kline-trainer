// SETUP-DRAIN-01（control-handoff-20260927-30 冻结合同）：受保护控制端点。
// POST /api/setup/control/prepare | cancel | shutdown，仅限本机一次性助手调用。
// 防护链（任一失败即拒绝，全部通过前不触碰 gate/业务查询/shutdown）：
//   body 严格 {runId,attemptId}（400 CONTROL_REQUEST_INVALID）→ remoteAddress 必须为
//   loopback（403 CONTROL_HELPER_ONLY）→ Host 逐字等于实际绑定 127.0.0.1:port（PORT=0
//   取 app.server.address 实际端口，不从请求反推）→ Origin 必须完全缺席（空串同样拒绝）→
//   Sec-Fetch-Site 若出现即拒绝 → 非空 controlToken 严格匹配（不接数组/重复值；
//   401 TOKEN_UNCONFIGURED/TOKEN_MISSING/TOKEN_INVALID）→ config.runId 非空（503
//   CONTROL_UNAVAILABLE）→ body.runId 逐字匹配（409 RUN_ID_MISMATCH）。
// 令牌不回显、不写 URL/日志/ready/health。响应统一 {phase,runId,attemptId} 或 {error:code}。
// shutdown：先状态迁移 closing，回包 202 后才异步调用注入的现有 shutdown（一次；202 不证明
// PID 退出；多次合法同 attempt 在可连接期间返回相同 closing，不双关 DB）。

import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../config.js'
import type { DrainController } from './drain-controller.js'

const CONTROL_PREFIX = '/api/setup/control'

export interface RegisterSetupControlApiOptions {
  controller: DrainController
  config: AppConfig
  /** 现有应用关闭函数（index.ts 的 shutdown）；由本模块在 202 回包后调用一次 */
  shutdown: () => void | Promise<void>
}

interface GuardFailure {
  ok: false
  statusCode: number
  code: string
}

interface GuardSuccess {
  ok: true
  attemptId: string
}

function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 请求体严格形状校验（先于一切副作用执行） */
function parseControlBody(body: unknown): { ok: true; runId: unknown; attemptId: string } | { ok: false } {
  if (!isPlainObject(body)) return { ok: false }
  const keys = Object.keys(body)
  if (keys.length !== 2 || !keys.includes('runId') || !keys.includes('attemptId')) return { ok: false }
  const { runId, attemptId } = body
  if (typeof runId !== 'string' || runId.trim() === '') return { ok: false }
  if (typeof attemptId !== 'string' || attemptId.length < 1 || attemptId.length > 128) return { ok: false }
  return { ok: true, runId, attemptId }
}

export async function registerSetupControlApi(
  app: FastifyInstance,
  options: RegisterSetupControlApiOptions,
): Promise<void> {
  const { controller, config, shutdown } = options
  let shutdownInvoked = false
  const invokeShutdownOnce = (): void => {
    if (shutdownInvoked) return
    shutdownInvoked = true
    // 经微任务调用：同步 throw 与 Promise rejection 一律进受控 catch，留可行动日志
    Promise.resolve()
      .then(() => shutdown())
      .catch(error => {
        app.log.error(error, '受控 shutdown 执行失败；失败已留日志，不冒充已退出')
      })
  }

  /** 实际绑定端口（PORT=0 时取内核分配值；不从请求反推） */
  function actualHostPort(): string | null {
    const address = app.server.address()
    if (address === null || typeof address === 'string') return null
    // 只允许服务真实监听 127.0.0.1；0.0.0.0 等非合同监听一律拒绝
    if (address.address !== '127.0.0.1') return null
    return `127.0.0.1:${address.port}`
  }

  function guard(request: { raw: { socket?: { remoteAddress?: string } }; headers: Record<string, unknown>; body: unknown }):
    GuardSuccess | GuardFailure {
    const parsed = parseControlBody(request.body)
    if (!parsed.ok) return { ok: false, statusCode: 400, code: 'CONTROL_REQUEST_INVALID' }

    const remoteAddress = request.raw.socket?.remoteAddress
    if (!isLoopbackAddress(remoteAddress)) return { ok: false, statusCode: 403, code: 'CONTROL_HELPER_ONLY' }

    const bound = actualHostPort()
    const host = request.headers.host
    if (bound === null || host !== bound) return { ok: false, statusCode: 403, code: 'CONTROL_HELPER_ONLY' }

    // Origin 必须完全缺席：空串同样拒绝（浏览器 principal 不得进入控制通道）
    if (request.headers.origin !== undefined) return { ok: false, statusCode: 403, code: 'CONTROL_HELPER_ONLY' }
    if (request.headers['sec-fetch-site'] !== undefined) return { ok: false, statusCode: 403, code: 'CONTROL_HELPER_ONLY' }

    if (!isNonEmptyHeader(config.controlToken)) return { ok: false, statusCode: 401, code: 'TOKEN_UNCONFIGURED' }
    const presented = request.headers['x-control-token']
    if (presented === undefined) return { ok: false, statusCode: 401, code: 'TOKEN_MISSING' }
    if (typeof presented !== 'string' || presented === '') return { ok: false, statusCode: 401, code: 'TOKEN_INVALID' }
    if (presented !== config.controlToken) return { ok: false, statusCode: 401, code: 'TOKEN_INVALID' }

    if (!isNonEmptyHeader(config.runId)) return { ok: false, statusCode: 503, code: 'CONTROL_UNAVAILABLE' }
    if (typeof parsed.runId === 'string' && parsed.runId !== config.runId) {
      return { ok: false, statusCode: 409, code: 'RUN_ID_MISMATCH' }
    }
    return { ok: true, attemptId: parsed.attemptId }
  }

  function isNonEmptyHeader(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== ''
  }

  const replyError = (reply: { code(statusCode: number): { send(payload: unknown): unknown } }, failure: GuardFailure): unknown =>
    reply.code(failure.statusCode).send({ error: failure.code })

  app.post(`${CONTROL_PREFIX}/prepare`, async (request, reply) => {
    const guarded = guard(request)
    if (!guarded.ok) return replyError(reply, guarded)
    const outcome = await controller.prepare(guarded.attemptId)
    switch (outcome.kind) {
      case 'prepared':
        return reply.code(200).send({ phase: 'prepared', runId: config.runId, attemptId: guarded.attemptId, expiresAtMs: outcome.leaseExpiresAtMs })
      case 'cancelled':
      case 'expired':
        return reply.code(409).send({ error: 'CONTROL_ATTEMPT_MISMATCH' })
      case 'drain-timeout':
        return reply.code(504).send({ error: 'DRAIN_TIMEOUT' })
      case 'active-training':
        return reply.code(409).send({ error: 'ACTIVE_TRAINING' })
      case 'closing':
        return reply.code(409).send({ error: 'CONTROL_CLOSING' })
      case 'busy':
        return reply.code(409).send({ error: 'CONTROL_BUSY' })
    }
  })

  app.post(`${CONTROL_PREFIX}/cancel`, async (request, reply) => {
    const guarded = guard(request)
    if (!guarded.ok) return replyError(reply, guarded)
    const outcome = controller.cancel(guarded.attemptId)
    if (outcome.kind === 'cancelled') {
      return reply.code(200).send({ phase: 'cancelled', runId: config.runId, attemptId: guarded.attemptId })
    }
    if (outcome.kind === 'closing') return reply.code(409).send({ error: 'CONTROL_CLOSING' })
    return reply.code(409).send({ error: 'CONTROL_ATTEMPT_MISMATCH' })
  })

  app.post(`${CONTROL_PREFIX}/shutdown`, async (request, reply) => {
    const guarded = guard(request)
    if (!guarded.ok) return replyError(reply, guarded)
    const outcome = controller.beginShutdown(guarded.attemptId)
    if (outcome.kind === 'closing') {
      // 真实响应完成后才触发关闭（原生 res 'finish'）；连接提前关闭按既有关闭语义保守触发。
      // 只触发一次；202 可读；202 不证明进程已退出。
      let scheduled = false
      const schedule = (): void => {
        if (scheduled) return
        scheduled = true
        invokeShutdownOnce()
      }
      reply.raw.once('finish', schedule)
      reply.raw.once('close', schedule)
      return reply.code(202).send({ phase: 'closing', runId: config.runId, attemptId: guarded.attemptId })
    }
    if (outcome.kind === 'active-training') return reply.code(409).send({ error: 'ACTIVE_TRAINING' })
    return reply.code(409).send({ error: 'CONTROL_NOT_PREPARED' })
  })
}
