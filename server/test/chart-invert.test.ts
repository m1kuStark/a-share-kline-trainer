import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

// CHART-INVERT-01 K 线多空反转（chart-invert 矩阵，2026-10-26 用户拍板）。
// 覆盖两层：
// ① priceMirror 纯函数层——transpile 提取 web/src/priceMirror.ts 真实模块执行
//   （模式同 percent-hover.test.ts / kdj-indicator.test.ts，不在测试里复制实现）；
// ② KlineChart 集成源码契约——capture 隔离（INVERT-CAPTURE-ISOLATION 最高风险点，
//   KlineChart.vue captureState 读喂入数据，镜像必须只存在于 feed 前最后一跳与渲染锚定）。
//
// 独立 oracle 原则：镜像期望全部为手算常量（p′ = 2P₀ − p 逐字段预计算），
// 不调用被测实现生成期望。
//
// 手算样例勘误记录：任务卡样例 {o:9,h:10.5,l:12,c:9.5} 中 l:12 与其自身规则
// 「镜像后 high′=2P₀−low」的对称式 low′=2P₀−high 矛盾（20−12=8，且 l:12>h:10.5
// 为非法 K 线）；按冻结规则 p′=2P₀−p 与 K 线不变式（h≥max(o,c)、l≤min(o,c)）
// 取 l′=8。已在收尾报告披露。

const chartPath = new URL('../../web/src/components/KlineChart.vue', import.meta.url)
const trainingPath = new URL('../../web/src/views/Training.vue', import.meta.url)
const replayPath = new URL('../../web/src/views/SessionReplay.vue', import.meta.url)

type MirrorBarLike = { open: number; high: number; low: number; close: number }
type MirrorFn = {
  mirrorBasis: (bars: ReadonlyArray<{ close: number }>) => number | null
  mirrorPrice: (price: number, basis: number) => number
  unmirrorPrice: (price: number, basis: number) => number
  mirrorBar: <T extends MirrorBarLike>(bar: T, basis: number) => T
  mirrorBars: <T extends MirrorBarLike>(bars: readonly T[], basis: number) => T[]
  mirrorDrawing: (drawing: MirrorDrawingLike, basis: number) => MirrorDrawingLike
  unmirrorDrawing: (drawing: MirrorDrawingLike, basis: number) => MirrorDrawingLike
}
type MirrorDrawingLike = {
  id: string
  name: string
  paneId: string
  points: Array<{ timestamp: number; value: number }>
  extendData?: unknown
  priceBasis?: { scale: number; offset: number }
}

/** 执行 web/src/priceMirror.ts 真实模块（CommonJS 转译；纯函数层，拒绝任何运行时依赖） */
async function loadPriceMirror(): Promise<MirrorFn> {
  const source = await readFile(new URL('../../web/src/priceMirror.ts', import.meta.url), 'utf8')
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
  const exports_: Record<string, unknown> = {}
  const require_ = (name: string): unknown => { throw new Error(`意外的依赖引用：${name}（priceMirror 应为纯函数模块）`) }
  new Function('require', 'exports', 'module', js)(require_, exports_, { exports: exports_ })
  for (const key of ['mirrorBasis', 'mirrorPrice', 'unmirrorPrice', 'mirrorBar', 'mirrorBars', 'mirrorDrawing', 'unmirrorDrawing'] as const) {
    if (typeof exports_[key] !== 'function') throw new Error(`${key} 未在 priceMirror.ts 导出`)
  }
  return exports_ as unknown as MirrorFn
}

