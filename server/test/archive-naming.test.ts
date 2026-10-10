// DATA-ARCH-01 录像归档语义化命名·纯逻辑单测（web/src/recording/archiveNaming.ts）。
// oracle 独立性：期望文件名手写自任务简报冻结的命名规格
// `<股票名>-<训练模式>-<训练周期>-<起始日yyyymmdd>-收益<±x.xx%>.trainer-session.json.gz`，
// 不从实现回显；档位/随机口径来自 server/src/train（tier 五档、RANGE 哨兵、
// range.mode preset/latest/bars/random、随机维度 random_stock/random_time/random_both）。
// 直接 import web 纯模块是既有先例（chart-navigation.test.ts / keyboard-shortcuts.test.ts）。
import { describe, expect, it } from 'vitest'
import type { CompactRecordingFile } from '../../web/src/recording/compactTypes'
import type { AccountView, TrainingMeta } from '../../web/src/api'
import {
  ARCHIVE_FILE_SUFFIX,
  buildArchiveFileName,
  describeRecordingForArchive,
  monthSpanMatchesTier,
  resolveArchiveConflict,
  sanitizeArchiveSegment,
} from '../../web/src/recording/archiveNaming'

const SUFFIX = ARCHIVE_FILE_SUFFIX

function meta(partial: Partial<TrainingMeta>): TrainingMeta {
  return {
    id: 1,
    tier: '1Y',
    code: '600519',
    name: '贵州茅台',
    market: 'SH',
    startDate: '2026-09-01',
    plannedEnd: '2027-09-01',
    currentDate: '2026-09-01',
    currentPhase: 'close',
    clockMode: 'close_only',
    currentOpen: null,
    currentClose: 100,
    ordersEnabled: false,
    status: 'settled',
    settleDate: '2027-09-01',
    earlySettle: false,
    blind: false,
    adjustMode: 'forward',
    initialCash: 100000,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  }
}

function account(equity: number): AccountView {
  return { cash: equity, shares: 0, availableShares: 0, costPrice: null, marketValue: 0, equity }
}

/** 最小紧凑录制文件：只有命名所需的三张资源表引用（其余字段不在读取路径上） */
function file(parts: {
  metas?: TrainingMeta[]
  accounts?: AccountView[]
  checkpoint?: { metaRef?: string; accountRef?: string } | null
}): CompactRecordingFile {
  const metas = parts.metas ?? []
  const accounts = parts.accounts ?? []
  const checkpoint = parts.checkpoint === undefined ? { metaRef: metas.length ? 'm-last' : undefined, accountRef: accounts.length ? 'a-last' : undefined } : parts.checkpoint
  return {
    format: 'trainer-session',
    schemaVersion: 2,
    sessionId: 'session-x',
    createdAt: '2026-09-01T00:00:00.000Z',
    app: { version: '1.2.7', gitCommit: 'x', dirty: false, chartLibrary: 'klinecharts' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1, height: 1 }, dpr: 1 },
    trainingKey: '1.2026-09-01T00:00:00.000Z',
    events: [],
    gaps: [],
    complete: true,
    checkpoints: checkpoint && (checkpoint.metaRef || checkpoint.accountRef)
      ? [{ id: 'c1', afterSeq: 0, segmentId: 's1', capturedAt: '2026-09-01T00:00:00.000Z', ui: {} as never, training: checkpoint.metaRef ? { metaRef: checkpoint.metaRef, accountRef: checkpoint.accountRef ?? 'a-none', tradeRefs: [] } : null, chart: null, contextRef: null }]
      : [],
    resources: {
      series: [],
      drawings: [],
      trainingMeta: metas.map((value, index) => ({ id: `m-${index === metas.length - 1 ? 'last' : index}`, value })),
      accounts: accounts.map((value, index) => ({ id: `a-${index === accounts.length - 1 ? 'last' : index}`, value })),
      trades: [],
      contexts: [],
    },
  } as unknown as CompactRecordingFile
}

describe('sanitizeArchiveSegment', () => {
  it('替换全部 Windows 非法字符为下划线并去掉首尾空格与结尾点', () => {
    expect(sanitizeArchiveSegment('万 科/A:B*?"<>|', 20)).toBe('万 科_A_B______')
    expect(sanitizeArchiveSegment(' 贵州茅台. ', 20)).toBe('贵州茅台')
    expect(sanitizeArchiveSegment('贵州茅台.', 20)).toBe('贵州茅台')
  })
  it('按字符数截断到上限（含 CJK）', () => {
    expect(sanitizeArchiveSegment('一二三四五六七八九十一二三四五六七八九十一', 20)).toBe('一二三四五六七八九十一二三四五六七八九十')
  })
  it('空串与全非法输入归一为占位符', () => {
    expect(sanitizeArchiveSegment('', 20)).toBe('未知')
    expect(sanitizeArchiveSegment('///', 20)).toBe('未知')
  })
})

