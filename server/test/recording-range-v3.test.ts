// 范围录像 schemaVersion=3 冻结合同（control-handoff-20260926-06 第二片）：
// 含 RANGE 训练元数据的录像文件必须是 v3；v1/v2 保留旧五档语义并拒绝 RANGE；
// 未知版本显式拒绝；range 元数据严格校验且与训练快照字段一致。
import { describe, expect, it } from 'vitest'
import type { CompactRecordingFile } from '../../web/src/recording/compactTypes'
import { readRecordingFile, writeRecordingFile } from '../../web/src/recording/recordingFile'
import type { ChartCapture } from '../../web/src/recording/types'
import type { TrainingSnapshot } from '../../web/src/api'
import type { RecordingCheckpoint, RecordingFile } from '../../web/src/recording/types'
import { CompactBuilder } from '../../web/src/recording/compactCodec'

function dateStr(offset: number): string {
  return new Date(Date.UTC(2020, 0, 1 + offset)).toISOString().slice(0, 10)
}

function makeBars(count: number): Array<{ date: string; open: number; high: number; low: number; close: number; volume: number; amount: number }> {
  return Array.from({ length: count }, (_, i) => ({
    date: dateStr(i),
    open: 10,
    high: 11,
    low: 9,
    close: 10 + i * 0.1,
    volume: 1000 + i,
    amount: 10500 + i,
  }))
}

const RANGE_META = {
  version: 1,
  mode: 'preset' as const,
  requestedStart: '2025-12-01',
  requestedEnd: null as string | null,
  startDate: '2025-12-01',
  endDate: '2026-06-01',
  barCount: 120,
  sourceFingerprint: 'fp-sh-000001',
  notes: ['合成范围'],
}

function makeTraining(overrides: Partial<TrainingSnapshot['training']> = {}): TrainingSnapshot {
  return {
    training: {
      id: 7,
      tier: '6M',
      code: '600000',
      name: '浦发银行',
      market: 'SH',
      startDate: '2025-12-01',
      plannedEnd: '2026-06-01',
      currentDate: '2026-03-05',
      status: 'running',
      settleDate: null,
      earlySettle: false,
      blind: false,
      adjustMode: 'forward',
      initialCash: 100000,
      createdAt: '2026-01-01T08:00:00.000Z',
      ...overrides,
    },
    account: {
      cash: 95000,
      shares: 500,
      availableShares: 500,
      costPrice: 10,
      marketValue: 5000,
      equity: 100000,
    },
    trades: [],
  }
}

function makeChart(bars: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number; amount: number }>): ChartCapture {
  return {
    timeframe: '1D',
    bars,
    drawings: [],
    view: { fromTimestamp: 1, toTimestamp: 2, barSpace: 8, paneHeights: { candle_pane: 300 } },
    costPrice: null,
  }
}

let checkpointSeq = 0

function makeCheckpoint(overrides: Partial<RecordingCheckpoint> = {}): RecordingCheckpoint {
  checkpointSeq += 1
  return {
    id: `cp-${checkpointSeq}`,
    afterSeq: overrides.afterSeq ?? 0,
    segmentId: overrides.segmentId ?? `seg-${checkpointSeq}`,
    capturedAt: '2026-03-05T09:00:00.000Z',
    chart: overrides.chart ?? makeChart(makeBars(4)),
    training: overrides.training ?? null,
    account: overrides.account ?? null,
    trades: overrides.trades ?? [],
    ui: { theme: 'dark', tool: null, magnet: 'strong', multiSelect: false },
    context: overrides.context ?? null,
  } as RecordingCheckpoint
}

const HEADER = {
  format: 'trainer-session' as const,
  sessionId: 'sess-range-1',
  createdAt: '2026-03-05T09:00:00.000Z',
  app: { version: '0.0.0-test', gitCommit: 'test-commit', dirty: false, chartLibrary: 'klinecharts' },
  environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 720 }, dpr: 1 },
  trainingKey: '600000|2025-12-01',
  gaps: [],
  complete: false as const,
}

function makeEvents(): RecordingFile['events'] {
  return [
    { seq: 1, opId: 'op-1', segmentId: 'seg-1', elapsedMs: 0, phase: 'started', action: 'training.create', source: 'ui' },
  ]
}

function buildFile(schemaVersion: 2 | 3, training: TrainingSnapshot): CompactRecordingFile {
  const builder = new CompactBuilder()
  const checkpoints = [makeCheckpoint({ afterSeq: 0, training })]
  return {
    ...HEADER,
    schemaVersion,
    events: makeEvents(),
    checkpoints: checkpoints.map(cp => builder.capture(cp)),
    resources: builder.getResources(),
  } as CompactRecordingFile
}

