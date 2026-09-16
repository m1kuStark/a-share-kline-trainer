# 工程脚本

从仓库根运行。TDX只读，运行数据库不得指向个人训练库。

| 命令 | 输入/输出与副作用 |
|---|---|
| docs:check | 当前Markdown与任务卡；检查链接/锚点/ID/引用，历史引用警示 |
| docs:impact -- --base SHA --task ID | Git基线、工作树及untracked；检查允许路径和文档更新声明 |
| docs:status / -- --check | 任务/阶段卡；生成status标记区或只检查是否过期 |
| verify:baseline | 文档、单测、构建、M2、Journey；finally恢复生产web产物 |
| verify:m1 | 单测/构建＋真实TDX对照；覆盖固定M1报告路径，事先保存历史 |
| verify:m2 | 单测/构建＋真实账户闭环；覆盖固定M2报告路径 |
| tsx scripts/audit-training-cost.ts ID before或after | 内存核对指定历史流水，特定样本模型，不能泛化成所有配股验证 |

docs工具由 `docs.ts` 入口及 `docs/` 模块组成，行为回归在server/test/docs-tooling.test.ts。不新增依赖。

大型验收当前先在隔离副本运行，所有日志/截图归本次run，选定证据再收入docs/verification。基线命令不检查M1原生导出是否新鲜，应单独执行并报告；文档影响核对需显式任务和基础SHA，不能省略。

实现细则见[更新协议](../docs/engineering/documentation.md)、[测试门禁](../docs/engineering/testing.md)。
