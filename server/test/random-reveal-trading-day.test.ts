import { describe, expect, it } from 'vitest'
import { MASKED_DATE_TEXT, presentableDateString, revealedTickTimestamp } from '../../web/src/randomDatePresentation'

// M2-RANDOM-AXIS-01 随机时间模式揭示日期与交易日对齐（矩阵行 RANDOM-REVEAL-TRADING-DAY）。
// 独立 oracle 原则：夹具与期望全部为手写常量，不调用被测实现生成期望。
//
// 夹具复刻用户 2026-10-19 批复 4 实证形态（2005 年五一休市周窗口）：
// 真实交易日（oracle，手写）：4/27(三) 4/28(四) 4/29(五)｜5/2–5/8 休市（黄金周＋周末）｜
// 5/9(一) 5/10(二) 5/11(三) 5/12(四) 5/13(五)，共 8 根，窗末＝2005-05-13（周五）。
// 服务端会话常量偏移＝+3 日（掩码空间日期＝真实日期+3，逐日保留间距与缺口——4/29→5/9 的
// 10 个日历日缺口在掩码空间为 5/2→5/12，同为 10 日）。
// 前端 shiftDays＝reveal 真实起始日−遮蔽起始日＝4/27−4/30＝−3。
// klinecharts 10.0.3 轴刻度对越界 dataIndex（右侧空白边距）按「末日根+每格 1 日历日」外推
// （dist index.esm.js dataIndexToTimestamp day 分支）——这正是揭示反推落在非交易日的源头。
const REAL_TRADING_DAYS = [
  '2005-04-27', '2005-04-28', '2005-04-29',
  '2005-05-09', '2005-05-10', '2005-05-11', '2005-05-12', '2005-05-13',
] as const
const SERVER_OFFSET_DAYS = 3
const SHIFT_DAYS = -SERVER_OFFSET_DAYS
const MS_PER_DAY = 86_400_000

function ts(day: string): number { return Date.parse(`${day}T00:00:00Z`) }
function shiftDay(day: string, days: number): string { return new Date(ts(day) + days * MS_PER_DAY).toISOString().slice(0, 10) }

/** 掩码空间 bar 日期＝真实交易日+3（与服务端 shiftStringValue 同式，但这里是测试自算 oracle） */
const MASKED_BAR_DAYS = REAL_TRADING_DAYS.map(day => shiftDay(day, SERVER_OFFSET_DAYS))
const MASKED_BAR_TS = new Set(MASKED_BAR_DAYS.map(ts))

describe('random reveal trading day anchor (M2-RANDOM-AXIS-01)', () => {
  it('converts every actual masked bar tick to its exact real trading day', () => {
    for (let i = 0; i < REAL_TRADING_DAYS.length; i++) {
      const revealed = revealedTickTimestamp(ts(MASKED_BAR_DAYS[i]), MASKED_BAR_TS, SHIFT_DAYS)
      expect(revealed, `bar#${i} 掩码 ${MASKED_BAR_DAYS[i]} 揭示应等于真实交易日 ${REAL_TRADING_DAYS[i]}`).toBe(ts(REAL_TRADING_DAYS[i]))
    }
  })

  it('never reveals a date for right-margin extrapolated ticks (klinecharts day extrapolation beyond the last bar)', () => {
    // 用户实证形态：窗末掩码末根 2005-05-16(一)，右侧空白刻度外推 +1 格＝2005-05-17(二)，
    // 旧实现常量差反推得 2005-05-14（周六）——揭示出非交易日，即本任务缺陷。
    const lastMasked = MASKED_BAR_DAYS[MASKED_BAR_DAYS.length - 1]
    for (let slot = 1; slot <= 3; slot++) {
      const extrapolated = shiftDay(lastMasked, slot)
      const revealed = revealedTickTimestamp(ts(extrapolated), MASKED_BAR_TS, SHIFT_DAYS)
      expect(revealed, `右侧空白外推刻度 ${extrapolated}（+${slot} 格）揭示不得呈现日期（该位置无真实 bar），实际得到 ${revealed === null ? 'null' : new Date(revealed).toISOString().slice(0, 10)}`).toBeNull()
    }
  })

  it('upholds the invariant that any revealed timestamp is either null or a real trading day of the window', () => {
    // 扫描掩码空间前后各 20 天：任何刻度位置的揭示结果只能是 null 或命中真实交易日集合
    const realTsSet = new Set(REAL_TRADING_DAYS.map(ts))
    const sweepStart = -20
    const sweepEnd = 40
    for (let offset = sweepStart; offset <= sweepEnd; offset++) {
      const day = shiftDay('2005-05-02', offset)
      const revealed = revealedTickTimestamp(ts(day), MASKED_BAR_TS, SHIFT_DAYS)
      if (revealed === null) continue
      expect(realTsSet.has(revealed), `揭示 ${new Date(revealed).toISOString().slice(0, 10)}（来自刻度 ${day}）必须是窗口内真实交易日`).toBe(true)
    }
  })

  it('keeps classic (unrevealed) mode a verbatim passthrough including extrapolated ticks', () => {
    // shiftDays=0（经典/未揭示）：原样返回，经典轴显示不在本修复范围（含外推刻度也不得被遮蔽）
    expect(revealedTickTimestamp(ts('2005-05-17'), MASKED_BAR_TS, 0)).toBe(ts('2005-05-17'))
    expect(revealedTickTimestamp(ts(MASKED_BAR_DAYS[0]), MASKED_BAR_TS, 0)).toBe(ts(MASKED_BAR_DAYS[0]))
  })

  it('keeps the hover-card string path exact for actual bar dates', () => {
    // 悬浮卡/状态条走日期字符串路径（真实 bar 日期精确换算）；遮蔽常量符仍由调用侧守卫
    expect(MASKED_DATE_TEXT).toBe('******')
    for (let i = 0; i < REAL_TRADING_DAYS.length; i++) {
      expect(presentableDateString(MASKED_BAR_DAYS[i], SHIFT_DAYS), `bar#${i} 字符串换算`).toBe(REAL_TRADING_DAYS[i])
    }
    expect(presentableDateString('2005-05', SHIFT_DAYS)).toBe('2005-04') // 月键路径（周/月观察周期形态）
    expect(presentableDateString('2005-04-27', 0)).toBe('2005-04-27')
  })
})
