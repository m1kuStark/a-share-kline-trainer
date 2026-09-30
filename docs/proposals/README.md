# 提案与实施计划

- [自适应强弱模型协作](adaptive-model-routing.md)：先交付合同与影子路由，再接独立验证、派发和分类审查。

- [首次接入与首页反馈批次计划](first-use-batch.md)：v0.3.2已交付首批底层模块与录像入口修订；数据接线、首次接入、创建范围和受控退出仍待开发。
- [v0.4 训练时钟、条件单与成交理由设计](v0.4-training-clock-orders-notes.md)：将日线拆为 open/close 阶段，加入单价格条件单和可回放理由；尚未实现。
- [首次接入与通达信发现](tdx-onboarding.md)：设计已接受，自动发现、目录选择与三步引导尚未实现。
- [操作录像机与自动验收](session-recorder/README.md)：历史设计；录制与只读回放已交付，自动业务重放等后续目标须区分。现行规则见[录制规格](../specs/recording.md)。

- [工程架构及并行开发建议](engineering-parallel.md)：工作副本和候选集成已实施（DEV-01）；共享合约、图表适配层及来源版本等仍有未落地部分。现行协作步骤见[并行开发协议](../engineering/parallel-development.md)。
- [并行实施细节](parallel-development.md)：目标运行隔离、任务所有权与候选集成步骤。
- [GPT 与 GLM 协作框架改进](zcode-orchestration-v2.md)：把 GPT 决策、GLM 实现和 zcode 自动验证统一到版本化契约、事件账本与候选门禁；当前为 V1.0.3 试点提案，尚未自动化实施。

文档治理设计已接受并实施，现行规则见[工程协议](../engineering/README.md)，原稿移入[历史](../archive/2026-09/documentation-proposal/README.md)。提案描述目标，不代表当前实现或用户已验收。
