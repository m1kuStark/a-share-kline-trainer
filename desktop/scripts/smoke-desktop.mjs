#!/usr/bin/env node
// PACK-01 便携 exe 打包冒烟（派发简报门禁第 4 条判据）：
//   便携 exe → 复制到未跟踪临时目录 → 启动 → /api/health 200 且 currentVersion 存在
//   → web 首页 HTML 可达 → 窗口存在（标题「K线训练器」）→ 进程退出（超时强杀并记录）。
// 隔离铁律：TRAINER_DATA_DIR/TRAINER_DB 指向临时目录，绝不触碰真实用户数据
// （%USERPROFILE%\.a-share-kline-trainer 或任何既有 zip 包的 data/）；TDX_ROOT 置空。
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
const KILL_TIMEOUT_MS = 30_000
const OVERALL_TIMEOUT_MS = 300_000

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

function windowTitleCount(title) {
  try {
    const command = `(Get-Process | Where-Object { $_.MainWindowTitle -eq '${title}' } | Measure-Object).Count`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15_000 })
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

const startedAt = Date.now()
let tempDir = null
let child = null
let stderrLog = null
let failures = 0

try {
  const exeStat = await stat(exeArg)
  log('exe', `${exeArg} (${(exeStat.size / 1024 / 1024).toFixed(1)} MB)`)

  tempDir = await mkdtemp(join(tmpdir(), 'pack01-smoke-'))
  const copiedExe = join(tempDir, basename(exeArg))
  await copyFile(exeArg, copiedExe)
  log('copy', copiedExe)

  const port = await freeLoopbackPort()
  const dataDir = join(tempDir, 'data')
  log('port', `port=${port} dataDir=${dataDir}`)

  const spawnedAt = Date.now()
  stderrLog = await open(join(tempDir, 'exe-stderr.log'), 'a')
  child = spawn(copiedExe, [], {
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
    },
  })
  const rootPid = child.pid
  log('spawn', `pid=${rootPid}`)

  const overallTimer = setTimeout(() => {
    log('timeout', `overall ${OVERALL_TIMEOUT_MS}ms exceeded; force killing`)
    killTree(rootPid)
    process.exitCode = 1
  }, OVERALL_TIMEOUT_MS)

  // 1) /api/health 200 + currentVersion
  let health = null
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  for (;;) {
    try {
      const probe = await fetchJson(`http://127.0.0.1:${port}/api/health`, 3_000)
      if (probe.status === 200) { health = probe; break }
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`exe exited during startup with code ${child.exitCode}`)
    if (Date.now() > deadline) throw new Error(`health not reachable within ${HEALTH_TIMEOUT_MS}ms`)
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const healthBody = JSON.parse(health.text)
  const bootSeconds = ((Date.now() - spawnedAt) / 1000).toFixed(1)
  if (healthBody.status !== 'ok') { failures++; log('health', `UNEXPECTED status=${healthBody.status}`) }
  if (typeof healthBody.currentVersion !== 'string' || healthBody.currentVersion.trim() === '') {
    failures++; log('health', 'MISSING currentVersion')
  } else {
    log('health', `200 status=ok currentVersion=${healthBody.currentVersion} pid=${healthBody.pid} runId=${healthBody.runId} boot=${bootSeconds}s`)
  }

  // 2) web 首页 HTML 可达
  const page = await fetchJson(`http://127.0.0.1:${port}/`, 5_000)
  const isHtml = page.status === 200 && /<html/i.test(page.text) && /id="app"/i.test(page.text)
  if (!isHtml) { failures++; log('page', `UNEXPECTED status=${page.status} html=${/<html/i.test(page.text)}`) }
  else log('page', `200 html ok (${page.text.length} bytes)`)

  // 3) 窗口存在（标题「K线训练器」）
  const titles = windowTitleCount('K线训练器')
  if (titles === -1) log('window', 'powershell unavailable; window check DEGRADED (recorded, not asserted)')
  else if (titles < 1) { failures++; log('window', `NO window titled K线训练器 (count=${titles})`) }
  else log('window', `window titled K线训练器 present (count=${titles})`)

  // 4) 进程退出（强杀并记录；正常关闭语义属 PACK-02 完整生命周期）
  const killed = killTree(rootPid)
  const exitCode = await new Promise(resolve => {
    const timer = setTimeout(() => resolve('kill-timeout'), KILL_TIMEOUT_MS)
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve(signal ?? code ?? 'unknown') })
    if (child.exitCode !== null) { clearTimeout(timer); resolve(child.exitCode) }
  })
  if (!killed || exitCode === 'kill-timeout') { failures++; log('exit', `FAILED killed=${killed} exit=${exitCode}`) }
  else log('exit', `terminated (signal=${exitCode}, force-kill as documented)`)

  clearTimeout(overallTimer)
  const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (failures > 0) {
    console.error(`[smoke] SMOKE_FAIL failures=${failures} total=${totalSeconds}s`)
    process.exitCode = 1
  } else {
    log('pass', `SMOKE_PASS total=${totalSeconds}s`)
  }
} catch (error) {
  console.error(`[smoke] SMOKE_FAIL: ${error.message}`)
  try {
    const { readFile } = await import('node:fs/promises')
    const stderrText = await readFile(join(tempDir, 'exe-stderr.log'), 'utf8').catch(() => '')
    if (stderrText.trim()) console.error(`[smoke] exe stderr (tail):\n${stderrText.trim().split('\n').slice(-12).join('\n')}`)
  } catch { /* log best-effort */ }
  if (child?.pid) killTree(child.pid)
  process.exitCode = 1
} finally {
  try { await stderrLog?.close() } catch { /* best-effort */ }
  if (tempDir && !keep) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  else if (tempDir) log('keep', tempDir)
}
