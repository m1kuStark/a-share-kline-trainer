'use strict'
/**
 * PORT-02 训练器启动/关闭进程治理（launcher-lifecycle 矩阵）行为测试。
 *
 * node:test 独立运行（不进 vitest 套件）：
 *   node --test scripts/release/launcher-lifecycle.test.mjs
 *
 * 纪律约束：
 * - 全程随机端口（listen 0 / freePort），绝不占用 8787，绝不杀非本测试拥有的进程；
 * - 假训练器＝真实 node 子进程（fixture server/dist/index.js，命令行形态与发布包
 *   一致），健康端点返回 { status:'ok', runId, pid } 满足 isTrainerHealth 口径；
 * - Stop 全杀的进程发现经注入的 processEnumerator / portLister（自动化测试不依赖
 *   真实系统扫描做杀决策）；真实 PowerShell 发现路径仅做只读验证（不杀）；
 * - 冲突询问的应答经 --conflict-answer / 注入 askConflict 提供，不弹真实 GUI。
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import launcherModule from './launcher.cjs'

const launcher = launcherModule

const launcherCliPath = fileURLToPath(new URL('./launcher.cjs', import.meta.url))

// 固定包结构的最小替身：真实 Node 进程、动态端口；/api/health 身份与 ready 文件
// 语义对齐发布包 server/dist/index.js。支持 PORT-02 场景模式：
//   trainer（默认）＝健康端点满足 isTrainerHealth；
//   foreign＝健康端点返回非训练器身体（'{"hello":1}'）。
const FIXTURE_SERVER = `
import http from 'node:http'
import { appendFile, writeFile } from 'node:fs/promises'

const counterFile = process.env.FIXTURE_SPAWN_COUNTER
if (counterFile) await appendFile(counterFile, process.pid + '\\n')
const pidFile = process.env.FIXTURE_PID_FILE
if (pidFile) await writeFile(pidFile, String(process.pid))

const mode = process.env.FIXTURE_MODE ?? 'trainer'
const runId = process.env.TRAINER_RUN_ID ?? 'run-00000000-0000-0000-0000-000000000000'
const portFile = process.env.FIXTURE_PORT_FILE
const healthStatus = Number(process.env.FIXTURE_HEALTH_STATUS ?? 200)
const server = http.createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(healthStatus, { 'content-type': 'application/json; charset=utf-8' })
    if (mode === 'foreign') response.end('{"hello":1}\\n')
    else response.end(JSON.stringify({ status: 'ok', runId, pid: process.pid }))
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('fixture\\n')
})
await new Promise(resolveListen => server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', resolveListen))
const address = server.address()
const port = typeof address === 'object' && address ? address.port : 0
if (portFile) await writeFile(portFile, String(port))
const readyFile = process.env.TRAINER_READY_FILE
if (readyFile) await writeFile(readyFile, JSON.stringify({ runId, pid: process.pid, port, baseURL: 'http://127.0.0.1:' + port }))
setInterval(() => {}, 1 << 30)
`

const FIXTURE_DIR_NAME = 'rel launch 容器 pkg'
const NODE_BINARY = process.platform === 'win32' ? 'node.exe' : 'node'

// ---- 清理台账：句柄杀 + 裸 PID 仅在健康身份仍然吻合时杀（PID 复用不误伤）----
/** @type {import('node:child_process').ChildProcess[]} */ const activeChildren = []
/** @type {{pid:number,port:number,runId:string}[]} */ const activeServers = []
/** @type {string[]} */ const activeRoots = []

