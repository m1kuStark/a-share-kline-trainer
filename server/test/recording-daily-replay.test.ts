import { describe, expect, it } from 'vitest'
import { compactRecording } from '../../web/src/recording/compactCodec'
import { validateCompactRecording } from '../../web/src/recording/compactValidation'
import type { CompactRecordingFile } from '../../web/src/recording/compactTypes'
import {
  DailyReplaySession,
  aggregateDailyBars,
  availablePeriods,
  observationBars,
} from '../../web/src/recording/dailyReplay'
import type { Bar, TrainingSnapshot } from '../../web/src/api'
import type { Drawing } from '../../web/src/drawingState'
import type {
  ChartCapture,
  RecordingCheckpoint,
  RecordingEvent,
  RecordingFile,
} from '../../web/src/recording/types'

const BASE_DATE = '2026-01-05' // 周一
const DATES = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']

function makeBar(date: string, close: number): Bar {
  return { date, open: close - 1, high: close + 1, low: close - 2, close, volume: 1000, amount: close * 1000 }
}

function makeDailyBars(through: number): Bar[] {
  return DATES.slice(0, through + 1).map((date, index) => makeBar(date, 10 + index))
}

function makeTraining(
  currentDate: string,
  equity: number,
  blind = false,
  phase?: 'open' | 'close',
): TrainingSnapshot {
  return {
    training: {
      id: 7,
      tier: '6M',
      code: blind ? null : '600000',
      name: blind ? null : '浦发银行',
      market: 'SH',
      startDate: BASE_DATE,
      plannedEnd: '2026-07-01',
      currentDate: blind ? null : currentDate,
      // RF-03：open_close 训练的检查点带阶段元数据（服务端 TrainingMeta 同源字段）；
      // 不传＝旧快照无阶段字段，回放按 close 口径兼容。
      ...(phase ? { currentPhase: phase, clockMode: 'open_close' as const } : {}),
      status: 'running',
      settleDate: null,
      earlySettle: false,
      blind,
      adjustMode: 'forward',
      initialCash: 100000,
      createdAt: '2026-01-05T01:00:00.000Z',
    },
    account: { cash: 95000, shares: 500, availableShares: 500, costPrice: 10, marketValue: 5000, equity },
    trades: [],
  }
}

function makeDrawing(id: string): Drawing {
  return { id, name: 'segment', paneId: 'candle_pane', points: [{ timestamp: 1, value: 10 }] }
}

function makeChart(timeframe: ChartCapture['timeframe'], bars: Bar[], drawings: Drawing[] = []): ChartCapture {
  return {
    timeframe,
    bars,
    drawings,
    view: { fromTimestamp: 1, toTimestamp: 2, barSpace: 8, paneHeights: { candle_pane: 300 } },
    costPrice: 10,
  }
}

function makeEvent(seq: number, overrides: Partial<RecordingEvent> = {}): RecordingEvent {
  return {
    seq,
    opId: `op-${seq}`,
    segmentId: 'seg-1',
    elapsedMs: seq * 10,
    phase: 'started',
    action: 'training.advance',
    source: 'ui',
    ...overrides,
  }
}

function makePair(
  seq: number,
  opId: string,
  action: RecordingEvent['action'],
  overrides: Partial<RecordingEvent> = {},
): RecordingEvent[] {
  return [
    makeEvent(seq, { opId, action }),
    makeEvent(seq + 1, { opId, action, phase: 'finished', outcome: 'accepted', ...overrides }),
  ]
}

function makeCheckpoint(
  afterSeq: number,
  overrides: Partial<RecordingCheckpoint> = {},
): RecordingCheckpoint {
  return {
    id: `cp-${afterSeq}`,
    afterSeq,
    segmentId: 'seg-1',
    capturedAt: `2026-01-05T09:${String(afterSeq % 60).padStart(2, '0')}:00.000Z`,
    training: null,
    chart: null,
    ui: { theme: 'dark', tool: null, magnet: 'strong', multiSelect: false },
    context: null,
    ...overrides,
  }
}

