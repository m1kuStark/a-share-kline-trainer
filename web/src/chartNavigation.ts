import type { Timeframe } from './api'

export const MAX_VISIBLE_BARS = 840
/** 主图右侧空白预留（px）：挂载 setOffsetRightDistance / 复位与缩放的可用宽度计算共用；
 *  回放重挂视口恢复（replayViewport.ts）以此为实时位空隔基准，测试侧经本常量断言 */
export const CHART_RIGHT_MARGIN_PX = 80
const TIMEFRAMES: Timeframe[] = ['1D', '1W', '1M']

export function nextTimeframe(timeframe: Timeframe, direction: 1 | -1): Timeframe {
  return TIMEFRAMES[(TIMEFRAMES.indexOf(timeframe) + direction + TIMEFRAMES.length) % TIMEFRAMES.length]
}

export function cycleDirection(event: Pick<KeyboardEvent, 'key' | 'code'> & Partial<KeyboardEvent>): -1 | 0 | 1 {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing || event.repeat) return 0
  if (event.code === 'BracketRight' || event.key === ']') return 1
  if (event.code === 'BracketLeft' || event.key === '[') return -1
  return 0
}