function rangeTraining(rangeOverrides: Record<string, unknown> = {}): TrainingSnapshot {
  const base = makeTraining({
    tier: 'RANGE' as unknown as TrainingSnapshot['training']['tier'],
    range: { ...RANGE_META, ...rangeOverrides },
  })
  return base
}

async function readText(file: unknown): Promise<CompactRecordingFile> {
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
  return readRecordingFile(blob)
}

describe('range recording schemaVersion=3 contract', () => {
  it('v2 file carrying RANGE tier is rejected (schema2+RANGE forbidden)', async () => {
    const file = buildFile(2, rangeTraining())
    await expect(readText(file)).rejects.toThrow(/tier/)
  })

  it('v3 file with RANGE tier and strict range meta is accepted', async () => {
    const file = buildFile(3, rangeTraining())
    const parsed = await readText(file)
    expect(parsed.schemaVersion).toBe(3)
    const metas = (parsed.resources.trainingMeta as Array<{ value: { tier: string; range?: unknown } }>)
    expect(metas.some(m => m.value.tier === 'RANGE' && m.value.range)).toBe(true)
  })

  it('v3 old tiers keep v2 semantics (no range required)', async () => {
    const file = buildFile(3, makeTraining())
    const parsed = await readText(file)
    expect(parsed.schemaVersion).toBe(3)
  })

  it('v3 rejects range meta with wrong version/mode/barCount/field mismatch', async () => {
    const cases = [
      rangeTraining({ version: 2 }),
      rangeTraining({ mode: 'grid' }),
      rangeTraining({ barCount: 0 }),
      rangeTraining({ barCount: -5 }),
      rangeTraining({ startDate: '2025-11-01' }),   // ≠ training.startDate
      rangeTraining({ endDate: '2026-07-01' }),      // ≠ training.plannedEnd
      rangeTraining({ sourceFingerprint: '' }),
      rangeTraining({ notes: 'not-array' }),
      rangeTraining({ requestedEnd: 42 }),
    ]
    for (const training of cases) {
      const file = buildFile(3, training)
      await expect(readText(file)).rejects.toThrow()
    }
  })

  it('v3 requires the range object when tier is RANGE and forbids range on old tiers', async () => {
    const missing = buildFile(3, rangeTraining())
    ;(missing.resources.trainingMeta as Array<{ value: Record<string, unknown> }>).forEach(entry => {
      if (entry.value.tier === 'RANGE') delete entry.value.range
    })
    await expect(readText(missing)).rejects.toThrow(/range/i)

    const withRange = buildFile(3, makeTraining())
    ;(withRange.resources.trainingMeta as Array<{ value: Record<string, unknown> }>).forEach(entry => {
      entry.value.range = { ...RANGE_META }
    })
    await expect(readText(withRange)).rejects.toThrow(/range|tier/i)
  })

  it('unknown schema versions are rejected with an actionable message', async () => {
    const v4 = buildFile(3, makeTraining()) as unknown as Record<string, unknown>
    v4.schemaVersion = 4
    await expect(readText(v4)).rejects.toThrow(/1、2|3/)
  })

  it('RANGE training writes schemaVersion 3; old tiers keep 2', async () => {
    // 真实写路径：CompactRecorder 会话中 RANGE 训练的首次持久化必须直接是 v3
    const { CompactRecorder } = await import('../../web/src/recording/compactRecorder')
    const { MemoryCompactStorage } = await import('../../web/src/recording/compactStorage')
    const fullTraining = rangeTraining()
    const storage = new MemoryCompactStorage()
    const recorder = new CompactRecorder(storage, {
      app: { version: '0.0.0-test', gitCommit: 'test-commit', dirty: false, chartLibrary: 'klinecharts' },
      environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 720 }, dpr: 1 },
    })
    await recorder.start('600000|2025-12-01', makeCheckpoint({ afterSeq: 0, training: fullTraining }) as never)
    const snapshot = recorder.getFile()
    expect(snapshot.schemaVersion).toBe(3)
    const exported = await recorder.export()
    expect(exported.schemaVersion).toBe(3)
    // 重新读取走完整校验链
    const blob = await writeRecordingFile(exported)
    const parsed = await readRecordingFile(blob)
    expect(parsed.schemaVersion).toBe(3)

    // 旧五档训练继续产出 v2
    const legacyStorage = new MemoryCompactStorage()
    const legacyRecorder = new CompactRecorder(legacyStorage, {
      app: { version: '0.0.0-test', gitCommit: 'test-commit', dirty: false, chartLibrary: 'klinecharts' },
      environment: { timezone: 'Asia/Shanghai', viewport: { width: 1280, height: 720 }, dpr: 1 },
    })
    await legacyRecorder.start('600000|2025-12-01', makeCheckpoint({ afterSeq: 0, training: makeTraining() }) as never)
    expect(legacyRecorder.getFile().schemaVersion).toBe(2)
  })
})
