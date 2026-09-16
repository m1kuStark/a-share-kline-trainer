> 历史快照：2026-09-17 文档迁移前内容。可能含当时的过期表述，不作当前指令；现行入口：[文档索引](../../README.md)。

# 当前开发状态与目录地图

核对日期：2026-09-17。此页作为后续接续开发的状态入口；产品规则见[开发计划](../../开发计划.md)，技术现状见[架构](../../ai/architecture.md)，改进提案见[架构与并行开发建议](../../ai/architecture-parallel-proposal.md)。历史报告保留当时结论，不随此页改写。

## 开发状态

| 阶段 | 当前代码与工程状态 | 验收边界 / 下一步 |
|---|---|---|
| M0/M1/M2 | 已有用户验收记录；M2 冻结基线 `12cba72` | 继续回归；历史 TDX 导出不能证明今天的来源对照通过 |
| M3 | D1～D32、23 种工具及保存、布局、成本、分隔拖拽反馈已实现 | 已有工程与浏览器验证记录；最终用户通过及阶段冻结尚未记录 |
| R0/R1 | 数据尾等待守卫、目录失败保护、TDX 扫描协调器、更新按钮、启动/回前台状态检查已实现 | 待用户验收；完整版本保护和部分结算口径仍有缺口，不能标为计划全部完成 |
| M4 | 已有账户、成交、权益曲线、基础结算 | 完整绩效指标、排行榜、成绩单和复盘页面/API 未实现 |
| M5 | 主题、热键、确认及部分交互打磨已有 | 设置页面/API 未实现；开放设置前先冻结训练规则、核查 raw 显示的权息入账 |
| R2 | 有在线来源扫描注册合约 | 未接真实在线源；训练读取仍依赖 TDX，尚不能脱离 TDX 运行 |

“更新日线”当前检查通达信已下载的本地文件，不执行在线行情下载。启动/激活调用状态检查；不能据此声称每次都会完成全盘扫描。

## 本轮证据

环境：Windows、Node `v24.15.0`、npm `11.12.1`。

| 检查 | 2026-09-17 本轮结果 |
|---|---|
| `npm test` | 30 文件，242/242 通过 |
| `npm run typecheck:web` | 通过 |
| `npx --no-install tsc -p server/tsconfig.json --noEmit` | 通过 |
| `npx --no-install playwright test --list` | 8 文件，57 项；仅列清单 |
| 生产构建、`verify:m1`、`verify:m2`、浏览器及主代理视觉检查 | 本轮未重跑；本轮为审查与文档同步，没有应用代码变更 |

此前 9 月 17 日 R0/R1 交付在 [testing.md](../../ai/testing.md) 记录生产构建、M2 24/24、Playwright 57/57 及视觉排查。当前 `test-results/.last-run.json` 为 passed，但它不含提交和完整用例清单，不能单独充当与某次提交绑定的全量通过证明。上述历史结果不计作本轮新验收。

本轮命令结果摘要保存在 [审查记录](../../verification/architecture-audit-2026-09-17.json)。单测日志原文及压缩缓存位于用户全局 Headroom 缓存；以后正式验收应把结果绑定到提交 SHA 和数据指纹。

## Git 状态

- 当前分支 `m3-complete-tools`，HEAD `43982ea2d0df72162eb078005b57dc624e705cb5`，提交日期为 9 月 8 日。
- 本地 `main` 也指向该提交；当前只有一个 worktree。真实主干名称为 `main`，不存在需要沿用的 `master`。
- 审查开始时有 33 个已跟踪文件修改、133 条未跟踪状态记录（部分为目录）；其后本轮只增加或修改文档。
- M3 后续成果及 R0/R1 不完整地存在于任何已提交基线中。直接从 HEAD 创建新 worktree 会漏掉这些成果。
- 本地 `origin/main` 跟踪指针落后 `main` 一个提交；本轮未 fetch，此信息不代表远端实时状态。
- 本轮未提交、推送、切换分支或创建工作副本。下一次实施并行基础设施时，先整理并验证现有工作树，再形成完整 checkpoint；checkpoint 与用户验收通过要分别记录。

## 实际目录

以下是当前实现，省略普通文件与生成物细目；提议的新目录放在改进方案中，避免混同。