function makeFile(overrides: Partial<RecordingFile> = {}): RecordingFile {
  return {
    format: 'trainer-session',
    schemaVersion: 1,
    sessionId: 'session-1',
    createdAt: '2026-01-05T01:00:00.000Z',
    app: { version: '0.1.0', gitCommit: 'aba7d82', dirty: false, chartLibrary: 'klinecharts@10.0.3' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1920, height: 1080 }, dpr: 1 },
    trainingKey: '600000-SH-6M',
    events: [],
    checkpoints: [],
    gaps: [],
    complete: true,
    ...overrides,
  }
}

/** 与生产入口同口径：v1 → 紧凑 → 校验，回放会话只消费校验过的紧凑文件 */
function toSession(file: RecordingFile): DailyReplaySession {
  const compact: CompactRecordingFile = validateCompactRecording(compactRecording(file))
  return new DailyReplaySession(compact)
}

describe('日期分组与当日终态（1D 规范检查点）', () => {
  // 日0=D1 初始；推进(4)→D2，交易(6)仍在 D2；推进(8)→D3，画线(9)仍在 D3；随后一次被拒的推进不再加日
  const file = makeFile({
    events: [
      ...makePair(1, 'op-create', 'training.create'),
      ...makePair(3, 'op-adv1', 'training.advance', { checkpointId: 'cp-4' }),
      ...makePair(5, 'op-trade', 'training.trade', { checkpointId: 'cp-6' }),
      ...makePair(7, 'op-adv2', 'training.advance', { checkpointId: 'cp-8' }),
      ...makePair(9, 'op-draw', 'chart.drawing.create', { checkpointId: 'cp-10' }),
      makeEvent(11, { opId: 'op-adv3', action: 'training.advance' }),
      makeEvent(12, { opId: 'op-adv3', action: 'training.advance', phase: 'finished', outcome: 'rejected' }),
    ],
    checkpoints: [
      makeCheckpoint(0, { id: 'cp-0', training: makeTraining(DATES[0]!, 100000), chart: makeChart('1D', makeDailyBars(0)) }),
      makeCheckpoint(4, { id: 'cp-4', training: makeTraining(DATES[1]!, 101000), chart: makeChart('1D', makeDailyBars(1)) }),
      makeCheckpoint(6, { id: 'cp-6', training: makeTraining(DATES[1]!, 102000), chart: makeChart('1D', makeDailyBars(1)) }),
      makeCheckpoint(8, { id: 'cp-8', training: makeTraining(DATES[2]!, 103000), chart: makeChart('1D', makeDailyBars(2)) }),
      makeCheckpoint(10, { id: 'cp-10', training: makeTraining(DATES[2]!, 104000), chart: makeChart('1D', makeDailyBars(2), [makeDrawing('dw-1')]) }),
    ],
  })
  const session = toSession(file)

  it('按推进事件分日：被拒推进不加日，区间与推进事件对齐', () => {
    expect(session.dayCount).toBe(3)
    expect(session.day(0)).toMatchObject({ firstSeq: 0, lastSeq: 3, date: DATES[0] })
    expect(session.day(1)).toMatchObject({ firstSeq: 4, lastSeq: 7, date: DATES[1] })
    expect(session.day(2)).toMatchObject({ firstSeq: 8, lastSeq: 12, date: DATES[2] })
  })

  it('当日终态取范围内最后一个可用检查点：账户为终态权益而非日初权益', () => {
    expect(session.state(1).training?.account.equity).toBe(102000)
    expect(session.state(2).training?.account.equity).toBe(104000)
  })

  it('画线终态随日还原：画线出现前的日子没有画线', () => {
    expect(session.state(1).drawings).toEqual([])
    expect(session.state(2).drawings).toHaveLength(1)
    expect(session.state(2).drawingsRef).not.toBeNull()
  })

  it('防未来：每日日线严格止于当日，绝不含之后日期的K线', () => {
    for (let index = 0; index < session.dayCount; index += 1) {
      const state = session.state(index)
      expect(state.dailyBars).not.toBeNull()
      expect(state.dailyBars!.at(-1)!.date).toBe(DATES[index])
      for (const bar of state.dailyBars!) expect(bar.date <= DATES[index]).toBe(true)
    }
  })
})

