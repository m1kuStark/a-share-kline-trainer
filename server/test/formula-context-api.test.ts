import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerApi } from '../src/api.js'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'

// M9-03 服务端股票上下文接口测试（RED 先行）。
// GET /api/formulas/context?code= → { code, name, industry: {name, blockCode,
// indexCode} | null, industryIndexBars: MarketData[] | null, reason? }。
// 冻结口径：行业文件缺失→industry/bars null＋人话 reason，不 500。
//
// 可移植性：fixture 轨用纯 ASCII 合成的 tdxzs3.cfg/tdxhy.cfg（industry.ts 按
// gb18030 解码，纯 ASCII 字节两侧等价）＋合成 .day 记录；真机轨（env TRAINER_TDX_ROOT_TEST
// 或默认 D:/MySoftWares/TDX）按存在性守卫内联跳过并醒目告警（环境守卫＝普通 it＋内联 return）。
//
// blockCode→880 映射规则（worker 实测披露）：tdxzs3.cfg type=2 行 parts[1] 即 880
// 指数代码、parts[5] 为 T 根 blockCode；industry.ts tRoots 路径下 IndustryEntry.id
// 就是 880xxx（真机 56 根全部有对应 sh880xxx.day）。规则＝id 匹配 ^880\d{3}$ →
// indexCode='sh'+id。

function dayRecord(date: number, open: number, high: number, low: number, close: number, amount: number, volume: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(Math.round(open * 100), 4)
  buffer.writeInt32LE(Math.round(high * 100), 8)
  buffer.writeInt32LE(Math.round(low * 100), 12)
  buffer.writeInt32LE(Math.round(close * 100), 16)
  buffer.writeFloatLE(amount, 20)
  buffer.writeInt32LE(volume, 24)
  return buffer
}

/** 56 个 ASCII 行业目录＋成员表；第 21 行（T0121/880321）归属 600519 */
function industryConfigLines(): { zs3: string; hy: string } {
  const zs3Rows: string[] = []
  const hyRows: string[] = []
  for (let i = 0; i < 56; i++) {
    const root = `T01${String(i + 1).padStart(2, '0')}`
    const id = `880${301 + i}`
    zs3Rows.push(`IND${String(i + 1).padStart(2, '0')}|${id}|2|1|0|${root}`)
    const code = i === 20 ? '600519' : `6001${String(i + 1).padStart(2, '0')}`
    hyRows.push(`0|${code}|${root}`)
  }
  return { zs3: zs3Rows.join('\r\n') + '\r\n', hy: hyRows.join('\r\n') + '\r\n' }
}

const INDUSTRY_ROOT = 'T0121'
const INDUSTRY_INDEX_CODE = 'sh880321'

interface FixtureOptions {
  withIndustryConfig?: boolean
  withIndustryDay?: boolean
}

async function createFixture(options: FixtureOptions = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tdx-formula-context-'))
  await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
  await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
  await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), Buffer.concat([
    dayRecord(20250106, 10, 11, 9.5, 10.5, 100, 1000),
    dayRecord(20250107, 10.5, 11, 10, 10.8, 120, 1200),
  ]))
  if (options.withIndustryConfig) {
    const { zs3, hy } = industryConfigLines()
    await writeFile(join(root, 'T0002', 'hq_cache', 'tdxzs3.cfg'), zs3, 'latin1')
    await writeFile(join(root, 'T0002', 'hq_cache', 'tdxhy.cfg'), hy, 'latin1')
  }
  if (options.withIndustryDay) {
    await writeFile(join(root, 'vipdoc', 'sh', 'lday', `${INDUSTRY_INDEX_CODE}.day`), Buffer.concat([
      dayRecord(20250106, 3000, 3100, 2950, 3050, 1e11, 9e8),
      dayRecord(20250107, 3050, 3120, 3000, 3100, 1.2e11, 1e9),
      dayRecord(20250108, 3100, 3150, 3050, 3120, 9e10, 8e8),
    ]))
  }
  return root
}

async function createApp(root: string | null) {
  const database = new DatabaseSync(':memory:')
  migrateDatabase(database)
  const app = Fastify()
  const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
  await registerApi(app, config, database)
  return { app, database }
}

function localMidnight(date: number): number {
  const s = String(date)
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))).getTime()
}

/** .day 记录的成交额按 float32 存储（dayfile.ts getFloat32 口径）——期望值独立按同精度换算 */
function float32(value: number): number {
  const buffer = Buffer.alloc(4)
  buffer.writeFloatLE(value, 0)
  return buffer.readFloatLE(0)
}