after(async () => {
  const children = activeChildren.splice(0)
  for (const child of children) {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    } catch { /* already gone */ }
  }
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise(resolveGone => {
        child.once('exit', resolveGone)
        setTimeout(resolveGone, 3_000)
      })
    }
  }
  const servers = activeServers.splice(0)
  for (const server of servers) {
    if (!launcher.pidAlive(server.pid)) continue
    const probe = await launcher.probeHealth(server.port, { timeoutMs: 2_000 })
    if (launcher.probeMatchesState(probe, { runId: server.runId, pid: server.pid })) {
      try { process.kill(server.pid, 'SIGKILL') } catch { /* already gone */ }
    }
  }
  for (const server of servers) {
    for (let attempt = 0; attempt < 50 && launcher.pidAlive(server.pid); attempt++) await delay(100)
  }
  for (const root of activeRoots.splice(0)) await rm(root, { recursive: true, force: true }).catch(() => {})
}, 60_000)

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (!launcher.pidAlive(pid)) return
    await delay(100)
  }
}

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'port02-life-'))
  const root = join(base, FIXTURE_DIR_NAME)
  activeRoots.push(base)
  await mkdir(join(root, 'runtime'), { recursive: true })
  await mkdir(join(root, 'server', 'dist'), { recursive: true })
  await mkdir(join(root, 'web', 'dist'), { recursive: true })
  const nodeTarget = join(root, 'runtime', NODE_BINARY)
  try {
    await link(process.execPath, nodeTarget)
  } catch {
    await copyFile(process.execPath, nodeTarget)
  }
  await Promise.all([
    writeFile(join(root, 'release.json'), JSON.stringify({ appId: launcher.APP_ID, version: '0.4.0-test', gitCommit: 'fixture-port02' })),
    writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', version: '0.4.0-test' })),
    writeFile(join(root, 'server', 'dist', 'index.js'), FIXTURE_SERVER),
    writeFile(join(root, 'web', 'dist', 'index.html'), '<!doctype html><title>fixture</title>'),
  ])
  return root
}

async function freePort() {
  const probe = http.createServer()
  await new Promise(resolveListen => probe.listen(0, '127.0.0.1', resolveListen))
  const address = probe.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise(resolveClose => probe.close(() => resolveClose()))
  assert.ok(port > 0 && port !== 8787)
  return port
}

function sanitizedEnv(overrides = {}) {
  return { ...process.env, NODE_OPTIONS: '', TDX_ROOT: '', TRAINER_DB: '', ...overrides }
}

async function writeConfig(root, fields) {
  // 夹具前置：FIXTURE_SPAWN_COUNTER 等 env 目标文件位于 dataDir，孤儿进程先于
  // launch 启动时该目录尚不存在——先建目录，避免夹具进程写计数文件时 ENOENT 退出。
  if (typeof fields.dataDir === 'string') await mkdir(fields.dataDir, { recursive: true })
  await writeFile(join(root, 'trainer.config.json'), JSON.stringify(fields))
}

/**
 * 直接拉起一个"孤儿训练器"：真实 node 进程跑 fixture server/dist/index.js，
 * 命令行形态与发布包服务进程一致（供停止扫描的候选口径使用）。返回其
 * pid/port/runId；进程句柄入清理台账。
 */
async function spawnOrphanTrainer(root, { port, mode = 'trainer', runId = `run-orphan-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`, env = {} } = {}) {
  const portFile = join(root, `orphan-port-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.txt`)
  const child = spawn(process.execPath, [join(root, 'server', 'dist', 'index.js')], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
    env: sanitizedEnv({ ...env, PORT: String(port ?? 0), FIXTURE_MODE: mode, TRAINER_RUN_ID: runId, FIXTURE_PORT_FILE: portFile }),
  })
  activeChildren.push(child)
  for (let attempt = 0; attempt < 100; attempt++) {
    const text = await readFile(portFile, 'utf8').catch(() => null)
    if (text !== null) {
      const actualPort = Number(text)
      await rm(portFile, { force: true }).catch(() => {})
      const record = { pid: child.pid, port: actualPort, runId }
      activeServers.push(record)
      return record
    }
    await delay(50)
  }
  throw new Error(`orphan trainer did not report its port (pid ${child.pid})`)
}

