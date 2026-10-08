import { describe, expect, it } from 'vitest'
import { Recorder } from '../../web/src/recording/recorder'
import { MemoryRecordingStorage } from '../../web/src/recording/storage'
import { validateRecording } from '../../web/src/recording/validation'
import { compactRecording } from '../../web/src/recording/compactCodec'
import { validateCompactRecording } from '../../web/src/recording/compactValidation'
import { businessEvents, isBusinessAction } from '../../web/src/recording/businessEvents'
import { DailyReplaySession } from '../../web/src/recording/dailyReplay'
import { ACTIONS } from '../../web/src/recording/types'
import type {
  Action,
  ChartCapture,
  CheckpointInput,
  RecordingEvent,
  RecordingFile,
} from '../../web/src/recording/types'

// RF-02 用户报告（oracle）：训练中挂条件单/撤销条件单的操作没有被录像记录，属信息丢失，需补上。
// 覆盖四层：①动作进白名单（Recorder 可录制且校验通过）②业务口径纳入（挂/撤是用户业务动作）
// ③紧凑编码往返与校验兼容 ④旧文件（无新动作）校验不受影响 ⑤回放业务列表可见且有信息量标签。

type OrderAction = 'training.order.create' | 'training.order.cancel'

/** 训练页挂单提交的关键信息（方向/类型/触发价/数量/理由），口径同 training.trade 的请求负载风格 */
const CREATE_PARAMS = { side: 'buy', orderType: 'limit', triggerPrice: 12.5, shares: 200, reason: '回踩支撑' }

function makeCheckpointInput(overrides: Partial<CheckpointInput> = {}): CheckpointInput {
  return {
    training: null,
    chart: null,
    ui: { theme: 'dark', tool: null, magnet: 'strong', multiSelect: false },
    context: null,
    ...overrides,
  }
}

const SAMPLE_CHART: ChartCapture = {
  timeframe: '1D',
  bars: [{ date: '2026-01-05', open: 13, high: 13.4, low: 12.8, close: 13.1, volume: 1000, amount: 13100 }],
  drawings: [],
  view: { fromTimestamp: 1, toTimestamp: 2, barSpace: 8, paneHeights: { candle_pane: 300 } },
  costPrice: null,
}

function makeEvent(seq: number, overrides: Partial<RecordingEvent> = {}): RecordingEvent {
  return {
    seq,
    opId: `op-${seq}`,
    segmentId: 'seg-1',
    elapsedMs: seq * 10,
    phase: 'started',
    action: 'training.trade',
    source: 'ui',
    ...overrides,
  }
}

function makePair(
  seq: number,
  opId: string,
  action: Action,
  overrides: Partial<RecordingEvent> = {},
): RecordingEvent[] {
  return [
    makeEvent(seq, { opId, action }),
    makeEvent(seq + 1, { opId, action, phase: 'finished', outcome: 'accepted', ...overrides }),
  ]
}

function makeFile(overrides: Partial<RecordingFile> = {}): RecordingFile {
  return {
    format: 'trainer-session',
    schemaVersion: 1,
    sessionId: 'session-rf02',
    createdAt: '2026-01-05T01:00:00.000Z',
    app: { version: '0.1.0', gitCommit: 'rf02', dirty: false, chartLibrary: 'klinecharts@10.0.3' },
    environment: { timezone: 'Asia/Shanghai', viewport: { width: 1920, height: 1080 }, dpr: 1 },
    trainingKey: '600000-SH-6M',
    events: [],
    checkpoints: [],
    gaps: [],
    complete: true,
    ...overrides,
  }
}

/** 含挂单/撤单事件的完整录制文件：params 在 started、result/outcome 在 finished（与真实接线一致） */
function makeOrderFile(): RecordingFile {
  return makeFile({
    events: [
      ...makePair(1, 'op-adv', 'training.advance'),
      makeEvent(3, { opId: 'op-order-create', action: 'training.order.create' as OrderAction, params: CREATE_PARAMS }),
      makeEvent(4, {
        opId: 'op-order-create',
        action: 'training.order.create' as OrderAction,
        phase: 'finished',
        outcome: 'accepted',
        result: { order: { id: 9, side: 'buy', orderType: 'limit', triggerPrice: 12.5, shares: 200, expiresDate: '2026-01-19' } },
        checkpointId: 'cp-4',
      }),
      makeEvent(5, { opId: 'op-order-cancel', action: 'training.order.cancel' as OrderAction, params: { orderId: 9 } }),
      makeEvent(6, {
        opId: 'op-order-cancel',
        action: 'training.order.cancel' as OrderAction,
        phase: 'finished',
        outcome: 'accepted',
        result: { order: { id: 9, side: 'buy', orderType: 'limit', triggerPrice: 12.5, shares: 200, expiresDate: '2026-01-19' } },
      }),
      makeEvent(7, { opId: 'op-order-reject', action: 'training.order.create' as OrderAction, params: { side: 'sell', orderType: 'stop', triggerPrice: 99, shares: 100 } }),
      makeEvent(8, {
        opId: 'op-order-reject',
        action: 'training.order.create' as OrderAction,
        phase: 'finished',
        outcome: 'rejected',
        result: { message: '可卖股数不足' },
      }),
    ],
    checkpoints: [
      {
        id: 'cp-4',
        afterSeq: 4,
        segmentId: 'seg-1',
        capturedAt: '2026-01-05T09:30:00.000Z',
        training: null,
        chart: SAMPLE_CHART,
        ui: { theme: 'dark', tool: null, magnet: 'strong', multiSelect: false },
        context: null,
      },
    ],
  })
}