describe('monthSpanMatchesTier（随机月份窗口的档位判定，7 天容差）', () => {
  it('自然月跨度命中档位边界（窗末＝起始日＋N 自然月的前一交易日）', () => {
    expect(monthSpanMatchesTier('2026-01-05', '2026-07-03')).toBe('6M')
    expect(monthSpanMatchesTier('2026-01-05', '2026-02-04')).toBe('1M')
    expect(monthSpanMatchesTier('2025-06-02', '2027-06-01')).toBe('2Y')
  })
  it('非档位跨度（自定义起止或根数窗口）返回 null', () => {
    expect(monthSpanMatchesTier('2026-01-05', '2026-03-20')).toBeNull()
    expect(monthSpanMatchesTier('2026-01-05', '2026-07-20')).toBeNull()
    expect(monthSpanMatchesTier('bad', '2026-07-03')).toBeNull()
    expect(monthSpanMatchesTier('2026-01-05', 'bad')).toBeNull()
  })
})

describe('buildArchiveFileName（语义输入 → 文件名）', () => {
  it('经典档位＋结算正收益：档位缩写与 +x.xx%', () => {
    expect(buildArchiveFileName({ stockName: '贵州茅台', modeLabel: '经典', periodLabel: '1Y', startDate: '2026-09-01', settled: true, returnPct: 12.34 }))
      .toBe(`贵州茅台-经典-1Y-20260901-收益+12.34%${SUFFIX}`)
  })
  it('负收益与零收益的符号', () => {
    expect(buildArchiveFileName({ stockName: '贵州茅台', modeLabel: '经典', periodLabel: '1Y', startDate: '2026-09-01', settled: true, returnPct: -5 }))
      .toBe(`贵州茅台-经典-1Y-20260901-收益-5.00%${SUFFIX}`)
    expect(buildArchiveFileName({ stockName: '贵州茅台', modeLabel: '经典', periodLabel: '1Y', startDate: '2026-09-01', settled: true, returnPct: 0 }))
      .toBe(`贵州茅台-经典-1Y-20260901-收益+0.00%${SUFFIX}`)
  })
  it('未结算（放弃/中断）输出「未结算」，不输出收益数字', () => {
    expect(buildArchiveFileName({ stockName: '贵州茅台', modeLabel: '随机时间', periodLabel: '250根', startDate: '2026-01-05', settled: false, returnPct: null }))
      .toBe(`贵州茅台-随机时间-250根-20260105-未结算${SUFFIX}`)
  })
  it('结算但收益不可得时同样输出「未结算」', () => {
    expect(buildArchiveFileName({ stockName: '贵州茅台', modeLabel: '经典', periodLabel: '1Y', startDate: '2026-09-01', settled: true, returnPct: null }))
      .toBe(`贵州茅台-经典-1Y-20260901-未结算${SUFFIX}`)
  })
  it('股票名缺失时用代码，代码也缺失时用「未知标的」', () => {
    expect(buildArchiveFileName({ stockName: null, stockCode: '600519', modeLabel: '经典', periodLabel: '1M', startDate: '2026-09-01', settled: true, returnPct: 1 }))
      .toBe(`600519-经典-1M-20260901-收益+1.00%${SUFFIX}`)
    expect(buildArchiveFileName({ stockName: null, stockCode: null, modeLabel: '经典', periodLabel: '自定义', startDate: null, settled: false, returnPct: null }))
      .toBe(`未知标的-经典-自定义-00000000-未结算${SUFFIX}`)
  })
})

