# M7-01 随机训练模式·服务端核心 — 验证记录

- 基线：`9c83b9ff09623b4da1ff4da611662555a66a1477`（开工时 HEAD，工作树干净）
- 契约与设计：[design.md](./design.md)（阶段①②③交付物；§2 为 API 契约）
- 矩阵：工作区 `.zcode/skills/ai-harness/matrix/random-training-mode.yaml`（12 行全部 covered）＋镜像 `ai-harness-lab/skill-v1/matrix/random-training-mode.yaml`
- 行为 oracle：用户 2026-10-06 原话＋架构师 M7-01 派发简报（proposed_default 清单见本页末尾，随收尾报告转呈用户确认）

## RED → GREEN 证据（阶段④）

- 测试文件：`server/test/random-training-mode.test.ts`（14 用例，TDX 合成夹具：4 只股票 520/520/120/260 根工作日日线＋pttab 名称表＋gbbq；`vi.setSystemTime` 固定 cutoff）
- **RED**：`npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts` → **14/14 失败，全部以正确原因**：
  - 12 个 HTTP 用例 `expected 404 to be 201/400/422`（路由不存在＝功能缺失）；
  - 2 个直调用例 `Cannot find module '../src/train/random-mode.js'`（模块不存在）；
  - 经典零影响用例在 DB 断言处 `expected undefined to be null`（迁移列不存在）。
- **GREEN**：实现（db.ts 两列迁移 / engine.ts 纯加法 / random-mode.ts 新模块 / api.ts 挂接）后同命令 → **14/14 通过**（4.3s）。期间两处测试自身编排错误（结算顺序、二次取行）与一处遗留死代码行修正，均未改断言语义。

## 门禁四件套（第 4 步）

| 门禁 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 绑定检查（strict＋未跟踪） | `node <skill>/scripts/check-binding.mjs --repo <repo> --matrix <skill>/matrix/random-training-mode.yaml --strict --include-untracked` | 12 行 covered=12 / open=0 / RED=0，1520 用例索引 | **0** |
| 定向测试（新矩阵行） | `npx vitest run --config server/vitest.config.ts server/test/random-training-mode.test.ts` | 14/14 ✓ | 0 |
| 定向存量（受改动波及文件） | `npx vitest run ... train-engine/train-range-preview/train-range/history-report/api/full-acceptance/conditional-orders/runtime-isolation.test.ts` | 首轮 4 失败＝本人瞬时 TS 编译错误（history-report 内联类型/导出遗漏/闭包收窄）所致的 journey 构建失败；修复后 runtime-isolation 15/15 ✓、其余全绿 | 0 |
| 全量 | `npm test` | **1467/1468**；唯一失败逐名报告：`review-profile.test.ts > conservative full classification > rejects control documentation directories even when the files are markdown`＝beforeEach `mkdtemp` 15s 钩子超时（4 worker 并行 637s 高负载下的 Windows 临时目录环境超时，与本改动无关——review-profile 为文档分类沙箱，未触本任务任何文件）；隔离重跑 `npx vitest run ... server/test/review-profile.test.ts` → **16/16 ✓** | 1（环境性，已复核） |
| 构建 | `npm run build`（typecheck:web＋build:server＋build:web） | 全绿（chunk>500kB 警告为存量提示） | **0** |

## 语义锁定变异抽检（P4，executed 级，均先备份后恢复）

| 变异 | 改动 | 击杀测试（矩阵行） | 结果 |
|---|---|---|---|
| M1 隐藏股票不置空 | `transformRandomPayload` 中删去 `masked.code/name = null` | `keeps every running random session response free of stock code and name substrings via deep walk`（RANDOM-HIDE-STOCK-NO-LEAK） | 该测试红、其余 13 绿 → **击杀**；恢复后 14/14 绿 |
| M2 日期平移恒等化 | `shiftDate` 直接 `return date` | `shifts all market dates by one constant session offset...`、`round-trips shifted before queries...`、`creates a random_time...`、`creates a random_both...`、`shifts date substrings...` 共 5 测试红（RANDOM-HIDE-TIME-OFFSET/RANDOM-TIME-INPUT-DESHIFT/RANDOM-CREATE-TIME/RANDOM-CREATE-BOTH） | **击杀**；恢复后 14/14 绿（`grep -c MUTATION` = 0） |

推论：无泄漏与偏移变换两条核心语义被断言真实锁死，非名字对应（L2）。

## 隐藏策略落实出口清单（改动摘要）

- 创建响应：`createRandomTraining` 返回前经 `maskedMetaOf` 变换（random-mode.ts）。
- 运行中一切出口：api.ts 挂接的 `onSend` 钩子按路由（`/api/trainings/active`、`/api/trainings/:id*`）解析会话后深度变换（含错误消息经全局 error handler 的序列化体；`/api/trainings/random` 创建响应在模块内变换）。
- 请求侧：`preHandler` 对 `GET :id/bars?before`（YYYY-MM/YYYY-MM-DD）与 `PUT :id/drawings` 的 `points[].timestamp` 去偏移，库内恒真实空间。
- 揭晓：settle/abandon/自然到期后 `status != running` → 钩子直通；history/report/equity-comparison/rankings 运行中本就 409。
- 录像：M7-01 未改 REC 链路（`/api/trainings/:id/recording-context` 的日期属 API 出口、被钩子平移；REC 文件捕获的是客户端所见遮蔽态，不做事后还原——见拍板项）。

## 数据库迁移

`trainings.random_mode TEXT`、`trainings.random_time_offset_days INTEGER`（`addColumnIfMissing` 兼容增列；旧行 NULL=经典，不重建表不清理）。retrain 复制两列（重练再次隐藏，偏移不变）。

## 待用户拍板项（proposed_default，随收尾报告转呈）

1. 随机池含一切可训练标的（含 ST/北交所），默认不排除——照办简报默认；北交所代码受既有目录扫描口径影响（`isAShareCode`/`marketFromCode` 对 6 位 bj 代码的正则边界），池本身不做市场过滤。
2. `training.market` 在隐藏股票时保留（非名称/代码；M7-02 若需更严可再收紧）。
3. 时间偏移上限 `|offsetDays| ≤ 3650`、非零、创建时一次定型存库。
4. 两类 422 采用简报给定码值（RANDOM_WINDOW_NOT_FIT / RANDOM_STOCK_UNIVERSE_EMPTY），400 沿经典中文 message 风格不带 code。
5. `random_stock` 池核验规则＝预热 201 根（200 预热＋窗首）＋窗口内 ≥2 根＋lastDate ≥ end_date；`random_both` 池预筛＝目录 bars ≥ window_bars+200 后拒绝采样（严格均匀性不做保证，简报明示 Math.random 级即可）。
6. REC 落盘不二次脱敏/不做事后还原（浏览器捕获本就只见遮蔽态；回放属事后）。
7. 池核验需逐股读日线（目录 lastDate/bars 预筛后），创建为一次性动作；性能优化（文件尺寸推根数等）另立任务。
