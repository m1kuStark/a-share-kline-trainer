import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

// UPD-02 设置页「关于与更新」分栏前端纯逻辑（web/src/updateFlow.ts）。
// 独立 oracle 原则：期望文案全部来自架构师 UPD-02 派发简报冻结的映射表原文
// （守卫四码人话、状态机动词、断线文案、2s×15 重连参数），非实现回显；
// 重连/终态/进度的数值期望由契约 §2.3（progress∈[0,1]）与简报示例参数独立计算。
// 取数方式沿用 kdj-indicator.test.ts 的"读取 web 源码＋ts.transpile 提取执行"模式：
// 测的是 web/src/updateFlow.ts 的真实导出，不在测试里复制实现。

/** 执行 web/src/updateFlow.ts 真实模块（CommonJS 转译；该模块不得有 Vue/浏览器依赖） */
async function loadUpdateFlowModule(): Promise<Record<string, unknown>> {
  const source = await readFile(new URL('../../web/src/updateFlow.ts', import.meta.url), 'utf8')
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
  const exports_: Record<string, unknown> = {}
  new Function('exports', 'require', js)(exports_, (name: string): unknown => {
    throw new Error(`意外的依赖引用：${name}（updateFlow.ts 必须零依赖纯函数）`)
  })
  return exports_
}

type UpdateFlowState = string

describe('UPD-UI: updateFlow 状态机呈现文案（设计 §3 表）', () => {
  it('renders every contract state with its frozen Chinese label', async () => {
    const mod = await loadUpdateFlowModule()
    const labels = mod.UPDATE_STATE_TEXT as Record<UpdateFlowState, string>
    expect(typeof labels).toBe('object')
    // 契约 §2.3 八态逐一锁定（简报决策 2：下载进度→校验→备份→换装→重启中）
    expect(labels.downloading).toContain('下载')
    expect(labels.verifying).toContain('校验')
    expect(labels.backing_up).toContain('备份')
    expect(labels.applying).toContain('安装')
    expect(labels.restarting).toContain('重启')
    expect(labels.completed).toContain('完成')
    expect(labels.failed).toContain('失败')
    expect(labels.idle).toBeTruthy()
    // 八态文案互不重复（状态机呈现可区分）
    expect(new Set(Object.values(labels)).size).toBe(8)
  })

  it('classifies busy vs terminal states for the polling loop', async () => {
    const mod = await loadUpdateFlowModule()
    const isBusy = mod.isBusyUpdatePhase as (state: UpdateFlowState) => boolean
    const isTerminal = mod.isTerminalUpdateState as (state: UpdateFlowState) => boolean
    for (const state of ['downloading', 'verifying', 'backing_up', 'applying', 'restarting']) {
      expect(isBusy(state), `busy: ${state}`).toBe(true)
      expect(isTerminal(state), `non-terminal: ${state}`).toBe(false)
    }
    for (const state of ['idle', 'completed', 'failed']) {
      expect(isBusy(state), `not busy: ${state}`).toBe(false)
      expect(isTerminal('completed')).toBe(true)
      expect(isTerminal('failed')).toBe(true)
      expect(isTerminal('idle')).toBe(false)
    }
  })

  it('maps progress 0..1 to a clamped integer percent', async () => {
    const mod = await loadUpdateFlowModule()
    const percent = mod.updateProgressPercent as (progress: number | null) => number | null
    expect(percent(null)).toBeNull()
    expect(percent(0)).toBe(0)
    expect(percent(0.5)).toBe(50)
    expect(percent(0.999)).toBe(100)
    expect(percent(1)).toBe(100)
    // 夹取：越界输入不得产生 <0 或 >100 的展示值
    expect(percent(1.5)).toBe(100)
    expect(percent(-0.2)).toBe(0)
  })

  it('labels a version for display and marks unknown explicitly', async () => {
    const mod = await loadUpdateFlowModule()
    const label = mod.versionLabel as (version: string | null) => string
    expect(label('1.2.7')).toBe('v1.2.7')
    expect(label('9.9.9')).toBe('v9.9.9')
    expect(label(null)).toBe('未知')
  })
})

