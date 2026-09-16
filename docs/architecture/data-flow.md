# 当前数据流

TDX只读文件→tdx解析与目录/权息缓存→train账户/训练→Fastify API→Launcher/Training→KlineChart交互。data扫描协调器管理状态，仍未统一所有读取/更新入口。

训练行情先截断→以推进日为基准前复权→聚合，首批最多1040根。引擎仍直读TDX；扫描合约不是训练来源合约，[DATA-04](../work-items/tasks/DATA-04.md)待实现。

SQLite保存settings、stocks、adj_factors、cache_meta、trainings、trades、equity_curve、position_events、drawings、data_file_state、data_refresh_log。db.ts目前用幂等补列迁移。

画线历史→本地outbox→串行PUT→drawings；加载失败不能空写覆盖。HTTP错误保留中文；运行中原始行情接口409，不能泄露未来。

文件快照＋日志事务不等于全部数据原子发布，[DATA-01](../work-items/tasks/DATA-01.md)未修复；旧行情版本保护见[DATA-03](../work-items/tasks/DATA-03.md)。

API/迁移/全局样式/锁文件/图表入口属于共享修改点。当前没有工作副本启动器、端口自动分配或生产与journey永久构建隔离；[DEV-01](../work-items/tasks/DEV-01.md)待实施。