describe('部分周/月聚合（只用当时已见日线）', () => {
  it('周K按周一起始、月K按自然月：开高低收量额与手算一致', () => {
    const daily = makeDailyBars(2) // 周一～周三，共3根
    const weekly = aggregateDailyBars(daily, '1W')
    expect(weekly).toHaveLength(1)
    expect(weekly[0]).toEqual({
      date: '2026-01-05',
      open: 9,
      high: 13,
      low: 8,
      close: 12,
      volume: 3000,
      amount: (10 + 11 + 12) * 1000,
    })
    const monthly = aggregateDailyBars(daily, '1M')
    expect(monthly).toHaveLength(1)
    expect(monthly[0]!.date).toBe('2026-01')
    expect(monthly[0]!.close).toBe(12)
    expect(monthly[0]!.volume).toBe(3000)
  })

  it('跨月日线聚合为多根月K', () => {
    const daily = [makeBar('2026-01-30', 10), makeBar('2026-01-31', 11), makeBar('2026-02-02', 12)]
    const monthly = aggregateDailyBars(daily, '1M')
    expect(monthly.map(bar => bar.date)).toEqual(['2026-01', '2026-02'])
    expect(monthly[0]).toMatchObject({ open: 9, high: 12, low: 8, close: 11, volume: 2000 })
    expect(monthly[1]).toMatchObject({ open: 11, high: 13, low: 10, close: 12, volume: 1000 })
  })

  it('推进日推进部分周K：周K收盘随当日已见日线增长', () => {
    const file = makeFile({
      events: [
        ...makePair(1, 'op-create', 'training.create'),
        ...makePair(3, 'op-adv1', 'training.advance', { checkpointId: 'cp-4' }),
        ...makePair(5, 'op-adv2', 'training.advance', { checkpointId: 'cp-6' }),
      ],
      checkpoints: [
        makeCheckpoint(0, { training: makeTraining(DATES[0]!, 100000), chart: makeChart('1D', makeDailyBars(0)) }),
        makeCheckpoint(4, { training: makeTraining(DATES[1]!, 101000), chart: makeChart('1D', makeDailyBars(1)) }),
        makeCheckpoint(6, { training: makeTraining(DATES[2]!, 102000), chart: makeChart('1D', makeDailyBars(2)) }),
      ],
    })
    const session = toSession(file)
    const weekCloses = [0, 1, 2].map(index => observationBars(session.state(index), '1W')?.bars[0]?.close)
    expect(weekCloses).toEqual([10, 11, 12])
    expect(observationBars(session.state(2), '1M')?.bars[0]?.date).toBe('2026-01')
  })
})

