// PORT-COEXIST-V127-NODE：killTrainerTree（按进程树终止已验证的训练器占用者）。
// 背景（2026-10-11 用户真机）：v1.2.7 zip 形态＝cmd 壳→launcher→detached node 服务，
// 另有 SETUP-01 受控重启监管形态；单 PID kill 对带子进程/监管者的形态会留残余并可能被
// 重启。oracle＝矩阵行 SHALL「可靠终止 v1.2.7 服务进程（含其子进程树/监管者）」＋
// 「终止失败时人话呈现」。纯函数层全注入；末尾一条真实 IO 边界用例（真实两级 node 进程
// 树＋真实 taskkill），对应 development-principles 4.2「默认 IO 实现必须有真实边界测试」。
import { spawn } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  KILL_EXIT_TIMEOUT_MS,
  TASKKILL_GUARD_MS,
  killTrainerTree,
  realPidAlive,
  taskkillTreeKillWindows,
  type TreeKillOutcome,
} from '../src/port-conflict.js'

const ownedFixtures: { stop(): Promise<void> }[] = []
afterEach(async () => {
  for (const fixture of ownedFixtures.splice(0)) await fixture.stop()
})

describe('PORT-COEXIST-V127-NODE: killTrainerTree 注入桩（树终止＋有界等待＋如实报错）', () => {
  it('PORT-COEXIST-V127-NODE: killTrainerTree tree-kills the verified pid and waits for its exit', async () => {
    const killedPids: number[] = []
    let alivePolls = 0
    const result = await killTrainerTree(4321, {
      runTreeKill: async pid => { killedPids.push(pid); return { ok: true } },
      pidAlive: () => { alivePolls += 1; return alivePolls < 3 },
    })
    expect(killedPids).toEqual([4321])
    expect(result).toEqual({ exited: true })
    expect(alivePolls).toBe(3)
  })

  it('PORT-COEXIST-V127-NODE: killTrainerTree reports a failed tree kill honestly instead of pretending exit', async () => {
    const result = await killTrainerTree(4321, {
      runTreeKill: async () => ({ ok: false, error: 'access denied' }),
      pidAlive: () => { throw new Error('must not poll after a failed kill') },
    })
    expect(result.exited).toBe(false)
    expect(result.error).toContain('access denied')
  })

  it('PORT-COEXIST-V127-NODE: killTrainerTree treats taskkill not-found as already exited', async () => {
    const result = await killTrainerTree(4321, {
      runTreeKill: async () => ({ ok: false, notFound: true } as TreeKillOutcome),
      pidAlive: () => false,
    })
    expect(result).toEqual({ exited: true })
  })

  it('PORT-COEXIST-V127-NODE: killTrainerTree stops at the bounded timeout and reports the wait failure', async () => {
    const result = await killTrainerTree(4321, {
      runTreeKill: async () => ({ ok: true }),
      pidAlive: () => true,
      timeoutMs: 120,
      pollIntervalMs: 20,
    })
    expect(result.exited).toBe(false)
    expect(result.error).toContain('4321')
  })

  it('PORT-COEXIST-V127-NODE: the default exit wait budget stays bounded at 5 seconds', () => {
    // 锁默认预算不被顺手上调（退出路径的等待上限是行为契约）
    expect(KILL_EXIT_TIMEOUT_MS).toBe(5_000)
  })

  it('PORT-COEXIST-V127-NODE: the taskkill guard stays bounded and above the measured real-target latency', () => {
    // 守卫契约：有界（30s 上限），且必须高于本机实测 taskkill /T /F 真实耗时 ~6.6s 的
    // 安全余量（2026-10-12 e2e 实证 8s 守卫在负载下误杀合法终止）
    expect(TASKKILL_GUARD_MS).toBeLessThanOrEqual(30_000)
    expect(TASKKILL_GUARD_MS).toBeGreaterThan(10_000)
  })
})

