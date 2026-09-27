# 训练引擎工作约束

适用范围：`server/src/train/**`。产品定义以 [训练规则](../../../docs/specs/training/rules.md) 为准；实现索引见 [README](./README.md)。

- `TRAIN-NO-FUTURE`：可见行情必须先按推进日截断，再以推进日为基准复权，最后聚合。首次与历史分批加载走同一条构建链，不能借普通行情接口绕过。
- 账户重放必须合并成交与 `position_events`：日期升序、同日权息先于交易、同类按 seq。配股实际缴款计入 `cost_delta`；旧 NULL 仅在股数和现金均匹配时恢复，不能改写旧流水。
- B/S 用 `chartPrice` 进入图表空间；当前成本来自含权息的账户，禁止仅重放历史复权买价和原成交股数。细节见 [账户与成本](./docs/accounting.md)。
- 无下一根不等于自然到期。不得把全市场尾或仅个股尾日期当作完整性证据；现有差距见 [DATA-02](../../../docs/work-items/tasks/DATA-02.md)。已 settled 的训练不得重开或延长。
- 规则快照已随 TRAIN-01 交付：费用/T+1 读本局 `rules_json` 快照（`trainingRulesOf`），默认 API 在 `server/src/settings/training.ts`；raw 与 forward 新训练都经 `applyPositionEvents` 入账权息；legacy raw（`legacy-raw-unverified`）交易/推进/结算 409。推进 await 后短事务重查状态/日期（409 `TRAIN_STATE_CHANGED`）。修改时先核对 [训练规格](../../../docs/specs/training/rules.md) TRAIN-RULE-SNAPSHOT 与 [TRAIN-01](../../../docs/work-items/tasks/TRAIN-01.md)，不得把后续扩项（费率编辑、TRAIN-03 两阶段等）写成已实现。
- 定向检查从仓库根运行 `npm test -- server/test/train-account.test.ts server/test/train-engine.test.ts server/test/rights-cost-basis.test.ts server/test/chart-cost-basis.test.ts`；接口与整体门禁见 [验证协议](../../../docs/engineering/testing.md)。
