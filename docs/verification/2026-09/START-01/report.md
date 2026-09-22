# 首页反馈诊断与计划记录

2026-09-22，源码基线d75da88aad28d316a481a009554bc877977ca186。只读现场为用户正在使用的http://127.0.0.1:8787/；未切换服务、创建训练或执行刷新。现场未暴露可核对的构建SHA，不能断言运行包等于本地HEAD。

## 事实

- 主代理通过真实浏览器读取页面：顶栏“数据已最新 · 截止 2026-09-21”，默认起始日2026-09-22，侧栏录像及首页横栏同时存在。
- 22:49（Asia/Shanghai）GET /api/data/status返回idle、needsUpdate=false、reason“当前数据已达到最新（截至 2026-09-21）”、sourceMaxDate=2026-09-21，lastCheckedAt=2026-09-21T15:27:38.843Z。只摘取状态字段，未收录本机目录或个人数据。
- 源码server/src/data/refresh.ts中lastWeekdayBeforeToday始终先减一天，再跳周末；getStatus直接用该日期比较lastSuccess.sourceMaxDate。Node/tsx纯函数探针输入2026-09-22T16:00:00+08:00，输出2026-09-21，退出码0。说明盘后状态错误与该算法一致；尚未修复。
- web/src/App.vue用!needsUpdate及source.available映射绿色“数据已最新”。扫描结果、市场新鲜度及个股覆盖未充分区分。现有测试只覆盖“今天之前工作日”，未覆盖收盘时刻/节假日。
- web/src/views/Launcher.vue起点直接取new Date().toISOString().slice(0,10)，周期按钮只赋tier；既无联动，也有UTC日期在上海凌晨落后一天的风险。server/src/train/engine.ts仅支持五档，取请求日及之前最后一根作为起点，再加自然月；没有两种新模式和创建前完整范围预览。
- 录像页本身已有历史和导入能力；首页横栏与侧栏重复，去重时须更新依赖横栏的既有e2e。新范围还影响录像tier枚举校验，不能只增加前端按钮。

## 处理

用户已接受接入方案，见[设计决定](../SETUP-design-acceptance/record.json)。新增[批次计划](../../../proposals/first-use-batch.md)及DATA-05/TRAIN-02/UI-02任务；SETUP-01更新为设计获接受、待实施。当前只提交文档，不声称bug修复或新功能交付；v0.3.1包和运行实例均未改动。

独立审查代理因429未返回结果；主代理已独立完成上述源码、纯函数与真实页面核对，未将子代理任务算作通过。

文档命令及范围见[checks.json](checks.json)。本轮无生产代码变更，不重跑全量业务门禁；实施后的验收要求见各任务及批次计划。