describe('CHART-INVERT-01 priceMirror 纯函数（独立手算 oracle）', () => {
  it('镜像变换，P0=10 时 OHLC 全镜像且高低对调（手算 oracle）', async () => {
    const m = await loadPriceMirror()
    // 手算：P₀=10 → p′=20−p。open 11→9；close 10.5→9.5；
    // p′ 域内 high′=2P₀−low=20−9.5=10.5；low′=2P₀−high=20−12=8
    expect(m.mirrorBar({ open: 11, high: 12, low: 9.5, close: 10.5 }, 10)).toEqual({ open: 9, high: 10.5, low: 8, close: 9.5 })
  })

  it('镜像变换，阴阳互换不变式（o 与 c 大小关系反转且高低域自洽）', async () => {
    const m = await loadPriceMirror()
    // 手算：阴线 {o:11,h:12,l:9.5,c:10.5}（o>c）→ {o:9,c:9.5}（o′<c′ 阳线形状）
    // 手算：阳线 {o:9.8,h:11,l:9.5,c:10.8} → {o:10.2,h:10.5,l:9,c:9.2}（o′>c′ 阴线形状）
    // 手算：平盘 {o:10,h:10.8,l:9.6,c:10} → o′=c′=10（平盘保持）
    const yin = m.mirrorBar({ open: 11, high: 12, low: 9.5, close: 10.5 }, 10)
    expect(yin.open < yin.close).toBe(true)
    const yang = m.mirrorBar({ open: 9.8, high: 11, low: 9.5, close: 10.8 }, 10)
    expect(yang).toEqual({ open: 10.2, high: 10.5, low: 9, close: 9.2 })
    expect(yang.open > yang.close).toBe(true)
    const flat = m.mirrorBar({ open: 10, high: 10.8, low: 9.6, close: 10 }, 10)
    expect(flat.open === flat.close).toBe(true)
    // K 线不变式：镜像后 high′≥max(o′,c′)、low′≤min(o′,c′)
    for (const bar of [yin, yang, flat]) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close))
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close))
    }
  })

  it('镜像基准，取首根收盘价，空序列返回 null', async () => {
    const m = await loadPriceMirror()
    expect(m.mirrorBasis([{ close: 10 }, { close: 11.5 }, { close: 9.25 }])).toBe(10)
    expect(m.mirrorBasis([{ close: 88.88 }])).toBe(88.88)
    expect(m.mirrorBasis([])).toBeNull()
  })

  it('镜像价格与反镜像，互逆且 P0 为不动点', async () => {
    const m = await loadPriceMirror()
    // 手算：P₀=10，13.37 → 20−13.37=6.63
    expect(m.mirrorPrice(13.37, 10)).toBeCloseTo(6.63, 10)
    expect(m.mirrorPrice(10, 10)).toBe(10)
    for (const price of [0.01, 5, 10, 123.456, 9999]) {
      expect(m.unmirrorPrice(m.mirrorPrice(price, 10), 10)).toBeCloseTo(price, 9)
      expect(m.mirrorPrice(m.unmirrorPrice(price, 10), 10)).toBeCloseTo(price, 9)
    }
  })

  it('序列镜像，时间戳与量额字段保留，逐根镜像', async () => {
    const m = await loadPriceMirror()
    const bars = [
      { timestamp: 1000, open: 11, high: 12, low: 9.5, close: 10.5, volume: 1234, amount: 5678.9, date: '2025-01-02' },
      { timestamp: 2000, open: 10.5, high: 10.6, low: 10.1, close: 10.2, volume: 987, amount: 4321, date: '2025-01-03' },
    ]
    const mirrored = m.mirrorBars(bars, 10)
    expect(mirrored).toHaveLength(2)
    expect(mirrored[0]).toEqual({ timestamp: 1000, open: 9, high: 10.5, low: 8, close: 9.5, volume: 1234, amount: 5678.9, date: '2025-01-02' })
    expect(mirrored[1]).toEqual({ timestamp: 2000, open: 9.5, high: 9.9, low: 9.4, close: 9.8, volume: 987, amount: 4321, date: '2025-01-03' })
    // 纯函数不改动输入
    expect(bars[0]).toEqual({ timestamp: 1000, open: 11, high: 12, low: 9.5, close: 10.5, volume: 1234, amount: 5678.9, date: '2025-01-02' })
  })

  it('序列镜像，镜像对 P0 平移形状不变而基准重算会改变数值（basis 冻结语义的数学面）', async () => {
    const m = await loadPriceMirror()
    const original = [{ open: 11, high: 12, low: 9.5, close: 10.5 }]
    const prepended = [{ open: 9.4, high: 9.6, low: 9.2, close: 9 }, ...original]
    // 冻结口径：前插后沿用首次解析的 P₀=10 → 原 bar 镜像 close 仍为 9.5
    expect(m.mirrorBars(prepended, 10)[1]!.close).toBeCloseTo(9.5, 10)
    // 若按新首根 close=9 重算 P₀ → 原 bar 镜像 close=18−10.5=7.5（数值漂移）
    expect(m.mirrorBars(prepended, 9)[1]!.close).toBeCloseTo(7.5, 10)
    // 两组数值不同：基准选择可分辨——组件层「冻结不重算」由源码契约与 e2e 锁定
    expect(m.mirrorBars(prepended, 10)[1]!.close).not.toBeCloseTo(m.mirrorBars(prepended, 9)[1]!.close, 10)
  })

  it('画线镜像，主图点位与数字标签镜像，副图与价格基准字段不动', async () => {
    const m = await loadPriceMirror()
    // 手算：P₀=10 → segment 主图点位 [12, 9] → [8, 11]
    const segment: MirrorDrawingLike = { id: 'd1', name: 'segment', paneId: 'candle_pane', points: [{ timestamp: 1000, value: 12 }, { timestamp: 2000, value: 9 }] }
    const mirroredSegment = m.mirrorDrawing(segment, 10)
    expect(mirroredSegment.points.map(point => point.value)).toEqual([8, 11])
    // simpleTag 纯数字标签随锚点同步（projectDrawings 同款判定口径）
    const tag: MirrorDrawingLike = { id: 'd2', name: 'simpleTag', paneId: 'candle_pane', points: [{ timestamp: 1000, value: 12 }], extendData: '12.00' }
    const mirroredTag = m.mirrorDrawing(tag, 10)
    expect(mirroredTag.points[0]!.value).toBeCloseTo(8, 10)
    expect(mirroredTag.extendData).toBe('8.00')
    // 副图画线（指标值域，非价格）不镜像
    const subPane: MirrorDrawingLike = { id: 'd3', name: 'segment', paneId: 'VOL', points: [{ timestamp: 1000, value: 12345.6 }] }
    expect(m.mirrorDrawing(subPane, 10).points[0]!.value).toBe(12345.6)
    // 前复权基准盖印字段原样保留（镜像不改前复权语义）
    const withBasis: MirrorDrawingLike = { id: 'd4', name: 'segment', paneId: 'candle_pane', points: [{ timestamp: 1000, value: 12 }], priceBasis: { scale: 1.5, offset: -0.25 } }
    expect(m.mirrorDrawing(withBasis, 10).priceBasis).toEqual({ scale: 1.5, offset: -0.25 })
  })

  it('画线镜像，unmirror 与 mirror 互逆（含数字标签）', async () => {
    const m = await loadPriceMirror()
    const drawings: MirrorDrawingLike[] = [
      { id: 'd1', name: 'segment', paneId: 'candle_pane', points: [{ timestamp: 1000, value: 12.34 }, { timestamp: 2000, value: 9.87 }] },
      { id: 'd2', name: 'simpleTag', paneId: 'candle_pane', points: [{ timestamp: 1000, value: 13.5 }], extendData: '13.50' },
      { id: 'd3', name: 'segment', paneId: 'MACD', points: [{ timestamp: 1000, value: -0.42 }] },
    ]
    for (const drawing of drawings) {
      const round = m.unmirrorDrawing(m.mirrorDrawing(drawing, 10), 10)
      expect(round.points.map(point => point.value)).toEqual(drawing.points.map(point => point.value))
    }
    // 数字标签往返回原字符串
    const tagRound = m.unmirrorDrawing(m.mirrorDrawing(drawings[1]!, 10), 10)
    expect(tagRound.extendData).toBe('13.50')
  })
})