describe('PORT-COEXIST-V127-NODE: killTrainerTree 真实边界（真实两级进程树＋真实 taskkill）', () => {
  it('PORT-COEXIST-V127-NODE: taskkill terminates a real two-level node process tree including the grandchild', async () => {
    if (process.platform !== 'win32') return // 本工程 Windows-only（CI 单矩阵）；非 win32 环境跳过真实树终止段
    const root = await mkdtemp(join(tmpdir(), 'trainer-port-tree-'))
    const treeDir = join(root, 'owned-tree')
    await mkdir(treeDir)
    const readyPath = join(treeDir, 'grandchild.ready')
    const grandchildScript = `require('node:fs').writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));setInterval(() => {}, 1000)`
    // 父进程再 spawn 一个子进程（孙）：树终止必须两者皆死（单 PID kill 只死父）
    const parent = spawn(process.execPath, ['-e', [
      'const { spawn } = require("node:child_process")',
      // Detached is essential: an attached child can die with its parent even without /T.
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], { detached: true, windowsHide: true, stdio: 'ignore' })`,
      'console.log(child.pid)',
      'setInterval(() => {}, 1000)',
    ].join('\n')], { cwd: treeDir, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] })
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: root, windowsHide: true, stdio: 'ignore' })
    const closed = Promise.all([parent, sentinel].map(child => new Promise<void>(resolve => child.once('close', () => resolve()))))
    let grandchildPid = ''
    parent.stdout?.on('data', chunk => { grandchildPid += chunk })
    let cleanup: Promise<void> | undefined
    const stop = () => cleanup ??= (async () => {
      const grandchild = Number(grandchildPid.trim() || await readFile(readyPath, 'utf8').catch(() => ''))
      const ownedPids = [parent.pid, grandchild, sentinel.pid].filter((pid): pid is number => Number.isInteger(pid) && Number(pid) > 0)
      for (const pid of ownedPids) if (realPidAlive(pid)) { try { process.kill(pid, 'SIGKILL') } catch { /* already exited */ } }
      const deadline = Date.now() + 5_000
      while (ownedPids.some(realPidAlive) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
      if (ownedPids.some(realPidAlive)) throw new Error('Owned tree fixture did not exit during cleanup')
      const handlesClosed = await Promise.race([closed.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5_000))])
      if (!handlesClosed) throw new Error('Owned tree fixture did not close during cleanup')
      // A killed detached process can release its Windows cwd handle after PID exit.
      // This retry is fixture teardown only; the release assertion below is immediate.
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    })()
    // Drain only fixture-owned PIDs even if an assertion or Vitest times out.
    ownedFixtures.push({ stop })
    try {
      const readyDeadline = Date.now() + 5_000
      while (Date.now() < readyDeadline) {
        if (grandchildPid.trim() && await readFile(readyPath, 'utf8').catch(() => '')) break
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      const grandchild = Number(grandchildPid.trim())
      expect(Number.isInteger(grandchild)).toBe(true)
      expect(realPidAlive(grandchild)).toBe(true)
      expect(parent.pid && realPidAlive(parent.pid)).toBe(true)
      expect(sentinel.pid && realPidAlive(sentinel.pid)).toBe(true)

      // 真实边界用例放宽等待预算（vitest 并行 worker 冷启动竞争下 taskkill/退出确认会拖过
      // 生产默认 5s；生产默认由上方专用用例锁死 5_000 不变，这里只放宽本用例的注入值）
      const killedAt = Date.now()
      const result = await killTrainerTree(parent.pid!, {
        runTreeKill: taskkillTreeKillWindows,
        pidAlive: realPidAlive,
        timeoutMs: 15_000,
      })
      expect(result.exited).toBe(true)
      // 孙进程必须随树死亡（可能滞后几十毫秒，有界等待）
      const deadline = Date.now() + 3_000
      while (realPidAlive(grandchild) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(realPidAlive(grandchild), 'owned grandchild must exit after tree termination').toBe(false)
      expect(realPidAlive(parent.pid!), 'owned parent must exit after tree termination').toBe(false)
      expect(sentinel.pid && realPidAlive(sentinel.pid), 'tree-external sibling must survive').toBe(true)
      await rm(treeDir, { recursive: true })
      await expect(access(treeDir)).rejects.toMatchObject({ code: 'ENOENT' })
      console.info('Owned tree termination receipt:', { parent: parent.pid, grandchild, elapsedMs: Date.now() - killedAt, directoryReleased: true, sentinelAlive: true })
    } finally {
      await stop()
    }
  },
    // 5s readiness + 30s taskkill + 15s injected exit wait + 3s grandchild wait + margin.
    60_000,
  )
})