async function launchOwned(root, envOverrides = {}, options = {}) {
  const result = await launcher.launch({
    root,
    openBrowser: false,
    env: sanitizedEnv(envOverrides),
    startTimeoutMs: 15_000,
    lockWaitMs: 3_000,
    ...options,
  })
  if (!result.reused) activeServers.push({ pid: result.pid, port: result.port, runId: result.runId })
  return result
}

async function stopOwned(root, options = {}) {
  return launcher.stop({
    root,
    env: sanitizedEnv(),
    lockWaitMs: 4_000,
    exitTimeoutMs: 5_000,
    ...options,
  })
}

async function readMaybe(path) {
  return readFile(path, 'utf8').catch(error => (error && error.code === 'ENOENT' ? null : Promise.reject(error)))
}

async function fetchHealth(base) {
  const url = new URL('/api/health', base)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error(`unexpected health target: ${url}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
  return { status: response.status, body: await response.json() }
}

function counterPath(dataDir) {
  return join(dataDir, 'spawns.txt')
}

async function counterLines(path) {
  const text = await readMaybe(path)
  return text === null || text.trim() === '' ? 0 : text.trim().split('\n').length
}

/** 以真实 CLI 子进程运行 launcher（不经进程内注入的路径）。 */
function runCli(args, env, timeoutMs = 30_000) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [launcherCliPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      rejectRun(new Error(`CLI timed out after ${timeoutMs}ms: node launcher.cjs ${args.join(' ')}`))
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', error => { clearTimeout(timer); rejectRun(error) })
    child.once('exit', code => { clearTimeout(timer); resolveRun({ code, stdout, stderr }) })
  })
}

// ============================ START 冲突询问 ============================

test('START-CONFLICT-TRAINER-ASK: launch without an answer throws a decision request, keeps the occupant alive and spawns nothing', { timeout: 45_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })
  const counter = counterPath(dataDir)
  const orphan = await spawnOrphanTrainer(root, { port, env: { FIXTURE_SPAWN_COUNTER: counter } })

  const failure = await launcher.launch({
    root, openBrowser: false, env: sanitizedEnv({ FIXTURE_SPAWN_COUNTER: counter }),
    startTimeoutMs: 15_000, lockWaitMs: 3_000,
  }).then(() => null, error => error)
  assert.ok(failure instanceof Error, 'launch must not succeed while a foreign trainer holds the port')
  assert.equal(failure.code, 'TRAINER_CONFLICT_ASK')
  assert.equal(failure.occupant.port, port)
  assert.equal(failure.occupant.pid, orphan.pid)
  assert.equal(failure.occupant.runId, orphan.runId)
  assert.match(failure.message, /没有对应的启动状态|without launcher state/)

  // 获得应答前：不杀占用者、不启第二个进程、不写 state
  assert.equal(launcher.pidAlive(orphan.pid), true)
  assert.equal(await counterLines(counter), 1)
  assert.equal(await readMaybe(join(dataDir, 'trainer-state.json')), null)
})

test('START-CONFLICT-TRAINER-ASK (CLI): main asks via the injected ask and honors the reuse answer', { timeout: 45_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })
  const counter = counterPath(dataDir)
  const orphan = await spawnOrphanTrainer(root, { port, env: { FIXTURE_SPAWN_COUNTER: counter } })

  const previousExitCode = process.exitCode
  let asked = null
  const openedUrls = []
  try {
    // 不带 --no-open：复用语义要求打开已有服务 URL；真实浏览器被注入的 urlOpener 替换
    await launcher.main(['--root', root], {
      env: sanitizedEnv({ FIXTURE_SPAWN_COUNTER: counter }),
      askConflict: async occupant => { asked = occupant; return 'reuse' },
      urlOpener: async url => { openedUrls.push(url); return true },
    })
    assert.ok(asked, 'the ask must receive the occupant identity')
    assert.equal(asked.pid, orphan.pid)
    assert.equal(asked.port, port)
    assert.equal(asked.runId, orphan.runId)
    assert.deepEqual(openedUrls, [`http://127.0.0.1:${port}`])
    assert.equal(launcher.pidAlive(orphan.pid), true)
    assert.equal(await counterLines(counter), 1, 'reuse must not spawn a second server process')
    assert.equal(await readMaybe(join(dataDir, 'trainer-state.json')), null)
    assert.notEqual(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})

// ============================ START 确认＝复用 ============================

test('START-REUSE-CONFIRMED: a confirmed reuse opens the existing service URL and starts no second process', { timeout: 45_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })
  const counter = counterPath(dataDir)
  const orphan = await spawnOrphanTrainer(root, { port, env: { FIXTURE_SPAWN_COUNTER: counter } })

  const openedUrls = []
  const result = await launchOwned(root, { FIXTURE_SPAWN_COUNTER: counter }, {
    openBrowser: true,
    conflictAnswer: 'reuse',
    urlOpener: async url => { openedUrls.push(url); return true },
  })
  assert.equal(result.reused, true)
  assert.equal(result.url, `http://127.0.0.1:${port}`)
  assert.equal(result.pid, orphan.pid)
  assert.equal(result.runId, orphan.runId)
  assert.deepEqual(openedUrls, [`http://127.0.0.1:${port}`])
  assert.equal(launcher.pidAlive(orphan.pid), true)
  assert.equal(await counterLines(counter), 1)
  assert.equal(await readMaybe(join(dataDir, 'trainer-state.json')), null)
})

