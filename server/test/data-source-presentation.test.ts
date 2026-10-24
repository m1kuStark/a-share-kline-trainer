import { describe, expect, it } from 'vitest'
import { attentionHint, directoryPickFeedback, tdxSourceLocked } from '../../web/src/dataSourcePresentation'

// tdx-path-settings 矩阵呈现层纯函数（2026-10-24 bug-loop：用户验收 BUILDER-ACCEPT-01 报
// 「选择不了通达信目录/更新日线常显且无效」）。三层根因中的两层呈现缺口由此锁定：
//   ① 设置页目录选择器对非 selected 结果静默返回（App.vue 向导版有分态提示，设置版没有）
//   ② 行情目录来源为 env/explicit-config（启动方式显式钉死，如验收包冻结样本）时 UI 零标识——
//     顶栏 attention 提示仍引导用户「去通达信下载」，对该形态无意义。
// 独立 oracle 原则：期望文案全部手写常量；默认分支（非钉死来源）的拼接期望逐字复刻
// App.vue 既有 STALE_HINT 口径，锁「本修复不改变既有形态的提示语义」。

const LEGACY_STALE_HINT = '请先在通达信完成盘后数据下载，再点击重新读取本地日线（不联网）'

describe('directoryPickFeedback（设置页目录选择器分态反馈）', () => {
  it('directoryPickFeedback 失败态给结构化原因，selected 与 cancelled 不提示', () => {
    // 失败态带 reason：reason 原样透出（服务端 picker 已给中文原因时不吞）
    expect(directoryPickFeedback({ status: 'unavailable', reason: '目录选择组件调用失败：boom' }))
      .toBe('目录选择组件调用失败：boom')
    // 失败态无 reason：给「状态可见」的兜底文案，四种失败态全覆盖
    expect(directoryPickFeedback({ status: 'unavailable' })).toBe('目录选择不可用（unavailable）')
    expect(directoryPickFeedback({ status: 'denied' })).toBe('目录选择不可用（denied）')
    expect(directoryPickFeedback({ status: 'timeout' })).toBe('目录选择不可用（timeout）')
    expect(directoryPickFeedback({ status: 'not_applicable' })).toBe('目录选择不可用（not_applicable）')
    // selected＝正常继续（提示交给后续检查结果），cancelled＝用户主动取消，都不提示
    expect(directoryPickFeedback({ status: 'selected', path: 'D:\\tdx' })).toBeNull()
    expect(directoryPickFeedback({ status: 'cancelled' })).toBeNull()
  })
})

describe('tdxSourceLocked（显式钉死来源判定）', () => {
  it('tdxSourceLocked 仅 env 与 explicit-config 视为显式钉死来源', () => {
    expect(tdxSourceLocked('env')).toBe(true)
    expect(tdxSourceLocked('explicit-config')).toBe(true)
    // 用户自己保存/自动发现的选择可以在应用内切换，不属于钉死
    expect(tdxSourceLocked('saved-choice')).toBe(false)
    expect(tdxSourceLocked('auto-discovered')).toBe(false)
    // 未解析出目录（null）与字段缺失（undefined）都不算
    expect(tdxSourceLocked(null)).toBe(false)
    expect(tdxSourceLocked(undefined)).toBe(false)
  })
})

describe('attentionHint（顶栏 attention 提示文案）', () => {
  it('attentionHint 显式钉死来源给「启动方式指定」文案，其余来源保留去通达信下载提示', () => {
    // 钉死形态：说明目录由启动方式指定、应用内无法更新或切换；不再引导去通达信下载
    const pinnedWithReason = attentionHint('env', '行情数据偏旧（截止 2026-09-16）')
    expect(pinnedWithReason).toContain('行情数据偏旧（截止 2026-09-16）')
    expect(pinnedWithReason).toContain('启动方式')
    expect(pinnedWithReason).toContain('无法')
    expect(pinnedWithReason).not.toContain('盘后数据下载')
    expect(attentionHint('env', null)).toContain('启动方式')
    expect(attentionHint('explicit-config', '行情数据偏旧')).not.toContain('盘后数据下载')
    // 既有形态逐字不回归：saved-choice/auto-discovered/null 保持旧拼接口径
    expect(attentionHint('saved-choice', '行情数据偏旧')).toBe(`行情数据偏旧${LEGACY_STALE_HINT}`)
    expect(attentionHint('auto-discovered', null)).toBe(LEGACY_STALE_HINT)
    expect(attentionHint(null, '行情数据偏旧')).toBe(`行情数据偏旧${LEGACY_STALE_HINT}`)
    expect(attentionHint(undefined, null)).toBe(LEGACY_STALE_HINT)
  })
})
