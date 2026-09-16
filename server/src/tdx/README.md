# 通达信数据适配

本目录处理本地 TDX 目录发现、代码与名称、股票缓存、二进制日线、权息解密和行情聚合。调用方仍直接使用这些函数，尚无覆盖全部读写的统一数据版本层。

| 任务 | 先读 | 实现入口 |
|---|---|---|
| 查路径、代码或二进制字段 | [格式与目录](./docs/formats.md) | [discover.ts](./discover.ts)、[symbol.ts](./symbol.ts)、[dayfile.ts](./dayfile.ts) |
| 修改名称或市场缓存 | [格式与目录](./docs/formats.md) | [names.ts](./names.ts)、[stocks.ts](./stocks.ts)、[catalog.ts](./catalog.ts) |
| 修改权息解密、复权或缓存 | [权息与复权](./docs/adjustment.md) | [gbbq.ts](./gbbq.ts)、[adjustment-cache.ts](./adjustment-cache.ts) |
| 修改周/月聚合或均线 | [格式与目录](./docs/formats.md) | [kline.ts](./kline.ts)；训练调用补读 [生命周期](../train/docs/lifecycle.md) |
| 修改失败保留、超时或发布事务 | [数据发布](../data/docs/publication.md) | 先核对 [data](../data/README.md) 的协调器与独立刷新入口 |

产品完整性要求见 [数据规格](../../../docs/specs/market-data/requirements.md)，跨模块关系见 [架构](../../../docs/architecture/README.md)。真实 TDX 对照验证见 [scripts](../../../scripts/README.md)，本目录不把历史验证数字当作当前通过结果。
