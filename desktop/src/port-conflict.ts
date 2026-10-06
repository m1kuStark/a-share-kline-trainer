// PACK-02 端口决策层（DESKTOP-PORT-CONFLICT-FOREIGN-AUTOPICK / DESKTOP-PORT-CONFLICT-TRAINER-ASK）。
// 口径镜像自 scripts/release/launcher.cjs 冻结语义（launcher 不入桌面包、禁改，故镜像重实现）：
//   - isTrainerHealth 三字段身份：status==='ok' && typeof runId==='string' && Number.isInteger(pid)
//   - probeHealth：仅 127.0.0.1、redirect:'error'、仅 HTTP 200 计身份
//   - PORT-01：bind 探测（EACCES→reserved，其他→occupied）＋preferred+1 起向上至多 40 次找首个可 bind
//   - PORT-02：reuse＝复核存活后不启第二进程；restart＝复核 pid 一致才杀→等退出＋端口释放
//   - 桌面第三应答 cancel（PACK-02 派发简报决策③）；应答可注入 env（对齐 launcher --conflict-answer）
import net from 'node:net'

export const FALLBACK_ATTEMPTS = 40

/** 训练器占用者身份（launcher occupant 同构） */
export interface TrainerIdentity {
  pid: number
  port: number
  runId: string
}

export type HealthProbe = {
  responded: boolean
  refused: boolean
  status: number | null
  json: unknown
}

export interface BindState {
  ok: boolean
  code?: string
}

export type ConflictAnswer = 'reuse' | 'restart' | 'cancel'

export interface PortFallback {
  from: number
  reason: 'reserved' | 'occupied'
}

export type PortPlan =
  | { action: 'start'; port: number; fallback: PortFallback | null }
  | { action: 'reuse'; port: number; url: string; occupant: TrainerIdentity }
  | { action: 'quit'; reason: string }

/** launcher isTrainerHealth 镜像：health 体身份判定（附加字段如 currentVersion 不影响） */
export function isTrainerHealthBody(value: unknown): value is { status: 'ok'; runId: string; pid: number } {
  return Boolean(value && typeof value === 'object'
    && (value as { status?: unknown }).status === 'ok'
    && typeof (value as { runId?: unknown }).runId === 'string'
    && Number.isInteger((value as { pid?: unknown }).pid))
}

/** TRAINER_DESKTOP_CONFLICT_ANSWER 严格解析：unset/空白→null；非法值报错不猜（launcher --conflict-answer 同口径） */
export function parseConflictAnswerEnv(env: NodeJS.ProcessEnv): ConflictAnswer | null {
  const raw = env.TRAINER_DESKTOP_CONFLICT_ANSWER?.trim()
  if (!raw) return null
  if (raw !== 'reuse' && raw !== 'restart' && raw !== 'cancel') {
    throw new Error(`TRAINER_DESKTOP_CONFLICT_ANSWER only accepts reuse|restart|cancel, got: ${raw}`)
  }
  return raw
}

/** bind 失败原因：EACCES＝系统保留段，其他＝被占用（launcher portUnavailableMessage 口径） */
export function portUnavailableReason(code: string | undefined): 'reserved' | 'occupied' {
  return code === 'EACCES' ? 'reserved' : 'occupied'
}

/** preferred+1 起向上找首个可 bind 端口（preferred 自身从不在候选内）；越界或耗尽返回 null */
export async function pickFallbackPort(
  preferred: number,
  bindCheck: (port: number) => Promise<BindState>,
  attempts: number = FALLBACK_ATTEMPTS,
): Promise<number | null> {
  for (let offset = 1; offset <= attempts; offset += 1) {
    const candidate = preferred + offset
    if (candidate > 65535) return null
    const state = await bindCheck(candidate)
    if (state.ok) return candidate
  }
  return null
}

/** TRAINER_PORT_FALLBACK 严格格式（server/src/config.ts parsePortFallback 同构） */
export function portFallbackEnvValue(fallback: PortFallback | null): string {
  return fallback ? `${fallback.from},${fallback.reason}` : ''
}

export interface PortPlanDeps {
  probeHealth: (port: number) => Promise<HealthProbe>
  bindCheck: (port: number) => Promise<BindState>
  askConflict: (occupant: TrainerIdentity) => Promise<ConflictAnswer>
  killOccupant: (occupant: TrainerIdentity) => Promise<{ exited: boolean; error?: string }>
  fallbackAttempts?: number
}