describe('UPD-UI-GUARD-MESSAGES: apply 守卫人话映射（设计 §5 表）', () => {
  it('maps the four frozen guard codes to their exact brief wording', async () => {
    const mod = await loadUpdateFlowModule()
    const guard = mod.updateGuardText as (error: string | null | undefined, serverMessage?: string | null) => string
    // 派发简报决策 3 冻结原文（独立 oracle，禁止从实现抄值改写）
    expect(guard('UPDATE_NOT_PACKAGED')).toBe('当前为开发/源码运行，请使用发布包更新')
    expect(guard('UPDATE_IN_PROGRESS')).toBe('更新已在进行中')
    expect(guard('ACTIVE_TRAINING')).toBe('请先结束当前训练')
    expect(guard('UPDATE_NOT_AVAILABLE')).toBe('没有可用的更新')
  })

  it('falls back to the server message, then to a generic line', async () => {
    const mod = await loadUpdateFlowModule()
    const guard = mod.updateGuardText as (error: string | null | undefined, serverMessage?: string | null) => string
    expect(guard('UPDATE_MANIFEST_FAILED', '无法检查更新：访问更新清单失败（HTTP 500）')).toBe('无法检查更新：访问更新清单失败（HTTP 500）')
    expect(guard('SOME_NEW_CODE', null)).toBe('更新失败：SOME_NEW_CODE')
    expect(guard(null, null)).toBe('更新失败')
  })
})

describe('UPD-UI-APPLY-FLOW: 断线退避重连参数（2s×15，简报冻结）', () => {
  it('exposes the frozen reconnect schedule as constants', async () => {
    const mod = await loadUpdateFlowModule()
    expect(mod.RECONNECT_INTERVAL_MS).toBe(2000)
    expect(mod.RECONNECT_MAX_ATTEMPTS).toBe(15)
  })

  it('keeps a flat 2s interval for attempts 0..14 and gives up at 15', async () => {
    const mod = await loadUpdateFlowModule()
    const next = mod.nextReconnectDelayMs as (attempt: number) => number | null
    expect(next(0)).toBe(2000)
    expect(next(7)).toBe(2000)
    expect(next(14)).toBe(2000)
    expect(next(15)).toBeNull()
  })
})

