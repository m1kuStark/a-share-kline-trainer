// REPLAY-VIEWPORT-01 回放重挂视口恢复纯函数：捕获/恢复「最后一根K线到绘图区右缘」的
// 右侧空隔（库内 _lastBarRightSideDiffBarCount，单位＝bar 数）。只随重挂瞬态传递
// （SessionReplay replayView → KlineChart replayView prop），绝不写入录像文件——
// 录像契约里的 ChartCaptureView（recording/types.ts）保持原样，不新增记录字段。
// 库语义按 klinecharts 10.0.3 dist 源码冻结（公式与测试侧冻结 oracle 相互独立）：
// · 可见区间 realTo = Math.round(diff + dataCount + 0.5)（不钳入数据长度）
// · getOffsetRightDistance() = max(0, diff × barSpace)（历史位 diff<0 被钳 0）
// · scrollToTimestamp(ts) 终态 diff = nearestIndex(ts) - (dataCount - 1)（锚点根钉在右缘）
// · scrollByDistance(d) 后 diff' = diff - d / barSpace
import type { ChartCaptureView } from './types'

/** 回放重挂用的视窗：内容锚点与录像快照同构，另带瞬态右侧空隔（回放恢复专用，不是录制字段） */
export interface ReplayViewport extends ChartCaptureView {
  /** 最后一根K线到绘图区右缘的空隔（bar 数，可带小数）。>0＝右侧空白预留（实时位），
   *  <0＝历史位（末根在右缘之外）；undefined＝旧视口对象，恢复行为与旧实现一致 */
  rightOffsetBars?: number
}

/** 由库的不钳右界 realTo 反解右侧空隔；round 的固有粒度使误差有界 ±半根 */
export function rightOffsetBarsFromRealTo(realTo: number, dataCount: number): number {
  if (!Number.isFinite(realTo) || !Number.isFinite(dataCount)) return 0
  return realTo - dataCount - 0.5
}

/** 捕获侧一次取值：diff≥0 时 getOffsetRightDistance()（px）精确无舍入，优先采用；
 *  返回 0（历史位被钳）时回落 realTo 反解（误差≤半根） */
export function replayRightOffsetBars(measure: {
  offsetRightDistancePx: number
  barSpace: number
  realTo: number
  dataCount: number
}): number {
  if (measure.offsetRightDistancePx > 0 && measure.barSpace > 0) {
    return measure.offsetRightDistancePx / measure.barSpace
  }
  return rightOffsetBarsFromRealTo(measure.realTo, measure.dataCount)
}

/** 时间戳→数据下标，与库 scrollToTimestamp 内部 binarySearchNearest 同口径：
 *  命中取命中下标，未命中取最近根（时间戳严格递增时二者等价）；空数据返回 -1 */
export function nearestIndexByTimestamp(data: ReadonlyArray<{ timestamp: number }>, timestamp: number): number {
  if (!data.length) return -1
  let low = 0
  let high = data.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    const value = data[mid]!.timestamp
    if (value === timestamp) return mid
    if (value < timestamp) low = mid + 1
    else high = mid
  }
  // low＝插入点；与前一根比较取真正最近的一根（平手取前）
  if (low > 0 && Math.abs(data[low - 1]!.timestamp - timestamp) <= Math.abs(data[low]!.timestamp - timestamp)) {
    return low - 1
  }
  return low
}

/** scrollToTimestamp(anchor) 之后的修正滚动距离（px，喂给 chart.scrollByDistance）：
 *  锚点根先被钉在绘图区右缘（终态 diff = anchorIndex - (dataCount - 1)），再把末根右侧
 *  空隔修正回重挂前值 rightOffsetBars。无 rightOffsetBars（旧视口对象）时返回 0＝旧实现行为 */
export function replayRestoreScrollDistance(
  anchorIndex: number,
  dataCount: number,
  barSpace: number,
  rightOffsetBars: number | null | undefined,
): number {
  if (rightOffsetBars === null || rightOffsetBars === undefined || !Number.isFinite(rightOffsetBars)) return 0
  if (!Number.isFinite(anchorIndex) || !Number.isFinite(dataCount) || !Number.isFinite(barSpace) || barSpace <= 0) return 0
  return (anchorIndex - (dataCount - 1) - rightOffsetBars) * barSpace
}