describe('缺口日与稀疏日期', () => {
  // 暂停缺口内推进 D2→D3 未记录：按检查点元数据日期补分界，不把 D3 状态错标成 D2
  const file = makeFile({
    events: [
      ...makePair(1, 'op-create', 'training.create'),
      ...makePair(3, 'op-adv1', 'training.advance', { checkpointId: 'cp-4' }),
      makeEvent(5, { opId: 'op-resume', action: 'recording.resume' }),
      makeEvent(6, { opId: 'op-resume', action: 'recording.resume', phase: 'finished', outcome: 'accepted', checkpointId: 'cp-6' }),
      ...makePair(7, 'op-adv2', 'training.advance', { checkpointId: 'cp-8' }),
    ],
    gaps: [{ afterSeq: 4, resumedAtSeq: 5 }],
    checkpoints: [
      makeCheckpoint(0, { id: 'cp-0', training: makeTraining(DATES[0]!, 100000), chart: makeChart('1D', makeDailyBars(0)) }),
      makeCheckpoint(4, { id: 'cp-4', training: makeTraining(DATES[1]!, 101000), chart: makeChart('1D', makeDailyBars(1)) }),
      // 恢复后首捕：真实日期已是 D3（缺口内推进被吞）
      makeCheckpoint(6, { id: 'cp-6', training: makeTraining(DATES[2]!, 102000), chart: makeChart('1D', makeDailyBars(2)) }),
      makeCheckpoint(8, { id: 'cp-8', training: makeTraining(DATES[3]!, 103000), chart: makeChart('1D', makeDailyBars(3)) }),
    ],
  })
  const session = toSession(file)

  it('缺口内被吞的推进日补出独立日期，不吞并也不借用未来', () => {
    expect(session.dayCount).toBe(4)
    expect(session.day(0).date).toBe(DATES[0])
    expect(session.day(1)).toMatchObject({ firstSeq: 4, lastSeq: 5, date: DATES[1] })
    expect(session.day(2)).toMatchObject({ firstSeq: 6, lastSeq: 7, date: DATES[2] })
    expect(session.day(3)).toMatchObject({ firstSeq: 8, lastSeq: 8, date: DATES[3] })
    expect(session.state(1).dailyBars!.at(-1)!.date).toBe(DATES[1])
    expect(session.state(2).dailyBars!.at(-1)!.date).toBe(DATES[2])
  })

  it('业务操作按发生日归属，便于按日跳转', () => {
    const file = makeFile({
      events: [
        ...makePair(1, 'op-create', 'training.create'),
        ...makePair(3, 'op-adv1', 'training.advance'),
        ...makePair(5, 'op-trade', 'training.trade'),
      ],
      checkpoints: [
        makeCheckpoint(0, { training: makeTraining(DATES[0]!, 100000), chart: makeChart('1D', makeDailyBars(0)) }),
      ],
    })
    const session = toSession(file)
    expect(session.businessItems).toHaveLength(1)
    expect(session.businessItems[0]).toMatchObject({ action: 'training.trade', dayIndex: 1 })
  })
})

describe('旧文件缺当日日线回退', () => {
  // D2 当日先看日K（有当日日线快照）后切周K（终态检查点只有周K）：日线仍可用、账户/画线取终态
  const weekBar: Bar = { date: '2026-01-05', open: 9, high: 12, low: 8, close: 11, volume: 2000, amount: 21000 }
  const file = makeFile({
    events: [
      ...makePair(1, 'op-create', 'training.create'),
      ...makePair(3, 'op-adv1', 'training.advance', { checkpointId: 'cp-4' }),
      makeEvent(5, { opId: 'op-tf', action: 'chart.timeframe' }),
      makeEvent(6, { opId: 'op-tf', action: 'chart.timeframe', phase: 'finished', outcome: 'accepted', checkpointId: 'cp-6' }),
    ],
    checkpoints: [
      makeCheckpoint(0, { id: 'cp-0', training: makeTraining(DATES[0]!, 100000), chart: makeChart('1D', makeDailyBars(0)) }),
      makeCheckpoint(4, { id: 'cp-4', training: makeTraining(DATES[1]!, 101000), chart: makeChart('1D', makeDailyBars(1)) }),
      makeCheckpoint(6, { id: 'cp-6', training: makeTraining(DATES[1]!, 101000), chart: makeChart('1W', [weekBar], [makeDrawing('dw-2')]) }),
    ],
  })
  const session = toSession(file)

  it('终态虽是周K，但当日已有日线快照时三个周期都可用', () => {
    const state = session.state(1)
    expect(availablePeriods(state)).toEqual(['1D', '1W', '1M'])
    expect(state.dailyBars!.at(-1)!.date).toBe(DATES[1])
    expect(observationBars(state, '1D')!.bars.at(-1)!.date).toBe(DATES[1])
    expect(observationBars(state, '1W')!.bars).toEqual([weekBar])
  })

  it('账户与画线取当日终态检查点，日线可来自同日更早快照（无未来）', () => {
    const state = session.state(1)
    expect(state.training?.account.equity).toBe(101000)
    expect(state.drawings).toHaveLength(1)
    expect(state.drawingsRef).not.toBeNull()
  })

  it('整天只有周K快照的日子：只提供周K并保留兜底标记', () => {
    const file = makeFile({
      events: [
        ...makePair(1, 'op-create', 'training.create'),
        ...makePair(3, 'op-adv1', 'training.advance', { checkpointId: 'cp-4' }),
      ],
      checkpoints: [
        makeCheckpoint(0, { training: makeTraining(DATES[0]!, 100000), chart: makeChart('1D', makeDailyBars(0)) }),
        makeCheckpoint(4, { training: makeTraining(DATES[1]!, 101000), chart: makeChart('1W', [weekBar]) }),
      ],
    })
    const session = toSession(file)
    const state = session.state(1)
    expect(state.dailyBars).toBeNull()
    expect(state.fallback).not.toBeNull()
    expect(availablePeriods(state)).toEqual(['1W'])
    expect(observationBars(state, '1W')!.bars).toEqual([weekBar])
    expect(observationBars(state, '1D')).toBeNull()
    expect(observationBars(state, '1M')).toBeNull()
  })
})

