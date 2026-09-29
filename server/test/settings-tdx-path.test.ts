import Fastify from 'fastify'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDatabase } from '../src/db.js'
import { DatabaseSync } from 'node:sqlite'
import { registerTdxPathSettingsRoutes, parseTdxPathPut } from '../src/settings/tdx-path.js'
import { readSavedTdxChoice, type SavedTdxChoice } from '../src/setup/saved-choice.js'
import type { TdxCandidateCheck } from '../src/tdx/inspect.js'
import type { AppConfig } from '../src/config.js'

// M5-01：TDX 路径设置 API（GET/PUT /api/settings/tdx-path、POST .../validate）。
// 路由尚未在 api.ts 注册（该文件本轮由集成人单写，集成阶段一行接线）；本文件把被测模块
// 直接注册到独立 Fastify 实例，检查器全部注入合成结果，不读取任何真实 TDX 安装或用户目录。

function okInspect(root: string): (root: string) => Promise<TdxCandidateCheck> {
  return async () => ({
    root,
    recognized: true,
    readable: true,
    dailyFileCount: 42,
    latestDate: '2026-09-24',
    hasAdjustment: true,
    hasNames: true,
    hasBenchmark: false,
    problems: [],
  })
}

function failInspect(problems: string[]): (root: string) => Promise<TdxCandidateCheck> {
  return async root => ({
    root,
    recognized: false,
    readable: false,
    dailyFileCount: 0,
    latestDate: null,
    hasAdjustment: false,
    hasNames: false,
    hasBenchmark: false,
    problems,
  })
}

async function createApp(overrides?: {
  effectiveRoot?: string | null
  inspect?: (root: string) => Promise<TdxCandidateCheck>
}) {
  const root = await mkdtemp(join(tmpdir(), 'settings-tdx-path-'))
  const databasePath = join(root, 'trainer.sqlite')
  const database = new DatabaseSync(databasePath)
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    databasePath,
    tdxRoot: overrides?.effectiveRoot === undefined ? null : overrides.effectiveRoot,
  }
  registerTdxPathSettingsRoutes(app, config, {
    dataDir: root,
    ...(overrides?.inspect ? { inspect: overrides.inspect } : {}),
  })
  return { app, database, root }
}

async function closeApp(context: Awaited<ReturnType<typeof createApp>>) {
  await context.app.close()
  context.database.close()
  await rm(context.root, { recursive: true, force: true })
}

describe('M5-01：TDX 路径设置 GET（设置面板数据目录区）', () => {
  it('无 TDX 也可读：effectiveRoot null、savedChoice null，不抛错', async () => {
    const context = await createApp({ effectiveRoot: null })
    try {
      const response = await context.app.inject({ method: 'GET', url: '/api/settings/tdx-path' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ effectiveRoot: null, savedChoice: null })
    } finally {
      await closeApp(context)
    }
  })

  it('GET 反映当前生效根（启动时解析，含 env/发现来源）与已保存选择', async () => {
    const context = await createApp({ effectiveRoot: 'D:\\tdx_live', inspect: okInspect('D:\\tdx_saved') })
    try {
      const saved = await context.app.inject({
        method: 'PUT', url: '/api/settings/tdx-path', payload: { root: 'D:\\tdx_saved' },
      })
      expect(saved.statusCode).toBe(200)
      const view = await context.app.inject({ method: 'GET', url: '/api/settings/tdx-path' })
      expect(view.statusCode).toBe(200)
      const body = view.json()
      expect(body.effectiveRoot).toBe('D:\\tdx_live')
      expect(body.savedChoice).toMatchObject({ version: 1, root: 'D:\\tdx_saved' })
    } finally {
      await closeApp(context)
    }
  })
})

