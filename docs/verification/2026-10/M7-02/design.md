# M7-02 随机训练模式·首页入口与前端接线 — 设计与实施计划（design.md）

> 阶段①②③交付物。行为 oracle：用户 2026-10-06 原话（首页进入随机模式；原模式命名经典模式；标签页切换；复用经典首页面板降低上手门槛）＋架构师 M7-02 派发简报 provisional 设计决策（proposed_default 清单随收尾报告转呈）。
> 消费契约＝M7-01 [design.md](../M7-01/design.md) §2（POST /api/trainings/random；`TrainingMeta.random={dimension,hideStock,hideTime}`；运行中遮蔽、结束态揭晓；422 `RANDOM_WINDOW_NOT_FIT`/`RANDOM_STOCK_UNIVERSE_EMPTY`）。本任务**不改服务端**。

## 一、现状结论（阶段① 读码摘要）

- 首页＝`web/src/views/Launcher.vue`（单组件表单）：股票双框检索（防抖＋点击确认）、周期 tier 网格（1M~2Y＋RANGE 自定义范围）、起始日/范围起止日、初始资金、复权、训练时钟、条件单、记录操作；`POST /api/trainings`（tier/range+previewId 两分支）在 `performCreate` 内；数据新鲜度守卫（`shouldSuggestDataUpdate`→确认弹窗）与默认设置守卫（`defaultsState!=='ready'` 禁用开始按钮）在提交路径最前端，两分支共享。
- 训练页＝`web/src/views/Training.vue`：标题 `workspace-title` 直插 `${training.name ?? ''} · ${training.code ?? ''}`（hideStock 会话两值为 null→显示「 · 」裸分隔符，必须补占位）；`tierLabel` 对 RANGE 显示「自定义范围 start~end」（random 会话应显示随机口径）；训练详情面板/当前日期全部直读 meta 字段（hideTime 时服务端已偏移，前端原样呈现即正确——**不做任何二次处理**）。结算面板（`settledView`）展示结算日/区间；settle 响应在 status 变化后产出、天然无遮蔽（真实信息）。
- 前端 API 层 `web/src/api.ts`：`TrainingRangeMeta.mode`/`HistoryRangeMode`/`HistoryReportTraining.range.mode` 联合类型缺 `'random'`（服务端已写入该值，TS 类型必须补齐）；`TrainingMeta` 缺 `random?` 字段；无 `createRandomTraining` 函数；`ApiError(message, status, code)` 已携带错误码（`request()` 解包 `payload.code`），422 映射可直接判 `error.code`。
- **录像校验缺口（本任务必须补）**：`web/src/recording/validation.ts` `RANGE_MODES=Set(['preset','latest','bars'])` 不含 `'random'`——随机局 tier='RANGE' 且 range.mode='random'，checkpoint 断言 `assertEnum(range.mode)` 会失败；「记录操作」默认开启，不补则每个随机局记录必失败。服务端 `history-report.ts` 的 `RANGE_MODES` 已含 'random'（M7-01 已备）。
- 历史页 `web/src/views/History.vue` `RANGE_MODE_LABELS` 缺 `random` 键→结算后的随机局显示回退文案「自定义范围」（误导），补 `random: '随机模式'`。
- e2e 惯例（`e2e/training-range.spec.ts`）：`openLauncher` 先清活动训练→`page.route('**/api/data/status**')` mock 为 current→goto `/`→等「数据已最新」；API 断言用 route 拦截或 `page.request` 直调；journey 经 `npm run journey` 起**真实服务＋真实 TDX 数据**（playwright.config 仅在 TRAINER_RUN_MANIFEST 存在时可跑），spec 可动态查 `/api/stocks` 取真实 code。CI（check.yml）只跑 vitest＋build，不跑 e2e。
- 排行榜/历史接口运行中 409（服务端既有守卫），随机局结束前不会出现在这些页面；结束后返回真实信息，前端无需额外遮蔽逻辑。

## 二、UI 契约（组件改动图＋文案表）