test('START-REUSE-CONFIRMED (CLI): --conflict-answer=reuse exits 0 without spawning', { timeout: 45_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })
  const counter = counterPath(dataDir)
  const orphan = await spawnOrphanTrainer(root, { port, env: { FIXTURE_SPAWN_COUNTER: counter } })

  const run = await runCli(['--root', root, '--conflict-answer=reuse', '--no-open'], sanitizedEnv({ FIXTURE_SPAWN_COUNTER: counter }))
  assert.equal(run.code, 0, `stdout=${run.stdout}\nstderr=${run.stderr}`)
  assert.match(run.stdout, /复用|reusing/)
  assert.equal(launcher.pidAlive(orphan.pid), true)
  assert.equal(await counterLines(counter), 1)
  assert.equal(await readMaybe(join(dataDir, 'trainer-state.json')), null)
})

test('START-REUSE-CONFIRMED: falls back to a fresh start when the occupant exits during the ask', { timeout: 45_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })
  const counter = counterPath(dataDir)
  const orphan = await spawnOrphanTrainer(root, { port, env: { FIXTURE_SPAWN_COUNTER: counter } })

  // 用户应答前占用者自行退出：reuse 应答回退为新进程启动，而不是失败或弹错
  const orphanPid = orphan.pid
  const orphanIndex = activeServers.findIndex(entry => entry.pid === orphanPid)
  if (orphanIndex >= 0) activeServers.splice(orphanIndex, 1)
  process.kill(orphanPid, 'SIGKILL')
  await waitForExit(orphanPid)

  const result = await launchOwned(root, { FIXTURE_SPAWN_COUNTER: counter }, { conflictAnswer: 'reuse' })
  assert.equal(result.reused, false)
  assert.notEqual(result.pid, orphanPid)
  assert.equal(result.port, port)
  assert.equal(await counterLines(counter), 2, 'orphan + fresh start')
  const state = JSON.parse(await readFile(join(dataDir, 'trainer-state.json'), 'utf8'))
  assert.equal(state.pid, result.pid)
  assert.equal(state.runId, result.runId)
})

// ============================ START 拒绝＝清理后重启 ============================