```text
a-share-kline-trainer/
├─ AGENTS.md                         AI 入口与文档路由
├─ README.md                         安装、启动、使用入口
├─ package.json / package-lock.json  单一依赖与命令清单
├─ playwright.config.ts              Edge 旅程，单 worker
├─ server/
│  ├─ src/
│  │  ├─ index.ts / config.ts         启动、端口、数据库和来源路径
│  │  ├─ api.ts / db.ts / drawings.ts API 装配、建表迁移、画线持久化
│  │  ├─ train/
│  │  │  ├─ account.ts               账户计算
│  │  │  └─ engine.ts                训练状态、SQL、行情读取和命令
│  │  ├─ tdx/                        day/gbbq、目录、权息缓存与聚合
│  │  └─ data/
│  │     ├─ source.ts / selection.ts 扫描合约与来源选择
│  │     ├─ tdxSource.ts             TDX 稳定扫描
│  │     ├─ refresh.ts               任务协调、状态与超时
│  │     └─ snapshot.ts              文件状态快照与日志
│  ├─ test/                          30 个 Vitest 文件，含前端纯逻辑/源码契约
│  └─ vitest.config.ts
├─ web/
│  ├─ src/
│  │  ├─ App.vue / api.ts / dataStatus.ts
│  │  ├─ views/Launcher.vue          选股、创建训练
│  │  ├─ views/Training.vue          训练编排、操作栏、工具与保存状态
│  │  ├─ components/KlineChart.vue   图表宿主、交互裁决与库适配
│  │  ├─ drawing*.ts / builtInGeometry.ts
│  │  ├─ drawTools.ts / toolFavorites.ts / chartNavigation.ts
│  │  ├─ TradeMarkerRail.vue / tradeMarkerLayout.ts
│  │  └─ indicators.ts / overlays.ts / theme.ts / styles.css
│  └─ vite.config.ts
├─ e2e/                             global-setup + 8 个 spec
├─ scripts/                         M1/M2 实源核验、成本审计
└─ docs/
   ├─ status.md                     当前状态及目录地图（本页）
   ├─ 开发计划.md / M3-画线工具链-开发计划.md
   ├─ 日线更新与数据源适配-开发计划.md
   ├─ ai/                           架构、规格速查、测试、不变量、历史
   └─ verification/                 验收记录、截图、TDX 导出证据
```

本地还有 `node_modules/`、`server/dist/`、`web/dist/`、`.data/`、`output/`、`test-results/`、`playwright-report/`，均为依赖、数据或生成产物。默认日常数据库并不在仓库 `.data/`，而在用户目录 `.a-share-kline-trainer/trainer.sqlite`；新 worktree 必须显式指定独立 `TRAINER_DB`。

## 本轮确认的接续风险

以下为静态源码与规格核对，未执行故障注入，未修改相关业务逻辑。单测全绿不能覆盖未建模的场景。

| 编号 | 证据与影响 | 下一步验收样例 |
|---|---|---|
| DATA-01 | `data/refresh.ts:135,140,161` 依次刷新目录、权息、文件快照；各自事务提交。后续失败不能回滚已提交目录；返回的 catalog `failures` 也未检查 | 目录发生变化后权息读取失败，所有已发布表仍保持同一旧版本；超时任务不能迟到发布 |
| DATA-02 | `train/engine.ts:445` 用全市场最大日期推断个股缺线可结算，与日线计划 §3 的“不以全市场最大日期单独证明完整”冲突 | 其他股票已更新，目标股票工作日漏数：保持 running 等待，不能按停牌自动结算；另测结束日后有记录但区间漏数 |
| DATA-03 | `data/source.ts` 只按文件 size/mtime/末日检测；末日前移即计 added。追加同时改写旧值可能漏报；未保存可读旧版行情和权息 | 纯追加、追加并改写旧值、权息修订、文件删除分别检测；旧训练读取原版本或明确阻断 |
| DATA-04 | `DailySource` 只有扫描能力；引擎仍直接读 TDX，`/api/env`/stocks 有独立缓存刷新入口 | 通过统一读取合约运行非 TDX 夹具；查询不绕开版本发布流程 |
| TRAIN-01 | 每笔交易读取全局 fees/T+1；权息入账受 forward 显示模式控制 | 修改默认设置不改变旧训练；raw/forward 账户权益相同 |
| DEV-01 | 8791 固定端口、默认个人库、生产/journey 共用 web/dist、固定报告目录 | 两个隔离工作副本同时测试，互不占端口、改库、覆写产物或误连服务 |

建议先完成可追踪基线与 DEV-01，随后处理 DATA-01/02；版本保护、合约与图表适配分批进行。M4 应消费稳定账户与数据口径；M5 设置应等待 TRAIN-01；R2 应等待训练读取合约和版本保护。
