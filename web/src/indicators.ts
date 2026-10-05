import { registerIndicator } from 'klinecharts'

interface MacdResult { dif: number; dea: number; macd: number }
export interface KdjPoint { k: number; d: number; j: number }

// 通达信 APP 标准 MACD：柱体一律实心、红正绿负（不用内置的"增空减实"描边画法），
// DIF 白 / DEA 黄，配色在 createIndicator 的 styles.lines 中传入。
registerIndicator({
  name: 'MACD',
  shortName: 'MACD',
  calcParams: [12, 26, 9],
  figures: [
    { key: 'dif', title: 'DIF: ', type: 'line' },
    { key: 'dea', title: 'DEA: ', type: 'line' },
    {
      key: 'macd',
      title: 'MACD: ',
      type: 'bar',
      baseValue: 0,
      // 柱体宽度＝库默认（halfGapBar*2）的 2/5（用户口径 2026-09-06：红绿柱太粗）
      attrs: ({ barSpace }) => ({ width: Math.max(1, barSpace.halfGapBar * 2 * 0.4) }),
      styles: ({ data }) => {
        const macd = (data.current as unknown as MacdResult | undefined)?.macd ?? 0
        const color = macd > 0 ? '#ef4444' : macd < 0 ? '#16a34a' : '#94a3b8'
        return { style: 'fill', color, borderColor: color }
      },
    },
  ],
  calc: (dataList, indicator) => {
    const [fast, slow, signal] = indicator.calcParams as number[]
    let emaFast = Number.NaN
    let emaSlow = Number.NaN
    let dea = Number.NaN
    return dataList.map((bar: { close?: number }) => {
      const close = bar.close ?? 0
      emaFast = Number.isNaN(emaFast) ? close : (2 * close + (fast - 1) * emaFast) / (fast + 1)
      emaSlow = Number.isNaN(emaSlow) ? close : (2 * close + (slow - 1) * emaSlow) / (slow + 1)
      const dif = emaFast - emaSlow
      dea = Number.isNaN(dea) ? dif : (2 * dif + (signal - 1) * dea) / (signal + 1)
      return { dif, dea, macd: (dif - dea) * 2 }
    })
  },
})

// 通达信口径 KDJ（M6-01）：RSV=(C−LLV(L,n))/(HHV(H,n)−LLV(L,n))×100，窗口不足 n 根按实际根数，
// HHV=LLV（如停牌平盘/一字无波动窗口）时 RSV 取 100；K=SMA(RSV,kp,1) 种子 50、D=SMA(K,dp,1) 种子 50，
// J=3K−2D。computeKdj 为纯函数（供注册与测试共用，单一口径）；期望表见矩阵 kdj-subchart KDJ-CALC-TDX。
export function computeKdj(bars: Array<{ high?: number; low?: number; close?: number }>, params: number[]): KdjPoint[] {
  const [window, kPeriod, dPeriod] = params
  let k = 50
  let d = 50
  return bars.map((bar, index) => {
    const from = Math.max(0, index - window + 1)
    let highest = -Number.MAX_VALUE
    let lowest = Number.MAX_VALUE
    for (let i = from; i <= index; i++) {
      highest = Math.max(highest, bars[i].high ?? 0)
      lowest = Math.min(lowest, bars[i].low ?? 0)
    }
    const close = bar.close ?? 0
    const range = highest - lowest
    const rsv = range === 0 ? 100 : ((close - lowest) / range) * 100
    k = (rsv + (kPeriod - 1) * k) / kPeriod
    d = (k + (dPeriod - 1) * d) / dPeriod
    return { k, d, j: 3 * k - 2 * d }
  })
}

// KDJ 副图：K/D/J 三条 line；默认配色 K 白 '#f2f2f2' / D 黄 '#f5c343' / J 紫洋红 '#d446d6'
// 为 proposed_default（通达信默认习惯，M6-01 待用户验收确认），颜色经 createIndicator 的
// styles.lines 传入（与 MACD 同一机制），不在模板内写死以便后续主题化。
registerIndicator({
  name: 'KDJ',
  shortName: 'KDJ',
  calcParams: [9, 3, 3],
  figures: [
    { key: 'k', title: 'K: ', type: 'line' },
    { key: 'd', title: 'D: ', type: 'line' },
    { key: 'j', title: 'J: ', type: 'line' },
  ],
  calc: (dataList, indicator) => computeKdj(dataList, indicator.calcParams as number[]),
})
