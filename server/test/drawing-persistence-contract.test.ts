import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { mergePeriodDrawings } from '../../web/src/recording/chartCapture'
import type { Drawing } from '../../web/src/drawingState'

const chartPath = new URL('../../web/src/components/KlineChart.vue', import.meta.url)

// 源文件为 CRLF，读入后归一化成 LF，函数级断言才能用 \n 书写
async function readChart(): Promise<string> {
  return (await readFile(chartPath, 'utf8')).replace(/\r\n/g, '\n')
}

// 取 startMarker 起、至 endMarker 前的源码块（函数级契约断言，避免全文件正则误命中）
function blockOf(source: string, startMarker: string, endMarker: string): string {
  const from = source.indexOf(startMarker)
  expect(from).toBeGreaterThanOrEqual(0)
  const to = endMarker ? source.indexOf(endMarker, from + startMarker.length) : -1
  return to < 0 ? source.slice(from) : source.slice(from, to)
}

// M2-DRAWING-01（2026-10-19 批复 1/2/3，bug-loop RED）：
// ①推进不清撤销历史（drawing-persistence.md 成文契约）；②恢复不覆盖逐画线自定义样式；
// ③录像 captureState 序列化全部周期画线（周期过滤仅属显示层，不得渗入持久面）。
describe('DRAWING-PERSISTENCE 修复轮契约', () => {
  it('feedData 仅在周期面重建（挂载/切周期）时重置撤销史，普通推进保历史', async () => {
    const source = await readChart()
    const feed = blockOf(source, 'function feedData(', '// REC-CHART 图表捕获')
    // 周期面判定：上一喂入周期与当前不同（含挂载首喂 null）才重建图表面
    expect(feed).toMatch(/const surfaceRebuild = fedTimeframe !== props\.timeframe/)
    expect(feed).toMatch(/fedTimeframe = props\.timeframe/)
    // 重置只发生在 surfaceRebuild 守卫内：推进（同周期新K线）绝不清撤销史
    const guard = feed.slice(feed.indexOf('const surfaceRebuild'))
    expect(guard).toMatch(/if \(surfaceRebuild\) \{\n {4}restoredDrawings = false\n {4}drawingHistory\.reset\(\[\]\)\n {2}\}/)
    // 守卫之前不得出现无条件重置
    expect(feed.slice(0, feed.indexOf('const surfaceRebuild'))).not.toMatch(/drawingHistory\.reset\(\[\]\)/)
  })

  it('restoreDrawings 逐条保留保存时样式，configuredOverlayStyle 只作缺省兜底', async () => {
    const source = await readChart()
    const restore = blockOf(source, 'function restoreDrawings(', 'function undoDrawing(')
    // 保存集里的 item.styles 优先；无样式旧数据才回落默认（工具偏好/箭头语义色）
    expect(restore).toMatch(/styles: item\.styles \?\? fallbackStyle/)
    expect(restore).toMatch(/const fallbackStyle = item\.name === 'bullArrow' \|\| item\.name === 'bearArrow'/)
    expect(restore).toMatch(/: configuredOverlayStyle\(item\.name\)/)
  })

  it('captureState 序列化全部周期画线（显示层过滤不得渗入录像持久面）', async () => {
    const source = await readChart()
    // 全周期持久面 prop：Training 传 allDrawings（含他周期子集）
    expect(source).toMatch(/allDrawings\?: Drawing\[\] \| null/)
    const capture = blockOf(source, 'function captureState(', 'function captureReplayView(')
    expect(capture).toMatch(/drawings: allPeriodDrawings\(\)/)
    const merge = blockOf(source, 'function allPeriodDrawings(', 'function captureState(')
    // 委托纯模块 mergePeriodDrawings：当前周期以图上为权威（最新），他周期取持久面全集
    expect(merge).toMatch(/mergePeriodDrawings\(drawings\(\), props\.allDrawings, props\.timeframe\)/)
  })

  it('mergePeriodDrawings：当前周期取图上权威集，他周期原样并入且不重复', () => {
    const day = { id: 'd1', name: 'segment', paneId: 'candle_pane', points: [{ timestamp: 1, value: 10 }], timeframe: '1D' as const }
    const week = { id: 'w1', name: 'segment', paneId: 'candle_pane', points: [{ timestamp: 2, value: 20 }], timeframe: '1W' as const }
    const legacy = { id: 'legacy', name: 'priceLine', paneId: 'candle_pane', points: [{ timestamp: 3, value: 30 }] }
    const onChart = [{ ...day, points: [{ timestamp: 1, value: 11 }] }]
    // 周K视图：图上周线为权威，日K/未盖印（归一1D）画线从持久面原样并入
    expect(mergePeriodDrawings(onChart, [day, week, legacy], '1W')).toEqual([onChart[0], day, legacy])
    // 日K视图：持久面的日K与未盖印项不得重复进入（图上是唯一权威）
    expect(mergePeriodDrawings(onChart, [day, legacy], '1D')).toEqual([onChart[0]])
    // 持久面缺省（未接线）：退化为当前视图集合，不虚构他周期数据
    expect(mergePeriodDrawings(onChart, null, '1W')).toEqual(onChart)
  })
})
