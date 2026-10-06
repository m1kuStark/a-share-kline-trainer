// PACK-02（DESKTOP-WINDOW-BOUNDS-PERSIST）：窗口位置尺寸记忆。
// oracle 独立性：期望来自 PACK-02 派发简报决策⑤（数据目录配置文件、最小尺寸 1024×680、
// 默认尺寸沿用 PACK-01 1360×860）；显示器工作区几何关系手写（不调用被测函数生成期望）。
import { describe, expect, it } from 'vitest'
import { clampToBounds, DEFAULT_WINDOW_SIZE, MIN_WINDOW_SIZE, parseWindowState, serializeBounds } from '../src/window-bounds.js'

// 典型 1080p 主屏工作区（任务栏 40px）：几何期望独立手写
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 }

describe('DESKTOP-WINDOW-BOUNDS-PERSIST：窗口 bounds 记忆', () => {
  it('DESKTOP-WINDOW-BOUNDS-PERSIST: parseWindowState accepts strict integer bounds and rejects garbage', () => {
    expect(parseWindowState({ x: 100, y: 50, width: 1360, height: 860 }))
      .toEqual({ x: 100, y: 50, width: 1360, height: 860 })
    expect(parseWindowState(null)).toBeNull()
    expect(parseWindowState(undefined)).toBeNull()
    expect(parseWindowState('100,50,1360,860')).toBeNull()
    expect(parseWindowState([100, 50, 1360, 860])).toBeNull()
    expect(parseWindowState({ x: 100, y: 50, width: 1360 })).toBeNull()        // 缺 height
    expect(parseWindowState({ x: 100.5, y: 50, width: 1360, height: 860 })).toBeNull() // 浮点
    expect(parseWindowState({ x: NaN, y: 50, width: 1360, height: 860 })).toBeNull()
    expect(parseWindowState({ x: 100, y: 50, width: 0, height: 860 })).toBeNull()      // 非正尺寸
    expect(parseWindowState({ x: 100, y: 50, width: 1360, height: -10 })).toBeNull()
  })

  it('DESKTOP-WINDOW-BOUNDS-PERSIST: clampToBounds pulls off-screen windows into the work area', () => {
    // 完全在左侧屏幕外 → 拉回工作区左上
    expect(clampToBounds({ x: -3000, y: -400, width: 1360, height: 860 }, WORK_AREA))
      .toEqual({ x: 0, y: 0, width: 1360, height: 860 })
    // 右下越界 → 贴工作区右/下边缘
    expect(clampToBounds({ x: 5000, y: 900, width: 1360, height: 860 }, WORK_AREA))
      .toEqual({ x: 1920 - 1360, y: 1040 - 860, width: 1360, height: 860 })
    // 工作区内合法位置 → 原样保留
    expect(clampToBounds({ x: 120, y: 80, width: 1360, height: 860 }, WORK_AREA))
      .toEqual({ x: 120, y: 80, width: 1360, height: 860 })
    // 非零原点显示器（副屏在右侧）
    const secondMonitor = { x: 1920, y: 0, width: 1280, height: 1024 }
    expect(clampToBounds({ x: 0, y: 0, width: 1024, height: 680 }, secondMonitor))
      .toEqual({ x: 1920, y: 0, width: 1024, height: 680 })
  })

  it('DESKTOP-WINDOW-BOUNDS-PERSIST: clampToBounds enforces the 1024x680 minimum size', () => {
    // 记忆的尺寸过小 → 放大到最小尺寸
    expect(clampToBounds({ x: 10, y: 10, width: 800, height: 500 }, WORK_AREA))
      .toEqual({ x: 10, y: 10, width: MIN_WINDOW_SIZE.width, height: MIN_WINDOW_SIZE.height })
    expect(MIN_WINDOW_SIZE).toEqual({ width: 1024, height: 680 })
    expect(DEFAULT_WINDOW_SIZE).toEqual({ width: 1360, height: 860 })
    // 显示器工作区小于最小尺寸时物理约束优先（收缩到工作区大小，不越界）
    const tiny = { x: 0, y: 0, width: 800, height: 600 }
    expect(clampToBounds({ x: 0, y: 0, width: 1024, height: 680 }, tiny))
      .toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })

  it('DESKTOP-WINDOW-BOUNDS-PERSIST: serializeBounds round-trips a live window rectangle', () => {
    const live = { x: 88, y: 66, width: 1400, height: 900 }
    const serialized = serializeBounds(live)
    expect(serialized).toEqual({ x: 88, y: 66, width: 1400, height: 900 })
    expect(parseWindowState(JSON.parse(JSON.stringify(serialized)))).toEqual(live)
  })
})
