import type { Drawing } from './drawingState'

// CHART-INVERT-01 K 线多空反转（视图层镜像）纯函数层。
// 用户 2026-10-26 拍板：p′ = 2×P₀ − p 绕首根收盘价 P₀ 翻转（保持正值域），
// 开高低收全镜像（阴阳形状互换）；纯视图——交易/结算/录像/画线持久面零污染。
// 镜像是仿射对合变换（involution：镜像的镜像＝原值），unmirror 与 mirror 同式。
// 本模块不依赖图表实例与 DOM（server/test transpile 提取单测的取数前提）。

/** 可镜像 K 线的最小字段（时间戳/量额等其余字段原样保留） */
export type MirrorableBar = { open: number; high: number; low: number; close: number }

/** 镜像基准 P₀：取序列首根收盘价；空序列/无效值返回 null（调用方保持不镜像） */
export function mirrorBasis(bars: ReadonlyArray<{ close: number }>): number | null {
  const first = bars[0]
  return first !== undefined && Number.isFinite(first.close) ? first.close : null
}

/** 单价镜像 p′=2P₀−p（自反：unmirrorPrice 与本函数同式） */
export function mirrorPrice(price: number, basis: number): number {
  return 2 * basis - price
}

/** 单价反镜像（对合变换，与 mirrorPrice 同式；独立导出以显式表达读回方向） */
export function unmirrorPrice(price: number, basis: number): number {
  return 2 * basis - price
}

/** OHLC 全镜像：p′ 域内 high′=2P₀−low、low′=2P₀−high（高低语义对调），其余字段浅拷贝保留 */
export function mirrorBar<T extends MirrorableBar>(bar: T, basis: number): T {
  return { ...bar, open: 2 * basis - bar.open, high: 2 * basis - bar.low, low: 2 * basis - bar.high, close: 2 * basis - bar.close }
}

/** 序列级镜像：逐根独立变换，输出全新数组（真实序列事实源不被改写） */
export function mirrorBars<T extends MirrorableBar>(bars: readonly T[], basis: number): T[] {
  return bars.map(bar => mirrorBar(bar, basis))
}

function mainPaneDrawing(drawing: Drawing): boolean {
  return drawing.paneId === 'candle_pane' || drawing.paneId === undefined
}

/** 画线整体镜像：只换主图锚点数值（VOL/MACD 等副图指标值不套价格公式）；
 * simpleTag 的纯数字字符串 extendData 是价格标签，随锚点同步（projectDrawings 同款判定）；
 * priceBasis 前复权盖印原样保留（镜像不改复权语义）。自反变换＝反镜像。 */
export function mirrorDrawing(drawing: Drawing, basis: number): Drawing {
  if (!mainPaneDrawing(drawing)) {
    return { ...drawing, points: drawing.points.map(point => ({ ...point })) }
  }
  const points = drawing.points.map(point => ({ ...point, value: mirrorPrice(point.value, basis) }))
  const mirrored: Drawing = { ...drawing, points }
  const label = drawing.extendData
  const oldValue = drawing.points[0]?.value
  if (drawing.name === 'simpleTag' && drawing.points.length === 1 && typeof label === 'string' &&
      Number.isFinite(Number(label.trim())) && Math.abs(Number(label.trim()) - (oldValue ?? NaN)) < 1e-9) {
    mirrored.extendData = mirrorPrice(oldValue!, basis).toFixed(2)
  }
  return mirrored
}

/** 画线整体反镜像（对合变换，与 mirrorDrawing 同式；读回存储/持久面方向） */
export function unmirrorDrawing(drawing: Drawing, basis: number): Drawing {
  return mirrorDrawing(drawing, basis)
}

/** 序列级画线镜像（喂入显示域前） */
export function mirrorDrawings(drawings: readonly Drawing[], basis: number): Drawing[] {
  return drawings.map(drawing => mirrorDrawing(drawing, basis))
}

/** 序列级画线反镜像（图上序列化读回真实价） */
export function unmirrorDrawings(drawings: readonly Drawing[], basis: number): Drawing[] {
  return drawings.map(drawing => unmirrorDrawing(drawing, basis))
}