describe('盲训与空录制', () => {
  it('盲训无日期时按 T+序号展示，有当日日线则回填真实末根日期', () => {
    const file = makeFile({
      events: [
        ...makePair(1, 'op-create', 'training.create'),
        ...makePair(3, 'op-adv1', 'training.advance', { checkpointId: 'cp-4' }),
      ],
      checkpoints: [
        makeCheckpoint(0, { training: makeTraining(DATES[0]!, 100000, true), chart: makeChart('1D', makeDailyBars(0)) }),
        makeCheckpoint(4, { training: makeTraining(DATES[1]!, 101000, true), chart: makeChart('1D', makeDailyBars(1)) }),
      ],
    })
    const session = toSession(file)
    expect(session.state(0).date).toBe(DATES[0])
    expect(session.state(1).date).toBe(DATES[1])
    // 无日线可回填时保持 T+序号
    const bare = toSession(makeFile({
      events: [...makePair(1, 'op-create', 'training.create')],
      checkpoints: [makeCheckpoint(0, { training: makeTraining(DATES[0]!, 100000, true), chart: makeChart('1W', [{ date: '2026-01-05', open: 9, high: 11, low: 8, close: 10, volume: 1000, amount: 10000 }]) })],
    }))
    expect(bare.state(0).date).toBe('T+0')
  })

  it('空录制：单日占位、无状态、无可用周期、无业务操作', () => {
    const session = toSession(makeFile())
    expect(session.dayCount).toBe(1)
    const state = session.state(0)
    expect(state.training).toBeNull()
    expect(state.dailyBars).toBeNull()
    expect(state.fallback).toBeNull()
    expect(state.stale).toBe(true)
    expect(availablePeriods(state)).toEqual([])
    expect(observationBars(state, '1D')).toBeNull()
    expect(session.businessItems).toEqual([])
  })
})

describe('推进分界与检查点元数据的时序错位（返修回归）', () => {
  // 推进已在 seq2 被接受分界，但该日首个带元数据的检查点因捕获去抖迟到在 afterSeq=4，
  // 中间还有一条 training/chart 皆空的中间检查点（afterSeq=3）：日期变化由推进分界解释，
  // 不得把「迟到的首次观察」当成段内日期前移再补一条分界——两个真实日绝不能出现前一日两次。
  const file = makeFile({
    events: [
      ...makePair(1, 'op-adv', 'training.advance'),
      ...makePair(3, 'op-theme', 'ui.theme', { checkpointId: 'cp-4' }),
    ],
    checkpoints: [
      makeCheckpoint(0, { id: 'cp-0', training: makeTraining(DATES[0]!, 100000), chart: makeChart('1D', makeDailyBars(0)) }),
      makeCheckpoint(3, { id: 'cp-3' }),
      makeCheckpoint(4, { id: 'cp-4', training: makeTraining(DATES[1]!, 101000), chart: makeChart('1D', makeDailyBars(1)) }),
    ],
  })
  const session = toSession(file)

  it('迟到的新日首观察不补分界：两个真实日各出现一次', () => {
    expect(session.dayCount).toBe(2)
    expect(session.index.days.map(day => day.date)).toEqual([DATES[0], DATES[1]])
    expect(session.day(0)).toMatchObject({ firstSeq: 0, lastSeq: 1 })
    expect(session.day(1)).toMatchObject({ firstSeq: 2, lastSeq: 4 })
  })

  it('中间空检查点不产生幻影日，新日终态仍取 afterSeq=4 的可用检查点', () => {
    expect(session.state(1).stale).toBe(false)
    expect(session.state(1).training?.account.equity).toBe(101000)
    expect(session.state(1).dailyBars!.at(-1)!.date).toBe(DATES[1])
  })
})