test('START-KILL-RESTART-DECLINED: a declined answer kills the verified occupant and starts a fresh server', { timeout: 60_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })
  const counter = counterPath(dataDir)
  const orphan = await spawnOrphanTrainer(root, { port, env: { FIXTURE_SPAWN_COUNTER: counter } })
  const orphanPid = orphan.pid
  const orphanIndex = activeServers.findIndex(entry => entry.pid === orphanPid)
  if (orphanIndex >= 0) activeServers.splice(orphanIndex, 1)

  const result = await launchOwned(root, { FIXTURE_SPAWN_COUNTER: counter }, { conflictAnswer: 'restart' })
  assert.equal(result.reused, false)
  assert.notEqual(result.pid, orphanPid)
  assert.equal(result.port, port)
  await waitForExit(orphanPid)
  assert.equal(launcher.pidAlive(orphanPid), false)
  assert.equal(await counterLines(counter), 2)
  const health = await fetchHealth(result.url)
  assert.equal(health.body.pid, result.pid)
  assert.equal(health.body.runId, result.runId)
  const state = JSON.parse(await readFile(join(dataDir, 'trainer-state.json'), 'utf8'))
  assert.equal(state.pid, result.pid)
  assert.equal(state.runId, result.runId)
  assert.equal(state.port, port)
})

test('START-KILL-RESTART-DECLINED (CLI): main asks and restarts after killing the occupant', { timeout: 60_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })
  const counter = counterPath(dataDir)
  const orphan = await spawnOrphanTrainer(root, { port, env: { FIXTURE_SPAWN_COUNTER: counter } })
  const orphanPid = orphan.pid
  const orphanIndex = activeServers.findIndex(entry => entry.pid === orphanPid)
  if (orphanIndex >= 0) activeServers.splice(orphanIndex, 1)

  const previousExitCode = process.exitCode
  let asked = null
  try {
    await launcher.main(['--root', root, '--no-open'], {
      env: sanitizedEnv({ FIXTURE_SPAWN_COUNTER: counter }),
      askConflict: async occupant => { asked = occupant; return 'restart' },
    })
    assert.equal(asked.pid, orphanPid)
    assert.notEqual(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
  await waitForExit(orphanPid)
  assert.equal(launcher.pidAlive(orphanPid), false)
  const state = JSON.parse(await readMaybe(join(dataDir, 'trainer-state.json')))
  assert.ok(state, 'a fresh server must be recorded after the restart answer')
  assert.notEqual(state.pid, orphanPid)
  assert.equal(await counterLines(counter), 2)
})

// ============================ START 非训练器占用（语义不变） ============================

test('START-CONFLICT-NONTRAINER: a non-trainer occupant keeps the explicit-port refusal and never asks', { timeout: 45_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })
  const counter = counterPath(dataDir)

  const occupant = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end('{"hello":1}\n')
  })
  await new Promise(resolveListen => occupant.listen(port, '127.0.0.1', resolveListen))
  try {
    const failure = await launcher.launch({
      root, openBrowser: false, env: sanitizedEnv({ FIXTURE_SPAWN_COUNTER: counter }),
      startTimeoutMs: 15_000, lockWaitMs: 3_000,
    }).then(() => null, error => error)
    assert.ok(failure instanceof Error)
    assert.notEqual(failure.code, 'TRAINER_CONFLICT_ASK', 'non-trainer occupants never reach the conflict ask')
    assert.match(failure.message, /被其他程序占用|occupied by another program/)
    const text = await (await fetch(new URL(`http://127.0.0.1:${port}/`))).text()
    assert.match(text, /hello/)
    assert.equal(await counterLines(counter), 0)
    assert.equal(await readMaybe(join(dataDir, 'trainer-state.json')), null)
  } finally {
    await new Promise(resolveClose => occupant.close(() => resolveClose()))
  }
})

// ============================ STOP 全杀已验证训练器 ============================