describe('CHART-INVERT-01 KlineChart 集成源码契约（capture 隔离与镜像最后一跳）', () => {
  async function readChart(): Promise<string> { return readFile(chartPath, 'utf8') }
  function functionBody(source: string, startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker)
    expect(start, `源码应含 ${startMarker}`).toBeGreaterThanOrEqual(0)
    const end = source.indexOf(endMarker, start)
    expect(end, `${startMarker} 之后应存在 ${endMarker}`).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('capture 隔离，captureState 以组件真实序列 loadedData 为唯一源（镜像喂入零渗入）', async () => {
    const source = await readChart()
    const body = functionBody(source, 'function captureState(): ChartCapture', 'function captureReplayView')
    // INVERT-CAPTURE-ISOLATION 核心：捕获 bars 与视窗 data 必须来自组件内真实序列
    expect(body).toMatch(/toCaptureBars\(loadedData\)/)
    expect(body).toMatch(/data: loadedData,/)
    // 镜像污染特征（M2-DRAWING-01 同构事故形态）：capture 不得读库内喂入数据
    expect(body).not.toMatch(/chart\.getDataList\(\)/)
    expect(body).not.toMatch(/toCaptureBars\((data|chartFeedData)/)
  })

  it('喂入层镜像，镜像只发生在 chart 数据装载前的最后一跳', async () => {
    const source = await readChart()
    // 存在唯一的喂入变换入口（真实序列事实源 loadedData → 镜像显示序列）
    expect(source).toMatch(/function chartFeedData\(\)[\s\S]{0,400}mirrorBars\(loadedData, /)
    // loader 回调喂的是变换后的显示序列，而不是把 loadedData 本体替换掉
    expect(source).toMatch(/callback\(chartFeedData\(\), \{ forward: hasMoreForward, backward: false \}\)/)
    // loadedData 事实源不被镜像写回（feedData 装载与补历史前插都保持真实价）
    expect(source).not.toMatch(/loadedData = .*mirrorBars/)
    expect(source).not.toMatch(/mirrorBars\(loadedData\)\s*;?\s*loadedData/)
  })

  it('镜像基准，P0 惰性解析且冻结（补历史不重算）', async () => {
    const source = await readChart()
    // INVERT-BASIS-FROZEN：basis 首次启用解析后冻结，后续喂入（含补历史前插）复用同一值
    expect(source).toMatch(/mirrorBasisP0 === null/)
    expect(source).toMatch(/mirrorBasisP0 = loadedData\[0\]!\.close/)
    // 冻结特征：解析赋值受 null 判定保护（不存在绕过判定的无条件按首根重算路径）
    const assignSites = source.match(/mirrorBasisP0 = [^\n]*/g) ?? []
    expect(assignSites.length, 'basis 解析点唯一').toBe(1)
  })

  it('画线读写对称，序列化读回反镜像与恢复喂入镜像成对出现', async () => {
    const source = await readChart()
    // INVERT-DRAWING-FOLLOW：存储域恒真实价——读回（drawings 序列化）反镜像、喂入（restore）镜像
    const drawingsBody = functionBody(source, 'function drawings(): Drawing[]', 'function notifyHistory')
    expect(drawingsBody).toMatch(/unmirrorDrawings\(/)
    const restoreBody = functionBody(source, 'function restoreDrawings(items: Drawing\[\], resetHistory = false)', 'function undoDrawing')
    expect(restoreBody).toMatch(/mirrorDrawings\(/)
  })

  it('标记锚定，B/S 标记成本线阶段价线与挂单像素经同一镜像变换', async () => {
    const source = await readChart()
    // INVERT-MARKS-REAL-INFO：锚定像素走镜像域（displayValue），悬浮文本保持真实值（orderTooltipText 原值）
    const marksBody = functionBody(source, 'function refreshMarks(): void', 'function hitPendingOrders')
    expect(marksBody).toMatch(/displayValue\(/)
    // 挂单像素锚定（命中检测/悬浮定位/邻近判定）经 displayValue（showOrderTooltip 用 orders[0]）
    for (const [anchor, next] of [['hitPendingOrders', 'function showOrderTooltip'], ['showOrderTooltip', 'function orderTooltipText'], ['isNearPendingOrder', 'function dispatchSyntheticAxisMove']] as const) {
      const body = functionBody(source, `function ${anchor}`, next)
      expect(body, `${anchor} 应经 displayValue 锚定`).toMatch(/displayValue\(orders?\[?0?\]?\.triggerPrice\)/)
    }
    // 悬浮文本不镜像（真实触发价直显）
    const tooltipBody = functionBody(source, 'function orderTooltipText(order: OrderView)', 'function restoreYAxisAutoFit')
    expect(tooltipBody).toMatch(/order\.triggerPrice\.toFixed\(2\)/)
  })

  it('悬浮信息卡，镜像态从真实序列取数（交易决策信息不撒谎）', async () => {
    const source = await readChart()
    // INVERT-MARKS-REAL-INFO 信息卡子句：buildHoverModel 在镜像态读 loadedData（真实价），而非库内镜像序列
    const body = functionBody(source, 'function buildHoverModel(dataIndex: number)', 'function placeHoverCard')
    expect(body).toMatch(/loadedData as Array[^\n]*\)\[dataIndex\]/)
  })

  it('两页接线，训练页与回放页都传入 priceMirror 开关且默认关闭不持久化', async () => {
    const training = await readFile(trainingPath, 'utf8')
    const replay = await readFile(replayPath, 'utf8')
    expect(training).toMatch(/:price-mirror="priceMirror"/)
    expect(replay).toMatch(/:price-mirror="priceMirror"/)
    // 两页各有带 aria-pressed 的「多空反转」开关按钮（同一按钮内：class→aria-pressed→按钮文本）
    for (const [label, source] of [['Training', training], ['SessionReplay', replay]] as const) {
      expect(source, `${label} 多空反转开关按钮`).toMatch(/class="price-mirror-toggle"[\s\S]{0,600}aria-pressed[\s\S]{0,600}多空反转<\/button>/)
      expect(source).toMatch(/const priceMirror = ref\(false\)/)
    }
    // 不持久化（防混淆优先）：无镜像开关专用 localStorage 键
    expect(training).not.toMatch(/trainer_price_mirror/)
    expect(replay).not.toMatch(/trainer_price_mirror/)
  })

  it('防混淆水印，开启时显示多空反转视角水印且注明坐标为镜像值', async () => {
    const source = await readChart()
    expect(source).toMatch(/多空反转视角/)
    expect(source).toMatch(/坐标为镜像值/)
    // 水印为纯展示层：不拦截指针事件
    expect(source).toMatch(/price-mirror-watermark[\s\S]{0,400}pointer-events: none/)
  })
})
