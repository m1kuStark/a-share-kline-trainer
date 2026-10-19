// UPD-NSIS-INTENT-RETRY（冷审 P1-2 修复，用户 2026-10-19 批复 2：无感自动诊断与处理）：
// NSIS 静默安装中断（冷审 A6/A7 窗口）自愈——quitAndInstall 前落「更新意图标记」，
// 下次启动三分支校验（无标记照旧 / 版本符清标记 / 版本不符静默重走更新链，有界重试）。
// oracle 独立性（不从实现反推）：
//   - 用户批复 2 原意：安装中断后用户不应感知也不应被报错困住——下次启动自动诊断并重走更新；
//   - 冷审 A6/A7 证据：中断后应用停在旧版本且 repo 无观测无恢复（现状什么都不发生）；
//   - 分支语义/有界重试次数 3（proposed_default）/损坏容忍＝视为无标记（data-home 损坏容忍先例）
//     均为任务卡冻结口径，期望值手写，不从实现回显；
//   - 版本相等性用 v 前缀容忍口径（与 mapCheckView 同一 server version.ts 口径，独立常识序）。
// 真实边界（开发原则 §4.2）：默认 fs 实现必须有真实文件系统用例（损坏/缺失/原子写无残留），
// 桩注入用例只证明决策编排路径。main.ts 接线按仓库先例以源码契约锁定。
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UPDATE_INTENT_FILE,
  UPDATE_INTENT_MAX_RETRIES,
  buildInstallIntentMarker,
  clearUpdateIntentMarker,
  parseUpdateIntentRecord,
  persistUpdateIntentMarker,
  persistUpdateIntentMarkerSync,
  readUpdateIntentMarker,
  readUpdateIntentMarkerSync,
  resolveUpdateIntentAction,
  retryIntentMarker,
  runUpdateIntentBootValidation,
  serializeUpdateIntentRecord,
  updateIntentGiveUpMessage,
  updateIntentNoUpdateMessage,
  type UpdateIntentBootDeps,
  type UpdateIntentRecord,
} from '../src/update-intent.js'

/** 手写 fixture：意图标记（期望值独立于实现；9.9.9 目标 > 1.3.2 现行——常识序） */
function markerFixture(overrides: Partial<UpdateIntentRecord> = {}): UpdateIntentRecord {
  return {
    version: 1,
    fromVersion: '1.3.2',
    toVersion: '9.9.9',
    startedAt: '2026-10-19T00:00:00.000Z',
    attempts: 0,
    ...overrides,
  }
}

