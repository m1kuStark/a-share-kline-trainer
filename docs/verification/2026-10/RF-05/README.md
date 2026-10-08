# RF-05 验证记录：随机模式信息隐藏改造

任务卡：[docs/work-items/tasks/RF-05.md](../../../work-items/tasks/RF-05.md)。oracle＝用户 2026-10-08 验收反馈原话（见任务卡「背景」）；矩阵 4 条 planned 行（RAND-UI-MASK-STARS / RANDOM-HIDE-TIME-REMAINING / RANDOM-REVEAL-MIDRUN / RANDOM-REPLAY-TAG，random-training-mode.yaml）。

## 一、语义与口径（proposed_default 提验清单）

| # | 决策 | 状态 |
|---|---|---|
| 1 | 「隐藏日期」边界＝信息呈现层：训练页头部/详情/推进消息不显示日期（剩余根数替代）；K 线 X 轴标签保留偏移假日期（训练可用性基础＋防认股机制本身）；服务端偏移机制保留（RANDOM-HIDE-TIME-OFFSET binding_note 明示可选保留） | proposed_default（架构师预拍板，本任务采纳） |
| 2 | 星号遮蔽字面量 `****** · ******`（名称与代码合并星号串，等宽数字弱化长度侧信道） | proposed_default |
| 3 | 确认弹窗文案：「本局为随机训练，股票与时间信息已被隐藏。确认显示将揭晓真实标的与训练时间段，剧透风险由你自己承担。」（spoiler 风险自担语义） | proposed_default |
| 4 | reveal 端点：POST /api/trainings/:id/reveal，仅运行中随机会话（结束 409 RANDOM_REVEAL_UNAVAILABLE、经典 409、未知 404、非整数 400）；一次性读取，其余端点遮蔽不变；onSend 遮蔽层排除该 URL | 端点形态（矩阵 binding_note 授权 RF-05 设计呈报） |
| 5 | remainingBars＝range_bar_count−equity_curve 去重日期数；运行中随机会话一律携带（前端仅 hideTime 消费） | proposed_default |
| 6 | 回放真实信息：录像内终末无 random 字段的 trainingMeta 条目（结束态检查点）离线派生；逐日标签按「首个 hideTime 元信息起始日↔真实起始日」常量差换算；图表 X 轴保持录制呈现；放弃路径 Training.vue abandon 接服务端响应使终末检查点携带真实值 | 技术方案（矩阵授权设计并呈报） |
| 7 | 录像库标注：trainingKey 前缀（训练 id）best-effort GET /api/trainings/:id 派生标的＋tag；不可达不标注 | proposed_default |

## 二、RED 证据（新语义先失败）

### 单测（server/test/random-training-mode.test.ts，修复前）

```
npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts
EXIT=1 —— Tests 9 failed | 16 passed (25)
```

9 例失败＝新增 4 例（remainingBars 未提供、reveal 404（端点不存在）、日期 deep-walk 泄漏口径、排行 rangeMode undefined）＋修订 5 处 random 对象断言（旧 random 对象无 remainingBars）。
其中 reveal 用例捕获实现期真实 bug：端点 SELECT 裸 `current_date` 命中 SQLite CURRENT_DATE 关键字，返回今日日期而非列值（`expected '2026-10-08' to be '2025-03-19'`）——列名加引号（`"current_date" AS currentDate`）修复后转绿。

### e2e（e2e/random-mode.spec.ts，web 改动 stash 后对旧 UI 运行）

见第五节机器收据（RED 行）。失败用例＝masked session（占位文字仍在）、eye toggle（眼睛按钮/确认弹窗/揭示缺失）、settle reveal 运行态（日期仍显示）、random recording（录像库/回放无 tag）。

## 三、关键实现落点

- server：random-mode.ts（remainingBarsOf/RandomSession.remainingBars、maskedMetaOf/transformRandomPayload 注入、reveal 端点＋onSend 排除、头注）、engine.ts（random 类型 +remainingBars?）、rankings.ts（RankingItem.rangeMode＋range/industry/stock 三视图 SELECT range_mode）。
- web：api.ts（revealRandomTraining/fetchTrainingSnapshot/类型）、Training.vue（星号遮蔽＋眼睛＋确认弹窗＋剩余根数＋维度联动＋abandon 接响应＋热键隔离）、SessionReplay.vue（录像内揭示＋tag＋日期换算）、RecordingLibrary.vue（best-effort 标注）、Rankings.vue/History.vue（tag 呈现）。

## 四、行为变更配套测试修订（双向留痕）

| 既有断言 | 改写 | 理由 |
|---|---|---|
| 单测 5 处 `random` toEqual({dimension,hideStock,hideTime}) | 增 remainingBars: expect.any(Number) | 行为变更：random 对象新增 remainingBars 字段（用户拍板「只显示剩余未推进 K 线的根数」的服务端支撑） |
| e2e `masked session: ... placeholder and badge ...`（占位文字断言） | 整例改写为星号遮蔽断言（title=「****** · ******」、not.toContainText('随机标的')） | 用户原话明确否定占位文字形式（「不要用文字形式写'随机标的 · 已隐藏'」），RAND-UI-MASKED-DISPLAY 行已标 SUPERSEDED |
| e2e `settle reveal` 运行态段（`.training-current-date strong` = 偏移日期） | 改为剩余根数断言＋偏移日期 not.toContainText | RANDOM-HIDE-TIME-REMAINING：random_time 运行中日期不显示 |
| e2e `random period grid` random 对象 toEqual | 增 remainingBars | 同单测第一条 |