test('STOP-KILL-ALL-TRAINER: stop with allTrainers kills the recorded server and a state-less orphan in one pass', { timeout: 60_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })

  const own = await launchOwned(root)
  const orphan = await spawnOrphanTrainer(root, { port: await freePort() })
  const orphanPid = orphan.pid
  const orphanIndex = activeServers.findIndex(entry => entry.pid === orphanPid)
  if (orphanIndex >= 0) activeServers.splice(orphanIndex, 1)

  const result = await stopOwned(root, {
    allTrainers: true,
    processEnumerator: async () => ({
      available: true,
      processes: [{ pid: orphanPid, commandLine: `"${process.execPath}" "${join(root, 'server', 'dist', 'index.js')}"` }],
    }),
    portLister: async pid => (pid === orphanPid ? [orphan.port] : []),
  })

  assert.equal(result.stopped, true, 'recorded server must still be stopped through the recorded path')
  assert.equal(result.pid, own.pid)
  assert.ok(Array.isArray(result.kills) && result.kills.length === 2, `kills=${JSON.stringify(result.kills)}`)
  assert.deepEqual(result.kills.map(entry => entry.pid), [own.pid, orphanPid])
  for (const entry of result.kills) {
    assert.equal(entry.exited, true)
    assert.equal(entry.portDrained, true)
  }
  await waitForExit(own.pid)
  await waitForExit(orphanPid)
  assert.equal(launcher.pidAlive(own.pid), false)
  assert.equal(launcher.pidAlive(orphanPid), false)
  assert.equal(await readMaybe(join(dataDir, 'trainer-state.json')), null)
})

test('STOP discovery (read-only): real PowerShell enumeration finds the trainer-cmdline fixture process and its listening port', { timeout: 60_000 }, async t => {
  const root = await makeFixture()
  const orphan = await spawnOrphanTrainer(root, { port: await freePort() })

  // 候选命令行口径（发布包两种形态＋正斜杠/引号变体；非训练器命令行不匹配）
  assert.equal(launcher.isTrainerCandidateCommandLine(`"${process.execPath}" "${join(root, 'server', 'dist', 'index.js')}"`), true)
  assert.equal(launcher.isTrainerCandidateCommandLine(`/opt/node /opt/kline-trainer-v1.2.7-windows-x64/server/dist/index.js`), true)
  assert.equal(launcher.isTrainerCandidateCommandLine(`node.exe C:\\pkg\\kline-trainer-v1.2.7-windows-x64\\launcher.cjs --stop`), true)
  assert.equal(launcher.isTrainerCandidateCommandLine(`node.exe C:\\pkg\\launcher-lifecycle.test.mjs`), false)
  assert.equal(launcher.isTrainerCandidateCommandLine(`node.exe C:\\pkg\\server\\dist\\index-other.js`), false)
  assert.equal(launcher.isTrainerCandidateCommandLine(''), false)

  const listing = await launcher.enumerateNodeProcessesPS()
  if (!listing.available) return t.skip(`PowerShell enumeration unavailable: ${listing.reason}`)
  const entry = listing.processes.find(candidate => candidate.pid === orphan.pid)
  assert.ok(entry, `fixture process (pid ${orphan.pid}) must be listed by the real enumeration`)
  assert.equal(launcher.isTrainerCandidateCommandLine(entry.commandLine), true)

  const ports = await launcher.listListenPortsPS(orphan.pid)
  assert.ok(Array.isArray(ports) && ports.includes(orphan.port), `ports=${JSON.stringify(ports)} expected to include ${orphan.port}`)
  // 只读验证：本测试绝不杀任何进程；孤儿由清理台账按句柄结束。
})

// ============================ STOP 不明进程不杀 ============================

