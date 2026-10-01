import { registerOverlay } from 'klinecharts'

export interface BsMarkData { side: 'buy' | 'sell'; shares: number; price: number }

// Keep engine marker identity for counts/exclusions; the separate rail renders trades.
registerOverlay({
  name: 'bsMark',
  totalStep: 1,
  createPointFigures: () => [],
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
  createPointFigures: ({ overlay, coordinates, bounding }) => {
    const data = overlay.extendData as { price?: number; color?: string } | number | undefined
    const price = typeof data === 'number' ? data : data?.price
    const color = typeof data === 'number' ? '#94a3b8' : data?.color ?? '#94a3b8'
    const y = coordinates[0]?.y
    if (typeof price !== 'number' || !Number.isFinite(price) || y === undefined || y < 0 || y > bounding.height) return []
    return [
      { type: 'line', attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] }, styles: { style: 'dashed', color, size: 1.5 }, ignoreEvent: true },
      { type: 'text', attrs: { x: Math.max(4, bounding.width - 82), y: y - 5, text: `${price.toFixed(2)}` }, styles: { color, size: 10, backgroundColor: 'transparent', borderSize: 0, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 }, ignoreEvent: true },
    ]
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