describe('M5-01：TDX 路径设置 PUT（保存前复验、原子、可恢复）', () => {
  it('复验通过才保存：持久化 saved-tdx-choice.json；不热切换本进程生效根；restartRequired 提示', async () => {
    const context = await createApp({ effectiveRoot: 'D:\\tdx_live', inspect: okInspect('D:\\new_tdx') })
    try {
      const response = await context.app.inject({
        method: 'PUT', url: '/api/settings/tdx-path', payload: { root: 'D:\\new_tdx' },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.saved).toMatchObject({ version: 1, root: 'D:\\new_tdx' })
      expect(typeof body.saved.savedAt).toBe('string')
      // 保存只落盘，不改变当前进程的生效根：重启生效由启动器/控制桥完成
      expect(body.effectiveRoot).toBe('D:\\tdx_live')
      expect(body.restartRequired).toBe(true)
      const onDisk = await readSavedTdxChoice(context.root)
      expect(onDisk).toMatchObject({ version: 1, root: 'D:\\new_tdx' })
    } finally {
      await closeApp(context)
    }
  })

  it('保存写入检查器归一化后的根（check.root），而非原始输入', async () => {
    const context = await createApp({ inspect: okInspect('D:\\Normalized\\Root') })
    try {
      const response = await context.app.inject({
        method: 'PUT', url: '/api/settings/tdx-path', payload: { root: ' d:\\normalized\\root\\ ' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().saved.root).toBe('D:\\Normalized\\Root')
    } finally {
      await closeApp(context)
    }
  })

  it('复验失败 400 可行动（含 problems），旧选择原样保留——路径错误可恢复', async () => {
    const context = await createApp({
      effectiveRoot: 'D:\\tdx_live',
      inspect: async root => root === 'D:\\old_choice'
        ? okInspect('D:\\old_choice')(root)
        : failInspect(['根目录不存在：D:\\bad，请确认选择的是通达信安装根目录'])(root),
    })
    try {
      const first = await context.app.inject({
        method: 'PUT', url: '/api/settings/tdx-path', payload: { root: 'D:\\bad' },
      })
      expect(first.statusCode).toBe(400)
      // 独立 Fastify 实例无 api.ts 的统一错误映射，默认序列化把 message 原样下发
      expect(first.json().message).toContain('根目录不存在')
      // 旧文件仍不存在（失败零写），再放一个旧选择后验证失败不破坏旧值
      const good = await context.app.inject({
        method: 'PUT', url: '/api/settings/tdx-path', payload: { root: 'D:\\old_choice' },
      })
      expect(good.statusCode).toBe(200)
      const oldOnDisk = await readSavedTdxChoice(context.root) as SavedTdxChoice
      const second = await context.app.inject({
        method: 'PUT', url: '/api/settings/tdx-path', payload: { root: 'D:\\bad' },
      })
      expect(second.statusCode).toBe(400)
      const afterFail = await readSavedTdxChoice(context.root)
      expect(afterFail).toEqual(oldOnDisk)
    } finally {
      await closeApp(context)
    }
  })

  it('形状校验：非对象/缺 root/root 空白/多字段 400 零写', async () => {
    const context = await createApp({ inspect: okInspect('D:\\x') })
    try {
      for (const payload of [null, 'D:\\x', [], {}, { path: 'D:\\x' }, { root: '' }, { root: '   ' }, { root: 3 }]) {
        const response = await context.app.inject({
          method: 'PUT', url: '/api/settings/tdx-path',
          headers: { 'content-type': 'application/json' },
          payload: payload as unknown as Record<string, unknown>,
        })
        expect(response.statusCode).toBe(400)
      }
      expect(await readSavedTdxChoice(context.root)).toBeNull()
    } finally {
      await closeApp(context)
    }
  })
})

describe('M5-01：TDX 路径校验端点（只读，不落盘）', () => {
  it('validate 返回完整检查结果（可识别/可读/计数/权息名称基准/问题清单），不写文件', async () => {
    const context = await createApp({ inspect: okInspect('D:\\maybe_tdx') })
    try {
      const good = await context.app.inject({
        method: 'POST', url: '/api/settings/tdx-path/validate', payload: { root: 'D:\\maybe_tdx' },
      })
      expect(good.statusCode).toBe(200)
      expect(good.json().check).toEqual({
        root: 'D:\\maybe_tdx',
        recognized: true,
        readable: true,
        dailyFileCount: 42,
        latestDate: '2026-09-24',
        hasAdjustment: true,
        hasNames: true,
        hasBenchmark: false,
        problems: [],
      })
      expect(await readSavedTdxChoice(context.root)).toBeNull()
    } finally {
      await closeApp(context)
    }
  })

  it('validate 对坏路径同样返回检查结果（问题清单驱动 UI 提示），不抛 5xx', async () => {
    const context = await createApp({ inspect: failInspect(['vipdoc 缺失：D:\\bad']) })
    try {
      const bad = await context.app.inject({
        method: 'POST', url: '/api/settings/tdx-path/validate', payload: { root: 'D:\\bad' },
      })
      expect(bad.statusCode).toBe(200)
      expect(bad.json().check.recognized).toBe(false)
      expect(bad.json().check.problems).toContain('vipdoc 缺失：D:\\bad')
    } finally {
      await closeApp(context)
    }
  })

  it('检查器意外失败 503 可行动，不伪装成坏路径', async () => {
    const context = await createApp({
      inspect: async () => {
        throw new Error('磁盘忙')
      },
    })
    try {
      const response = await context.app.inject({
        method: 'POST', url: '/api/settings/tdx-path/validate', payload: { root: 'D:\\x' },
      })
      expect(response.statusCode).toBe(503)
      expect(response.json().message).toContain('磁盘忙')
    } finally {
      await closeApp(context)
    }
  })

  it('validate 形状校验同 PUT：非对象/缺 root/空白 400', async () => {
    const context = await createApp({ inspect: okInspect('D:\\x') })
    try {
      for (const payload of [null, {}, { root: '' }, { root: true }, { root: 'D:\\x', extra: 1 }]) {
        const response = await context.app.inject({
          method: 'POST', url: '/api/settings/tdx-path/validate',
          headers: { 'content-type': 'application/json' },
          payload: payload as unknown as Record<string, unknown>,
        })
        expect(response.statusCode).toBe(400)
      }
    } finally {
      await closeApp(context)
    }
  })
})

describe('M5-01：parseTdxPathPut 纯函数契约', () => {
  it('恰好 {root: 非空字符串} 通过并返回原文；其余 400', () => {
    expect(parseTdxPathPut({ root: 'D:\\tdx' })).toBe('D:\\tdx')
    expect(() => parseTdxPathPut(null)).toThrow()
    expect(() => parseTdxPathPut('D:\\tdx')).toThrow()
    expect(() => parseTdxPathPut({})).toThrow()
    expect(() => parseTdxPathPut({ root: '' })).toThrow()
    expect(() => parseTdxPathPut({ root: '  ' })).toThrow()
    expect(() => parseTdxPathPut({ root: 'D:\\tdx', extra: 1 })).toThrow()
  })
})
