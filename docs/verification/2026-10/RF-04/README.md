# RF-04 随机模式时间维度复用经典训练周期选择 验证

对象：worktree `D:\tmp\rf04`（分支 `rf04-random-period`，基础提交 `9d5530a`＝main）。改动集中：`web/src/views/Launcher.vue`（随机面板档位网格）、`server/src/train/random-mode.ts`（window_months 档位口径）、`web/src/api.ts`（类型）、`server/test/random-training-mode.test.ts` 与 `e2e/random-mode.spec.ts`（扩展）。

## 用户 oracle 与矩阵行

用户原话（2026-10-08）：「时间段自定义其实可以复用经典模式的训练周期模式，如果是时间随机的模式，也应该复用经典模式训练周期选择，这样才能保证最后训练的结果在排行时，能与历史训练数据在时间长度上对齐，便于排行分类」。矩阵行 `RAND-UI-PERIOD-REUSE`（planned → 本任务交付实现，test_ids 见任务卡收尾报告）。

## 实现口径

- UI：random_time/random_both 新增「训练周期」档位网格＝经典五档（同 `TIER_MONTHS` 月数同文案）＋「自定义根数」档（旧 window_bars 输入，默认 250）；默认 3M；random_stock 起止日期现状不变；经典面板零改动。
- API：`POST /api/trainings/random` 新增可选 `window_months`（值域 1/3/6/12/24，非档位值/与 window_bars 同给/random_stock 携带 → 400 零写入）；窗口＝「N 个自然月日期跨度、起点在可行集合内均匀随机、跨度完整落在数据内」（复用 engine `addMonths`，与经典 plannedEnd 同源）；跨度放不下 422 `RANDOM_WINDOW_NOT_FIT`；window_bars 旧口径与缺省 250 兼容保留。
- 排行：时长口径与经典一致（月跨度）；tier 列保持 RANGE 哨兵（录制契约冻结），范围排行按精确起止分组不变，档位口径写入 `range.notes`（「窗口为 N 个自然月跨度，与经典训练周期同口径」）。

## RED→GREEN 收据（命令＋退出码）

| 步骤 | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| RED 单元 | `npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts` | 1 | 4 failed / 17 passed：window_months 创建按旧默认 250 根走、`window_months:5` 被无视 201、rng 确定性与档位口径断言失败（[red-unit.txt](red-unit.txt)） |
| RED e2e | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/random-mode.spec.ts --retries=0` | 1 | 4 failed / 5 passed：random_time/random_both 载荷、settle reveal 自定义根数档、新 3M 真实创建（run `run-7eeb4619`，[red-e2e-journey.txt](red-e2e-journey.txt)） |
| GREEN 单元 | 同 RED 单元 | 0 | 21/21 通过（[green-unit.txt](green-unit.txt)） |
| GREEN e2e | 同 RED e2e | 0 | 9/9 passed（52.4s，run `run-54573bff`，[green-e2e-journey.txt](green-e2e-journey.txt)） |
| 定向回归·经典面板 e2e | `npm run journey -- e2e/training-range.spec.ts e2e/journey.spec.ts e2e/training-defaults.spec.ts --retries=0` | 1 | 24 passed / 3 failed；3 例失败与基线对照完全同款（见下），training-range 全过（[regression-classic-journey.txt](regression-classic-journey.txt)） |
| 基线对照 | stash 全部改动后 `npm run journey -- e2e/training-defaults.spec.ts e2e/journey.spec.ts --retries=0 --grep "Act4d|返修F5|设置保存失败反馈"` | 1 | 干净基线 `9d5530a` 同样 3 failed 且错误签名一致（paneId 断言 / locator.click 超时 / `input[type=date]` strict 2 元素）→ **存量失败，与本改动无关**（run `run-2a44b471`，[baseline-classic-journey.txt](baseline-classic-journey.txt)） |
| 单测全套 | `npx vitest run --config server/vitest.config.ts` | 0 | 122 文件 / 1546 用例全过（[regression-unit-full.txt](regression-unit-full.txt)） |
| 构建 | `npm run build`（typecheck:web＋build:server＋build:web） | 0 | 通过（[build-receipt.txt](build-receipt.txt)） |

## 单测 oracle 独立性

新增 7 例期望值由夹具日历本地推算：`addMonthsLocal`（自然月加法）、`contractMonthStarts`（完整 N 月跨度＋200 预热＋窗口≥2 根的可行起点契约本地实现）、`contractMonthWindow`（跨度内交易日窗口）——不 import 服务端 `addMonths`/选窗实现；600005（260 根）够预热但放不下完整 3 个月跨度的 422 用例即由 `contractMonthStarts(MID_DATES,3)=[]` 夹具自证。

## 相邻发现（不属本任务，待拍板/另立任务）

1. **排行分组的完整对齐受录制契约冻结阻断**：`web/src/recording/validation.ts:346-355` 规定旧五档 tier 在任何 schemaVersion 都不得携带 range 元数据（`RANGE_MODES` 注释明示随机训练＝tier RANGE 哨兵＋服务端 range 元数据），`web/src/recording/compactRecorder.ts` schemaVersion=3 判定同样依赖 `tier==='RANGE'`。若把随机档位局的 tier 列改存 '3M' 以进入经典 3M 榜（`server/src/train/rankings.ts` 按 tier 精确分组），随机局的浏览器录像校验会以「旧五档 tier 不得携带范围元数据」失败。两文件均不在本任务 allowed_paths。当前交付对齐到「时长口径一致（月跨度）」层面；未来若要做榜面对齐，需先扩展录制 schema（如 v4 允许五档 tier＋random range 元数据）再改 tier 列与 rankings 分组，已写入任务卡 next_action。
2. **training-defaults/journey 存量失败 3 例**：`Act4d 副图画线多选`（paneId 断言）、`设置保存失败反馈…`（locator.click 超时）、`返修F5…`（`input[type=date]` strict 2 元素）——基线（stash 后干净 `9d5530a`）同样失败且错误签名一致，与本改动无关，按 RF-03 先例保留事实不顺带修复。
