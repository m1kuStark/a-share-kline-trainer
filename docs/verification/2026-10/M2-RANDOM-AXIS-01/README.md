# M2-RANDOM-AXIS-01 随机模式揭示日期交易日对齐（验证记录）

> 执行说明：worker 完成定位＋实现＋单元 RED→GREEN 后被 API 限额中断；root 接手收尾（同 M2-DRAWING-01 模式）。

## 定位结论（换算链）

服务器对 random_time 会话逐响应做**会话常量日偏移**（真实日期→遮蔽空间，纯日历平移、逐日保留间距与缺口）→前端揭示＝常量差反推（先例 SessionReplay.realDateOf）。反推本身对**真实 bar** 是精确还原；错在 **klinecharts 的轴刻度外推**：右侧空白越界 dataIndex 的刻度时间戳是日历日外推值（无对应 bar），常量差反推后落到周末/节假日（实证 2005-05-07=周六）。

## 修复口径

揭示态换算入口 `revealedTickTimestamp`（web/src/randomDatePresentation.ts 纯函数抽出）：刻度命中已加载 K 线时间戳集合＝真实 bar→常量差换算即该 bar 真实交易日；未命中（空白外推位）→返回 null→轴不显示日期（不造假日期）。遮蔽态与经典态行为与修复前逐字一致。KlineChart 维护 barTimestamps 集合并接管线注入。

## 收据（root 复跑）

| 项 | 命令 | 退出码 |
|---|---|---|
| 单元层 | vitest random-reveal-trading-day | 0（5/5：真实 bar 精确换算/外推位不揭示/不变式（揭示值∈null∪真实交易日）/经典态透传/悬浮卡字符串路径） |
| 类型 | npm run typecheck:web | 0 |
| e2e random-mask-axis | journey | 0（3/3） |
| e2e random-mode | journey（回归） | 0 |
| 变异：删交易日闸门 | vitest | 1（2 failed 击杀）→还原 0 |

## 遗留

- G3「待复核 random-mask-axis」就此定案为真缺陷并修复（分类账本同步）。
- 无 needs_user_decision；无 proposed_default。