describe('describeRecordingForArchive（录制文件 → 命名输入）', () => {
  it('经典训练：末检查点元信息＋账户推导收益', () => {
    const input = describeRecordingForArchive(file({
      metas: [meta({ status: 'running' }), meta({ status: 'settled', name: '贵州茅台', tier: '1Y', startDate: '2026-09-01' })],
      accounts: [account(90000), account(112340)],
    }))
    expect(input).toMatchObject({ stockName: '贵州茅台', modeLabel: '经典', periodLabel: '1Y', startDate: '2026-09-01', settled: true, returnPct: 12.34 })
  })
  it('随机模式：模式取自运行中元信息的 random 维度，标的/日期取结算后揭晓的末元信息', () => {
    const input = describeRecordingForArchive(file({
      metas: [
        meta({ status: 'running', name: null, code: null, tier: 'RANGE', random: { dimension: 'random_stock', hideStock: true, hideTime: false }, range: { version: 1, mode: 'random', requestedStart: '2026-01-05', requestedEnd: null, startDate: '2026-01-05', endDate: '2026-07-03', barCount: 119, sourceFingerprint: 'f', notes: [] } }),
        meta({ status: 'settled', name: '宁德时代', code: '300750', tier: 'RANGE', startDate: '2026-01-05', range: { version: 1, mode: 'random', requestedStart: '2026-01-05', requestedEnd: null, startDate: '2026-01-05', endDate: '2026-07-03', barCount: 119, sourceFingerprint: 'f', notes: [] } }),
      ],
      accounts: [account(100000)],
    }))
    expect(input).toMatchObject({ stockName: '宁德时代', modeLabel: '随机股票', periodLabel: '6M', startDate: '2026-01-05', settled: true, returnPct: 0 })
  })
  it('随机根数窗口：跨度不命中档位时用「N根」；random_time → 随机时间', () => {
    const input = describeRecordingForArchive(file({
      metas: [meta({ status: 'abandoned', name: '贵州茅台', tier: 'RANGE', random: { dimension: 'random_time', hideStock: false, hideTime: true }, range: { version: 1, mode: 'random', requestedStart: '2025-06-02', requestedEnd: null, startDate: '2025-06-02', endDate: '2026-06-15', barCount: 250, sourceFingerprint: 'f', notes: [] } })],
      accounts: [account(98000)],
    }))
    expect(input).toMatchObject({ modeLabel: '随机时间', periodLabel: '250根', settled: false, returnPct: null })
  })
  it('全随机 → 全随机；经典 range bars → 「N根」；preset → 「自定义」', () => {
    expect(describeRecordingForArchive(file({ metas: [meta({ status: 'settled', tier: 'RANGE', random: { dimension: 'random_both', hideStock: true, hideTime: true }, range: { version: 1, mode: 'random', requestedStart: '2026-03-02', requestedEnd: null, startDate: '2026-03-02', endDate: '2026-03-18', barCount: 13, sourceFingerprint: 'f', notes: [] } })], accounts: [account(100000)] })).modeLabel).toBe('全随机')
    expect(describeRecordingForArchive(file({ metas: [meta({ status: 'settled', tier: 'RANGE', range: { version: 1, mode: 'bars', requestedStart: '2026-01-05', requestedEnd: null, startDate: '2026-01-05', endDate: '2026-07-03', barCount: 120, sourceFingerprint: 'f', notes: [] } })], accounts: [account(100000)] })).periodLabel).toBe('120根')
    expect(describeRecordingForArchive(file({ metas: [meta({ status: 'settled', tier: 'RANGE', range: { version: 1, mode: 'preset', requestedStart: '2026-01-05', requestedEnd: null, startDate: '2026-01-05', endDate: '2026-03-20', barCount: 50, sourceFingerprint: 'f', notes: [] } })], accounts: [account(100000)] })).periodLabel).toBe('自定义')
  })
  it('实时快照覆盖：训练元信息与结算数值以覆盖为准（录制在结束时暂停、末检查点过旧的兜底）', () => {
    const stale = file({
      metas: [meta({ status: 'running', name: null, code: null, tier: 'RANGE', random: { dimension: 'random_stock', hideStock: true, hideTime: false } })],
      accounts: [account(100000)],
    })
    const input = describeRecordingForArchive(stale, {
      training: meta({ status: 'settled', name: '五粮液', code: '000858', tier: 'RANGE', startDate: '2026-02-02', range: { version: 1, mode: 'random', requestedStart: '2026-02-02', requestedEnd: null, startDate: '2026-02-02', endDate: '2026-08-04', barCount: 124, sourceFingerprint: 'f', notes: [] } }),
      settled: true,
      returnPct: -3.5,
    })
    expect(input).toMatchObject({ stockName: '五粮液', modeLabel: '随机股票', periodLabel: '6M', startDate: '2026-02-02', settled: true, returnPct: -3.5 })
  })
  it('无任何训练元信息时输出安全占位命名', () => {
    const input = describeRecordingForArchive(file({ metas: [], accounts: [] }))
    expect(buildArchiveFileName(input)).toBe(`未知标的-经典-自定义-00000000-未结算${SUFFIX}`)
  })
  it('股票名含非法字符时在最终文件名中被替换（结算持平＝收益+0.00%）', () => {
    const input = describeRecordingForArchive(file({ metas: [meta({ name: '万 科/A:B*?"<>|' })], accounts: [account(100000)] }))
    expect(buildArchiveFileName(input)).toBe(`万 科_A_B______-经典-1Y-20260901-收益+0.00%${SUFFIX}`)
  })
})

describe('resolveArchiveConflict（同名冲突序号后缀）', () => {
  const suffix = (stem: string, n: number) => `${stem}-${n}${SUFFIX}`
  it('基础名可用时原样返回', async () => {
    const name = `贵州茅台-经典-1Y-20260901-收益+12.34%${SUFFIX}`
    expect(await resolveArchiveConflict(name, async () => false)).toBe(name)
  })
  it('基础名被占用时依次尝试 -2、-3…（同日同股同模式同收益的第二次）', async () => {
    const name = `贵州茅台-经典-1Y-20260901-收益+12.34%${SUFFIX}`
    const stem = name.slice(0, -SUFFIX.length)
    let calls = 0
    expect(await resolveArchiveConflict(name, async path => { calls++; return path === name || path === suffix(stem, 2) })).toBe(suffix(stem, 3))
    expect(calls).toBe(3)
  })
  it('序号达到上限仍未找到时抛错（防失控循环）', async () => {
    const name = `x-经典-1M-20260901-未结算${SUFFIX}`
    await expect(resolveArchiveConflict(name, async () => true)).rejects.toThrow('同名')
  })
})
