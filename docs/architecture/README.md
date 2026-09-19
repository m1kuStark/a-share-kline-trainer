# 跨模块架构

当前为模块化单体：Node24/TypeScript/Fastify/SQLite＋Vue3/Vite＋klinecharts10.0.3。

- [数据流](data-flow.md)：HTTP、账户、来源和画线关系。
- 模块细节：[后端](../../server/README.md)、[前端](../../web/README.md)。
- [文档架构决定](../decisions/0001-documentation.md)：已接受并实施。
- [并行开发协议](../engineering/parallel-development.md)：已实施的工作副本、独立运行与候选门禁。
- [进一步业务重构](../proposals/engineering-parallel.md)：模块拆分与数据版本化仍为提案。
