import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

// M6-01 KDJ 副图（通达信口径）。
// 独立 oracle 原则：期望值全部为内嵌常量——12 根夹具与期望 K/D/J 表由架构师预计算
// （矩阵 kdj-subchart KDJ-CALC-TDX 的 oracle 字段，六位小数），本文件禁止调用被测实现生成期望。
// 取数方式沿用 helpers/chart-zoom.ts 的"读取 web 源码＋ts.transpile 提取执行"模式：
// 测的是 web/src/indicators.ts / web/src/appSettings.ts 的真实导出，不在测试里复制实现。

// 夹具：12 根日线 OHLC（架构师提供，见 docs/verification/2026-10/M6-01/README.md）
const FIXTURE_OHLC: ReadonlyArray<readonly [open: number, high: number, low: number, close: number]> = [
  [10.0, 10.2, 9.8, 10.1],
  [10.1, 10.5, 10.0, 10.4],
  [10.4, 10.6, 10.2, 10.3],
  [10.3, 10.8, 10.2, 10.7],
  [10.7, 11.0, 10.5, 10.9],
  [10.9, 11.2, 10.7, 11.1],
  [11.1, 11.3, 10.8, 10.9],
  [10.9, 11.0, 10.4, 10.5],
  [10.5, 10.7, 10.1, 10.2],
  [10.2, 10.9, 10.1, 10.8],
  [10.8, 11.4, 10.7, 11.3],
  [11.3, 11.5, 11.0, 11.1],
]

// 架构师独立期望表（i0..i11，K/D/J 六位小数）；断言用 toBeCloseTo(…, 4)
const EXPECTED_KDJ: ReadonlyArray<readonly [k: number, d: number, j: number]> = [
  [58.333333, 52.777778, 69.444444],
  [67.460317, 57.671958, 87.037037],
  [65.806878, 60.383598, 76.653439],
  [73.871252, 64.879483, 91.854791],
  [79.803057, 69.854007, 99.701156],
  [84.154419, 74.620811, 103.221634],
  [80.547390, 76.596338, 88.449496],
  [69.253816, 74.148830, 59.463787],
  [55.058099, 67.785253, 29.603792],
  [57.218220, 64.262909, 43.128842],
  [68.914711, 65.813510, 75.117113],
  [69.752664, 67.126561, 75.004871],
]

type Bar = { open: number; high: number; low: number; close: number }
const fixtureBars: Bar[] = FIXTURE_OHLC.map(([open, high, low, close]) => ({ open, high, low, close }))

type KdjPoint = { k: number; d: number; j: number }
type KdjFn = (bars: Array<Partial<Bar>>, params: number[]) => KdjPoint[]

type RegisteredIndicator = {
  name: string
  shortName?: string
  calcParams?: number[]
  figures?: Array<{ key: string; title?: string; type?: string }>
  calc?: (dataList: Array<Partial<Bar>>, indicator: { calcParams: number[] }) => KdjPoint[]
}

/** 执行 web/src/indicators.ts 真实模块（CommonJS 转译＋桩 klinecharts），返回导出与注册的指标模板 */
async function loadIndicatorsModule(): Promise<{ exports: Record<string, unknown>; registered: RegisteredIndicator[] }> {
  const source = await readFile(new URL('../../web/src/indicators.ts', import.meta.url), 'utf8')
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
  const registered: RegisteredIndicator[] = []
  const exports_: Record<string, unknown> = {}
  const require_ = (name: string): unknown => {
    if (name !== 'klinecharts') throw new Error(`意外的依赖引用：${name}`)
    return { registerIndicator: (indicator: RegisteredIndicator) => { registered.push(indicator) } }
  }
  new Function('require', 'exports', 'module', js)(require_, exports_, { exports: exports_ })
  return { exports: exports_, registered }
}

/** 执行 web/src/appSettings.ts 的 KDJ 偏好读写片段（桩 localStorage），返回两个纯函数 */
async function loadKdjPreferenceFunctions(): Promise<{
  read: (storage: Pick<Storage, 'getItem'>) => boolean
  write: (storage: Pick<Storage, 'setItem'>, enabled: boolean) => void
}> {
  const source = await readFile(new URL('../../web/src/appSettings.ts', import.meta.url), 'utf8')
  const start = source.indexOf('const KDJ_SUBCHART_STORAGE_KEY')
  const end = source.indexOf('export const appKdjSubchart')
  if (start < 0 || end < 0 || end <= start) throw new Error('KDJ 偏好读写片段未在 appSettings.ts 中找到')
  const js = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
  const exports_: Record<string, unknown> = {}
  new Function('exports', js)(exports_)
  const read = exports_.readKdjSubchartPref as (storage: Pick<Storage, 'getItem'>) => boolean
  const write = exports_.writeKdjSubchartPref as (storage: Pick<Storage, 'setItem'>, enabled: boolean) => void
  if (typeof read !== 'function' || typeof write !== 'function') throw new Error('KDJ 偏好导出缺失（readKdjSubchartPref/writeKdjSubchartPref）')
  return { read, write }
}