describe('formula context API', () => {
  it('returns stock context with industry and index bars from fixture data', async () => {
    const root = await createFixture({ withIndustryConfig: true, withIndustryDay: true })
    const { app, database } = await createApp(root)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/formulas/context?code=600519' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.code).toBe('600519')
      // 无 tnf 名称文件 → 目录扫描回退名为代码（披露口径）
      expect(body.name).toBe('600519')
      expect(body.industry).toEqual({ name: 'IND21', blockCode: INDUSTRY_ROOT, indexCode: INDUSTRY_INDEX_CODE })
      expect(Array.isArray(body.industryIndexBars)).toBe(true)
      expect(body.industryIndexBars).toHaveLength(3)
      // .day 读取器对 880 代码可用：首条 close=3050、时间戳为本地午夜、升序、amount 按 float32 口径
      expect(body.industryIndexBars[0]).toMatchObject({ open: 3000, high: 3100, low: 2950, close: 3050, volume: 9e8, amount: float32(1e11) })
      expect(body.industryIndexBars[0].timestamp).toBe(localMidnight(20250106))
      expect(body.industryIndexBars.map((b: { timestamp: number }) => b.timestamp)).toEqual(
        [20250106, 20250107, 20250108].map(localMidnight),
      )
      expect(body.reason).toBeUndefined()
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts explicit market prefixed code and resolves the same context', async () => {
    const root = await createFixture({ withIndustryConfig: true, withIndustryDay: true })
    const { app, database } = await createApp(root)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/formulas/context?code=sh600519' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.code).toBe('600519')
      expect(body.industry?.indexCode).toBe(INDUSTRY_INDEX_CODE)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null industry with human readable reason when industry files are missing', async () => {
    // vipdoc 存在但 T0002/hq_cache 无行业文件：不 500，industry/bars null＋reason
    const root = await createFixture()
    const { app, database } = await createApp(root)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/formulas/context?code=600519' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.code).toBe('600519')
      expect(body.industry).toBeNull()
      expect(body.industryIndexBars).toBeNull()
      expect(body.reason).toMatch(/行业/)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null bars with reason when industry day file is missing', async () => {
    // 行业目录在（T0121→sh880321）但对应指数 .day 缺失：industry 非 null、bars null＋reason
    const root = await createFixture({ withIndustryConfig: true })
    const { app, database } = await createApp(root)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/formulas/context?code=600519' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.industry).toEqual({ name: 'IND21', blockCode: INDUSTRY_ROOT, indexCode: INDUSTRY_INDEX_CODE })
      expect(body.industryIndexBars).toBeNull()
      expect(body.reason).toMatch(/指数|日线/)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid or missing code with 400', async () => {
    const root = await createFixture({ withIndustryConfig: true })
    const { app, database } = await createApp(root)
    try {
      const bad = await app.inject({ method: 'GET', url: '/api/formulas/context?code=abc' })
      expect(bad.statusCode).toBe(400)
      const missing = await app.inject({ method: 'GET', url: '/api/formulas/context' })
      expect(missing.statusCode).toBe(400)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('responds 503 when tdx root is not configured', async () => {
    const { app, database } = await createApp(null)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/formulas/context?code=600519' })
      expect(response.statusCode).toBe(503)
    } finally {
      await app.close()
      database.close()
    }
  })

  // 真机数据轨：真实 GBK 行业文件与 880 指数日线（TDX_ROOT 真实数据；缺失时醒目跳过并披露）。
  // 真机全目录扫描（5566+ 只 stat＋tnf 解析）超默认 5s——按 api.test.ts 既有先例显式 30s 等待预算，断言语义不变。
  it('returns real tdx context for 600519 with industry niangjiu and sh880380 bars', { timeout: 30_000 }, async () => {
    const realRoot = process.env.TRAINER_TDX_ROOT_TEST?.trim() || 'D:/MySoftWares/TDX'
    if (!existsSync(join(realRoot, 'vipdoc', 'sh', 'lday', 'sh880380.day'))) {
      console.warn(`[formula-context-api] 真机 TDX 数据缺失，跳过真机轨：${realRoot}`)
      return
    }
    const { app, database } = await createApp(realRoot)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/formulas/context?code=600519' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.code).toBe('600519')
      expect(body.name).toBe('贵州茅台')
      // 实测锚点：600519→T030501→酿酒行业根 T0305→880380（酿酒行业指数）
      expect(body.industry).toEqual({ name: '酿酒', blockCode: 'T0305', indexCode: 'sh880380' })
      expect(Array.isArray(body.industryIndexBars)).toBe(true)
      expect(body.industryIndexBars.length).toBeGreaterThan(0)
      const stamps = body.industryIndexBars.map((b: { timestamp: number }) => b.timestamp)
      expect([...stamps].sort((a: number, b: number) => a - b)).toEqual(stamps)
    } finally {
      await app.close()
      database.close()
    }
  })
})
