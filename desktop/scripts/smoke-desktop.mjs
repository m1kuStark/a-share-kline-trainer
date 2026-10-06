#!/usr/bin/env node
// PACK-01/02 便携 exe 打包冒烟（门禁判据；PACK-02 扩展生命周期断言）：
//   ① 便携 exe → 复制到未跟踪临时目录 → 启动 → /api/health 200 且 currentVersion 存在
//   ② web 首页 HTML 可达 → 窗口存在（标题「K线训练器」）
//   ③ 第二实例：同 exe 再启动 → 限时自然退出（单实例锁）且首实例存活
//   ④ 优雅退出（替代 PACK-01 强杀）：CloseMainWindow → 自然退出（exit 0）→ 端口可重绑＋health 拒连（无孤儿）
//   ⑤ 冲突 restart 注入：假训练器（独立 node 进程，isTrainerHealth 身份）占随机端口 →
//      TRAINER_DESKTOP_CONFLICT_ANSWER=restart → 假占用者被结束 → exe 自己的服务接管该端口
// 隔离铁律：TRAINER_DATA_DIR/TRAINER_DB 指向临时目录，绝不触碰真实用户数据
// （%USERPROFILE%\.a-share-kline-trainer 或任何既有 zip 包的 data/）；TDX_ROOT 置空；
// 全程动态/随机端口，绝不动 8787 真实占用者；CloseMainWindow 只发给我们进程树的子进程。
// 用法：node desktop/scripts/smoke-desktop.mjs --exe <便携exe路径> [--keep]
import { spawn, execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, rm, stat, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import net from 'node:net'

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const exeIndex = args.indexOf('--exe')
const exeArg = exeIndex >= 0 ? args[exeIndex + 1] : null
if (!exeArg) {
  console.error('usage: node desktop/scripts/smoke-desktop.mjs --exe <portable-exe-path> [--keep]')
  process.exit(1)
}

const HEALTH_TIMEOUT_MS = 120_000
const SECOND_INSTANCE_TIMEOUT_MS = 90_000
const GRACEFUL_EXIT_TIMEOUT_MS = 60_000
const CONFLICT_TAKEOVER_TIMEOUT_MS = 120_000
const KILL_TIMEOUT_MS = 30_000
const OVERALL_TIMEOUT_MS = 480_000
const WINDOW_TITLE = 'K线训练器'

function log(step, detail) {
  console.log(`[smoke] ${step}${detail ? `: ${detail}` : ''}`)
}

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function fetchJson(url, timeoutMs = 5_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  const text = await response.text()
  return { status: response.status, text }
}

function canBindLoopback(port) {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => { probe.close(() => resolve(true)) })
    probe.listen(port, '127.0.0.1')
  })
}

function windowTitleCount(title) {
  try {
    const command = `(Get-Process | Where-Object { $_.MainWindowTitle -eq '${title}' } | Measure-Object).Count`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15_000 })
    return Number(out.trim())
  } catch (error) {
    return -1
  }
}

/** 只向我们进程树（root pid 的直接子进程）里的窗口发 WM_CLOSE——绝不触碰用户真实实例 */
function closeMainWindowOfChildren(rootPid) {
  try {
    const command = `$kids = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${rootPid} };`
      + ` $closed = 0; foreach ($k in $kids) { try { $p = Get-Process -Id $k.ProcessId -ErrorAction Stop;`
      + ` if ($p.CloseMainWindow()) { $closed += 1 } } catch {} }; Write-Output $closed`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 20_000 })
    return Number(out.trim())
  } catch (error) {
    return -1
  }
}

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: KILL_TIMEOUT_MS })
    return true
  } catch (error) {
    log('kill', `taskkill failed: ${error.message}`)
    return false
  }
}

function waitForExit(child, timeoutMs, label) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ exited: false, code: null, label }), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ exited: true, code: signal ? null : code, label })
    })
    if (child.exitCode !== null) {
      clearTimeout(timer)
      resolve({ exited: true, code: child.exitCode, label })
    }
  })
}