function memoryStorage(initial: Record<string, string> = {}): { storage: Storage; items: Record<string, string> } {
  const items: Record<string, string> = { ...initial }
  const storage = {
    getItem: (key: string) => (key in items ? items[key] : null),
    setItem: (key: string, value: string) => { items[key] = String(value) },
  } as unknown as Storage
  return { storage, items }
}

describe('M6-01 KDJ indicator (TDX semantics)', () => {
  it('computes KDJ against the architect oracle table (short windows through the 9-bar window)', async () => {
    const { exports } = await loadIndicatorsModule()
    const computeKdj = exports.computeKdj as KdjFn | undefined
    if (typeof computeKdj !== 'function') throw new Error('computeKdj 未在 indicators.ts 导出')
    const result = computeKdj(fixtureBars, [9, 3, 3])
    expect(result).toHaveLength(EXPECTED_KDJ.length)
    EXPECTED_KDJ.forEach(([k, d, j], index) => {
      expect(result[index].k, `K[${index}]`).toBeCloseTo(k, 4)
      expect(result[index].d, `D[${index}]`).toBeCloseTo(d, 4)
      expect(result[index].j, `J[${index}]`).toBeCloseTo(j, 4)
    })
  })

  it('maps flat bars (HHV=LLV) to RSV=100 and keeps the 50 seeds (hand-derived oracle)', async () => {
    // 独立手算（非实现反推）：两根全平 K 线（H=L=C=5.0）→ RSV=100
    // i0: K=(100+2×50)/3=200/3≈66.666667, D=(200/3+2×50)/3=500/9≈55.555556, J=3K−2D=800/9≈88.888889
    // i1: K=(100+2×200/3)/3=700/9≈77.777778, D=(700/9+2×500/9)/3=1700/27≈62.962963, J=2900/27≈107.407407
    const flat = [{ open: 5, high: 5, low: 5, close: 5 }, { open: 5, high: 5, low: 5, close: 5 }]
    const { exports } = await loadIndicatorsModule()
    const computeKdj = exports.computeKdj as KdjFn
    const result = computeKdj(flat, [9, 3, 3])
    expect(result[0].k).toBeCloseTo(200 / 3, 4)
    expect(result[0].d).toBeCloseTo(500 / 9, 4)
    expect(result[0].j).toBeCloseTo(800 / 9, 4)
    expect(result[1].k).toBeCloseTo(700 / 9, 4)
    expect(result[1].d).toBeCloseTo(1700 / 27, 4)
    expect(result[1].j).toBeCloseTo(2900 / 27, 4)
  })

  it('registers the KDJ template with calcParams [9,3,3], K/D/J line figures and a calc wired to computeKdj', async () => {
    const { exports, registered } = await loadIndicatorsModule()
    const template = registered.find(indicator => indicator.name === 'KDJ')
    if (!template) throw new Error('KDJ 指标未通过 registerIndicator 注册')
    expect(template.shortName).toBe('KDJ')
    expect(template.calcParams).toEqual([9, 3, 3])
    expect(template.figures?.map(figure => [figure.key, figure.title, figure.type])).toEqual([
      ['k', 'K: ', 'line'],
      ['d', 'D: ', 'line'],
      ['j', 'J: ', 'line'],
    ])
    // calc 必须复用同一实现（注册口径与纯函数一致，避免两套口径漂移）
    const calc = template.calc
    if (typeof calc !== 'function') throw new Error('KDJ 模板缺少 calc')
    const viaCalc = calc(fixtureBars, { calcParams: [9, 3, 3] })
    const computeKdj = exports.computeKdj as KdjFn
    EXPECTED_KDJ.forEach(([k, d, j], index) => {
      expect(viaCalc[index].k, `calc K[${index}]`).toBeCloseTo(k, 4)
      expect(viaCalc[index].d, `calc D[${index}]`).toBeCloseTo(d, 4)
      expect(viaCalc[index].j, `calc J[${index}]`).toBeCloseTo(j, 4)
      expect(computeKdj(fixtureBars, [9, 3, 3])[index].k).toBeCloseTo(viaCalc[index].k, 10)
    })
  })

  it('persists the KDJ subchart preference in localStorage with default on (appSettings layer)', async () => {
    const { read, write } = await loadKdjPreferenceFunctions()
    // 未设置 / 异常值 → 默认开（M6-01 任务卡：开关默认 true）
    expect(read(memoryStorage().storage)).toBe(true)
    expect(read(memoryStorage({ trainer_kdj_subchart: 'garbage' }).storage)).toBe(true)
    // '1' 开 / '0' 关；写入往返
    expect(read(memoryStorage({ trainer_kdj_subchart: '1' }).storage)).toBe(true)
    expect(read(memoryStorage({ trainer_kdj_subchart: '0' }).storage)).toBe(false)
    const off = memoryStorage()
    write(off.storage, false)
    expect(off.items['trainer_kdj_subchart']).toBe('0')
    expect(read(off.storage)).toBe(false)
    const on = memoryStorage({ trainer_kdj_subchart: '0' })
    write(on.storage, true)
    expect(on.items['trainer_kdj_subchart']).toBe('1')
    expect(read(on.storage)).toBe(true)
  })
})
