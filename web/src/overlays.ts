import { registerOverlay } from 'klinecharts'

// Passive fill glyph. The rail remains the only interactive trade detail view.
registerOverlay<{ side: 'buy' | 'sell' }>({
  name: 'bsMark', totalStep: 1, lock: true, needDefaultPointFigure: false,
  createPointFigures: ({ chart, overlay, coordinates, bounding, xAxis }) => {
    const point = coordinates[0], timestamp = overlay.points[0]?.timestamp
    if (!point || timestamp == null || !xAxis) return []
    const { x, y } = point
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > bounding.width || y < 0 || y > bounding.height) return []
    // Library projection can extrapolate or choose a neighbouring candle. An
    // open-phase fill, for example, may not have a disclosed daily bar yet.
    if (chart.getDataList()[xAxis.convertFromPixel(x)]?.timestamp !== timestamp) return []
    const buy = overlay.extendData.side === 'buy', dir = buy ? 1 : -1
    // Keep opposite fills distinguishable even on the same weekly/monthly candle.
    const labelX = x - dir * 8
    const color = buy ? '#e88918' : '#24a6d9'
    return [
      { type: 'polygon', attrs: { coordinates: [{ x, y }, { x: labelX - 5, y: y + dir * 8 }, { x: labelX + 5, y: y + dir * 8 }] }, styles: { style: 'fill', color }, ignoreEvent: true },
      { type: 'text', attrs: { x: labelX, y: y + dir * 8, text: buy ? 'B' : 'S', align: 'center', baseline: buy ? 'top' : 'bottom' }, styles: { size: 10, weight: 'bold', color: '#ffffff', backgroundColor: buy ? '#995411' : '#166887', paddingLeft: 2, paddingRight: 2, borderSize: 0 }, ignoreEvent: true },
    ]
  },
})

// M2 摊薄成本线：锁定，不参与鼠标交互。
registerOverlay({
  name: 'costLine',
  totalStep: 1,
  createPointFigures: ({ overlay, coordinates, bounding }) => {
    const cost = overlay.extendData as number | undefined
    const y = coordinates[0]?.y
    if (cost === undefined || y === undefined || y < 0 || y > bounding.height) return []
    return [
      { type: 'line', attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] }, styles: { style: 'dashed', color: '#f59e0b', size: 2 }, ignoreEvent: true },
      { type: 'text', attrs: { x: 6, y: y - 12, text: `成本 ${cost.toFixed(2)}` }, styles: { color: '#f59e0b', size: 11, backgroundColor: 'transparent', borderSize: 0, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 }, ignoreEvent: true },
    ]
  },
})

registerOverlay({
  name: 'phasePriceLine',
  totalStep: 1,
  createPointFigures: ({ chart, overlay, coordinates, bounding }) => {
    const data = overlay.extendData as { price?: number; color?: string } | number | undefined
    const price = typeof data === 'number' ? data : data?.price
    const color = typeof data === 'number' ? '#94a3b8' : data?.color ?? '#94a3b8'
    const y = coordinates[0]?.y
    if (typeof price !== 'number' || !Number.isFinite(price) || y === undefined || y < 0 || y > bounding.height) return []
    return [
      { type: 'line', attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] }, styles: { ...chart.getStyles().candle.priceMark.last.line, color }, ignoreEvent: true },
    ]
  },
  createYAxisFigures: ({ chart, overlay, coordinates, bounding, yAxis }) => {
    const data = overlay.extendData as { price?: number; color?: string } | number | undefined
    const price = typeof data === 'number' ? data : data?.price
    const color = typeof data === 'number' ? '#94a3b8' : data?.color ?? '#94a3b8'
    const y = coordinates[0]?.y
    if (typeof price !== 'number' || !Number.isFinite(price) || y === undefined || y < 0 || y > bounding.height) return []
    const fromZero = yAxis?.isFromZero() ?? true
    return [{
      type: 'text', attrs: { x: fromZero ? 0 : bounding.width, y, text: price.toFixed(2), align: fromZero ? 'left' : 'right', baseline: 'middle' },
      styles: { ...chart.getStyles().candle.priceMark.last.text, backgroundColor: color }, ignoreEvent: true,
    }]
  },
})

registerOverlay({
  name: 'orderTriggerMark',
  totalStep: 1,
  createPointFigures: ({ overlay, coordinates, bounding }) => {
    const data = overlay.extendData as { side?: 'buy' | 'sell'; triggerPrice?: number; shares?: number } | undefined
    const y = coordinates[0]?.y
    if (!data?.triggerPrice || y === undefined || y < 0 || y > bounding.height) return []
    const color = data.side === 'buy' ? '#f97316' : '#a855f7'
    return [{ type: 'circle', attrs: { x: bounding.width - 7, y, r: 5 }, styles: { color, style: 'fill' } }, { type: 'text', attrs: { x: bounding.width - 75, y: y - 5, text: `${data.side === 'buy' ? '买' : '卖'} ${data.triggerPrice.toFixed(2)}` }, styles: { color, size: 10, backgroundColor: 'transparent', borderSize: 0, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 } }]
  },
})
