# DRAW-02 worker delivery (historical)

[返修合同](../../../engineering/stage-feedback-20260919.md)。工程完成不等于用户验收。

## 验证记录（2026-09-19，worktree task/DRAW-02，基线 e8bdddf）

- `npm test`：全量 53 个测试文件、638 个用例通过，退出码 0。
- `npm run typecheck:web`：退出码 0。
- `npm run build:server`：退出码 0。
- `npm run docs:check` / `docs:impact --base e8bdddf --task DRAW-02` / `docs:status`：0 errors。

覆盖点：603980 除息 4.81→4.74 跟随；分红+送转+配股合并事件按仿射（非纯比例）投影；多事件按推进日累计且不含未来权息；raw 与无事件恒等；`/bars` 主请求与 `before` 分块同发 `drawingPriceBasis`，双盲下推进日期仍被掩码；`priceBasis` 非法元数据 400 且不覆盖既有画线；投影不四舍五入、不改输入；VOL/MACD 副图锚点不动；simpleTag 纯数字价格标签随锚点刷新；序列化盖印当前基准、两参调用保持旧格式；旧无基准画线保留原值采用首个可靠基准；撤销/重做历史快照各带自身基准、恢复时投影到当前基准且重复投影不位移。

## 实现说明（2026-09-19）

- 服务端 [drawing-price-basis.ts](../../../../server/src/train/drawing-price-basis.ts)：读训练行 `adjust_mode/current_date/start_date`（注意 SQLite `current_date` 列与 CURRENT_DATE 关键字同名，SELECT 必须加引号），权息事件按推进日截断后取 `buildForwardAdjustmentSegments` 最老一段累计 a/b；raw 或无事件为 1/0；返回值不含日期。`/api/trainings/:id/bars` 在既有 bars 计算与权息缓存刷新之后附 `drawingPriceBasis`（含 before 分块）。
- 服务端 drawings 校验：`priceBasis` 可选、恰含正有限 scale 与有限 offset；JSON 存量存储，无表结构迁移。
- web [drawingPriceBasis.ts](../../../../web/src/drawingPriceBasis.ts)：纯函数投影/校验/采用助手；`Drawing.priceBasis` 可选，序列化按当前渲染基准盖印（两参调用保持旧格式）。
- KlineChart：新增可选 `drawingPriceBasis` prop。恢复（载入/撤销/重做）统一走 `adoptDrawings`——带合法基准投影到当前基准、旧无基准画线保留原值采用首个可靠基准；喂新K线基准变化时先按旧基准捕获、喂完投影到新基准并恰好外发一次 `drawingsChange`；基准未变不重复投影，推进不清撤销历史，投影期间静默语义操作并重播种上报基线（无 drawing.move）。只读回放与 prop 缺省均保持旧行为。
- Training/worker 不在本次范围：集成人把成功 bars 响应的 `drawingPriceBasis` 经 prop 传入 KlineChart（prop 与 bars 同源同批到达即可，单独到达时组件仅在下次喂新K线时对齐）。

## 返修记录（2026-09-20，评审 P1 + 口径更正，仍基于 e8bdddf）

- **P1（已修）**：喂新K线 watcher 仅在 `stale.length` 非空时推进 `renderedBasis`——空图/清空/撤销到空跨除息后基准滞留旧值，随后新建画线被盖印旧基准（如 1/0），下次普通刷新遭二次投影错位（4.74→4.67）。修复：抽出纯决策 [advanceRenderedBasis](../../../../web/src/drawingPriceBasis.ts)（未知→已知采用、已知→新基准无条件推进、只读/缺省/同基准不动），基准推进与图形数量解耦；有画线时才恢复投影并外发 `drawingsChange`。恢复路径复核无需改动：`restoreDrawings` 采用首个可靠基准本就与图形数量无关，撤销/重做快照经 `adoptDrawings` 投影到已保持最新的 `renderedBasis`。
- **口径更正**：移除"画线锚定在已发生全部权息之前的历史K线上"的限定性说法（服务端注释同步改写）。集成人独立评审确认仿射数学对更晚年代锚点同样成立——推进只新增更新事件，`F_new ∘ F_old⁻¹ = G_new` 抵消两份基准共有的早先事件，各年代锚点只吃到新发生事件的变换；新增 later-anchor 复合投影回归固定该结论。
- 回归：`drawing-state.test.ts` 新增"rendered basis advance decision"组——空图推进决策、4.74 全链路（推进→盖印→同基准刷新不再位移）、只读/未知/首载语义不变、later-anchor 与最老锚点复合投影、空图推进后新建画线再次推进只施加新事件。
- 本轮验证（定向）：`npx vitest run --config server/vitest.config.ts drawing-state drawing-price-basis drawings drawing-outbox drawing-geometry drawing-hit` 与 `npm run typecheck:web` 通过；docs:check / docs:impact / docs:status 0 errors。改动已暂存但提交被 Mimosa 预提交门禁拦截（15 high 全部位于任务范围外的基线脚本 scripts/verify-candidate.ts、scripts/runtime.ts、scripts/agent-monitor/monitor.py；不得由本任务修复或绕过），待集成人处置基线后正常提交。