### 2.1 首页标签页（Launcher.vue）

```
Launcher
├─ header（创建训练）—— 副文案随标签切换
├─ mode-tabs［新增］role=tablist：经典模式 | 随机模式（默认 classic）
└─ launcher-form（同一表单，控件按 mode×dimension 显隐，实现"复用经典面板"）
   ├─ 股票双框检索      classic:始终 | random: 仅 random_time
   ├─ 训练周期 tier 网格  仅 classic（随机模式无周期档）
   ├─ 起始日（tier 档）  仅 classic && tier!=RANGE
   ├─ 起始日+结束日      classic && tier=RANGE（带自动范围校验） | random && random_stock（无校验，服务端管池）
   ├─ 随机维度［新增］    仅 random：随机股票·我选时间段 | 随机时间段·我选股票 | 全随机
   ├─ 训练窗口长度［新增］ 仅 random && dimension∈{random_time,random_both}：number，默认 250，min 20 max 2000
   ├─ 初始资金           始终（三维度都接受 initial_cash；沿用 defaultsState/dirty 逻辑）
   ├─ 复权/训练时钟/条件单/记录操作  始终（共享，零改动）
   └─ 开始训练           classic→POST /api/trainings（原路径不动） | random→POST /api/trainings/random
```

- 标签切换只改显隐与提交分支；随机模式复用同一表单状态（selected/rangeStart/rangeEnd/initialCash/adjustMode/clockMode/ordersEnabled/recordingEnabled 及 defaults 装配、数据新鲜度守卫全部共享）。
- 随机模式提交校验：random_stock 需起止日且 end≥start；random_time 需已选股票；window_bars 需 20–2000 整数。校验失败行内 `error-text`，不发请求。
- 范围自动校验（preview）逻辑保持**仅 classic RANGE** 触发（`mode==='classic'` 守卫加入 watch/schedule 判定），随机模式不生成 preview。
- `emit('created', { enabled, params })`：random 分支 params＝本次随机创建载荷（录像 createdParams）。

### 2.2 训练页遮蔽呈现（Training.vue）

- 标题：`training.random?.hideStock` 为真→占位「随机标的 · 已隐藏」（proposed_default 文案）；否则维持 `${name} · ${code}`。隐藏态 title 属性同占位文案。
- 徽标［新增］：`training.random` 存在（运行中随机会话）→标题旁「随机模式」小徽标，title 含维度中文名（随机股票/随机时段/全随机）。结算/放弃后服务端不再下发 `random` 字段→徽标自然消失、真实名称顶上（RAND-UI-REVEAL-DISPLAY 的 UI 面）。
- `tierLabel`：range.mode==='random'→`随机窗口 {barCount} 根`（三维度统一；barCount＝服务端记录的窗口根数）。
- 日期类字段（当前日/详情面板起始/计划结束/结算面板）**原样呈现**服务端（已偏移）数据；结算后 settle 响应为真实数据，同样原样呈现。前端不写任何偏移/反偏移逻辑（请求侧去偏移由服务端 preHandler 完成）。

### 2.3 错误呈现（Launcher.vue 提交 catch）

| ApiError.code | UI 文案（proposed_default） |
|---|---|
| `RANDOM_WINDOW_NOT_FIT` | 该股票数据不足以容纳所选窗口，请缩短窗口或换股票 |
| `RANDOM_STOCK_UNIVERSE_EMPTY` | 本地数据中没有满足窗口的股票，请缩短窗口或更新数据 |
| 其余 | 服务端 message 原样（沿经典分支惯例） |

### 2.4 历史页（History.vue）

`RANGE_MODE_LABELS` 补 `random: '随机模式'`——结算后的随机局在历史列表按真实 code/name 显示（服务端已揭晓），档位标签不再误报「自定义范围」。

### 2.5 录像校验（recording/validation.ts）

`RANGE_MODES` 加 `'random'`（形状接受；REC 载荷仍只含浏览器可见的遮蔽态数据——M7-01 拍板项 6 维持）。