describe('盲训缺日线日不得借用前一日日线（返修回归）', () => {
  // 盲训 currentDate=null：day1 有日线、day2 整日只有周K快照。日线的「当前」观察只能来自
  // 当日段内检查点；跨日段沿用前一日日线会把 day2 标成 day1 的日期——未知推进日不得从
  // 陈旧数据推断，如实回落到当日周K兜底并保留缺日线提示口径。
  const weekBar: Bar = { date: '2026-01-05', open: 9, high: 12, low: 8, close: 11, volume: 2000, amount: 21000 }
  const file = makeFile({
    events: [
      ...makePair(1, 'op-create', 'training.create'),
      ...makePair(3, 'op-adv', 'training.advance', { checkpointId: 'cp-4' }),
    ],
    checkpoints: [
      makeCheckpoint(0, { id: 'cp-0', training: makeTraining(DATES[0]!, 100000, true), chart: makeChart('1D', makeDailyBars(0)) }),
      makeCheckpoint(4, { id: 'cp-4', training: makeTraining(DATES[1]!, 101000, true), chart: makeChart('1W', [weekBar]) }),
    ],
  })
  const session = toSession(file)

  it('day2 无当日日线：不继承 day1 日线，回落周K兜底', () => {
    const state = session.state(1)
    expect(state.dailyBars).toBeNull()
    expect(state.fallback).not.toBeNull()
    expect(state.fallback!.timeframe).toBe('1W')
    expect(availablePeriods(state)).toEqual(['1W'])
    expect(observationBars(state, '1W')!.bars).toEqual([weekBar])
    expect(observationBars(state, '1D')).toBeNull()
    expect(observationBars(state, '1M')).toBeNull()
  })

  it('day2 不得标注成 day1 的日期：盲训无日线保持 T+序号', () => {
    expect(session.state(0).date).toBe(DATES[0])
    expect(session.state(1).date).toBe('T+1')
  })
})

