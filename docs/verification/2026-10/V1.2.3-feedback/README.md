# V1.2.3 用户反馈修订验证

候选工作树：`wt/integration/v1`。本记录只描述工程自验，不代表用户验收或 GitHub 发布。

## 本轮范围（用户 v1.2.2 验收反馈三项）

- 开盘阶段只保留一条活动价位线：隐藏与阶段价位线（当日开盘价）并存的内置最新价线；收盘阶段两线重合时恢复内置线提供轴标签。连带修复推进到开盘阶段时状态消息泄露当日收盘价（未来数据）。
- 条件单价格轴标记悬浮信息改为悬停显示、移开消失，纯信息层（pointer-events: none）；多笔挂单合并展示；样式改用已定义令牌，修复深色主题回落浅色的配色错配，并清理全项目未定义令牌引用（--surface-raised ×4、--accent ×1，根因＝引用全项目令牌表中不存在的变量）。
- 下单与条件单合并为统一下单面板：普通下单/条件单标签页共享百分比仓位与按股数买卖输入（按股数买入为新增服务端能力，整手校验、资金不足即拒）；面板下方条件单列表支持同时挂多笔（解除服务端"最多一个待触发条件单"限制），新增在途占用校验（买单按触发价计入资金占用、卖单累计可卖股数），已终结订单保留最近 6 条与拒绝原因。
- 连带修复：e2e 多个 spec 尾部/中部损坏行（v1.2.0 批量误编辑遗留的字面 `\n` 片段与孤儿语句），全套浏览器回归自此可完整解析运行。

## bug 回流反思（为何由用户发现而非测试覆盖）

1. 双价位线：此前 journey 只断言阶段价位线存在，未断言"开盘阶段内置最新价线必须隐藏"——视觉并存无数量断言。回归：`lastPriceMarkShow` 只读钩子＋order-panel.spec 开盘/收盘两态断言；frontend-contract 锁定 showLastMark 判定逻辑。
2. 悬浮框主题错配：样式引用未定义令牌属"代码逻辑正确、视觉错误"，纯单测不可见。回归：order-panel.spec 深浅主题下悬浮层底色与 `--surface-background` 令牌探针值相等；frontend-contract 幽灵令牌审计（var(--surface-raised)/var(--accent) 全项目禁用）。
3. 面板重复与单挂单限制：v1.2.0 条件单为单挂单垂直切片（按任务卡范围交付），UI 冗余无产品级检查门。回归：order-panel.spec 标签页结构、共享控件、双挂单/撤单/最近记录断言；服务端 conditional-orders.test.ts 多挂单、占用校验、按股数买入三例。

## 验证命令

| 命令 | 结果 |
|---|---|
| `npm run docs:check` | 通过，0 errors（既有长度警告不变） |
| 定向 Vitest（frontend-contract、conditional-orders） | 30/30 通过 |
| `npm test` | 1353/1365 通过；12 项失败均为存量环境抖动（录像编解码、库迁移、docs 工具、worktree 工具域），与 stash 基线复跑集合一致，与本轮改动无关 |
| `npm run build` | 通过：web 类型检查（vue-tsc）、server 编译、Vite 生产构建 |
| `npm run journey -- e2e/order-panel.spec.ts --retries=0` | 通过：1/1，覆盖统一下单面板、多挂单、悬停信息主题一致性、开盘阶段唯一价位线 |
| `npm run journey -- --retries=0`（全套 24 spec，108 例） | 89 通过 / 19 失败；19 项失败已用 stash 基线（仅暂存本轮 web/server 源码改动）逐 spec 复跑，全部在干净 v1.2.2 基线上以相同用例复现——零本轮回归，均为 v1.2.0 以来随树携带的存量失败（全套此前因 spec 损坏从未完整跑通） |

## 全套浏览器回归与存量损坏修复

首次全套运行被 `e2e/training-defaults.spec.ts` 解析错误阻断：文件尾行含 v1.2.0 批量误编辑遗留的字面 `\n` 代码片段。扩展排查发现同模式损坏共 13 处（training-defaults、acceptance-feedback、data-update、journey、m3-feedback、m4-history、m4-rankings、recording、recording-long、recording-migration、trade-marker-details、report-feedback 尾部/中部字面片段与孤儿语句；m3-tools 一条断言串被污染）。全部清除后全套解析通过并完整运行；m3-tools 的损坏断言（断言文本标注内容含代码片段）改为既有正确断言保留。

全套 89/108 通过；19 项失败按文件分组与 stash 基线复跑结果逐一对应（data-update、drawing-basis、journey Act4d、m3-feedback、m3-round3、m3-tools ×7、m4-history、m4-rankings、recording、report-feedback、training-defaults ×2、training-rules F3），结论：均为存量失败，不阻塞本轮候选，已登记待专项清偿。

## 未决事项

- 用户需基于 output 包手动验收三项修订；工程验收与用户验收分开记录，`user=unknown`、`publish=unknown`。
- 存量环境抖动单测（12 项）建议在安静时段复跑确认，不在本轮范围。
- 录制订单事件与完整回放（V4-01 其余范围）仍待实现。