/** 端口决策编排（探测全部可注入；决策树见 docs/verification/2026-10/PACK-02/design.md §二 S3） */
export async function resolvePortPlan(desiredPort: number, deps: PortPlanDeps): Promise<PortPlan> {
  const probe = await deps.probeHealth(desiredPort)
  const body = probe.responded && probe.status === 200 ? probe.json : null
  if (isTrainerHealthBody(body) && body.pid > 0) {
    const occupant: TrainerIdentity = { pid: body.pid, port: desiredPort, runId: body.runId }
    const answer = await deps.askConflict(occupant)
    if (answer === 'cancel') {
      return { action: 'quit', reason: `conflict-cancel: port ${desiredPort} is served by trainer PID ${occupant.pid}; user chose to exit` }
    }
    if (answer === 'reuse') {
      // 复核：应答期间占用者可能已退出；仍存活→直接用其 URL（绝不启第二个服务进程）
      const recheck = await deps.probeHealth(desiredPort)
      if (recheck.responded && recheck.status === 200 && isTrainerHealthBody(recheck.json)) {
        return {
          action: 'reuse',
          port: desiredPort,
          url: `http://127.0.0.1:${desiredPort}`,
          occupant: { pid: recheck.json.pid, port: desiredPort, runId: recheck.json.runId },
        }
      }
      // 占用者消失 → 落入 bind 裁决
    } else {
      // restart：复核身份一致才杀（不杀不明进程）；杀失败/未退出即中止启动
      const recheck = await deps.probeHealth(desiredPort)
      if (recheck.responded && recheck.status === 200 && isTrainerHealthBody(recheck.json)
        && recheck.json.pid === occupant.pid) {
        const killed = await deps.killOccupant(occupant)
        if (!killed.exited) {
          return {
            action: 'quit',
            reason: `conflict-restart-failed: could not stop trainer PID ${occupant.pid} on port ${desiredPort}${killed.error ? ` (${killed.error})` : ''}; start aborted`,
          }
        }
      }
      // 占用者已消失或身份变化 → 不杀，落入 bind 裁决
    }
  }

  const bind = await deps.bindCheck(desiredPort)
  if (bind.ok) return { action: 'start', port: desiredPort, fallback: null }
  const reason = portUnavailableReason(bind.code)
  const picked = await pickFallbackPort(desiredPort, deps.bindCheck, deps.fallbackAttempts ?? FALLBACK_ATTEMPTS)
  if (picked === null) {
    return {
      action: 'quit',
      reason: `port ${desiredPort} and ${deps.fallbackAttempts ?? FALLBACK_ATTEMPTS} nearby ports above are all unavailable (${reason}); cannot pick a port automatically`,
    }
  }
  return { action: 'start', port: picked, fallback: { from: desiredPort, reason } }
}

// ===== 真实探测实现（main.ts 粘合用；决策函数不依赖此处，单测全部注入桩） =====

const HEALTH_TIMEOUT_MS = 1_200

/** launcher probeHealth 镜像：127.0.0.1 专用、redirect:'error'、仅 200 计身份 */
export async function probeHealthHttp(port: number): Promise<HealthProbe> {
  const url = `http://127.0.0.1:${port}/api/health`
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    let json: unknown = null
    if (response.status === 200) {
      try { json = await response.json() } catch { json = null }
    }
    return { responded: true, refused: false, status: response.status, json }
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause?.code
    return {
      responded: false,
      refused: cause === 'ECONNREFUSED',
      status: null,
      json: null,
    }
  }
}

/** launcher bindCheckPort 镜像：真实 bind 探测（自身先占后放） */
export function bindCheckTcp(port: number): Promise<BindState> {
  return new Promise(resolve => {
    const probe = net.createServer()
    const settle = (result: BindState) => {
      probe.removeAllListeners('listening')
      probe.removeAllListeners('error')
      resolve(result)
    }
    probe.once('error', error => settle({ ok: false, code: (error as NodeJS.ErrnoException).code ?? 'EUNKNOWN' }))
    probe.once('listening', () => { probe.close(() => settle({ ok: true })) })
    probe.listen(port, '127.0.0.1')
  })
}
