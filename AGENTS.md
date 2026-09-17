# K线训练器：Agent入口

Vue3＋Fastify＋Node24/SQLite独立工程。先确定任务，再沿模块逐级读取，不默认读全量历史。

## 全局边界

- 通达信目录只读；开发/测试显式使用独立TRAINER_DB，个人训练库不能作夹具。
- T+1、整手100股、当日收盘成交、买入仓位按总权益。训练先截断至推进日，再前复权、聚合，禁原始行情旁路。
- 红涨绿跌、阳空阴实；klinecharts钉定10.0.3。内部依赖维护[登记表](web/src/components/docs/library-adapter.md)。
- 规格目标与实现缺口分开，已结算训练不自动重开；待修项见[任务](docs/work-items/README.md)。
- 保留其他改动；Agent只写任务分配范围，共享接口和全局状态由集成人协调。

## 按任务读取

| 任务 | 入口 |
|---|---|
| 接续、阶段、验收 | [状态](docs/status.md) → 对应任务/阶段卡 |
| 产品规则 | [规格](docs/specs/README.md) |
| 后端、账户、行情 | [server规则](server/AGENTS.md) → [模块索引](server/README.md) |
| 前端、图表 | [web规则](web/AGENTS.md) → [模块索引](web/README.md) |
| 浏览器测试 | [e2e规则](e2e/AGENTS.md) → [套件索引](e2e/README.md) |
| 文档 | [docs规则](docs/AGENTS.md) → [索引](docs/README.md) |
| 跨模块设计 | [架构](docs/architecture/README.md)；未实现设计在[提案](docs/proposals/README.md) |
| 模型委派 | [Z code／GLM协作](docs/engineering/model-delegation.md)：小任务、1M上下文与最高支持思考设置；先验证接口 |

改文件前读取其路径适用的局部AGENTS，不依赖客户端自动加载。局部规则不得放松父级硬边界。

## 交付责任

1. 建立或接续[任务卡](docs/work-items/README.md)，记录范围、基础提交、依赖、下一步和文档影响。
2. 行为变化补有效回归，同步规格/实现说明；bug原因和回归归入任务，不向旧长日志追加。
3. 按[测试门禁](docs/engineering/testing.md)执行；功能/bug交付由主代理做真实UI/UX检查，子代理报告不能代替。
4. 证据关联提交/数据范围，集成人更新摘要。M3整批自验后交用户验收，不逐工具停机；测试不等于用户阶段验收。
5. 运行docs:check、docs:impact；任务/阶段变化后docs:status，提交前检查生成摘要。

启动命令见[README](README.md)、[脚本](scripts/README.md)。仅追溯时读[归档](docs/archive/README.md)。