describe('业务操作列表过滤', () => {
  it('推进触发自然结算但没有新K线时不增加一个重复交易日', () => {
    const snapshot = makeTraining(DATES[0]!, 100000)
    const ended = { ...snapshot, training: { ...snapshot.training, status: 'settled' as const, settleDate: DATES[0]! } }
    const session = toSession(makeFile({
      events: makePair(1, 'settled-without-next-bar', 'training.advance', { result: { settled: true } }),
      checkpoints: [
        makeCheckpoint(0, { training: snapshot, chart: makeChart('1D', makeDailyBars(0)) }),
        makeCheckpoint(2, { training: ended, chart: makeChart('1D', makeDailyBars(0)) }),
      ],
    }))
    expect(session.dayCount).toBe(1)
    expect(session.state(0).training?.training.status).toBe('settled')
  })
  const file = makeFile({
    events: [
      ...makePair(1, 'op-create', 'training.create'),
      ...makePair(3, 'op-adv1', 'training.advance'),
      makeEvent(5, { opId: 'op-trade-ok', action: 'training.trade', params: { side: 'buy', shares: 500 } }),
      makeEvent(6, { opId: 'op-trade-ok', action: 'training.trade', phase: 'finished', outcome: 'accepted', result: { plan: { side: 'buy', shares: 500, price: 10, amount: 5000, fee: 5 } } }),
      makeEvent(7, { opId: 'op-trade-reject', action: 'training.trade', params: { side: 'sell' } }),
      makeEvent(8, { opId: 'op-trade-reject', action: 'training.trade', phase: 'finished', outcome: 'rejected', result: { message: '资金不足' } }),
      makeEvent(9, { opId: 'op-draw', action: 'chart.drawing.create', params: { name: 'textAnnotation' } }),
      makeEvent(10, { opId: 'op-draw', action: 'chart.drawing.create', phase: 'finished', outcome: 'accepted' }),
      makeEvent(11, { opId: 'op-cancel', action: 'chart.drawing.cancel' }),
      makeEvent(12, { opId: 'op-cancel', action: 'chart.drawing.cancel', phase: 'finished', outcome: 'cancelled' }),
      makeEvent(13, { opId: 'op-theme', action: 'ui.theme' }),
      makeEvent(14, { opId: 'op-theme', action: 'ui.theme', phase: 'finished', outcome: 'accepted' }),
      makeEvent(15, { opId: 'op-pause', action: 'recording.pause' }),
      makeEvent(16, { opId: 'op-pause', action: 'recording.pause', phase: 'finished', outcome: 'accepted' }),
      makeEvent(17, { opId: 'op-tool', action: 'chart.tool' }),
      makeEvent(18, { opId: 'op-tool', action: 'chart.tool', phase: 'finished', outcome: 'accepted' }),
      makeEvent(19, { opId: 'op-unfinished', action: 'training.trade' }),
      makeEvent(20, { opId: 'op-unfinished', action: 'training.trade', phase: 'finished', outcome: 'interrupted' }),
    ],
    checkpoints: [
      makeCheckpoint(0, { training: makeTraining(DATES[0]!, 100000), chart: makeChart('1D', makeDailyBars(0)) }),
    ],
  })
  const session = toSession(file)

  it('只保留完成的买卖与图形/文字变更，一次操作一条', () => {
    expect(session.businessItems.map(item => item.action)).toEqual([
      'training.trade',
      'training.trade',
      'chart.drawing.create',
    ])
  })

  it('拒单保留并标注，成交带方向/数量/价格，文字标注说明来源', () => {
    const [filled, rejected, drawing] = session.businessItems
    expect(filled!.outcome).toBe('accepted')
    expect(filled!.label).toBe('买入 500股 @10.00')
    expect(rejected!.outcome).toBe('rejected')
    expect(rejected!.label).toBe('卖出')
    expect(drawing!.label).toBe('新增画线 · 文字标注')
  })
})

