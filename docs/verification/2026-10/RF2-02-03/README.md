# RF2-02/03 验证记录：随机时间轴遮蔽联动＋结算披露股票名

任务卡：[docs/work-items/tasks/RF2-02-03.md](../../../work-items/tasks/RF2-02-03.md)。oracle＝用户 2026-10-09 验收反馈原话（见任务卡「背景」）；矩阵两行（RANDOM-HIDE-TIME-REMAINING 2026-10-09 修订版轴子句＋新增 RANDOM-SETTLE-REVEAL-STOCK，RAND-UI-MASK-STARS 轴联动扩展）。

## 一、语义与口径（proposed_default 提报清单）

| # | 决策 | 状态 |
|---|---|---|
| 1 | 轴遮蔽形态：遮蔽期 X 轴刻度文本空串（轴/刻度线保留）；十字线底部标签与画线端点轴标签（formatter crosshair 分支）星号 `******`；悬浮信息卡日期行同口径（遮蔽期 `******`） | proposed_default（用户原话「隐藏这些日期信息」＋RF-05 星号语言延伸） |
| 2 | 同类遮蔽面（实现期侦察发现，随轴一并处理）：状态条「可见至/末根」视窗日期来自（偏移空间的）bar 日期，遮蔽期同样星号、揭示期同常量差换算——轴隐藏后若状态条仍显示偏移假日期即同缺陷复发 | proposed_default（**范围判断待架构师复核**：矩阵轴子句未点名状态条，属同类呈现面一并收敛） |
| 2 | 揭示换算：常量差＝reveal 真实起始日−运行中偏移起始日（天），作用于时间戳与日期串（含周/月 bar.date 月键）；仅 gate「运行中+hideTime+已揭示」；结束态换算归零（bars 已真实） | 技术方案（先例＝SessionReplay.realDateOf，矩阵轴子句「按会话常量差换算真实日期」） |
| 3 | 定制点＝klinecharts v10 `chart.setFormatter({ formatDate })`（Chart 侧走 `_setOptions` 全量 layout 含 X 轴刻度重建）；默认分支 `utils.formatDate`＝库内默认函数，非随机会话/回放零行为差 | 技术方案（v10 实证：formatter 为轴文本唯一出口，XAxisImp.createTicksImp→formatDate('xAxis')） |
| 4 | 结算面板「训练标的」行（name · code）无条件显示：随机结束态遮蔽层退场、盲训 masked 仅 running，结束态恒真实 | proposed_default（RF2-03「及时披露」；经典会话显示真实标的为自然副产物） |
| 5 | random_stock/经典/回放零影响：hideDates/dateShiftDays 缺省 false/0，formatter 默认路径与库默认同函数 | 回归护栏（spec 第三例断言） |
| 6 | 放弃路径：既有 UX 无结算面板（emit('ended') 返回首页），真实标的经录像库/历史/成绩单披露，不新造面板 | proposed_default（不改既有退出流程） |

## 二、RED 证据（新语义先失败）

### e2e（e2e/random-mask-axis.spec.ts；先落 journey 探针 xAxisLabels——klinecharts 轴为 canvas，DOM 断言不可用——再对旧 UI 运行）

Run `run-0552b7d7-ed6a-4c54-9b92-cb8cd7969e07`（EXIT=1，2 failed | 1 passed）：

- 例 1（mask axis）失败于遮蔽态断言：`遮蔽态轴不得出现日期文本，实际=["2027-06-19","2027-07-26","2027-08-30","2027-10-03","2027-11-06","2027-12-10"]`——旧 UI 轴显示偏移假日期（用户截图症状复现）。
- 例 2（settle reveal）失败于 RF2-03 断言：`getByText('训练标的') element(s) not found`——旧结算面板只渲染区间/成绩，无股票名称与代码。
- 例 3（random_stock 轴正常）通过——非回归护栏，设计上应通过。
- 首轮探针未落时的运行 `run-89b2272d-1016-4839-b002-4745bec36cf9`（EXIT=1，3 failed：xAxisLabels is not a function）一并留痕（探针即测试观察面本身）。

GREEN 前的中间运行 `run-247fbb39-f51c-4d9d-9c9c-6bb7d1551dc6`（EXIT=1，1 failed | 2 passed）：例 1 步骤③ spec 笔误（random_time 股票不遮蔽，误断言标题回星号）修正为日期维度断言（剩余根数回显＋轴回遮蔽），非实现缺陷。

## 三、关键实现落点

- `web/src/components/KlineChart.vue`：props hideDates/dateShiftDays；datePresentation 可变状态＋presentableTimestamp/presentableDateString（月键支持）＋applyDateFormatter（setFormatter 注入，挂载期同步初始 props、watch 变化重设触发全量重绘）；buildHoverModel 日期行过呈现层；journey 探针 xAxisLabels()。
- `web/src/views/Training.vue`：axisDateHidden（＝maskedTime）/axisDateShiftDays（揭示态常量差，gate running）computed＋KlineChart 接线；settle-grid 首行「训练标的」；RF-05 头注补修订说明。
- 服务端/录像格式零改动（服务端偏移机制保留在响应层；回放侧 SessionReplay 不接线 props＝原样呈现，与 RF-05「图表 X 轴保持录制时呈现」口径一致）。

## 四、行为变更配套测试修订（双向留痕）

| 既有断言 | 改写 | 理由 |
|---|---|---|
| 无 | 无既有断言被删除或改写 | 新 spec 独立文件；`e2e/random-mode.spec.ts` 未触碰（另一并行任务修改中），本任务行为变更经核对不影响其断言（其遮蔽/揭示断言均在头部/日期区 DOM，random_stock 轴不遮蔽、settle 面板只增不减字段）；`server/test/random-training-mode.test.ts` 零改动全绿（服务端零改动） |

## 五、机器收据（命令＋退出码）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `npm run build:server` | tsc 无输出 | 0 |
| `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/random-mask-axis.spec.ts --retries=0`（RED，探针已落） | 2 failed \| 1 passed（run-0552b7d7） | 1 |
| 同上（GREEN，含状态条视窗日期断言的最终形态） | 3 passed（run-05c579b4） | 0 |
| `npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts` | 25 passed | 0 |
| `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/replay-period.spec.ts --retries=0` | 1 passed（run-c2e0ff7d） | 0 |
| `npm run typecheck:web` | vue-tsc 无输出 | 0 |
| `npm run build` | typecheck＋server＋web 全过 | 0 |

## 六、矩阵行绑定提案（test_ids）

- RANDOM-HIDE-TIME-REMAINING（2026-10-09 修订版轴子句）：`e2e/random-mask-axis.spec.ts > random mask axis and settle stock (RF2-02/03) > mask axis: hidden while running, revealed by eye toggle with constant offset, restorable`（①遮蔽②揭示换算③恢复）＋`> settle reveal: panel shows real stock name and code with axis real dates`（结束态轴真实）。
- RAND-UI-MASK-STARS（轴纳入遮蔽/揭示联动范围）：同上两例（轴/悬浮卡与眼睛按钮联动断言）。
- RANDOM-SETTLE-REVEAL-STOCK（planned→covered）：`> settle reveal: panel shows real stock name and code with axis real dates`（面板训练标的＝真实 name·code，与区间/成绩并列）。
- 维度联动回归护栏：`> random stock session: axis dates render normally without masking`。