describe('UPD-NSIS-INTENT-RETRY: 标记形状与严格解析（update-intent.ts 纯决策层）', () => {
  it('UPD-NSIS-INTENT-RETRY: parseUpdateIntentRecord 接受完整合法形状', () => {
    const valid = markerFixture()
    expect(parseUpdateIntentRecord(valid)).toEqual(valid)
    // 多余字段容忍（前向兼容；已知字段全对即认）
    expect(parseUpdateIntentRecord({ ...valid, note: 'extra' })).toEqual(valid)
  })

  it('UPD-NSIS-INTENT-RETRY: parseUpdateIntentRecord 对非法形状一律拒绝（null），损坏容忍先例', () => {
    const valid = markerFixture()
    expect(parseUpdateIntentRecord(null)).toBeNull()
    expect(parseUpdateIntentRecord(undefined)).toBeNull()
    expect(parseUpdateIntentRecord('x')).toBeNull()
    expect(parseUpdateIntentRecord([valid])).toBeNull()
    expect(parseUpdateIntentRecord({ ...valid, version: 2 })).toBeNull()
    expect(parseUpdateIntentRecord({ fromVersion: '1.3.2', toVersion: '9.9.9', startedAt: 't', attempts: 0 })).toBeNull() // 缺 version
    expect(parseUpdateIntentRecord({ ...valid, version: '1' })).toBeNull() // version 非数字 1
    expect(parseUpdateIntentRecord({ ...valid, fromVersion: '' })).toBeNull()
    expect(parseUpdateIntentRecord({ ...valid, fromVersion: 132 })).toBeNull()
    expect(parseUpdateIntentRecord({ ...valid, toVersion: '' })).toBeNull()
    expect(parseUpdateIntentRecord({ ...valid, toVersion: null })).toBeNull()
    expect(parseUpdateIntentRecord({ ...valid, startedAt: '' })).toBeNull()
    expect(parseUpdateIntentRecord({ ...valid, attempts: '2' })).toBeNull()
    expect(parseUpdateIntentRecord({ ...valid, attempts: 2.5 })).toBeNull()
    expect(parseUpdateIntentRecord({ ...valid, attempts: -1 })).toBeNull()
    expect(parseUpdateIntentRecord({ ...valid, attempts: undefined })).toBeNull()
  })

  it('UPD-NSIS-INTENT-RETRY: serialize 后可被 parse 完整还原（往返一致）', () => {
    const record = markerFixture({ attempts: 2 })
    const text = serializeUpdateIntentRecord(record)
    expect(typeof text).toBe('string')
    expect(parseUpdateIntentRecord(JSON.parse(text))).toEqual(record)
  })

  it('UPD-NSIS-INTENT-RETRY: buildInstallIntentMarker 新意图 attempts 从 0 起，同目标续装保留计数', () => {
    // 全新意图（无先前标记）→ attempts 0
    expect(buildInstallIntentMarker({ fromVersion: '1.3.2', toVersion: '9.9.9', startedAt: 't1', previous: null }))
      .toEqual({ version: 1, fromVersion: '1.3.2', toVersion: '9.9.9', startedAt: 't1', attempts: 0 })
    // 先前标记同目标（自愈重装再进安装分支）→ 计数延续（防无限循环的计数根基）
    const previous = markerFixture({ attempts: 2 })
    expect(buildInstallIntentMarker({ fromVersion: '1.3.2', toVersion: '9.9.9', startedAt: 't2', previous }))
      .toEqual({ version: 1, fromVersion: '1.3.2', toVersion: '9.9.9', startedAt: 't2', attempts: 2 })
    // 先前标记目标不同（新版本意图）→ 新计数
    const stale = markerFixture({ toVersion: '8.8.8', attempts: 2 })
    expect(buildInstallIntentMarker({ fromVersion: '1.3.2', toVersion: '9.9.9', startedAt: 't3', previous: stale }).attempts).toBe(0)
  })

  it('UPD-NSIS-INTENT-RETRY: retryIntentMarker 只递增计数，不改目标与起点', () => {
    const marker = markerFixture({ attempts: 1 })
    expect(retryIntentMarker(marker, 2)).toEqual({ ...marker, attempts: 2 })
  })
})

describe('UPD-NSIS-INTENT-RETRY: 启动三分支裁决（resolveUpdateIntentAction）', () => {
  it('UPD-NSIS-INTENT-RETRY: 无标记→none；无法确定当前版本→none（无从裁决不动作）', () => {
    expect(resolveUpdateIntentAction({ marker: null, currentVersion: '1.3.2' })).toEqual({ kind: 'none' })
    expect(resolveUpdateIntentAction({ marker: markerFixture(), currentVersion: null })).toEqual({ kind: 'none' })
  })

  it('UPD-NSIS-INTENT-RETRY: 版本==target→complete（v 前缀容忍同口径）', () => {
    expect(resolveUpdateIntentAction({ marker: markerFixture(), currentVersion: '9.9.9' })).toEqual({ kind: 'complete', marker: markerFixture() })
    expect(resolveUpdateIntentAction({ marker: markerFixture(), currentVersion: 'v9.9.9' })).toEqual({ kind: 'complete', marker: markerFixture() })
    // 成功收尾优先于预算：即使计数已超界，版本符合仍是 complete（成功不是失败重试）
    expect(resolveUpdateIntentAction({ marker: markerFixture({ attempts: 99 }), currentVersion: '9.9.9' }).kind).toBe('complete')
  })

  it('UPD-NSIS-INTENT-RETRY: 版本≠target 且未超界→retry（nextAttempts=attempts+1）', () => {
    expect(resolveUpdateIntentAction({ marker: markerFixture({ attempts: 0 }), currentVersion: '1.3.2' }))
      .toEqual({ kind: 'retry', marker: markerFixture({ attempts: 0 }), nextAttempts: 1 })
    expect(resolveUpdateIntentAction({ marker: markerFixture({ attempts: 2 }), currentVersion: '1.3.2' }).nextAttempts).toBe(3)
    // toVersion 不可比较（损坏但结构合法）→ 按未完成处理（交给重走链与有界预算兜底）
    expect(resolveUpdateIntentAction({ marker: markerFixture({ toVersion: 'release-9' }), currentVersion: '1.3.2' }).kind).toBe('retry')
  })

  it('UPD-NSIS-INTENT-RETRY: 计数达上界→give-up（默认 3，proposed_default）', () => {
    expect(UPDATE_INTENT_MAX_RETRIES).toBe(3)
    expect(resolveUpdateIntentAction({ marker: markerFixture({ attempts: 3 }), currentVersion: '1.3.2' }).kind).toBe('give-up')
    expect(resolveUpdateIntentAction({ marker: markerFixture({ attempts: 5 }), currentVersion: '1.3.2' }).kind).toBe('give-up')
    // 上界可注入（测试/诊断口径）
    expect(resolveUpdateIntentAction({ marker: markerFixture({ attempts: 1 }), currentVersion: '1.3.2', maxRetries: 1 }).kind).toBe('give-up')
  })
})