test('STOP-SPARE-UNKNOWN: unverified candidates are never signaled and are reported as spared', { timeout: 60_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  await writeConfig(root, { dataDir })

  const foreign = await spawnOrphanTrainer(root, { port: await freePort(), mode: 'foreign' })
  const noListen = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore', windowsHide: true, env: sanitizedEnv() })
  activeChildren.push(noListen)
  await delay(300) // 让无监听进程存活过枚举时刻

  const result = await stopOwned(root, {
    allTrainers: true,
    processEnumerator: async () => ({
      available: true,
      processes: [
        { pid: foreign.pid, commandLine: `"${process.execPath}" "${join(root, 'server', 'dist', 'index.js')}"` },
        { pid: noListen.pid, commandLine: `node.exe C:\\somewhere\\launcher.cjs` },
      ],
    }),
    portLister: async pid => (pid === foreign.pid ? [foreign.port] : []),
  })

  assert.equal(result.stopped, false)
  assert.equal(result.noop, 'no-state')
  assert.deepEqual(result.kills, [])
  const sparedPids = result.spared.map(entry => entry.pid)
  assert.deepEqual(sparedPids.sort((a, b) => a - b), [foreign.pid, noListen.pid].sort((a, b) => a - b))
  const foreignEntry = result.spared.find(entry => entry.pid === foreign.pid)
  const noListenEntry = result.spared.find(entry => entry.pid === noListen.pid)
  assert.equal(foreignEntry.reason, 'health-unverified')
  assert.equal(noListenEntry.reason, 'no-listening-port')
  assert.equal(launcher.pidAlive(foreign.pid), true, 'unverified occupants must stay alive')
  assert.equal(launcher.pidAlive(noListen.pid), true, 'candidates without a listening port must stay alive')
})

// ============================ STOP 杀后未确认退出＝如实报告 ============================

test('STOP-KILL-VERIFY-FAIL: an unconfirmed exit is reported as failure and the CLI exits non-zero', { timeout: 60_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  await writeConfig(root, { dataDir })

  const orphanA = await spawnOrphanTrainer(root, { port: await freePort() })
  const orphanB = await spawnOrphanTrainer(root, { port: await freePort() })
  for (const pid of [orphanA.pid, orphanB.pid]) {
    const index = activeServers.findIndex(entry => entry.pid === pid)
    if (index >= 0) activeServers.splice(index, 1)
  }
  const pidAliveLying = pid => (pid === orphanA.pid || pid === orphanB.pid ? true : launcher.pidAlive(pid))

  // 库层：杀已发出但退出无法确认（注入 pidAlive 恒活模拟），报告 exited=false 而非成功
  const enumerator = async () => ({
    available: true,
    processes: [
      { pid: orphanA.pid, commandLine: `"node" "${join(root, 'server', 'dist', 'index.js')}"` },
      { pid: orphanB.pid, commandLine: `"node" "${join(root, 'server', 'dist', 'index.js')}"` },
    ],
  })
  const portLister = async pid => (pid === orphanA.pid ? [orphanA.port] : pid === orphanB.pid ? [orphanB.port] : [])
  const result = await stopOwned(root, {
    allTrainers: true, processEnumerator: enumerator, portLister,
    pidAliveImpl: pidAliveLying, exitTimeoutMs: 400,
  })
  assert.equal(result.kills.length, 2)
  for (const entry of result.kills) assert.equal(entry.exited, false, `kill of ${entry.pid} must not be reported as confirmed`)

  await waitForExit(orphanA.pid)
  await waitForExit(orphanB.pid)

  // CLI 层：任一杀未确认 → 非零退出码（不假报成功）
  const orphanC = await spawnOrphanTrainer(root, { port: await freePort() })
  const orphanCIndex = activeServers.findIndex(entry => entry.pid === orphanC.pid)
  if (orphanCIndex >= 0) activeServers.splice(orphanCIndex, 1)
  const previousExitCode = process.exitCode
  try {
    await launcher.main(['--stop', '--root', root], {
      env: sanitizedEnv(),
      processEnumerator: async () => ({ available: true, processes: [{ pid: orphanC.pid, commandLine: `node "x/server/dist/index.js"` }] }),
      portLister: async pid => (pid === orphanC.pid ? [orphanC.port] : []),
      pidAliveImpl: pid => (pid === orphanC.pid ? true : launcher.pidAlive(pid)),
      exitTimeoutMs: 400,
    })
    assert.equal(process.exitCode, 1, 'unconfirmed kills must exit non-zero')
  } finally {
    process.exitCode = previousExitCode
  }
  await waitForExit(orphanC.pid)
})