**未删除任何断言换绿**：被取代断言均以等价或更强的新断言替换（占位文字→星号＋否定旧文字；日期显示→剩余根数＋否定日期显示）。

## 五、机器收据（命令＋退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts`（实现前·RED） | 1 | 9 failed / 16 passed（新增 4 例＋修订 5 处断言全失败；含 current_date 关键字 bug 捕获） |
| `npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts`（实现后） | 0 | 25 passed |
| `npx vitest run --config server/vitest.config.ts server/test/rankings.test.ts server/test/history-report.test.ts` | 0 | 46 passed |
| `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/random-mode.spec.ts --retries=0`（web 改动 stash 后·RED，run a07239c3） | 1 | 4 failed / 7 passed（masked-session 星号、eye-toggle、settle-reveal 运行态、random-recording tag 四例对旧 UI 失败） |
| `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/random-mode.spec.ts --retries=0`（恢复后·GREEN，run b6594938） | 0 | 11 passed |
| `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/replay-period.spec.ts --retries=0`（SessionReplay 改动回归，run 6d93464d） | 0 | 全过 |
| `npm run build:server` | 0 | tsc 干净（初版 remainingBars 必填类型错 exit 1 已修） |
| `npm run typecheck:web` | 0 | vue-tsc 干净（初版 replayCode/replayName 漏定义 exit 2 已修） |
| `npm run build` | 0 | typecheck＋server＋web 全过 |
| `npx vitest run --config server/vitest.config.ts`（全量·首轮） | 1 | 1557/1558（frontend-contract 标题内联源码契约失败——标题组合式须保持模板内联，已改回内联三元） |
| `npx vitest run --config server/vitest.config.ts`（全量·复跑） | 0 | 1558/1558 |
| `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/random-mode.spec.ts --retries=0`（契约修复后复跑，run adb96257） | 0 | 11 passed |
| `npm run docs:check` | 0 | 0 errors（初版验证记录相对链接错 exit 1 已修；status 生成区经 `npm run docs:status` 生成器刷新） |
| `node <skill>/scripts/check-binding.mjs --repo . --matrix random-training-mode.yaml --strict` | 1 | 23 行 covered=19 open=4 RED=1——4 open＝本任务 4 条 planned 行（升级提案见下节，矩阵文件不属本任务 allowed_paths）；1 悬空 ref＝被取代行 RAND-UI-MASKED-DISPLAY 仍指向已改名旧测试（`masked session: hidden stock shows placeholder...`→`...star-masked title...`），该行 EARS 已标 SUPERSEDED，随矩阵升级一并处理 |

### 矩阵行升级提案（4 条 planned→covered 的 test_ids）

- **RAND-UI-MASK-STARS**：`e2e/random-mode.spec.ts::masked session: hidden stock shows star-masked title and badge while dates render as served`；`e2e/random-mode.spec.ts::eye toggle: confirm reveals real stock and dates, cancel keeps mask, re-click restores`
- **RANDOM-HIDE-TIME-REMAINING**：`server/test/random-training-mode.test.ts::serves remainingBars on running random sessions and decrements it per advance`；`server/test/random-training-mode.test.ts::keeps every running hideTime response free of unshifted real market dates via deep walk`；`e2e/random-mode.spec.ts::eye toggle: confirm reveals real stock and dates, cancel keeps mask, re-click restores`（random_both 剩余根数呈现）；`e2e/random-mode.spec.ts::settle reveal: real stock and real date window surface after settlement`（random_time 运行态剩余根数＋偏移日期不呈现）
- **RANDOM-REVEAL-MIDRUN**：`server/test/random-training-mode.test.ts::reveals real identity on demand for running random sessions while other endpoints stay masked`；`e2e/random-mode.spec.ts::eye toggle: confirm reveals real stock and dates, cancel keeps mask, re-click restores`（取消维持遮蔽／确认揭示／再点恢复三段）
- **RANDOM-REPLAY-TAG**：`server/test/random-training-mode.test.ts::exposes the random caliber on settled range rankings and history for tagging`；`e2e/random-mode.spec.ts::random recording: library item and replay carry random tag with real stock info`

## 六、语义锁定抽检（P4 变异纸面推演）

- 变异 1（RAND-UI-MASK-STARS）：Training.vue 标题改回占位文字 → e2e `masked session` 的 `toHaveText('****** · ******')` 死（杀手：e2e/random-mode.spec.ts::masked session）。
- 变异 2（RANDOM-REVEAL-MIDRUN）：random-mode.ts onSend 去掉 reveal 排除 → reveal 响应经遮蔽层洗回 null/偏移 → 单测 `reveals real identity on demand...` 的 `revealed.code toBe(row.code)` 死（杀手：server/test/random-training-mode.test.ts::reveals real identity on demand for running random sessions while other endpoints stay masked）。
- 变异 3（RANDOM-HIDE-TIME-REMAINING）：remainingBarsOf 改回常数 → 单测 `serves remainingBars...` 推进后 8≠9 断言死（杀手：server/test/random-training-mode.test.ts::serves remainingBars on running random sessions and decrements it per advance）。

## 七、相邻问题登记

见任务卡「相邻登记」：HistoryReport.vue RANGE_MODE_LABELS 缺 'random'（成绩单弹窗 tierText 回退「自定义范围」，文件不在 allowed_paths）；排行个股视图 RANGE 训练「周期」列显示哨兵字符串（既有）；跨机器导入录像无本地训练时不标注库条目。