describe('UPD-NSIS-INTENT-RETRY: 启动校验编排（runUpdateIntentBootValidation 注入桩）', () => {
  interface BootHarness {
    calls: string[]
    persisted: UpdateIntentRecord[]
    sentMessages: string[]
    logger: { error: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn>, info: ReturnType<typeof vi.fn>, log: ReturnType<typeof vi.fn> }
    deps: UpdateIntentBootDeps
  }

  function bootHarness(options: {
    marker: UpdateIntentRecord | null
    currentVersion: string | null
    readThrows?: boolean
    persistThrows?: boolean
    clearThrows?: boolean
    chainThrows?: boolean
  }): BootHarness {
    const calls: string[] = []
    const persisted: UpdateIntentRecord[] = []
    const sentMessages: string[] = []
    const harness: BootHarness = {
      calls,
      persisted,
      sentMessages,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() },
      deps: {
        readMarker: options.readThrows
          ? async () => { throw new Error('disk io error') }
          : async () => options.marker,
        persistMarker: async marker => {
          calls.push('persist')
          if (options.persistThrows) throw new Error('persist failed')
          persisted.push(marker)
        },
        clearMarker: async () => {
          calls.push('clear')
          if (options.clearThrows) throw new Error('clear failed')
        },
        getCurrentVersion: () => options.currentVersion,
        runUpdateChain: async () => {
          calls.push('chain')
          if (options.chainThrows) throw new Error('chain exploded')
        },
        sendEvent: message => {
          calls.push('send')
          sentMessages.push(message)
        },
        logger: undefined as never,
      },
    }
    harness.deps.logger = harness.logger
    return harness
  }

  it('UPD-NSIS-INTENT-RETRY: 标记在＋版本≠target→先持久化计数+1 再自动重走更新链（RED 场景一）', async () => {
    // 现状（无此逻辑）：标记在＋版本不符时什么都不发生——本用例断言应自动重触发
    const harness = bootHarness({ marker: markerFixture({ attempts: 0 }), currentVersion: '1.3.2' })
    await runUpdateIntentBootValidation(harness.deps)
    expect(harness.calls).toEqual(['persist', 'chain'])
    expect(harness.persisted).toEqual([markerFixture({ attempts: 1 })])
  })

  it('UPD-NSIS-INTENT-RETRY: 标记在＋版本==target→清标记收尾，绝不重触发（RED 场景二）', async () => {
    // 现状（残留）：安装成功后标记永久残留——本用例断言应清理
    const harness = bootHarness({ marker: markerFixture({ attempts: 1 }), currentVersion: '9.9.9' })
    await runUpdateIntentBootValidation(harness.deps)
    expect(harness.calls).toEqual(['clear'])
    expect(harness.persisted).toEqual([])
  })

  it('UPD-NSIS-INTENT-RETRY: 清标记失败仅日志不阻断（成功收尾不因清理失败报错困住用户）', async () => {
    const harness = bootHarness({ marker: markerFixture(), currentVersion: '9.9.9', clearThrows: true })
    await expect(runUpdateIntentBootValidation(harness.deps)).resolves.toBeUndefined()
    expect(harness.logger.error).toHaveBeenCalled()
    expect(harness.calls).toEqual(['clear'])
  })

  it('UPD-NSIS-INTENT-RETRY: 无标记→照旧（零调用零日志噪声）', async () => {
    const harness = bootHarness({ marker: null, currentVersion: '1.3.2' })
    await runUpdateIntentBootValidation(harness.deps)
    expect(harness.calls).toEqual([])
    expect(harness.logger.warn).not.toHaveBeenCalled()
  })

  it('UPD-NSIS-INTENT-RETRY: 读标记抛错→按无标记处理且绝不逃逸（损坏容忍）', async () => {
    const harness = bootHarness({ marker: markerFixture(), currentVersion: '1.3.2', readThrows: true })
    await expect(runUpdateIntentBootValidation(harness.deps)).resolves.toBeUndefined()
    expect(harness.calls).toEqual([])
    expect(harness.logger.warn).toHaveBeenCalled()
  })

  it('UPD-NSIS-INTENT-RETRY: 超界→人话指引经既有事件面呈现＋清标记收尾，不再重走链', async () => {
    const harness = bootHarness({ marker: markerFixture({ attempts: 3 }), currentVersion: '1.3.2' })
    await runUpdateIntentBootValidation(harness.deps)
    expect(harness.calls).toEqual(['send', 'clear'])
    expect(harness.sentMessages).toHaveLength(1)
    // 人话指引：告知已重试次数＋手动出路（设置页重试/下载完整安装包）
    expect(harness.sentMessages[0]).toContain('3')
    expect(harness.sentMessages[0]).toMatch(/手动|下载/)
    expect(harness.persisted).toEqual([])
  })

  it('UPD-NSIS-INTENT-RETRY: 重试前计数持久化失败→不重走链（不计数不重试，防无限循环旁路）', async () => {
    const harness = bootHarness({ marker: markerFixture({ attempts: 0 }), currentVersion: '1.3.2', persistThrows: true })
    await expect(runUpdateIntentBootValidation(harness.deps)).resolves.toBeUndefined()
    expect(harness.calls).toEqual(['persist'])
    expect(harness.logger.error).toHaveBeenCalled()
  })

  it('UPD-NSIS-INTENT-RETRY: 更新链自身抛错被吞（链内错误经事件面呈现，校验绝不逃逸）', async () => {
    const harness = bootHarness({ marker: markerFixture({ attempts: 0 }), currentVersion: '1.3.2', chainThrows: true })
    await expect(runUpdateIntentBootValidation(harness.deps)).resolves.toBeUndefined()
    expect(harness.calls).toEqual(['persist', 'chain'])
    expect(harness.logger.error).toHaveBeenCalled()
  })

  it('UPD-NSIS-INTENT-RETRY: 人话文案构造器——超界与更新源无新版两个口径', () => {
    const giveUp = updateIntentGiveUpMessage(3)
    expect(giveUp).toContain('3')
    expect(giveUp).toMatch(/手动|下载/)
    expect(giveUp.length).toBeGreaterThan(10)
    const noUpdate = updateIntentNoUpdateMessage()
    expect(noUpdate.length).toBeGreaterThan(10)
    expect(noUpdate).toMatch(/新版本|更新/)
  })
})

