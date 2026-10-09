# RF3-01 验证记录：random_stock 档位补起始日期输入（完全照搬经典）

任务：`docs/work-items/tasks/RF3-01.md`（用户报告 2026-10-09：随机股票模式只有自定义范围才能自选起始日期；训练周期与起始日期设置应完全照搬经典模式；random_time/random_both 随机起始时间口径已正确不动）。

## 实现口径

### 前端（web/src/views/Launcher.vue）
- `showRandomStockStart = mode==='random' && randomDimension==='random_stock' && randomTier!=='RANGE'`；`showPresetStart` 由经典单分支扩为 `(classic && tier!=='RANGE') || showRandomStockStart`——random_stock 档位复用经典「起始日输入＋行内初始资金」整行（同一 startDate 状态、同一 `@input` 置 startDateTouched 标记，同控件同行为）。
- 默认值＝anchorDate（dataStatus.sourceMaxDate，未扫描回退上海今天）回退当前档位月数（默认 3M）。联动与经典逐一等价：
  - 档位点击（onRandomTierClick，random_stock 分支）：重算 startDate 并清 touched（同经典 onTierClick，不保留手填值）；
  - 手填保留到下次切换档位（touched 标记，同经典）；
  - `watch(dataStatus)`：条件由 `classic && tier!=='RANGE' && !touched` 扩为 `showPresetStart && !touched`，月数按 mode 取 classic tier 或 randomTier——经典行为原样保留；
  - 切入随机模式（setMode）与切入 random_stock 维度（onDimensionClick）：按当前档位重算起始日，不沿用经典面板残留值（避免经典 1Y 残留与随机 3M 档位错配）。
- 「自定义范围」档（randomTier==='RANGE'）：起始日输入退场、起止日对进场（旧 start_date/end_date 口径原样保留，含 resetRangeDefaults 习惯）。
- 载荷（performRandomCreate random_stock 档位分支）：`window_months + start_date`（空起始日守卫「请选择起始日」）；自定义范围档仍发 start_date+end_date。`web/src/api.ts` 的 RandomTrainingRequest 本就含可选 start_date，零改动。
- 提示文案分流：经典保留原文（含「840 根同屏」句），随机为「起始日默认从最新数据日回退所选档位时长；窗口为起始日起所选档位的自然月数，股票由服务器在窗口内随机选取」（不含经典原句子串，home-tabs 互斥断言不回归）。

### 服务端（server/src/train/random-mode.ts）
- random_stock 档位支持 `window_months + start_date`（唯一合法组合维度）：
  - start_date 校验 `isDayDate`，非法 400；
  - 窗口：起始日对齐前方最近交易日起窗（与锚点口径同一对齐规则），窗末＝起始交易日＋N 自然月（经典 plannedEnd=addMonths(start,N) 同式）；
  - 候选池预筛＝「目录 lastDate ≥ addMonths(start_date, N)」（startBar ≤ start_input ⇒ 各股实际窗末 ≤ 该上界，覆盖上界即覆盖自身窗末）＋逐股预热 200 根拒绝采样（不变）；
  - 池空 422 RANDOM_STOCK_UNIVERSE_EMPTY（消息区分「起始日 X 起 N 个自然月」）。
- 向后兼容：未提供 start_date 时维持 RF2-01「最近 N 个自然月、数据末日锚点」默认行为（既有 RF2-01 测试全绿为证）。
- 互斥语义不变项：`end_date+window_months` 仍 400（档位窗口末缘由起始日＋N 自然月决定）；`random_time/random_both` 带 start_date 仍 400（随机时间口径已正确不动）；`window_bars` 对 random_stock 仍 400。

## RED→GREEN

- 单测（server/test/random-training-mode.test.ts 新增 RF3-01 组 3 例）：
  - RED：exit 1，2 failed（`creates ... window spans 3 natural months from the user start date`＝window_months+start_date 被 400 拒绝；`rejects start_date misuse ...`＝同因连带）。收据 red-unit.txt。
  - 配套修订（行为变更双向留痕）：RF2-01 互斥用例表移除 `{random_stock, window_months:3, start_date}` 行（原断言 400，现为合法组合→201，移至 RF3-01 组断言正向行为并在原处留注释指向）。
  - GREEN：exit 0，33/33。收据 green-unit.txt。
- e2e（e2e/random-mode.spec.ts）：
  - 修订 2 例：`random panel: dimension-driven control visibility and payload for random_stock`（起始日输入在场 count 1、默认值 2026-06-24＝mock 锚点 2026-09-24 回退 3 自然月、默认/切档/手填载荷 start_date 断言、自定义范围档起始日退场 count 2）；`random stock period grid: tier options mirror classic and real creation with 3M succeeds`（起始日输入在场＋默认值、填用户起始日 minusDays(lastDate,200) 真实创建、active.startDate 对齐断言、barCount 40-70）。
  - RED：exit 1，2 failed（起始日输入 count Expected 1 / Received 0）。收据 red-e2e-journey.txt。
  - GREEN（全 spec 12 用例）：exit 0。收据 green-e2e-journey.txt。

## 定向回归收据

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts（修复后全文件） | 0 | 33/33 |
| TDX_ROOT=... npm run journey -- e2e/random-mode.spec.ts --retries=0 | 0 | 12/12 |
| TDX_ROOT=... npm run journey -- e2e/training-range.spec.ts --retries=0（经典面板回归，含起始日 watch 联动用例） | 0 | 7/7 |
| npm run build:server | 0 | tsc 通过 |
| npm run build（typecheck:web＋build:server＋build:web） | 0 | 通过 |
| npx vitest run --config server/vitest.config.ts（全套） | 1* | 1565/1566；唯一失败＝history-report.test.ts 5s 超时（全套并发 flake，与本改动无路径交集；单文件复跑 25/25 过，附于 regression-unit-full.txt） |

## 矩阵行重绑提案（RAND-UI-PERIOD-REUSE；矩阵文件不写，供架构师重绑）

新 test_ids（RF3-01 覆盖点）：
- `random-training-mode.test.ts > RF3-01 random stock tier with user start date (window_months + start_date) > creates a random_stock tier training whose window spans 3 natural months from the user start date`
- `... > keeps the RF2-01 data-end anchor default when start_date is absent`
- `... > rejects start_date misuse with 400 and a start date no stock covers with 422, zero side effects`
- `random-mode.spec.ts > random panel: dimension-driven control visibility and payload for random_stock`（修订后含起始日输入断言）
- `random-mode.spec.ts > random stock period grid: tier options mirror classic and real creation with 3M succeeds`（修订后含用户起始日真实创建）

RANDOM-INPUT-VALIDATION 受影响子句评估：
- 新增合法组合：`window_months + start_date`（仅 random_stock；start_date 须 isDayDate）。原「start_date 与 window_months 互斥」子句收窄为「end_date 与 window_months 互斥；start_date+end_date 对（无 window_months 的 random_stock RANGE 口径）仍需成对提供」。
- 不变：random_time/random_both 一切 start_date/end_date 仍 400；window_bars 与 window_months 互斥；window_bars 对 random_stock 仍 400；window_months 值域仍＝经典档位月数。

## 待拍板项 / 相邻问题登记
- 无新增待拍板项（控件行为按用户原话「完全照搬经典」逐项对齐，无自由裁量文案进断言）。
- 相邻登记（非本任务路径）：全套并发下 history-report.test.ts 一例 5s 超时 flake，单文件复跑通过；建议后续关注测试并发时延配置，不属本任务范围。
