# E2E-SPEC-SYNC-01 桶B 规格同步＋画线隔离口径定案（验证报告）

日期：2026-10-19。任务卡：[E2E-SPEC-SYNC-01](../../../work-items/tasks/E2E-SPEC-SYNC-01.md)。worktree `D:\tmp\wt-specsync`（分支 task/E2E-SPEC-SYNC-01，基 main `337cbec`）。依据：用户 2026-10-19 验收批复 1（桶B 九条依建议直接更新断言、不删例）＋画线按周期隔离拍板（原话：画线不要跨周期可见，维持现状）。**零产品码改动**（`git status` 改动清单仅 e2e/**、docs/specs/**、web/src/components/docs/**、docs/verification/**、任务卡）。

## 一、探针实证（画线隔离三条的前置）

临时探针 spec（`e2e/zz-probe-isolation.spec.ts`，证据采集后删除）复用 journey 隔离服务与冻结样本（600519），六项断言：

| # | 探针断言 | 结果 |
|---|---|---|
| P1 | 日K 画线序列化盖印 `timeframe:"1D"`，保存后服务端 GET 返回该线 | 过 |
| P2 | 切周K → `drawings()`=`[]` 且该 id 无 geometry（不可见） | 过 |
| P3 | 周K 画新线（盖印 `1W`）保存 → 服务端 GET 同时保有 1D＋1W 两条 | 过 |
| P4 | 切回日K → `drawings()` 与原线 `toEqual` 全等恢复 | 过 |
| P5 | 再切周K → 只见周K 线（往返稳定） | 过 |
| P6 | 刷新后视图回默认日K（周期选择不跨刷新持久）→ 只见日K 线；再切周K 见周K 线；服务端两条俱在 | 过 |

**结论：产品实现＝按周期隔离的过滤显示，非数据丢失**（静态链佐证：Training.vue `onDrawingsChange` 先保留其他周期集合再拼接当前周期整包保存；`watch(tf)` 切换时从全量 `allDrawings` 重过滤回填）。无新发现缺陷，无需 needs_user_decision，隔离口径断言按拍板落地。探针 run：首跑 run-d8558d17（exit 1，P6 预期写错——误设"刷新后仍处周K 视图"，error-context 证实刷新后 tab 日K [selected]，属探针自身假设错误非产品缺陷）；修正后 run-16909e5e（**exit 0**）。

## 二、逐条改动对照（旧断言 → 新断言 → 复跑）

### 桶B 九条

| # | 用例（文件:行） | 旧断言 | 新断言 | 复跑 |
|---|---|---|---|---|
| B-1 | data-update f)（data-update.spec.ts:243） | 按钮文本「未检测到通达信数据」＋点击后 409 中文原因 `.data-refresh-error` 行内展示＋refreshCalls=1 | 文本「连接通达信」＋title 含「未检测到通达信数据」＋点击打开接入向导（POST /api/setup/select-directory 到达）＋refreshCalls=0＋无 alert | **绿**（exit 0） |
| B-2 | journey Act4d（journey.spec.ts:399） | 固定坐标 y790-830 画线＋`overlayInfo(0).paneId != 'candle_pane'` | 动态定位 MACD 窗格（`panes().find(name==='MACD')`）取点画线＋框选同改动态取点＋断言 `drawings()[0].paneId === 'MACD'` | **绿**（exit 0；Act6 级联恢复同轮通过） |
| B-3 | m3-feedback 自动保存（经 training-flow.ts:34） | 结算面板点「继续查看图表」 | 点「留在当前界面」 | **绿**（exit 0） |
| B-4 | m3-tools D23 文本（m3-tools.spec.ts:420） | `JSON.stringify(drawing)` 含未转义换行（数学上不可满足） | `drawings()[0].extendData.text === '已复核\n保留观察'` | **绿**（文件级 18 过 2 败，败者属桶A-②，本用例 ok） |
| B-5 | m3-tools D31 已结算（:646，经 training-flow.ts） | 同 B-3 | 同 B-3 | **绿**（同上，本用例 ok） |
| B-6 | report-feedback（report-feedback.spec.ts:87） | 浅色成绩单底色 `rgb(255,255,255)` | `rgb(243, 246, 244)`（＝`--surface-background: #f3f6f4` token 解析值） | **绿**（exit 0） |
| B-7 | training-defaults:133 | 弹层「取消」按钮关闭 | 「关闭」按钮（aria-label）关闭，焦点返还断言保留 | **绿**（exit 0） |
| B-8 | training-defaults F5（:304） | 单 `input[type="date"]` fill | 按 label「起始日」结构过滤定位起始输入＋**结束日填样本覆盖内日期 2026-09-15**（默认今天 2026-10-19 超出冻结样本末根 2026-09-16 会被预览合理拒绝） | **绿**（exit 0） |
| B-9 | training-rules F3（training-rules.spec.ts:253） | 弹层「取消」按钮 | 「关闭」按钮 | **绿**（exit 0） |

### 画线隔离三条（口径定案：用户拍板）

| # | 用例（m3-tools.spec.ts） | 旧断言 | 新断言 | 复跑 |
|---|---|---|---|---|
| A-③-a | D30-D31 主副图保存刷新与跨周期恢复（:508，更名「…与按周期隔离显示（切回原周期恢复）」） | 周K/月K/日K 循环内 `drawings()` 恒等于全量两线（跨周期持续可见） | 周K/月K 视图 `drawings()`=`[]` 且服务端 GET 仍等于全量（过滤显示非丢失）；切回日K `toEqual` 恢复；后续拖拽/补历史/刷新断言不变（均在日K） | **绿**（ok 12/20） |
| A-③-b | D31 快速切换过期响应不覆盖月线（:669） | 月K 视图上 `drawings()` 等于日K 线（跨周期可见） | 月K 视图 `drawings()`=`[]`；切回日K `toEqual([line])` 恢复（快速切换不丢画线）；过期周线响应不覆盖月K 的核心断言不变 | **绿**（ok 16/20） |
| A-③-c | D31 最新日线锚点跨周月映射（:748，更名「日线锚点画线按周期隔离显示，切回日线仍按时间锚定」） | 周/月视图上日K 线几何映射到聚合柱像素（跨周期锚点映射） | 周K/月K 视图 `drawings()`=`[]`；切回日K 原线恢复、timestamp 不变、锚点像素与日线重算一致（时间锚定语义保留在本周期内） | **绿**（ok 18/20） |

### 两处分类报告假设证伪（执行中发现，如实呈报）

1. **B-1**：分类报告称"409 行内展示与不弹 alert 这两点产品仍满足"——复跑证伪：unavailable 按钮现走 `openWizard()`（App.vue:683），不再发 refresh，409 行内展示经该按钮不可达。按报告备选建议"改断言 title/点击行为"落地；409 中文行内展示语义确认由 data-update-feedback.spec.ts:96「训练页将 409 更新失败展示在固定反馈区」（基线通过）独立锁定，覆盖无缺口。
2. **B-8**：修好定位器后暴露更深旧假设——v1.0.3 双输入下结束日默认今天，超出冻结样本覆盖被预览合理拒绝（"尾段缺口含未证实工作日"）。起止均填覆盖内日期后最终预览成功展示真实区间，F5 语义（在途失效/重生成/投毒丢弃）不变。

## 三、规格文档同步

- `docs/specs/chart/interaction.md`：CHART-DRAWING 节新增「画线按周期隔离」正式口径条目（盖印/仅本周期显示/过滤非删除/保存按周期合并不覆盖他周期/存量归一 1D）。
- `web/src/components/docs/drawing-persistence.md`：§对象与本地历史 旧句「动态补历史与周期切换后仍以时间定位」修正为「动态补历史后仍以时间定位」；新增「周期隔离（用户 2026-10-19 拍板口径）」专节（序列化盖印、恢复过滤、保存合并、切回恢复四条机制＋探针实证）。

## 四、定向复跑收据（journey，TDX_ROOT 必填，--retries=0）

命令模板：`TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/<spec>.spec.ts --retries=0`（worktree 根）

| spec | run | 退出码 | 备注 |
|---|---|---|---|
| （探针）zz-probe-isolation | run-16909e5e | **0** | 首跑 run-d8558d17 exit 1＝探针 P6 自身预期错误 |
| data-update | run-4272caf5 | **0** | 7/7；首跑 run-1cb3f83a exit 1＝发现 B-1 假设证伪（见二） |
| training-rules | run-4f5a3b1a | **0** | |
| training-defaults | run-d561fad5 | **0** | 5/5；首跑 run-1287179c exit 1＝发现 B-8 结束日问题（见二） |
| report-feedback | run-27660ce | **0** | |
| m3-feedback | run-5bca5f77 | **0** | |
| journey | run-36b899cb | **0** | Act4d 修复＋Act6 级联恢复 |
| m3-tools | run-aa51b6b9 | **1** | 18 过/2 败；两败＝`M3 D26-D29 编辑移动撤销重做…`与`M3 D28 文本线段混选编辑…`（桶A-② styles 丢失存量，分类报告 #7/#13，本轮未触碰，属 M2 产品修复轮） |

本任务改动的 12 个用例（桶B 9＋隔离 3）全部转绿；m3-round3 未改动（其失败 #6/#13 属桶A-②，不引用 training-flow，无需复跑）。

## 五、剩余失败清单（对账）

桶A-①（drawing-basis 跨除权日撤销）、桶A-②（m3-round3 诅咒线、m3-tools D26-D29、m3-tools D28 混选）、桶A-④（recording 默认录制离线回放）、待复核 1（random-mask-axis）、设计内跳过（migration-v127）。与任务卡预期一致：只剩桶A-①②④与待复核 1。

## 六、边界声明

- 零产品源码改动：`web/src/` 下仅改 `web/src/components/docs/drawing-persistence.md`（文档）。
- 矩阵文件零触碰（e2e 规格不属于矩阵绑定测试域；本轮无行为模块改动）。
- 探针为临时资产，证据（run 目录）保留，spec 文件已删除不入库。