describe('UPD-NSIS-INTENT-RETRY: 真实文件系统边界（默认 fs 实现，非桩）', () => {
  async function makeTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'upd-intent-'))
  }

  it('UPD-NSIS-INTENT-RETRY: 同步写＋双路读往返一致；清标记后读取为 null', async () => {
    const dataDir = await makeTempDir()
    try {
      const record = markerFixture({ attempts: 2 })
      persistUpdateIntentMarkerSync(dataDir, record)
      expect(readUpdateIntentMarkerSync(dataDir)).toEqual(record)
      expect(await readUpdateIntentMarker(dataDir)).toEqual(record)
      await clearUpdateIntentMarker(dataDir)
      expect(await readUpdateIntentMarker(dataDir)).toBeNull()
      expect(readUpdateIntentMarkerSync(dataDir)).toBeNull()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('UPD-NSIS-INTENT-RETRY: 异步原子写后无临时文件残留且内容可读回', async () => {
    const dataDir = await makeTempDir()
    try {
      const record = markerFixture()
      await persistUpdateIntentMarker(dataDir, record)
      const entries = await readdir(dataDir)
      expect(entries).toEqual([UPDATE_INTENT_FILE])
      expect(parseUpdateIntentRecord(JSON.parse(await readFile(join(dataDir, UPDATE_INTENT_FILE), 'utf8')))).toEqual(record)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('UPD-NSIS-INTENT-RETRY: 文件缺失/内容损坏→双路读均按无标记处理（损坏容忍＝重发现）', async () => {
    const dataDir = await makeTempDir()
    try {
      // 缺失
      expect(await readUpdateIntentMarker(dataDir)).toBeNull()
      expect(readUpdateIntentMarkerSync(dataDir)).toBeNull()
      // 损坏：非 JSON
      await writeFile(join(dataDir, UPDATE_INTENT_FILE), 'not-json{{', 'utf8')
      expect(await readUpdateIntentMarker(dataDir)).toBeNull()
      expect(readUpdateIntentMarkerSync(dataDir)).toBeNull()
      // 损坏：合法 JSON 但形状非法
      await writeFile(join(dataDir, UPDATE_INTENT_FILE), JSON.stringify({ version: 9 }), 'utf8')
      expect(await readUpdateIntentMarker(dataDir)).toBeNull()
      expect(readUpdateIntentMarkerSync(dataDir)).toBeNull()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('UPD-NSIS-INTENT-RETRY: 清除不存在的标记不抛错（幂等）', async () => {
    const dataDir = await makeTempDir()
    try {
      await expect(clearUpdateIntentMarker(dataDir)).resolves.toBeUndefined()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

describe('UPD-NSIS-INTENT-RETRY: main.ts 接线源码契约', () => {
  async function readMainSource(): Promise<string> {
    return readFile(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')
  }

  it('UPD-NSIS-INTENT-RETRY: 排空收敛安装分支内 quitAndInstall 发起前同步写标记', async () => {
    const source = await readMainSource()
    // 标记写助手存在且走同步原子写（退出路径不得依赖未完成的异步写）
    expect(source).toMatch(/function writeInstallIntentMarker\(\)/)
    expect(source).toMatch(/persistUpdateIntentMarkerSync/)
    // 顺序锁定：进入 quit-and-install 分支 → 写标记调用 → quitAndInstall 调用
    // （writeInstallIntentMarker 的函数定义在文件前部，调用点须从分支位置向后搜索）
    const branchIndex = source.indexOf("=== 'quit-and-install'")
    const writeCallIndex = source.indexOf('writeInstallIntentMarker()', branchIndex)
    const installIndex = source.indexOf('updateAdapterRef?.quitAndInstall(true, true)')
    expect(branchIndex).toBeGreaterThan(-1)
    expect(writeCallIndex).toBeGreaterThan(branchIndex)
    expect(installIndex).toBeGreaterThan(writeCallIndex)
  })

  it('UPD-NSIS-INTENT-RETRY: 启动校验接在 proceed 启动路径尾（服务起来之后），reuse 提前返回路径不经手', async () => {
    const source = await readMainSource()
    expect(source).toMatch(/runNsisIntentBootValidation\(\)/)
    const bootStart = source.indexOf('async function bootServerAndOpen')
    const bootEnd = source.indexOf('async function bootstrap')
    const callIndex = source.indexOf('runNsisIntentBootValidation()')
    expect(bootStart).toBeGreaterThan(-1)
    expect(callIndex).toBeGreaterThan(bootStart)
    expect(callIndex).toBeLessThan(bootEnd)
    // 在内嵌服务真正启动之后（reuse 分支在此之前已 return）
    expect(callIndex).toBeGreaterThan(source.indexOf('startTrainerServer'))
  })

  it('UPD-NSIS-INTENT-RETRY: 校验仅 packaged 通道放行且重触发单发（同一启动只重触发一次）', async () => {
    const source = await readMainSource()
    // dev 通道跳过（开发窗口不打更新源自愈；与 shouldAutoCheckOnBoot 同口径）
    expect(source).toMatch(/function runNsisIntentBootValidation\(\)[^{]*\{[\s\S]{0,120}updateChannelKind !== 'packaged'/)
    // 单发守卫：重走链只触发一次
    expect(source).toMatch(/if \(updateIntentRetryTriggered\) return/)
    // 与 boot 自动检查叠加不重复呈现：通知出口在自愈进行中丢弃
    expect(source).toMatch(/onBootNotice:\s*notice\s*=>\s*\{[\s\S]{0,160}updateIntentRetryTriggered[\s\S]{0,120}bootUpdateNotice\s*=\s*notice/)
    // 重走链复用既有 controller 编排（check→downloadAndInstall→既有排空守卫）
    expect(source).toMatch(/updateControllerRef/)
    expect(source).toMatch(/controller\.downloadAndInstall\(\)/)
  })

  it('UPD-NSIS-INTENT-RETRY: 安装分支的标记目标版本来自 downloaded 事件捕获', async () => {
    const source = await readMainSource()
    expect(source).toMatch(/event\.type === 'downloaded'/)
    expect(source).toMatch(/pendingInstallVersion/)
    // 数据目录在 boot 解析后回填（标记落点＝生效 dataDir）
    expect(source).toMatch(/updateIntentDataDir = config\.dataDir/)
  })
})
