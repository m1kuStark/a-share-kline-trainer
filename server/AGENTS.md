# 后端工作约束

适用范围：`server/**`。在根规则基础上补充以下约束；按 [模块索引](./README.md) 选择正文。

- API 形状、业务错误状态码和中文原因属于调用合约。不能把 T+1 拒单、等待日线等业务响应统一改成 500。
- 修改数据库走 [db.ts](./src/db.ts) 的兼容迁移；不得通过重建表清空既有训练、成交、权息流水或画线。
- 训练查询也可能刷新权息，目录刷新也有独立入口。涉及写入、并发或失败恢复时，先核对 [数据发布](./src/data/docs/publication.md)，不能只检查刷新按钮的调用链。
- 调整交易与行情语义先读 [训练规则](../docs/specs/training/rules.md)；数据源或完整性变更先读 [数据要求](../docs/specs/market-data/requirements.md)。不得用当前缺陷降低规格。
- 后端定向测试从仓库根执行 `npm test -- <测试路径>`；构建用 `npm run build:server`。交付门禁及主代理视觉责任见 [验证协议](../docs/engineering/testing.md)，定向通过不能替代整体门禁。
- 同步维护受影响模块正文与任务卡；测试结果进入验证记录，README 不记通过数量或阶段进度。见 [文档维护](../docs/engineering/documentation.md)。
