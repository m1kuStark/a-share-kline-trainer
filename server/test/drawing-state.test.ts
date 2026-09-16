import { describe, expect, it } from 'vitest'
import { DrawingHistory, SerialDrawingSaver, serializeDrawings, applyDrawingPrices } from '../../web/src/drawingState'

const line = { id: 'a', name: 'segment', paneId: 'candle_pane', points: [{ timestamp: 1000, value: 10 }, { timestamp: 2000, value: 20 }] }

describe('drawing state lifecycle', () => {
  it('edits horizontal drawings with one price while preserving all timestamps and ordinary independent endpoints', () => {
    expect(applyDrawingPrices(line.points, [30], 'horizontalSegment')).toEqual([{ timestamp: 1000, value: 30 }, { timestamp: 2000, value: 30 }])
    expect(applyDrawingPrices(line.points, [40], 'horizontalRayLine')).toEqual([{ timestamp: 1000, value: 40 }, { timestamp: 2000, value: 40 }])
    expect(applyDrawingPrices(line.points, [30, 40], 'segment')).toEqual([{ timestamp: 1000, value: 30 }, { timestamp: 2000, value: 40 }])
  })
  it('undoes creation, movement and deletion without aliasing snapshots, and clears redo on new edits', () => {
    const history = new DrawingHistory()
    history.reset([])
    history.record([line])
    history.record([{ ...line, points: [{ timestamp: 1000, value: 30 }, line.points[1]] }])
    history.record([])
    expect(history.undo()?.[0].points[0].value).toBe(30)
    const previous = history.undo()!
    expect(previous[0].points[0].value).toBe(10)
    previous[0].points[0].value = 999
    expect(history.redo()?.[0].points[0].value).toBe(30)
    history.record([{ ...line, id: 'b' }])
    expect(history.redo()).toBeNull()
  })

  it('serializes only user drawings with timestamp anchors and stable pane names', () => {
    const result = serializeDrawings([
      { ...line, paneId: 'random-pane', points: [{ timestamp: 1000, value: 10, dataIndex: 30 }], isDrawing: () => false },
      { ...line, id: 'engine', name: 'bsMark' },
      { ...line, id: 'unfinished', isDrawing: () => true },
    ], id => id === 'random-pane' ? 'MACD' : id)
    expect(result).toEqual([{ ...line, paneId: 'MACD', points: [{ timestamp: 1000, value: 10 }] }])
  })
  it('does not record hover-induced library stacking order as a drawing edit', () => {
    const a = { ...line, id: 'a' }, b = { ...line, id: 'b' }
    expect(serializeDrawings([b, a], id => id)).toEqual(serializeDrawings([a, b], id => id))
  })

  it('serializes pending saves so an old response cannot overwrite a later drawing', async () => {
    const calls: string[] = []
    let release!: () => void
    const saver = new SerialDrawingSaver(async drawings => {
      calls.push(drawings[0]?.id ?? 'empty')
      if (calls.length === 1) await new Promise<void>(resolve => { release = resolve })
    })
    const first = saver.save([line])
    await new Promise(resolve => setTimeout(resolve, 0))
    const second = saver.save([{ ...line, id: 'b' }])
    expect(calls).toEqual(['a'])
    release()
    await Promise.all([first, second])
    expect(calls).toEqual(['a', 'b'])
  })

  it('allows a retry after a failed save and surfaces that failure', async () => {
    let attempt = 0
    const saver = new SerialDrawingSaver(async () => { if (++attempt === 1) throw new Error('offline') })
    await expect(saver.save([line])).rejects.toThrow('offline')
    await expect(saver.save([line])).resolves.toBeUndefined()
    expect(attempt).toBe(2)
  })
})
