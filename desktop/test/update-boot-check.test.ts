// UPD-NOTIFY-01（矩阵行 UPD-BOOT-AUTO-CHECK）：v1.3.0 每次启动自动版本检查＋首页更新提示。
// oracle：用户 2026-10-11 原话（每次启动都要检查一次；发现新版本→首页左上角按钮→跳转
// 设置『关于与更新』）＋派发简报 proposed_default（dev 形态跳过、静默失败零打扰、不加间隔）。
// 独立性：期望版本号/notes 为手写 fixture（9.9.9/修复内容），非实现回显；update-ipc 以
// 依赖注入桩执行（ipcMain/controller/notice 收集器），不触碰 Electron；main.ts 接线沿
// UPD-DESKTOP-INSTALL-DRAINS-FIRST 的源码契约先例锁定。
import { describe, expect, it, vi } from 'vitest'
import { access, readFile } from 'node:fs/promises'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  bootNoticeFromCheckView,
  shouldAutoCheckOnBoot,
  type DesktopUpdateCheckView,
  type DesktopUpdateController,
  type DesktopUpdateNotice,
} from '../src/desktop-updates.js'
import { registerUpdateIpc } from '../src/update-ipc.js'

/** 手写 fixture：有新版视图（期望值独立于实现，不从实现抄） */
const availableView: DesktopUpdateCheckView = {
  currentVersion: '1.3.0',
  latestVersion: '9.9.9',
  updateAvailable: true,
  releaseNotes: '修复若干问题，优化更新体验',
  error: null,
}
const latestView: DesktopUpdateCheckView = {
  currentVersion: '1.3.0',
  latestVersion: '1.3.0',
  updateAvailable: false,
  releaseNotes: null,
  error: null,
}
const failedView: DesktopUpdateCheckView = {
  currentVersion: '1.3.0',
  latestVersion: null,
  updateAvailable: false,
  releaseNotes: null,
  error: '无法检查更新：网络错误（ECONNREFUSED）',
}

interface Deferred {
  promise: Promise<DesktopUpdateCheckView>
  resolve(view: DesktopUpdateCheckView): void
  reject(error: unknown): void
}

function deferredView(): Deferred {
  let resolve!: Deferred['resolve']
  let reject!: Deferred['reject']
  const promise = new Promise<DesktopUpdateCheckView>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

interface Harness {
  gate: Deferred
  started: number
  notices: DesktopUpdateNotice[]
  logger: { error: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn>, info: ReturnType<typeof vi.fn> }
}

function registerBootCheck(options: { channelKind: 'packaged' | 'dev', bootCheckOutPath?: string | null }): Harness {
  const gate = deferredView()
  const harness: Harness = {
    gate,
    started: 0,
    notices: [],
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  }
  const controller: DesktopUpdateController = {
    checkForUpdates: () => { throw new Error('boot check 不应落到 controller 默认实现') },
    downloadAndInstall: async () => ({ ok: true as const }),
  }
  registerUpdateIpc({
    ipcMain: { handle: () => { /* 桩：本测试不测 invoke 面 */ } },
    controller,
    channelKind: options.channelKind,
    runBootCheck: () => { harness.started += 1; return gate.promise },
    bootCheckOutPath: options.bootCheckOutPath ?? null,
    onBootNotice: notice => { harness.notices.push(notice) },
    logger: harness.logger,
  })
  return harness
}

/** 排空 fire-and-forget 微任务链（then/catch 已就绪后） */
async function flushAsync(): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, 0) })
}

/** 等可观测性缝产物落盘（真实异步 fs，跨多个 macrotask；至多约 2s） */
async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await access(path); return } catch { await new Promise(resolve => { setTimeout(resolve, 20) }) }
  }
  throw new Error(`可观测性缝产物未在预期时间内落盘：${path}`)
}