/** 假训练器占用者：独立 node 子进程，/api/health 回 isTrainerHealth 身份（pid=自身） */
function spawnFakeTrainer(port) {
  const script = [
    "const http = require('http')",
    'const server = http.createServer((req, res) => {',
    "  if (req.url === '/api/health') {",
    "    res.writeHead(200, { 'content-type': 'application/json' })",
    "    res.end(JSON.stringify({ status: 'ok', runId: 'run-fake-occupant', pid: process.pid }))",
    '    return',
    '  }',
    "  res.writeHead(404, { 'content-type': 'application/json' })",
    "  res.end(JSON.stringify({ error: 'NOT_FOUND' }))",
    '})',
    "server.listen(Number(process.argv[1]), '127.0.0.1', () => { process.stdout.write('FAKE_READY') })",
  ].join('\n')
  return spawn(process.execPath, ['-e', script, String(port)], {
    cwd: tmpdir(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

const startedAt = Date.now()
let tempDir = null
let failures = 0
const cleanups = []
const openLogHandles = []

async function openStderrLog(logName) {
  const handle = await open(join(tempDir, logName), 'a')
  openLogHandles.push(handle)
  return handle
}

async function runSmoke() {
  const exeStat = await stat(exeArg)
  log('exe', `${exeArg} (${(exeStat.size / 1024 / 1024).toFixed(1)} MB)`)

  tempDir = await mkdtemp(join(tmpdir(), 'pack02-smoke-'))
  const copiedExe = join(tempDir, basename(exeArg))
  await copyFile(exeArg, copiedExe)
  log('copy', copiedExe)

  const port = await freeLoopbackPort()
  const dataDir = join(tempDir, 'data')
  log('port', `port=${port} dataDir=${dataDir}`)

  const spawnExe = async (overrides = {}, logName = 'exe-main-stderr.log') => {
    const stderrLog = await openStderrLog(logName)
    return spawn(copiedExe, [], {
      cwd: tempDir,
      stdio: ['ignore', 'ignore', stderrLog.fd],
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port),
        TRAINER_DATA_DIR: dataDir,
        TRAINER_DB: join(dataDir, 'trainer.sqlite'),
        TDX_ROOT: '',
        OPEN_BROWSER: '0',
        ...overrides,
      },
    })
  }

  // ===== 阶段 A：主实例启动 =====
  const spawnedAt = Date.now()
  const main = await spawnExe()
  cleanups.push(() => killTree(main.pid))
  const overallTimer = setTimeout(() => {
    log('timeout', `overall ${OVERALL_TIMEOUT_MS}ms exceeded; force killing`)
    for (const cleanup of cleanups) cleanup()
    process.exitCode = 1
  }, OVERALL_TIMEOUT_MS)

  const awaitHealth = async (targetPort) => {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    for (;;) {
      try {
        const probe = await fetchJson(`http://127.0.0.1:${targetPort}/api/health`, 3_000)
        if (probe.status === 200) return JSON.parse(probe.text)
      } catch { /* not up yet */ }
      if (main.exitCode !== null) throw new Error(`exe exited during startup with code ${main.exitCode}`)
      if (Date.now() > deadline) throw new Error(`health not reachable within ${HEALTH_TIMEOUT_MS}ms on port ${targetPort}`)
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  const health = await awaitHealth(port)
  const bootSeconds = ((Date.now() - spawnedAt) / 1000).toFixed(1)
  if (health.status !== 'ok') { failures++; log('health', `UNEXPECTED status=${health.status}`) }
  if (typeof health.currentVersion !== 'string' || health.currentVersion.trim() === '') {
    failures++; log('health', 'MISSING currentVersion')
  } else {
    log('health', `200 status=ok currentVersion=${health.currentVersion} pid=${health.pid} runId=${health.runId} boot=${bootSeconds}s`)
  }

  // ===== 阶段 B：web 首页＋窗口存在 =====
  const page = await fetchJson(`http://127.0.0.1:${port}/`, 5_000)
  const isHtml = page.status === 200 && /<html/i.test(page.text) && /id="app"/i.test(page.text)
  if (!isHtml) { failures++; log('page', `UNEXPECTED status=${page.status} html=${/<html/i.test(page.text)}`) }
  else log('page', `200 html ok (${page.text.length} bytes)`)

  const titles = windowTitleCount(WINDOW_TITLE)
  if (titles === -1) log('window', 'powershell unavailable; window check DEGRADED (recorded, not asserted)')
  else if (titles < 1) { failures++; log('window', `NO window titled ${WINDOW_TITLE} (count=${titles})`) }
  else log('window', `window titled ${WINDOW_TITLE} present (count=${titles})`)

  // ===== 阶段 C：第二实例（单实例锁）——启动即退＋首实例存活 =====
  const second = await spawnExe({}, 'exe-second-stderr.log')
  const secondResult = await waitForExit(second, SECOND_INSTANCE_TIMEOUT_MS, 'second-instance')
  if (!secondResult.exited) {
    failures++; log('second-instance', `FAILED second instance did not exit within ${SECOND_INSTANCE_TIMEOUT_MS}ms`)
    killTree(second.pid)
  } else if (secondResult.code !== 0) {
    failures++; log('second-instance', `FAILED second instance exit code ${secondResult.code} (expected 0)`)
  } else {
    log('second-instance', `exited promptly with code 0 (single-instance lock honored)`)
  }
  const stillAlive = await fetchJson(`http://127.0.0.1:${port}/api/health`, 5_000).then(r => r.status === 200).catch(() => false)
  if (!stillAlive) { failures++; log('second-instance', 'FAILED first instance no longer healthy after second launch') }
  else log('second-instance', 'first instance still healthy')

  // ===== 阶段 D：优雅退出——CloseMainWindow → 自然退出 → 端口释放（替代强杀） =====
  const closedWindows = closeMainWindowOfChildren(main.pid)
  if (closedWindows === -1) {
    log('graceful-quit', 'powershell unavailable; DEGRADED to force-kill (recorded, not asserted)')
    killTree(main.pid)
    await waitForExit(main, KILL_TIMEOUT_MS, 'main')
  } else {
    const mainResult = await waitForExit(main, GRACEFUL_EXIT_TIMEOUT_MS, 'main')
    if (!mainResult.exited) {
      failures++; log('graceful-quit', `FAILED exe did not exit within ${GRACEFUL_EXIT_TIMEOUT_MS}ms after window close`)
      killTree(main.pid)
    } else if (mainResult.code !== 0) {
      failures++; log('graceful-quit', `FAILED natural exit code ${mainResult.code} (expected 0)`)
    } else {
      log('graceful-quit', `natural exit 0 after window close (closed=${closedWindows})`)
    }
    await new Promise(resolve => setTimeout(resolve, 1_000))
    const portReleased = await canBindLoopback(port)
    const healthRefused = !(await fetchJson(`http://127.0.0.1:${port}/api/health`, 3_000).then(() => true).catch(() => false))
    if (!portReleased || !healthRefused) {
      failures++; log('orphan', `FAILED port released=${portReleased} health refused=${healthRefused}`)
    } else {
      log('orphan', `no orphan: port rebindable + health refused after exit`)
    }
  }

  // ===== 阶段 E：冲突 restart 注入（假训练器占用随机端口） =====
  const conflictPort = await freeLoopbackPort()
  const conflictDataDir = join(tempDir, 'conflict-data')
  const fake = spawnFakeTrainer(conflictPort)
  cleanups.push(() => killTree(fake.pid))
  const fakeReady = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fake trainer did not become ready')), 10_000)
    fake.stderr.resume()
    fake.stdout.resume()
    const poll = async () => {
      try {
        const probe = await fetchJson(`http://127.0.0.1:${conflictPort}/api/health`, 1_000)
        if (probe.status === 200) { clearTimeout(timer); resolve(JSON.parse(probe.text)) }
      } catch { /* retry */ }
      if (fake.exitCode !== null) return reject(new Error(`fake trainer exited early with code ${fake.exitCode}`))
      setTimeout(poll, 200)
    }
    void poll()
  })
  log('conflict-setup', `fake trainer ready on port ${conflictPort} (pid=${fakeReady.pid} runId=${fakeReady.runId})`)

  const conflictStderrLog = await openStderrLog('exe-conflict-stderr.log')
  const conflictExe = spawn(copiedExe, [], {
    cwd: tempDir,
    stdio: ['ignore', 'ignore', conflictStderrLog.fd],
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(conflictPort),
      TRAINER_DATA_DIR: conflictDataDir,
      TRAINER_DB: join(conflictDataDir, 'trainer.sqlite'),
      TDX_ROOT: '',
      OPEN_BROWSER: '0',
      TRAINER_DESKTOP_CONFLICT_ANSWER: 'restart',
    },
  })
  cleanups.push(() => killTree(conflictExe.pid))

  // 断言①：假占用者被结束（restart 应答）
  const fakeExit = await waitForExit(fake, CONFLICT_TAKEOVER_TIMEOUT_MS, 'fake-trainer')
  if (!fakeExit.exited) { failures++; log('conflict-restart', 'FAILED fake trainer occupant was not stopped') }
  else log('conflict-restart', `fake occupant stopped (exit code ${fakeExit.code})`)

  // 断言②：exe 自己的服务接管该端口（health 身份变为 exe：runId≠fake 且带 currentVersion）
  let takeover = null
  const takeoverDeadline = Date.now() + CONFLICT_TAKEOVER_TIMEOUT_MS
  for (;;) {
    try {
      const probe = await fetchJson(`http://127.0.0.1:${conflictPort}/api/health`, 3_000)
      if (probe.status === 200) {
        const body = JSON.parse(probe.text)
        if (body.runId !== fakeReady.runId && typeof body.currentVersion === 'string' && body.currentVersion.trim() !== '') {
          takeover = body
          break
        }
      }
    } catch { /* exe server not up yet */ }
    if (conflictExe.exitCode !== null) { failures++; log('conflict-restart', `FAILED exe exited early with code ${conflictExe.exitCode}`); break }
    if (Date.now() > takeoverDeadline) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (takeover) {
    log('conflict-restart', `exe took over port ${conflictPort} (runId=${takeover.runId} currentVersion=${takeover.currentVersion})`)
  } else if (conflictExe.exitCode === null) {
    failures++; log('conflict-restart', `FAILED exe did not take over port ${conflictPort} within ${CONFLICT_TAKEOVER_TIMEOUT_MS}ms`)
  }

  // 断言③：该实例也能优雅退出
  if (conflictExe.exitCode === null) {
    closeMainWindowOfChildren(conflictExe.pid)
    const conflictResult = await waitForExit(conflictExe, GRACEFUL_EXIT_TIMEOUT_MS, 'conflict-exe')
    if (!conflictResult.exited) {
      failures++; log('conflict-quit', 'FAILED conflict exe did not exit after window close')
      killTree(conflictExe.pid)
    } else {
      log('conflict-quit', `conflict exe exited with code ${conflictResult.code}`)
      await new Promise(resolve => setTimeout(resolve, 1_000))
      const conflictPortReleased = await canBindLoopback(conflictPort)
      if (!conflictPortReleased) { failures++; log('conflict-quit', 'FAILED conflict port not released') }
      else log('conflict-quit', `port ${conflictPort} released`)
    }
  }

  clearTimeout(overallTimer)
  const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (failures > 0) {
    console.error(`[smoke] SMOKE_FAIL failures=${failures} total=${totalSeconds}s`)
    process.exitCode = 1
  } else {
    log('pass', `SMOKE_PASS total=${totalSeconds}s`)
  }
}

try {
  await runSmoke()
} catch (error) {
  console.error(`[smoke] SMOKE_FAIL: ${error.message}`)
  try {
    const { readFile } = await import('node:fs/promises')
    if (tempDir) {
      for (const logName of ['exe-main-stderr.log', 'exe-second-stderr.log', 'exe-conflict-stderr.log']) {
        const text = await readFile(join(tempDir, logName), 'utf8').catch(() => '')
        if (text.trim()) console.error(`[smoke] ${logName} (tail):\n${text.trim().split('\n').slice(-12).join('\n')}`)
      }
    }
  } catch { /* log best-effort */ }
  for (const cleanup of cleanups) cleanup()
  process.exitCode = 1
} finally {
  for (const handle of openLogHandles) { try { await handle.close() } catch { /* best-effort */ } }
  if (tempDir && !keep) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  else if (tempDir) log('keep', tempDir)
}