describe('开盘阶段回放可与训练页同口径切周/月（RF-03）', () => {
  // open_close 训练的真实形态：每次推进产生一个事件分界，同一交易日拆成
  // 开盘段（日线止于前一交易日，当日K线尚未形成）与收盘段（日线含当日）两步。
  // 检查点按 MA-01 后的 canonical 1D 口径嵌入当时已见日线——开盘段的日线
  // 必然止于 currentDate 之前，旧门控（末根日期 >= currentDate）把整个开盘段
  // 误判为「缺日线」，导致回放中周K/月K被禁用并弹出缺日线提示（用户验收 RF-03）。
  const PRIOR = '2026-01-02' // 周五：起始日之前的最后一根真实日线
  const priorBar = makeBar(PRIOR, 9)
  const phaseFile = makeFile({
    events: [
      ...makePair(1, 'op-create', 'training.create'),
      ...makePair(3, 'op-adv1', 'training.advance', { checkpointId: 'cp-4' }), // D1 开盘→收盘
      ...makePair(5, 'op-adv2', 'training.advance', { checkpointId: 'cp-6' }), // D1 收盘→D2 开盘
      ...makePair(7, 'op-adv3', 'training.advance', { checkpointId: 'cp-8' }), // D2 开盘→收盘
    ],
    checkpoints: [
      makeCheckpoint(0, { id: 'cp-0', training: makeTraining(DATES[0]!, 100000, false, 'open'), chart: makeChart('1D', [priorBar]) }),
      makeCheckpoint(4, { id: 'cp-4', training: makeTraining(DATES[0]!, 101000, false, 'close'), chart: makeChart('1D', [priorBar, makeBar(DATES[0]!, 10)]) }),
      makeCheckpoint(6, { id: 'cp-6', training: makeTraining(DATES[1]!, 102000, false, 'open'), chart: makeChart('1D', [priorBar, makeBar(DATES[0]!, 10)]) }),
      makeCheckpoint(8, { id: 'cp-8', training: makeTraining(DATES[1]!, 103000, false, 'close'), chart: makeChart('1D', [priorBar, makeBar(DATES[0]!, 10), makeBar(DATES[1]!, 11)]) }),
    ],
  })
  const session = toSession(phaseFile)

  it('开盘段四步：日0/日2 为开盘，日期与日线止点如实分层', () => {
    expect(session.dayCount).toBe(4)
    expect(session.state(0).dailyBars!.at(-1)!.date).toBe(PRIOR)
    expect(session.state(1).dailyBars!.at(-1)!.date).toBe(DATES[0])
    expect(session.state(2).dailyBars!.at(-1)!.date).toBe(DATES[0])
    expect(session.state(3).dailyBars!.at(-1)!.date).toBe(DATES[1])
  })

  it('开盘段与训练页同级：日/周/月三周期都可用，不回落、不标缺日线', () => {
    for (const index of [0, 2]) {
      const state = session.state(index)
      expect(availablePeriods(state)).toEqual(['1D', '1W', '1M'])
      expect(state.fallback).toBeNull()
    }
  })

  it('开盘段周/月由已见日线聚合：口径与 aggregateDailyBars 一致', () => {
    const open1 = session.state(0)
    // PRIOR=周五属上一周（周一键 2025-12-29），月键 2026-01
    expect(observationBars(open1, '1W')!.bars.map(bar => bar.date)).toEqual(['2025-12-29'])
    expect(observationBars(open1, '1M')!.bars.map(bar => bar.date)).toEqual(['2026-01'])
    const open2 = session.state(2)
    expect(observationBars(open2, '1W')!.bars.map(bar => bar.date)).toEqual(['2025-12-29', '2026-01-05'])
    expect(observationBars(open2, '1W')!.bars[1]).toMatchObject({ open: 9, close: 10 })
    expect(observationBars(open2, '1M')!.bars.map(bar => bar.date)).toEqual(['2026-01'])
  })

  it('收盘段行为不变：日线含当日，三周期可用', () => {
    for (const index of [1, 3]) {
      const state = session.state(index)
      expect(availablePeriods(state)).toEqual(['1D', '1W', '1M'])
      expect(state.fallback).toBeNull()
    }
    expect(observationBars(session.state(3), '1W')!.bars.at(-1)!.close).toBe(11)
  })

  it('旧快照无阶段字段：仍按收盘口径判完整，不因缺字段回落', () => {
    // 旧录制（阶段字段尚未存在）的收盘段快照：末根=当日 → 完整（与历史行为一致）
    const legacy = toSession(makeFile({
      events: [
        ...makePair(1, 'op-create', 'training.create'),
        ...makePair(3, 'op-adv1', 'training.advance', { checkpointId: 'cp-4' }),
      ],
      checkpoints: [
        makeCheckpoint(0, { id: 'cp-0', training: makeTraining(DATES[0]!, 100000), chart: makeChart('1D', [makeBar(DATES[0]!, 10)]) }),
        makeCheckpoint(4, { id: 'cp-4', training: makeTraining(DATES[1]!, 101000), chart: makeChart('1D', [makeBar(DATES[0]!, 10), makeBar(DATES[1]!, 11)]) }),
      ],
    }))
    expect(availablePeriods(legacy.state(1))).toEqual(['1D', '1W', '1M'])
  })
})
