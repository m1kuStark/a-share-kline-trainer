import { registerOverlay } from 'klinecharts'

export interface BsMarkData { side: 'buy' | 'sell'; shares: number; price: number }

// M2 成交标记：买入红点在 K 线下方，卖出绿点在 K 线上方。
registerOverlay({
  name: 'bsMark',
  totalStep: 1,
  createPointFigures: ({ overlay, coordinates }) => {
    const data = overlay.extendData as BsMarkData | undefined
    const coordinate = coordinates[0]
    if (!data || !coordinate) return []
    const isBuy = data.side === 'buy'
    const dotY = isBuy ? coordinate.y + 24 : coordinate.y - 24
    const color = isBuy ? '#dc2626' : '#16a34a'
    const letterSize = 11
    return [
      { type: 'circle', attrs: { x: coordinate.x, y: dotY, r: 9 }, styles: { style: 'fill', color, borderColor: color }, ignoreEvent: true },
      { type: 'text', attrs: { x: coordinate.x - letterSize * 0.36, y: dotY - letterSize * 0.55, text: isBuy ? 'B' : 'S' }, styles: { color: '#ffffff', size: letterSize, weight: 'bold', backgroundColor: 'transparent' }, ignoreEvent: true },
      { type: 'text', attrs: { x: coordinate.x + 12, y: isBuy ? dotY + 9 : dotY - 21, text: `${data.shares}股@${data.price.toFixed(2)}`, paddingLeft: 4, paddingRight: 4 }, styles: { color: '#ffffff', size: 10, backgroundColor: color, paddingTop: 2 }, ignoreEvent: true },
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
      { type: 'text', attrs: { x: 6, y: y - 9, text: `成本 ${cost.toFixed(2)}`, paddingLeft: 4, paddingRight: 4 }, styles: { color: '#ffffff', size: 10, backgroundColor: '#f59e0b', paddingTop: 2 }, ignoreEvent: true },
    ]
  },
})

