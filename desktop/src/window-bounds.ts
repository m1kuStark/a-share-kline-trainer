// PACK-02 窗口 bounds 记忆（DESKTOP-WINDOW-BOUNDS-PERSIST）。
// 纯函数：解析/clamp/序列化。口径＝PACK-02 派发简报决策⑤——持久化到数据目录配置文件、
// 最小尺寸 1024×680、默认尺寸沿用 PACK-01 1360×860。
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_WINDOW_SIZE = { width: 1024, height: 680 } as const
export const DEFAULT_WINDOW_SIZE = { width: 1360, height: 860 } as const

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** 严格解析 window-state.json 内容：{x,y,width,height} 四键均安全整数且尺寸为正；任何偏差→null（回默认） */
export function parseWindowState(raw: unknown): WindowBounds | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const { x, y, width, height } = record
  if (!isSafeInteger(x) || !isSafeInteger(y) || !isSafeInteger(width) || !isSafeInteger(height)) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/**
 * clamp 到显示器工作区：先保最小尺寸（工作区物理上小于最小尺寸时收缩到工作区），
 * 再把窗口完全拉入工作区（越界贴边，负坐标归工作区原点）。
 */
export function clampToBounds(bounds: WindowBounds, workArea: { x: number; y: number; width: number; height: number }): WindowBounds {
  let { width, height } = bounds
  width = Math.max(width, MIN_WINDOW_SIZE.width)
  height = Math.max(height, MIN_WINDOW_SIZE.height)
  // 物理约束优先：显示器装不下最小尺寸时收缩到工作区大小
  width = Math.min(width, workArea.width)
  height = Math.min(height, workArea.height)
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height
  const x = Math.min(Math.max(bounds.x, workArea.x), Math.max(workArea.x, maxX))
  const y = Math.min(Math.max(bounds.y, workArea.y), Math.max(workArea.y, maxY))
  return { x, y, width, height }
}

/** 落盘形态：四键安全整数（Electron getBounds 可能给浮点，取整；NaN 防御回默认尺寸） */
export function serializeBounds(bounds: { x: number; y: number; width: number; height: number }): WindowBounds {
  const round = (value: unknown, fallback: number): number => {
    const n = Math.round(Number(value))
    return Number.isSafeInteger(n) ? n : fallback
  }
  return {
    x: round(bounds.x, 0),
    y: round(bounds.y, 0),
    width: round(bounds.width, DEFAULT_WINDOW_SIZE.width),
    height: round(bounds.height, DEFAULT_WINDOW_SIZE.height),
  }
}
