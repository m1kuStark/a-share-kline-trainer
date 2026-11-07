import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'

// DIAG-OPLOG-01：Web 埋点纯逻辑（transpile 真实模块执行，零依赖）。
async function loadTraceModule(): Promise<Record<string, unknown>> {
  const source = await readFile(new URL('../../web/src/operationTrace.ts', import.meta.url), 'utf8')
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
  const exports_: Record<string, unknown> = {}
  new Function('exports', 'require', 'globalThis', js)(exports_, (name: string) => { throw new Error('意外依赖：' + name) }, globalThis)
  return exports_
}

describe('DIAG-OPLOG-01: Web 操作埋点', () => {
  it('点击标签优先级 data-op > aria-label > 可见文本 > title；无标签不采集', async () => {
    const mod = await loadTraceModule()
    const select = mod.selectClickLabel as (target: unknown) => { label: string, tag: string } | null
    const element = (attrs: Record<string, string | null>, text = '', tag = 'BUTTON') => ({
      closest: () => ({
        getAttribute: (name: string) => attrs[name] ?? null,
        textContent: text,
        tagName: tag,
      }),
    })
    expect(select(element({ 'data-op': 'train.start', 'aria-label': '开始训练' }, '按钮', 'BUTTON'))).toEqual({ label: 'train.start', tag: 'button' })
    expect(select(element({ 'aria-label': '推进下一日' }, '推进'))).toEqual({ label: '推进下一日', tag: 'button' })
    expect(select(element({}, '  开始训练  '))).toEqual({ label: '开始训练', tag: 'button' })
    expect(select(element({ title: '提示' }))).toEqual({ label: '提示', tag: 'button' })
    expect(select(element({}, ''))).toBe(null)
    expect(select(null)).toBe(null)
  })

  it('批量队列 flush 载荷带 client/session；发送失败不外抛', async () => {
    const mod = await loadTraceModule()
    const install = mod.installOperationTrace as (options: Record<string, unknown>) => {
      track(type: string, action: string, data?: Record<string, unknown>): void
      flush(): Promise<void>
      dispose(): void
      queueSize(): number
      clientId(): string
      sessionId(): string
    }
    const bodies: Array<Record<string, unknown>> = []
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    const win = {
      addEventListener: (name: string, listener: (...args: unknown[]) => void) => { const list = listeners.get(name) ?? []; list.push(listener); listeners.set(name, list) },
      removeEventListener: (name: string, listener: (...args: unknown[]) => void) => {
        const list = listeners.get(name) ?? []
        listeners.set(name, list.filter(item => item !== listener))
      },
    }
    const trace = install({
      win,
      storage: null,
      randomIdImpl: () => 'fixed-id',
      flushMs: 60_000,
      fetchImpl: async (_url: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return { ok: true } },
    })
    trace.track('ui', 'click', { label: '开始训练' })
    trace.track('error', 'page.error', { message: 'boom' })
    expect(trace.queueSize()).toBe(3)
    await trace.flush()
    expect(trace.queueSize()).toBe(0)
    expect(bodies[0]).toMatchObject({ clientId: 'fixed-id', sessionId: 'fixed-id' })
    const events = bodies[0].events as Array<{ type: string, action: string }>
    expect(events.map(event => event.type + ':' + event.action)).toEqual(['lifecycle:app.ready', 'ui:click', 'error:page.error'])
    trace.dispose()
    expect(listeners.get('click')).toHaveLength(0)

    const failing = install({
      win, storage: null, randomIdImpl: () => 'id-2', flushMs: 60_000,
      fetchImpl: async () => { throw new Error('offline') },
    })
    failing.track('ui', 'click')
    await expect(failing.flush()).resolves.toBeUndefined()
    failing.dispose()
  })

  it('页面错误/未处理拒绝/点击/生命周期监听在 dispose 后成对移除', async () => {
    const mod = await loadTraceModule()
    const install = mod.installOperationTrace as (options: Record<string, unknown>) => { dispose(): void, track: (...args: unknown[]) => void }
    const counts = { add: 0, remove: 0 }
    const win = {
      addEventListener: () => { counts.add += 1 },
      removeEventListener: () => { counts.remove += 1 },
    }
    const trace = install({ win, storage: null, randomIdImpl: () => 'id', flushMs: 60_000, fetchImpl: async () => ({ ok: true }) })
    expect(counts.add).toBe(4)
    trace.dispose()
    expect(counts.remove).toBe(4)
  })
})
