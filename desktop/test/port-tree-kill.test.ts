// PORT-COEXIST-V127-NODE：killTrainerTree（按进程树终止已验证的训练器占用者）。
// 背景（2026-10-11 用户真机）：v1.2.7 zip 形态＝cmd 壳→launcher→detached node 服务，
// 另有 SETUP-01 受控重启监管形态；单 PID kill 对带子进程/监管者的形态会留残余并可能被
// 重启。oracle＝矩阵行 SHALL「可靠终止 v1.2.7 服务进程（含其子进程树/监管者）」＋
// 「终止失败时人话呈现」。纯函数层全注入；末尾一条真实 IO 边界用例（真实两级 node 进程
// 树＋真实 taskkill），对应 development-principles 4.2「默认 IO 实现必须有真实边界测试」。
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  KILL_EXIT_TIMEOUT_MS,
  TASKKILL_GUARD_MS,
  killTrainerTree,
  realPidAlive,
  taskkillTreeKillWindows,
  type TreeKillOutcome,
} from '../src/port-conflict.js'

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
      // 父进程再 spawn 一个子进程（孙）：树终止必须两者皆死（单 PID kill 只死父）
      const parent = spawn(process.execPath, ['-e', [
        'const { spawn } = require("node:child_process")',
        'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "inherit"] })',
        'console.log(child.pid)',
        'setInterval(() => {}, 1000)',
      ].join('\n')], { stdio: ['ignore', 'pipe', 'inherit'] })
      let grandchildPid = ''
      parent.stdout?.on('data', chunk => { grandchildPid += chunk })
      const grandchildPidReady = new Promise<void>(resolve => {
        const timer = setInterval(() => { if (grandchildPid.trim()) { clearInterval(timer); resolve() } }, 20)
        setTimeout(() => { clearInterval(timer); resolve() }, 5_000).unref()
      })
      await grandchildPidReady
      const grandchild = Number(grandchildPid.trim())
      expect(Number.isInteger(grandchild)).toBe(true)
      expect(realPidAlive(grandchild)).toBe(true)

      // 真实边界用例放宽等待预算（vitest 并行 worker 冷启动竞争下 taskkill/退出确认会拖过
      // 生产默认 5s；生产默认由上方专用用例锁死 5_000 不变，这里只放宽本用例的注入值）
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
      expect(realPidAlive(grandchild)).toBe(false)
    },
    // vitest 默认单用例 5s 超时不够（进程 spawn＋taskkill＋等待）；放宽到 15s
    15_000,
  )
})