## 三、文案表（全部 proposed_default，验收时可改）

| 位置 | 文案 |
|---|---|
| 标签×2 | 经典模式 / 随机模式 |
| 随机模式副标题 | 服务器随机选股或选时段，训练中隐藏对应信息，结算后揭晓 |
| 维度选项×3 | 随机股票 · 我选时间段 / 随机时间段 · 我选股票 / 全随机 |
| 维度选项提示 | 选定时间段内由服务器随机选股（结算前隐藏名称代码）/ 由服务器随机选一段行情（结算前隐藏真实日期）/ 股票与时间段都由服务器随机（双重隐藏） |
| 窗口长度 label/提示 | 训练窗口长度（交易日）/ 默认 250，范围 20–2000；需保证该股票历史足够长 |
| 隐藏占位 | 随机标的 · 已隐藏 |
| 徽标 | 随机模式（title：随机模式 · 随机股票/随机时段/全随机） |
| tierLabel（random） | 随机窗口 N 根 |
| 422×2 | 见 §2.3 |
| 历史档位 | 随机模式 |

## 四、实施计划（阶段③：文件清单＋验证命令）

| # | 文件 | 改动形态 | 验证命令 | 完成判据 |
|---|---|---|---|---|
| 1 | `e2e/random-mode.spec.ts`（新） | 三维度各创建一局（真实服务＋真实 TDX）＋遮蔽态断言＋settle 揭晓断言＋422 映射（route stub）＋经典面板回归抽查 | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/random-mode.spec.ts --retries=0` | 先 RED（标签/维度控件不存在→选择器超时；占位/徽标不存在）后 GREEN |
| 2 | `web/src/api.ts` | 类型补齐（mode 联合加 'random'×3、HistoryRangeMode、`RandomDimension`、`TrainingMeta.random?`）＋`createRandomTraining()` | `npm run build`（vue-tsc） | typecheck 绿 |
| 3 | `web/src/views/Launcher.vue` | mode-tabs＋维度驱动显隐＋随机提交分支＋422 映射 | journey #1 | 新断言全绿＋training-range.spec 抽查不回归 |
| 4 | `web/src/views/Training.vue` | 遮蔽占位＋徽标＋tierLabel(random) | journey #1 | 遮蔽/揭晓断言绿 |
| 5 | `web/src/views/History.vue` | RANGE_MODE_LABELS.random | `npm run build` | typecheck 绿（文案由 §2.4 约束） |
| 6 | `web/src/recording/validation.ts` | RANGE_MODES＋'random' | journey #1（随机局默认记录操作不报记录失败） | 无「记录失败」 |
| 7 | 矩阵 skill 侧＋镜像 | 追加 6 行 RAND-UI-*（planned→covered） | `check-binding --strict --include-untracked` | 任务行闭合，M7-01 12 行不降级 |

顺序：矩阵行（先加 planned）→ e2e spec（RED 亲见）→ api.ts → Launcher → Training → History/validation（GREEN）→ REFACTOR → 门禁。

## 五、歧义处置记录（阶段① 四问）

1. 目标用户行为：首页切「随机模式」标签→选维度→（按维度）选股或选起止日→开始训练→训练页看到占位标的与（偏移后）日期→结算后揭晓真实信息。可观测（选择器/文本断言）。
2. 成功标准：三维度 UI 建局成功＋遮蔽态可见＋结算揭晓＋经典面板零回归＋422 人话提示＋随机局记录操作不失败。
3. 边界：window_bars 越界（客户端拦）；random_stock 无起止日（拦）；random_time 未选股（拦）；hideTime 日期前端不处理（契约：服务端偏移）；结束态 `random` 字段消失（徽标自然退场）。
4. 产品语义拍板项：全部文案（§三）＋徽标是否显示维度名＋tierLabel 随机口径——均为呈现类 proposed_default（先实现后提验）；无行为/语义类歧义需阻断（行为语义已被 M7-01 契约与用户原话冻结）。