describe('UPD-BOOT-AUTO-CHECK: boot 自动检查编排（update-ipc 注入桩）', () => {
  it('UPD-BOOT-AUTO-CHECK: packaged 形态注册即自动执行一次 boot 检查，无需任何 env 缝', async () => {
    const harness = registerBootCheck({ channelKind: 'packaged' })
    expect(harness.started).toBe(1)
    harness.gate.resolve(availableView)
    await flushAsync()
    expect(harness.notices).toEqual([{ version: '9.9.9', releaseNotes: '修复若干问题，优化更新体验' }])
  })

  it('UPD-BOOT-AUTO-CHECK: dev 形态绝不自动检查（开发环境启动不打更新源）', async () => {
    const harness = registerBootCheck({ channelKind: 'dev' })
    await flushAsync()
    expect(harness.started).toBe(0)
    expect(harness.notices).toEqual([])
    expect(harness.logger.warn).not.toHaveBeenCalled()
  })

  it('UPD-BOOT-AUTO-CHECK: 检查失败视图保持静默——只 warn 不通知不抛出', async () => {
    const harness = registerBootCheck({ channelKind: 'packaged' })
    harness.gate.resolve(failedView)
    await flushAsync()
    expect(harness.notices).toEqual([])
    expect(harness.logger.warn).toHaveBeenCalledTimes(1)
    expect(harness.logger.warn).toHaveBeenCalledWith('[desktop] update boot check failed:', failedView.error)
    expect(harness.logger.error).not.toHaveBeenCalled()
  })

  it('UPD-BOOT-AUTO-CHECK: 检查 promise 拒绝同样被吞掉——warn 一次零通知', async () => {
    const harness = registerBootCheck({ channelKind: 'packaged' })
    harness.gate.reject(new Error('adapter exploded'))
    await flushAsync()
    expect(harness.notices).toEqual([])
    expect(harness.logger.warn).toHaveBeenCalled()
  })

  it('UPD-QUIT-TYPEERROR-GUARD: 检查 reject(undefined) 只 warn 一次且观测缝如实落盘 undefined 字符串', async () => {
    // reject(undefined) 形态（EventEmitter error 无参 / 外部库 reject 非法值——用户 2026-10-11
    // 真机 TypeError 崩溃窗的候选生成面）：boot 检查链零无守卫读取，失败视图如实字符串化。
    const outPath = join(tmpdir(), `upd-quit-guard-${randomUUID()}.json`)
    const harness = registerBootCheck({ channelKind: 'packaged', bootCheckOutPath: outPath })
    harness.gate.reject(undefined)
    await waitForFile(outPath)
    const written = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>
    expect(written.channel).toBe('packaged')
    expect(written.error).toBe('undefined')
    expect(harness.logger.warn).toHaveBeenCalledTimes(1)
    await rm(outPath, { force: true })
  })

  it('UPD-BOOT-AUTO-CHECK: 已是最新版本不产生任何通知（零打扰）', async () => {
    const harness = registerBootCheck({ channelKind: 'packaged' })
    harness.gate.resolve(latestView)
    await flushAsync()
    expect(harness.notices).toEqual([])
    expect(harness.logger.warn).not.toHaveBeenCalled()
  })

  it('UPD-BOOT-AUTO-CHECK: 可观测性缝保留——设置 BOOT_CHECK_OUT 时检查结果仍原子落盘供冒烟断言', async () => {
    const outPath = join(tmpdir(), `trainer-boot-check-${randomUUID()}.json`)
    const harness = registerBootCheck({ channelKind: 'packaged', bootCheckOutPath: outPath })
    harness.gate.resolve(availableView)
    await waitForFile(outPath)
    const written = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>
    expect(written.channel).toBe('packaged')
    expect(written.latestVersion).toBe('9.9.9')
    expect(written.updateAvailable).toBe(true)
    expect(harness.notices).toHaveLength(1)
    await rm(outPath, { force: true })
  })
})

describe('UPD-BOOT-AUTO-CHECK: 纯决策函数（desktop-updates.ts）', () => {
  it('UPD-BOOT-AUTO-CHECK: shouldAutoCheckOnBoot 只对 packaged 通道放行', () => {
    expect(shouldAutoCheckOnBoot('packaged')).toBe(true)
    expect(shouldAutoCheckOnBoot('dev')).toBe(false)
  })

  it('UPD-BOOT-AUTO-CHECK: bootNoticeFromCheckView 只把干净的有新版视图映射为通知载荷', () => {
    expect(bootNoticeFromCheckView(availableView)).toEqual({ version: '9.9.9', releaseNotes: '修复若干问题，优化更新体验' })
    // notes 缺失是合法通知（便携条目无 notes）
    expect(bootNoticeFromCheckView({ ...availableView, releaseNotes: null })).toEqual({ version: '9.9.9', releaseNotes: null })
    // 无新版 / 失败视图 / 坏视图（有 error 却带可用标记）一律 null——零打扰且不做部分判读
    expect(bootNoticeFromCheckView(latestView)).toBeNull()
    expect(bootNoticeFromCheckView(failedView)).toBeNull()
    expect(bootNoticeFromCheckView({ ...availableView, error: '坏清单' })).toBeNull()
    expect(bootNoticeFromCheckView({ ...availableView, latestVersion: null })).toBeNull()
  })
})

describe('UPD-BOOT-AUTO-CHECK: 主进程接线源码契约（main.ts）', () => {
  const readMainSource = async (): Promise<string> =>
    readFile(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')

  it('UPD-BOOT-AUTO-CHECK: main.ts 把 boot 通知接到渲染端事件面并在页面加载完成后补投', async () => {
    const source = await readMainSource()
    // onBootNotice → 缓存＋即时投递（经既有 sendUpdateEvent 事件面，无新 IPC 通道）
    expect(source).toMatch(/onBootNotice:\s*notice\s*=>\s*\{[\s\S]{0,120}bootUpdateNotice\s*=\s*notice/)
    expect(source).toMatch(/update-available-notice/)
    // 启动时序竞态兜底：检查先于渲染端订阅完成时，did-finish-load 后补投缓存通知
    expect(source).toMatch(/did-finish-load[\s\S]{0,120}deliverBootUpdateNotice\(\)/)
  })
})
