# 架构、文档与并行开发建议

日期：2026-09-17。状态：**业务架构重构提案，尚未实施**。文档治理已单独实施，现行规则见[工程协议](../engineering/README.md)；本页的目标代码目录及共享合约仍为建议，当前状态见[任务摘要](../status.md)。

2026-09-18更新：Git工作副本、候选集成和独立运行层已由DEV-01落地，实际用法见[并行协议](../engineering/parallel-development.md)。本页相关条目保留设计背景，不再作为待实施状态来源。

## 1. 设计判断

保留 Vue 3＋Fastify＋SQLite 的模块化单体。当前规模适合在同一仓库中明确职责、收紧数据入口、隔离测试资源。最高收益来自减少共同修改面和使每次合并可复现。

用户提出的“小功能分支 → 独立测试 → 顺序合并 → 集成验收”方向可行，需要补上三点：分支配独立 worktree；数据库/端口/构建产物同步隔离；先验证含最新主干的合并候选，通过后再推进 `main`。Git 自动合并成功只证明文本可拼接，不能证明交互和交易语义正确。

## 2. 工程架构的改进顺序

| 优先级 | 改进 | 具体边界与验收 |
|---|---|---|
| 首批 | 数据发布与结算口径 | 先修 status 中 DATA-01/02；准备目录、权息和日线版本后短事务发布，个股缺线不能由其他股票末日证明为停牌 |
| 首批 | 开发与测试运行隔离 | 完成 DEV-01，让工作副本的数据库、端口、服务身份、静态目录、结果目录明确可查 |
| 下一批 | 统一行情读取与版本保护 | 引擎通过 `MarketDataReader` 读取 bars/actions/coverage，绑定已发布版本；TDX adapter 保行为，旧版可读或明确阻断 |
| 下一批 | API 合约单一来源 | `shared/contracts` 仅放 DTO、枚举、schema；Fastify 验证边界，前端复用类型。schema/tsconfig/构建入口一并验证 |
| 下一批 | 图表库适配层 | klinecharts 私有调用集中到 adapter，公开 clearSelection、completePolyline 等业务操作；继续钉定 10.0.3 |
| 分批 | 交互与视图拆分 | 从 KlineChart/Training 抽可测试模块；事件优先级仍只有一个裁决入口，先抽取保行为再加功能 |
| M5 前 | 训练规则、命令与迁移 | 规则快照、raw/forward 权息一致；命令按训练串行＋短事务，数据库约束防重复活动训练；必要时加幂等键/版本检查 |

`KlineChart.vue` 当前约 1049 行，`Training.vue` 565 行，`engine.ts` 533 行，`api.ts` 297 行。行数只是定位责任集中的线索；真正需要拆的是生命周期、交互裁决、持久化、库适配和领域计算这些不同变化原因。

### 数据层

建议流程为：**读取稳定内容 → 校验/比较修订 → 保存不可变内容版本 → 短事务发布目录、权息、版本指针与成功日志**。不要跨异步磁盘读取持有 SQLite 写事务；发布失败留下的未引用内容可之后回收。TDX 始终只读。

当前文件状态快照不能复现历史行情。仅保存哈希也不够，还需要哈希对应的原始字节或标准化记录可读取。追加数据可以沿版本链继承已验证前缀，修订分叉；训练固定既有历史，推进时显式消费兼容追加版本。旧训练迁移只能建立“迁移时保护基线”，无法证明它等于创建时行情时应标记待核对，保留原流水。

`MarketDataReader` 建议提供 `getBars`、`getCorporateActions`、`getCoverage` 与版本标识。覆盖证明必须区分来源日期、交易日历、个股停牌和完整性；“全市场有股票更新了”不足以证明目标股票没有漏数。读 API 读取已发布状态；所有更新路径统一进入协调器。

### 图表和前端

按职责抽取的目标结构：

```text
shared/contracts/                   HTTP DTO/schema；禁止依赖 Vue、SQLite
server/src/
  routes/                           training/data/drawings/environment
  train/                            account、commands、queries、repository
  data/
    providers/                      TDX、后续真实在线来源
    publication/                    稳定读取、修订、版本发布
  db/migrations/                    有版本的迁移、兼容升级
web/src/
  app/                              页面装配、导航
  features/
    training/                       session、交易控制
    drawings/                       history、outbox、保存状态
    tools/                          工具面板与收藏
    data-status/                    检查、刷新、状态展示
  chart/
    runtime/                        klinecharts 适配、私有能力清单
    interaction/                    唯一交互裁决器
    viewport/                       缩放、历史载入、坐标投影
    geometry/                       绘制与命中共用几何
```

依赖方向：页面装配 → 功能控制器 → 领域逻辑/端口；图表适配器实现图表端口。后端 HTTP → 应用命令/查询 → 账户与数据端口 → SQLite/TDX 实现。共享合约不能反向导入服务端 SQL 类型。

先抽稳定边界，分几次小提交完成。KlineChart 的 capture/bubble、分隔条优先级、绘图/多选/轴缩放互斥仍由唯一裁决器控制，不让各 composable 自行注册竞争监听器。迁移期间由一人负责宿主接线，其他任务只实现已约定模块。

### 测试结构

保留现有单测、真实旅程及 TDX 手算核验。逐步把依赖变量名和源码排列的正则检查换为纯模块行为测试、组件状态测试；版本钉定、禁止未来 API、私有调用白名单仍适合静态断言。先补等价行为覆盖再移除旧断言。

固定夹具负责可复现门禁：OHLC、权息、时间、随机种子、SQLite schema 均固定。真实 TDX 负责来源对照与本地兼容，单独记录来源范围和指纹。不要让本地文件每天增长造成普通 CI 随机变红，也不能用夹具通过冒充实源核验通过。

## 3. 文档治理已单独实施

用户已接受此部分的后续详细设计。现行规则见[工程协议](../engineering/README.md)和[决定0001](../decisions/0001-documentation.md)，不再在此重复维护。其余工程重构仍为建议。

## 并行开发

具体隔离与集成方案见[并行开发提案](parallel-development.md)。
