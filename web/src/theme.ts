import { ref } from 'vue'
import type { CandleTooltipLegendsCustomCallback } from 'klinecharts'

export type UiTheme = 'light' | 'dark'

// 默认深色：用户反馈浅色下均线与 MACD 不明显、眼睛不适
function initialTheme(): UiTheme {
  const saved = localStorage.getItem('trainer_theme')
  return saved === 'light' || saved === 'dark' ? saved : 'dark'
}

export const theme = ref<UiTheme>(initialTheme())

// 用户画线默认黄色（口径：上轮 M3 拍板沿用）：深浅主题下均可读；
// 引擎标记 bsMark/costLine 逐 figure 显式样式，不受全局 overlay 默认影响
export const DRAW_DEFAULT_COLOR = '#f5c343'

// 主图图例（candle tooltip）只显示开高低收四个价格，配色用主题文本色
const candleLegendTemplate: CandleTooltipLegendsCustomCallback = data => {
  const bar = data.current
  if (!bar) return []
  return [
    { title: '开 ', value: bar.open.toFixed(2) },
    { title: '高 ', value: bar.high.toFixed(2) },
    { title: '低 ', value: bar.low.toFixed(2) },
    { title: '收 ', value: bar.close.toFixed(2) },
  ]
}

export function applyThemeClass(): void {
  document.body.classList.toggle('dark', theme.value === 'dark')
}

export function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  localStorage.setItem('trainer_theme', theme.value)
  applyThemeClass()
}

// klinecharts v10 Styles：键为 grid/candle/indicator/xAxis/yAxis/separator/crosshair/overlay
export function chartStyles(t: UiTheme) {
  const dark = t === 'dark'
  const lineColor = dark ? '#2c3f57' : '#e6ebf2'
  const axisText = dark ? '#8fa3b8' : '#7c8ba0'
  const crossColor = dark ? '#5d7390' : '#7a8ba0'
  const tooltipText = dark ? '#c9d6e4' : '#2c3c50'
  return {
    grid: {
      show: true,
      horizontal: { color: lineColor },
      vertical: { color: dark ? '#243550' : '#eef2f6' },
    },
    separator: { color: lineColor },
    candle: {
      // 通达信经典画法：阳线空心（红框）、阴线实心（绿柱）
      type: 'candle_up_stroke' as const,
      bar: {
        compareRule: 'current_open' as const,
        upColor: '#ef4444', downColor: '#16a34a', noChangeColor: '#94a3b8',
        // 边框与影线必须与填充同色——klinecharts 默认预设是绿涨红跌的边框/影线，
        // 部分覆盖时不会同步，导致阴线包红边、阳线带绿影线
        upBorderColor: '#ef4444', downBorderColor: '#16a34a', noChangeBorderColor: '#94a3b8',
        upWickColor: '#ef4444', downWickColor: '#16a34a', noChangeWickColor: '#94a3b8',
      },
      priceMark: {
        high: { text: { color: axisText } },
        low: { text: { color: axisText } },
        // 最新价线方向色（国内口径红涨绿跌平灰）：klinecharts v10 线体与轴标签的
        // 颜色按 compareRule（默认相对前收）从 upColor/downColor/noChangeColor 取值，
        // line.color/text.backgroundColor 不参与方向色；默认值是国际惯例绿涨红跌，必须显式覆盖。
        last: { upColor: '#ef4444', downColor: '#16a34a', noChangeColor: '#94a3b8', text: { color: '#ffffff' } },
      },
      tooltip: {
        text: { color: tooltipText },
        // 标题行 "{ticker} · {period}"（training · 1天）无意义，隐藏；
        // 图例只保留开高低收——"时间"与信息栏/底部时间轴重复，"成交量"VOL 副图已有
        title: { show: false },
        legend: { template: candleLegendTemplate },
      },
    },
    indicator: {
      tooltip: { text: { color: tooltipText } },
      lastValueMark: { text: { color: tooltipText } },
      lines: [
        { color: '#f5a623' },
        { color: '#54b8cc' },
        { color: '#c793e0' },
      ],
    },
    xAxis: {
      axisLine: { color: lineColor },
      tickLine: { color: lineColor },
      tickText: { color: axisText },
    },
    yAxis: {
      axisLine: { color: lineColor },
      tickLine: { color: lineColor },
      tickText: { color: axisText },
    },
    crosshair: {
      horizontal: { line: { color: crossColor }, text: { backgroundColor: crossColor, color: '#ffffff' } },
      vertical: { line: { color: crossColor }, text: { backgroundColor: crossColor, color: '#ffffff' } },
    },
    // 用户画线全局默认样式（用户 D2 验收反馈）：1px 虚线、统一黄色；选中/激活锚点同色
    overlay: {
      line: { color: DRAW_DEFAULT_COLOR, size: 1, style: 'dashed' },
      point: {
        color: DRAW_DEFAULT_COLOR, borderColor: '#ffffff', borderSize: 1, radius: 5,
        activeColor: DRAW_DEFAULT_COLOR, activeBorderColor: '#ffffff', activeBorderSize: 1, activeRadius: 6,
      },
    },
  }
}
