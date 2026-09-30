# 当前数据流

本页按 `wt/integration/v1@9fd5070` 的 V1.0 源码候选说明（2026-09-30），不代表 main 或旧安装包已包含相同能力。跨工作树核对记录在主仓库的 `docs/verification/2026-09/DOC-03-state-audit/report.md`。

TDX只读文件→tdx解析与目录/权息缓存→train账户/训练→Fastify API→Launcher/Training→KlineChart交互。data扫描协调器管理状态，仍未统一所有读取/更新入口。

训练行情先截断→以推进日为基准前复权→聚合，首批最多1040根。[DATA-04](../work-items/tasks/DATA-04.md) 已让训练/结算通过 `MarketDataReader` 读取 bars/actions/coverage/version；TDX 读取器仍读取现势文件与当前权息缓存。普通 `/api/kline` 直读、路由级 TDX 根目录守卫与 env/stocks 独立刷新尚未统一；真实替代来源未接入。

SQLite保存settings、stocks、adj_factors、cache_meta、trainings、trades、equity_curve、position_events、drawings、data_file_state、data_refresh_log。db.ts目前用幂等补列迁移。

画线历史→本地outbox→串行PUT→drawings；加载失败不能空写覆盖。HTTP错误保留中文；运行中原始行情接口409，不能泄露未来。

[DATA-01](../work-items/tasks/DATA-01.md) 已在协调器路径实现同事务整批发布目录、权息、文件状态、成功日志与批次标识，失败整体回滚、超时迟到结果不能提交；独立刷新仍为单域入口，不共享协调器批次，详见[发布边界](../../server/src/data/docs/publication.md)。

[DATA-03](../work-items/tasks/DATA-03.md) 增加内容指纹、刷新后的市场版本账本和按需保存/读取旧版行情原语，版本数据置于独立侧车库。训练链尚未调用旧版保存/读取原语，`MarketDataReader` 也未选择保留版本，因此不能保证旧训练可恢复并继续使用旧行情，模块存在不等于完整历史保护。

历史/成绩单/五档排行为只读查询，运行中训练存在时历史与排行接口拒答；K 线只允许该运行中训练自身，防止复盘泄露其未来。应用偏好与 TDX 路径路由已注册、设置面板已接入；这一接线晚于 e27885e 旧人工验收包，源码事实不自动更新该包。

API/迁移/全局样式/锁文件/图表入口属于共享修改点。工作副本及候选由Git工具管理，Agent预览/Journey按run隔离数据库、实际绑定端口及产物；现行命令见[并行开发](../engineering/parallel-development.md)。业务数据版本保护仍独立于运行隔离。
