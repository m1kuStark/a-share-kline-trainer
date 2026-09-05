import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const chartPath = new URL('../../web/src/components/KlineChart.vue', import.meta.url)
const trainingPath = new URL('../../web/src/views/Training.vue', import.meta.url)

describe('M2 chart interaction contract', () => {
  it('starts box select only on the main-pane layer and supports right-drag zoom-in / left-drag zoom-out', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/paneIdAt\(event\.clientY\) !== 'candle_pane'/)
    expect(source).toMatch(/if \(end >= selectStartX\)/)
    expect(source).toMatch(/const dragWidth = selectStartX - end/)
    expect(source).toMatch(/current \* drawable \/ dragWidth/)
  })

  it('confines box-select visuals and zoom range to the chart host (no leaking into the console)', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/Math\.max\(0, Math\.min\(hostRect\?\.width \?\? x, x\)\)/)
    expect(source).toMatch(/\.chart-wrap \{[^}]*overflow: hidden/)
  })

  it('colors the last price line by change vs previous close in CN convention and re-applies it after theme switches', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/function applyLastPriceStyle\(\): void/)
    expect(source).toMatch(/last\.close > prev\.close/)
    expect(source).toMatch(/last\.close < prev\.close/)
    expect(source).toMatch(/watch\(theme, value => \{ chart\?\.setStyles\(chartStyles\(value\)\); applyLastPriceStyle\(\) \}\)/)
    const themeSource = await readFile(new URL('../../web/src/theme.ts', import.meta.url), 'utf8')
    expect(themeSource).toMatch(/last: \{ upColor: '#ef4444', downColor: '#16a34a', noChangeColor: '#94a3b8'/)
  })

  it('keeps the text annotation feature removed (M3 leftover guard)', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).not.toMatch(/textPanel|absoluteTexts|startDraw|__absoluteText/)
    const overlays = await readFile(new URL('../../web/src/overlays.ts', import.meta.url), 'utf8')
    expect(overlays).not.toMatch(/name: 'text'/)
  })

  it('maps ArrowUp to zoom-in and ArrowDown to zoom-out', async () => {
    const source = await readFile(trainingPath, 'utf8')
    expect(source).toMatch(/ArrowUp[\s\S]{0,120}?zoomBy\(1 \/ 1\.3\)/)
    expect(source).toMatch(/ArrowDown[\s\S]{0,120}?zoomBy\(1\.3\)/)
  })

  it('slims MACD histogram bars to 2/5 of the default width', async () => {
    const source = await readFile(new URL('../../web/src/indicators.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/barSpace\.halfGapBar \* 2 \* 0\.4/)
  })

  it('keeps the blind toggle out of the creation form (V1 shows stock info openly)', async () => {
    const source = await readFile(new URL('../../web/src/views/Launcher.vue', import.meta.url), 'utf8')
    expect(source).not.toMatch(/const blind|blind: blind\.value|双盲模式/)
  })

  it('keeps price-axis wheel scaling separate from chart panning and out of box select', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/function isOverPriceAxis\(/)
    expect(source).toMatch(/getSize\('candle_pane', 'yAxis'\)/)
    expect(source).toMatch(/zone\.left \+ zone\.width && y >= zone\.top && y <= zone\.top \+ zone\.height/)
    // 滚轮：轴上直接返回（交给库原生纵轴缩放），不平移
    expect(source).toMatch(/if \(isOverPriceAxis\(event\.clientX, event\.clientY\)\) return[\s\S]{0,160}scrollByDistance/s)
    // 按下：轴上不进入框选
    expect(source).toMatch(/if \(isOverPriceAxis\(event\.clientX, event\.clientY\)\) return[\s\S]{0,40}selecting = true/s)
  })

  it('restores y-axis auto-fit before programmatic zooms so box select never drifts the chart out of view', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/function restoreYAxisAutoFit\(\): void/)
    expect(source).toMatch(/getYAxes\(\{\}\)/)
    expect(source).toMatch(/setAutoCalcTickFlag\?\.\(true\)/)
    // 框选右滑/左滑、键盘缩放、Home 复位四条路径都要先恢复自动适配
    expect(source).toMatch(/restoreYAxisAutoFit\(\)[\s\S]{0,300}setBarSpace/s)
    expect(source).toMatch(/zoomBy\(factor: number\): void \{[\s\S]{0,220}restoreYAxisAutoFit\(\)/s)
    expect(source).toMatch(/resetView\(\): void \{[\s\S]{0,160}restoreYAxisAutoFit\(\)/s)
  }
  )

  it('shows a lean title and duration meta, and a lean OHLC-only candle legend', async () => {
    const trainingSource = await readFile(trainingPath, 'utf8')
    expect(trainingSource).toMatch(/`\$\{training\.name \?\? ''\} · \$\{training\.code \?\? ''\}`/)
    expect(trainingSource).toMatch(/时长 \{\{ tierLabel \}\}/)
    expect(trainingSource).not.toMatch(/档<\//)
    expect(trainingSource).toMatch(/'2Y': '2年'/)
    const themeSource = await readFile(new URL('../../web/src/theme.ts', import.meta.url), 'utf8')
    expect(themeSource).toMatch(/title: \{ show: false \}/)
    const legendBlock = themeSource.match(/candleLegendTemplate[\s\S]{0,400}/)?.[0] ?? ''
    expect(legendBlock).toMatch(/开 |高 |低 |收 /)
    expect(legendBlock).not.toMatch(/成交量|时间/)
  })

  it('supports zooming below 10 visible bars and dynamically loads earlier history', async () => {
    const source = await readFile(chartPath, 'utf8')
    expect(source).toMatch(/const MIN_COUNT = 1/)
    expect(source).toMatch(/const BAR_SPACE_MAX = 300/)
    expect(source).toMatch(/barSpaceLimit\.max = BAR_SPACE_MAX/)
    expect(source).toMatch(/clampBarSpace\(/)
    expect(source).toMatch(/type === 'forward'/)
    expect(source).toMatch(/async function loadEarlierBars\(/)
    expect(source).toMatch(/fetchEarlier\?: \(before: string, count: number\) =>/)
    expect(source).toMatch(/loadedData = \[\.\.\.older, \.\.\.loadedData\]/)
    // date 必须随 KLineData 保留，否则 before 参数丢失导致重复加载整个窗口
    expect(source).toMatch(/volume: bar\.volume, date: bar\.date \}/)
    expect(source).toMatch(/!first\?\.date \|\| loadingForward/)
    // 前插后不得做锚定/补偿滚动：库的 forward 前插自锚定，额外滚动会引发视图塌缩与加载风暴
    expect(source).not.toMatch(/scrollToDataIndex\(newIndex \+ 1\)|scrollToDataIndex\(prevTo \+ older\.length\)/)
    const trainingSource = await readFile(trainingPath, 'utf8')
    expect(trainingSource).toMatch(/async function fetchEarlier\(/)
    expect(trainingSource).toMatch(/:has-more-bars="hasMoreBars" :fetch-earlier="fetchEarlier"/)
    expect(trainingSource).toMatch(/缩放 1~420/)
  })
})
