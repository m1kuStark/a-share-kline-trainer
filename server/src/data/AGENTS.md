# 数据更新工作约束

适用范围：`server/src/data/**`。先从 [索引](./README.md) 选择发布或来源合约。

- `DATA-PUBLISH-ATOMIC` 是目标约束，当前整批发布尚有缺口。必须区分文件快照事务与目录、日线、权息的整批一致性，不能沿用源码注释或提示语宣称“全部旧数据保留”。详见 [发布边界](./docs/publication.md)。
- 来源扫描任一文件失败须报告失败，不返回部分成功集合。删除缓存只依据成功且完整的扫描；目录不存在与暂不可读必须区分。
- `sourceMaxDate` 是全市场最大日期，`needsUpdate` 是更新提示；两者都不能证明目标股票完整覆盖训练区间。结算约束见 [数据要求](../../../docs/specs/market-data/requirements.md)。
- `DailySource` 目前只提供可用性和扫描接口。新增来源不得宣称训练已脱离 TDX 路径；读侧缺口见 [DATA-04](../../../docs/work-items/tasks/DATA-04.md)。
- 修改失败、超时或并发行为时，验证后置失败、迟到写入及独立刷新入口。局部任务合并不能代替全局发布屏障，见 [DATA-01](../../../docs/work-items/tasks/DATA-01.md)、[DATA-04](../../../docs/work-items/tasks/DATA-04.md)。
- 定向检查从仓库根运行 `npm test -- server/test/data-refresh.test.ts server/test/catalog-protection.test.ts`；涉及 TDX 缓存时补相应测试。交付规则见 [验证协议](../../../docs/engineering/testing.md)。