// ============================ 询问通道：PowerShell → 控制台回退 ============================

test('ASK-FALLBACK-CONSOLE: PowerShell MessageBox maps Yes/No to reuse/restart from a BOM ps1 script that is cleaned up', { timeout: 30_000 }, async () => {
  let sawScript = null
  let sawScriptPath = null
  const runWith = async stdout => {
    sawScript = null
    sawScriptPath = null
    const powershellRunner = async args => {
      const fileArg = args.find(argument => argument && argument.endsWith('.ps1'))
      if (fileArg) {
        sawScriptPath = fileArg
        sawScript = await readFile(fileArg, 'utf8')
      }
      return { ok: true, code: 0, stdout }
    }
    const answer = await launcher.askConflictReuseOrRestart(
      { pid: 4242, port: 8787, runId: 'run-x', baseURL: 'http://127.0.0.1:8787' },
      { powershellRunner, consoleAsk: async () => { throw new Error('console must not be reached when PowerShell answers') } },
    )
    return answer
  }
  const yes = await runWith('6\n')
  assert.equal(yes, 'reuse')
  assert.ok(sawScript && sawScript.startsWith('\uFEFF'), 'ps1 must be written with a UTF-8 BOM')
  assert.match(sawScript, /是否从已有进程启动训练器/)
  assert.match(sawScript, /8787/)
  assert.match(sawScript, /4242/)
  // 询问结束后临时脚本必须清理
  assert.equal(await readMaybe(sawScriptPath), null, 'the temp ps1 must be removed after the ask')
  const no = await runWith('7\n')
  assert.equal(no, 'restart')
  assert.equal(await readMaybe(sawScriptPath), null)
})

test('ASK-FALLBACK-CONSOLE: a failing or garbage PowerShell falls back to the console prompt', { timeout: 30_000 }, async () => {
  const occupant = { pid: 1111, port: 9999, runId: 'run-y', baseURL: 'http://127.0.0.1:9999' }
  const consoleCalls = []

  const failing = await launcher.askConflictReuseOrRestart(occupant, {
    powershellRunner: async () => ({ ok: false, code: 1, stdout: '' }),
    consoleAsk: async message => { consoleCalls.push(message); return 'restart' },
  })
  assert.equal(failing, 'restart')
  assert.equal(consoleCalls.length, 1)
  assert.match(consoleCalls[0], /是否从已有进程启动训练器/)

  const garbage = await launcher.askConflictReuseOrRestart(occupant, {
    powershellRunner: async () => ({ ok: true, code: 0, stdout: 'garbage' }),
    consoleAsk: async message => { consoleCalls.push(message); return 'reuse' },
  })
  assert.equal(garbage, 'reuse')
  assert.equal(consoleCalls.length, 2)
})

test('ASK-FALLBACK-CONSOLE: with both ask channels unavailable the launch aborts without touching any process', { timeout: 45_000 }, async () => {
  const root = await makeFixture()
  const dataDir = join(root, '数 据 dir')
  const port = await freePort()
  await writeConfig(root, { port, dataDir })
  const counter = counterPath(dataDir)
  const orphan = await spawnOrphanTrainer(root, { port, env: { FIXTURE_SPAWN_COUNTER: counter } })

  const previousExitCode = process.exitCode
  try {
    await launcher.main(['--root', root, '--no-open'], {
      env: sanitizedEnv({ FIXTURE_SPAWN_COUNTER: counter }),
      askConflict: async () => { throw new Error('simulated: both PowerShell and console unavailable') },
    })
    assert.equal(process.exitCode, 1, 'an unanswered conflict must abort the launch with a non-zero exit')
  } finally {
    process.exitCode = previousExitCode
  }
  assert.equal(launcher.pidAlive(orphan.pid), true, 'no process may be killed when the ask fails')
  assert.equal(await counterLines(counter), 1, 'no second server process may be spawned when the ask fails')
  assert.equal(await readMaybe(join(dataDir, 'trainer-state.json')), null)
})