describe('RF-02 条件单动作白名单与录制', () => {
  it('training.order.create 与 training.order.cancel 进入 ACTIONS 白名单', () => {
    expect(ACTIONS).toContain('training.order.create')
    expect(ACTIONS).toContain('training.order.cancel')
  })

  it('Recorder 可录制挂单/撤单并保留 params 与 outcome，产出文件通过 v1 校验', async () => {
    const recorder = new Recorder(new MemoryRecordingStorage(), {
      app: { version: '0.0.0-test', gitCommit: 'rf02', dirty: false, chartLibrary: 'klinecharts' },
      environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 720 }, dpr: 1 },
    })
    await recorder.start('train-rf02', makeCheckpointInput())

    const createOp = recorder.begin('training.order.create' as OrderAction, CREATE_PARAMS, 'ui')
    expect(typeof createOp).toBe('string')
    recorder.finish(createOp!, 'accepted', { order: { id: 9, side: 'buy', orderType: 'limit', triggerPrice: 12.5, shares: 200, expiresDate: '2026-01-19' } }, makeCheckpointInput({ chart: SAMPLE_CHART }))

    const cancelOp = recorder.begin('training.order.cancel' as OrderAction, { orderId: 9 }, 'ui')
    recorder.finish(cancelOp!, 'accepted', { order: { id: 9, side: 'buy', orderType: 'limit', triggerPrice: 12.5, shares: 200, expiresDate: '2026-01-19' } })

    const file = recorder.getFile()
    const orderEvents = file.events.filter(event => event.action === ('training.order.create' as OrderAction) || event.action === ('training.order.cancel' as OrderAction))
    expect(orderEvents.map(event => [event.action, event.phase])).toEqual([
      ['training.order.create', 'started'],
      ['training.order.create', 'finished'],
      ['training.order.cancel', 'started'],
      ['training.order.cancel', 'finished'],
    ])
    expect(orderEvents[0]!.params).toEqual(CREATE_PARAMS)
    expect(orderEvents[1]!.outcome).toBe('accepted')
    expect(() => validateRecording(file)).not.toThrow()
  })

  it('含挂单/撤单事件的录制文件通过 v1 校验（白名单不再拒绝）', () => {
    expect(() => validateRecording(makeOrderFile())).not.toThrow()
  })
})

describe('RF-02 业务口径纳入挂单与撤单', () => {
  it('挂单/撤单属于业务动作（用户视角是操作记录）', () => {
    expect(isBusinessAction('training.order.create' as OrderAction)).toBe(true)
    expect(isBusinessAction('training.order.cancel' as OrderAction)).toBe(true)
  })

  it('businessEvents 保留完成的挂/撤与被拒挂单，去 started 重复', () => {
    const events = businessEvents(makeOrderFile().events)
    expect(events.map(event => event.action)).toEqual([
      'training.order.create',
      'training.order.cancel',
      'training.order.create',
    ])
    expect(events[2]!.outcome).toBe('rejected')
  })
})

describe('RF-02 紧凑编码与旧文件兼容', () => {
  it('v1→紧凑转换保留挂/撤事件原文且通过 v2 校验，CompactReader 可解码关联检查点', () => {
    const compact = validateCompactRecording(compactRecording(makeOrderFile()))
    const orderActions = compact.events.map(event => event.action)
    expect(orderActions).toContain('training.order.create')
    expect(orderActions).toContain('training.order.cancel')
    const create = compact.events.find(event => event.action === ('training.order.create' as OrderAction) && event.phase === 'finished')
    expect(create!.result).toMatchObject({ order: { triggerPrice: 12.5, shares: 200, expiresDate: '2026-01-19' } })
  })

  it('旧文件（无任何条件单动作）校验不受白名单扩展影响', () => {
    const legacy = makeFile({
      events: [
        ...makePair(1, 'op-adv', 'training.advance'),
        ...makePair(3, 'op-trade', 'training.trade'),
      ],
    })
    expect(() => validateRecording(legacy)).not.toThrow()
    expect(() => validateCompactRecording(compactRecording(legacy))).not.toThrow()
  })
})

describe('RF-02 回放业务列表呈现挂单与撤单', () => {
  it('businessItems 含挂/撤条目：归属发生日，标签带方向/类型/触发价/数量信息', () => {
    const session = new DailyReplaySession(validateCompactRecording(compactRecording(makeOrderFile())))
    const orderItems = session.businessItems.filter(item => item.action === ('training.order.create' as OrderAction) || item.action === ('training.order.cancel' as OrderAction))
    expect(orderItems.map(item => item.action)).toEqual([
      'training.order.create',
      'training.order.cancel',
      'training.order.create',
    ])
    // 挂/撤发生在首日内（推进分界 seq=1 之后同属日1）
    expect(orderItems.every(item => item.dayIndex === 1)).toBe(true)
    const [create, cancel] = orderItems
    expect(create!.label).toContain('挂条件单')
    expect(create!.label).toContain('买入')
    expect(create!.label).toContain('12.50')
    expect(create!.label).toContain('200')
    expect(cancel!.label).toContain('撤条件单')
    expect(cancel!.label).toContain('12.50')
    // 被拒挂单保留在列表中，outcome 如实呈现（不静默丢失）
    expect(orderItems[2]!.outcome).toBe('rejected')
  })
})
