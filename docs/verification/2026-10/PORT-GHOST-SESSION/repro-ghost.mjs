// PORT-GHOST-SESSION-QUIT 复现脚本（.repro 式收据；真实 HTTP 边界）
// 场景＝S1 repro2 的僵尸页时序：v1.3.0 server 已接管端口 → v1.2.7 遗留标签页
// 按其 dist 实证行为轮询（旧凭证心跳 403 → catch → rc() 重注册【无 body】）→
// v1.3.0 页（注册带 clientProtocol）发起页内退出 → 观察是否被拖进 awaiting。
//
// 用法：node docs/verification/2026-10/PORT-GHOST-SESSION/repro-ghost.mjs <fixed|prefix>
//   fixed  —— 当前 server/dist 含修复：断言僵尸重注册 426、退出直接 draining、秒级完成
//   prefix —— 修复前构建（先 git stash server/src/api.ts 再 npm run build:server）：
//             断言僵尸重注册 200、退出 awaiting（120s TTL 拖拽的起点），随后取消退出清理
import { DatabaseSync } from 'node:sqlite'
import Fastify from 'fastify'
import { registerApi } from '../../../../server/dist/api.js'
import { migrateDatabase } from '../../../../server/dist/db.js'
import { createDrainController } from '../../../../server/dist/setup/drain-controller.js'

const mode = process.argv[2]
if (mode !== 'fixed' && mode !== 'prefix') {
  console.error('usage: node repro-ghost.mjs <fixed|prefix>')
  process.exit(2)
}
const t0 = Date.now()
const log = (...a) => console.log(`[t+${String(Date.now() - t0).padStart(6)}ms]`, ...a)
const postJson = async (origin, path, body) => {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

const database = new DatabaseSync(':memory:')
migrateDatabase(database)
const app = Fastify()
const config = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: null }
const drain = createDrainController()
let shutdownCalls = 0
await registerApi(app, config, database, {
  drain: drain.gate,
  lifecycle: {
    controller: drain,
    shutdown: async () => {
      shutdownCalls += 1
      await app.close()
      database.close()
    },
  },
})
await app.listen({ port: 0, host: '127.0.0.1' })
config.port = app.server.address().port
const origin = `http://127.0.0.1:${config.port}`
log(`server up on ${origin} (mode=${mode})`)

let exitCode = 0
try {
  // 1. 僵尸页轮询（v1.2.7 dist 实证形状：心跳带旧凭证；rc() 重注册无 body）
  const stale = { sessionId: 'leftover-from-v1.2.7', exitToken: 'gone-with-old-server' }
  const beat = await postJson(origin, '/api/lifecycle/heartbeat', stale)
  log(`zombie heartbeat (stale creds): ${beat.status}`, JSON.stringify(beat.json).slice(0, 160))
  const reregister = await postJson(origin, '/api/lifecycle/session', undefined)
  log(`zombie rc() re-register (no body): ${reregister.status}`, JSON.stringify(reregister.json).slice(0, 160))
  if (mode === 'fixed' && reregister.status !== 426) { log('FAIL: expected 426 refusal'); exitCode = 1 }
  if (mode === 'prefix' && reregister.status !== 200) { log('FAIL: expected 200 pollution'); exitCode = 1 }

  // 2. v1.3.0 页（当前代际）注册并发起页内退出
  const marked = await postJson(origin, '/api/lifecycle/session', { clientProtocol: 2 })
  log(`v1.3.0 page register (clientProtocol 2): ${marked.status}`)
  const exitStartedAt = Date.now()
  const exit = await postJson(origin, '/api/lifecycle/exit', {
    sessionId: marked.json.sessionId, exitToken: marked.json.exitToken,
  })
  log(`page exit view: ${exit.status}`, JSON.stringify(exit.json))

  if (exit.json.phase === 'draining') {
    for (let i = 0; i < 100 && shutdownCalls === 0; i++) await new Promise(r => setTimeout(r, 20))
    const elapsed = Date.now() - exitStartedAt
    log(`shutdown completed in ${elapsed}ms after exit request (no awaiting, no 120s TTL)`)
    if (mode === 'fixed' && elapsed >= 5_000) { log('FAIL: drained too slowly'); exitCode = 1 }
    if (mode === 'prefix') { log('FAIL: prefix build unexpectedly drained immediately'); exitCode = 1 }
  } else if (exit.json.phase === 'awaiting') {
    // 修复前行为：僵尸会话进入活跃集，页面需等全部确认或 120s TTL 失败
    const status = await fetch(`${origin}/api/lifecycle/status`, { headers: { origin } }).then(r => r.json())
    log(`status while dragged: ${JSON.stringify(status)} (would sit here up to 120s TTL)`)
    if (mode === 'prefix' && status.remaining !== 1) { log('FAIL: expected the zombie to block'); exitCode = 1 }
    if (mode === 'fixed') { log('FAIL: fixed build still dragged into awaiting'); exitCode = 1 }
    // 清理：取消本次退出，让脚本收尾
    const cancel = await postJson(origin, '/api/lifecycle/cancel-exit', {
      sessionId: marked.json.sessionId, exitToken: marked.json.exitToken, requestId: exit.json.requestId,
    })
    log(`cleanup cancel-exit: ${JSON.stringify(cancel.json)}`)
  } else {
    log('FAIL: unexpected phase', exit.json.phase)
    exitCode = 1
  }
  log(`outcome mode=${mode}: ${exitCode === 0 ? 'AS_EXPECTED' : 'MISMATCH'}`)
} finally {
  try { if (app.server.listening) await app.close() } catch { /* 已被退出路径关闭 */ }
  try { database.close() } catch { /* 已被退出路径关闭 */ }
  // Windows/libuv：立即 process.exit 会触发拆卸断言噪声污染退出码；让句柄沉降后自然退出
  await new Promise(resolve => setTimeout(resolve, 120))
}
process.exitCode = exitCode
