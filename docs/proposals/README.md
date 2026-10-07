# 提案与实施计划

- [主图均线参数设置](ma-settings.md)：固定八条周期/颜色、日周月共用配置；实施及验证见 MA-01。

- [自适应强弱模型协作](adaptive-model-routing.md)：先交付合同与影子路由，再接独立验证、派发和分类审查。

- [首次接入与首页反馈批次计划](first-use-batch.md)：历史拆分计划；首批模块与运行接线已进入 V1 候选，后续用户反馈改为起止日期及主动目录选择，不能按旧清单重复派发。
- [v0.4 训练时钟、条件单与成交理由设计](v0.4-training-clock-orders-notes.md)：将日线拆为 open/close 阶段，加入单价格条件单和可回放理由；尚未实现。
- [首次接入与通达信发现](tdx-onboarding.md)：保留已接受的历史方案；自动发现和三步向导已被用户主动确认 Windows 原生目录的流程替代，现行步骤见[安装指南](../user/install.md)。
- [操作录像机与自动验收](session-recorder/README.md)：历史设计；录制与只读回放已交付，自动业务重放等后续目标须区分。现行规则见[录制规格](../specs/recording.md)。

- [工程架构及并行开发建议](engineering-parallel.md)：工作副本和候选集成已实施（DEV-01）；共享合约、图表适配层及来源版本等仍有未落地部分。现行协作步骤见[并行开发协议](../engineering/parallel-development.md)。
- [并行实施细节](parallel-development.md)：目标运行隔离、任务所有权与候选集成步骤。
- [GPT 与 GLM 协作框架改进](zcode-orchestration-v2.md)：目标架构与落地顺序；统一文件状态、CLI 与适配已有候选实现，余下边界和验收以[ORCH-STATE-01](../work-items/tasks/ORCH-STATE-01.md)及[控制循环](../engineering/controller-loop.md)为准，不代表公开发布。

文档治理设计已接受并实施，现行规则见[工程协议](../engineering/README.md)，原稿移入[历史](../archive/2026-09/documentation-proposal/README.md)。提案描述目标，不代表当前实现或用户已验收。
