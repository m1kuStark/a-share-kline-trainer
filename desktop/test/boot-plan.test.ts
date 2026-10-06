// PACK-02（DESKTOP-SINGLE-INSTANCE）：单实例启动分支决策。
// oracle 独立性：期望来自 PACK-02 派发简报决策①（第二实例在进入任何启动分支之前退出）
// 与 PACK-01 派发简报（DESKTOP_DEV_URL＝开发窗口模式，不内嵌服务）——不从 main.ts 现状反推。
import { describe, expect, it } from 'vitest'
import { planInstanceBoot } from '../src/boot-plan.js'

describe('DESKTOP-SINGLE-INSTANCE：单实例启动分支', () => {
  it('DESKTOP-SINGLE-INSTANCE: a lockless instance quits before any boot branch (no server, no window)', () => {
    // 无锁（第二实例）：无论是否配置开发 URL，都不得进入任何启动分支
    expect(planInstanceBoot({ hasLock: false, devWindowUrl: null })).toEqual({ kind: 'quit' })
    expect(planInstanceBoot({ hasLock: false, devWindowUrl: 'http://127.0.0.1:5173' })).toEqual({ kind: 'quit' })
  })

  it('DESKTOP-SINGLE-INSTANCE: the lock holder proceeds to boot (embedded server without DESKTOP_DEV_URL, dev window with it)', () => {
    expect(planInstanceBoot({ hasLock: true, devWindowUrl: null })).toEqual({ kind: 'boot', mode: 'embedded' })
    expect(planInstanceBoot({ hasLock: true, devWindowUrl: 'http://127.0.0.1:5173' }))
      .toEqual({ kind: 'boot', mode: 'dev-window', url: 'http://127.0.0.1:5173' })
  })
})