describe('UPD-UI-APPLY-FLOW: 组件接线源码契约（沿 UPD-VERSION-EXPOSE 的 index.ts 源码契约先例）', () => {
  it('TrainingSettings.vue wires the apply flow: confirm text, health refresh on completed, reconnect display', async () => {
    const source = await readFile(new URL('../../web/src/components/TrainingSettings.vue', import.meta.url), 'utf8')
    // 确认弹窗（说明将自动重启）：简报决策 2 文案
    expect(source).toContain('将下载新版本并自动重启训练器，更新过程中请勿关闭窗口。确定继续？')
    // completed 以 health.currentVersion 为准（重拉 loadUpdateVersion），非 targetVersion 回显
    expect(source).toMatch(/onApplyCompleted[\s\S]{0,200}loadUpdateVersion\(\)/)
    expect(source).toContain('已更新到 {{ versionLabel(applyCompletedVersion) }}')
    // 断线窗口呈现（重连尝试 n/15）＋守卫人话＋三个端点真的被调用
    expect(source).toContain('正在重启，等待服务回来…（重连尝试')
    expect(source).toContain('updateGuardText(')
    expect(source).toContain("fetch('/api/update/check')")
    expect(source).toContain("fetch('/api/update/apply', { method: 'POST' })")
    expect(source).toContain("fetch('/api/update/status')")
    // 卸载清定时器（轮询不泄漏到关闭后的面板）
    expect(source).toMatch(/onUnmounted\(\(\) => \{[\s\S]{0,200}stopUpdatePolling\(\)/)
  })
})

describe('UPD-UI-APPLY-FLOW: 轮询决策核心 decidePollStep（契约 §2.3 状态机→轮询行为）', () => {
  type Fetched =
    | { ok: true, view: { state: string, progress: number | null, error: string | null } }
    | { ok: false }

  async function decide(failedReconnects: number, fetched: Fetched): Promise<Record<string, unknown>> {
    const mod = await loadUpdateFlowModule()
    const fn = mod.decidePollStep as (count: number, result: Fetched) => Record<string, unknown>
    return fn(failedReconnects, fetched)
  }

  it('continues at 1s while a busy phase renders with download progress', async () => {
    // downloading 带 progress→百分比呈现＋1s 继续（简报决策 2：轮询呈现状态机）
    const busyDownload = await decide(0, { ok: true, view: { state: 'downloading', progress: 0.42, error: null } })
    expect(busyDownload.kind).toBe('render-state')
    expect(busyDownload.state).toBe('downloading')
    expect(busyDownload.progressPercent).toBe(42)
    expect(busyDownload.continueDelayMs).toBe(1000)
    // 其余 busy 态同样 1s 继续，progress 非 downloading 态不展示
    for (const state of ['verifying', 'backing_up', 'applying', 'restarting']) {
      const step = await decide(0, { ok: true, view: { state, progress: 0.5, error: null } })
      expect(step.kind).toBe('render-state')
      expect(step.state).toBe(state)
      expect(step.progressPercent).toBeNull()
      expect(step.continueDelayMs).toBe(1000)
    }
  })

  it('stops on terminal states: completed and failed carry no continue delay', async () => {
    const completed = await decide(0, { ok: true, view: { state: 'completed', progress: null, error: null } })
    expect(completed.kind).toBe('render-state')
    expect(completed.state).toBe('completed')
    expect(completed.continueDelayMs).toBeNull()
    const failed = await decide(0, { ok: true, view: { state: 'failed', progress: null, error: '校验失败' } })
    expect(failed.kind).toBe('render-state')
    expect(failed.state).toBe('failed')
    expect(failed.continueDelayMs).toBeNull()
    // idle（无更新在途）也停
    const idle = await decide(0, { ok: true, view: { state: 'idle', progress: null, error: null } })
    expect(idle.kind).toBe('render-state')
    expect(idle.state).toBe('idle')
    expect(idle.continueDelayMs).toBeNull()
  })

  it('treats a fetch failure as the restart window: reconnect with flat backoff up to the 15th attempt', async () => {
    // 断线窗口（旧服务已退/新服务未起）→ 重连计数递增、2s 间隔；恢复后由下一次成功的 render-state 承接
    const first = await decide(0, { ok: false })
    expect(first.kind).toBe('reconnect')
    expect(first.attempt).toBe(1)
    expect(first.delayMs).toBe(2000)
    const mid = await decide(7, { ok: false })
    expect(mid.kind).toBe('reconnect')
    expect(mid.attempt).toBe(8)
    expect(mid.delayMs).toBe(2000)
    const last = await decide(14, { ok: false })
    expect(last.kind).toBe('reconnect')
    expect(last.attempt).toBe(15)
    expect(last.delayMs).toBe(2000)
    // 第 16 次失败（已用尽 15 次）→ 放弃（调用方呈现手动 Start.cmd 指引）
    const giveUp = await decide(15, { ok: false })
    expect(giveUp.kind).toBe('give-up')
    // 恢复示例：重连 5 次后成功读到 completed（契约明示恢复后 status 可能直接 completed）→ 终态呈现
    const recovered = await decide(5, { ok: true, view: { state: 'completed', progress: null, error: null } })
    expect(recovered.kind).toBe('render-state')
    expect(recovered.state).toBe('completed')
    expect(recovered.continueDelayMs).toBeNull()
  })
})

// ===== PACK-04 桌面更新通道（渲染端纯逻辑；契约＝docs/verification/2026-10/PACK-04/design.md §2/§4） =====
// oracle：通道三档探测语义（纯浏览器→http 零变化 / packaged→desktop / dev→http）与四事件
// 呈现映射来自 PACK-04 派发简报决策 2「UI 文案复用现有三态」＋design §2.4 事件表；
// percent 夹取期望独立计算（42.5→43、150→100、-5→0）。

describe('PACK-04 桌面通道: detectUpdateChannel 通道探测（design §2.1）', () => {
  type ChannelApi = { channel(): { kind: string } }

  async function detect(api: ChannelApi | undefined): Promise<string> {
    const mod = await loadUpdateFlowModule()
    const fn = mod.detectUpdateChannel as (api: ChannelApi | undefined) => string
    return fn(api)
  }

  it('a browser without the preload (no desktopUpdates) keeps the existing http flow', async () => {
    expect(await detect(undefined)).toBe('http')
  })

  it('a packaged desktop (kind=packaged) switches to the desktop IPC flow', async () => {
    expect(await detect({ channel: () => ({ kind: 'packaged' }) })).toBe('desktop')
  })

  it('a dev/source desktop (kind=dev) falls back to the existing http flow', async () => {
    expect(await detect({ channel: () => ({ kind: 'dev' }) })).toBe('http')
  })
})

describe('PACK-04 桌面通道: desktopEventToApplyView 事件呈现映射（design §2.4 事件表）', () => {
  type UpdateEvent = { type: string, percent?: number, message?: string, version?: string }

  async function mapEvent(event: UpdateEvent): Promise<Record<string, unknown>> {
    const mod = await loadUpdateFlowModule()
    const fn = mod.desktopEventToApplyView as (event: UpdateEvent) => Record<string, unknown>
    return fn(event)
  }

  it('maps download progress onto the existing downloading presentation with a clamped percent', async () => {
    // electron-updater percent 为 0..100；渲染端夹取成 0..100 整数（与 http 通道 0..1→整数同呈现粒度）
    expect(await mapEvent({ type: 'download-progress', percent: 42.5 })).toEqual({ state: 'downloading', progressPercent: 43 })
    expect(await mapEvent({ type: 'download-progress', percent: 150 })).toEqual({ state: 'downloading', progressPercent: 100 })
    expect(await mapEvent({ type: 'download-progress', percent: -5 })).toEqual({ state: 'downloading', progressPercent: 0 })
  })

  it('maps downloaded / installing to the additive presentation states', async () => {
    expect(await mapEvent({ type: 'downloaded', version: '9.9.9' })).toEqual({ state: 'downloaded', progressPercent: null })
    expect(await mapEvent({ type: 'installing' })).toEqual({ state: 'installing', progressPercent: null })
  })

  it('maps errors to the failed presentation carrying the human message', async () => {
    expect(await mapEvent({ type: 'error', message: 'HTTP 500' })).toEqual({ state: 'failed', message: 'HTTP 500' })
  })

  it('reuses the frozen downloading label and adds distinct new additive labels', async () => {
    const mod = await loadUpdateFlowModule()
    const base = mod.UPDATE_STATE_TEXT as Record<string, string>
    const desktop = mod.DESKTOP_APPLY_STATE_TEXT as Record<string, string>
    // 复用既有下载文案（不造第二套口径）
    expect(desktop.downloading).toBe(base.downloading)
    // 新增两呈现态非空且互不重复（呈现可区分）
    expect(desktop.downloaded.trim()).not.toBe('')
    expect(desktop.installing.trim()).not.toBe('')
    expect(new Set([desktop.downloading, desktop.downloaded, desktop.installing]).size).toBe(3)
    // failed 语义复用既有失败文案
    expect(desktop.failed).toBe(base.failed)
  })
})

describe('PACK-04 桌面通道: TrainingSettings.vue 接线源码契约（既有 http 分支零改动）', () => {
  it('wires desktop channel probing and the IPC apply flow next to the untouched http flow', async () => {
    const source = await readFile(new URL('../../web/src/components/TrainingSettings.vue', import.meta.url), 'utf8')
    // 通道探测（进入分栏时）
    expect(source).toContain('detectUpdateChannel(')
    // desktop 分支：check 与 downloadAndInstall 走 IPC、订阅事件并退订
    expect(source).toMatch(/desktopUpdates[\s\S]{0,120}checkForUpdates/)
    expect(source).toContain('downloadAndInstall()')
    expect(source).toMatch(/onUpdateEvent\(/)
    expect(source).toMatch(/desktopUnsubscribe/)
    // 既有 http 分支三端点原样保留（与既有 UPD-02 契约并存）
    expect(source).toContain("fetch('/api/update/check')")
    expect(source).toContain("fetch('/api/update/apply', { method: 'POST' })")
    expect(source).toContain("fetch('/api/update/status')")
  })
})
