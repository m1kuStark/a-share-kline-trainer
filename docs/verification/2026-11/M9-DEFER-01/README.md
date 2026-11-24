# M9-DEFER-01 隔离说明

用户于 2026-11-24 明确表示目前无法人工验收，要求 M9 留分支、不进入主线。`task/M9-ACCEPT-HOLD` 已由远端 readback 核实指向 `fe0989736ebf7428deb6dafcf1dbba992c2b50dc`，包含原 C2 工程证据。原始 ZIP 及其 SHA 不变；未验收、未授权发布。

隔离 PR 从同一提交切出，移出引擎、产品 API/CLI、UI、图表挂载、三示例和专属测试。旧预览标签仍指向原始提交，本 PR 不改写历史。现有 SQLite 公式表不 DROP、不迁移、不写入；新数据库不创建该表。录像 gzip 排空、取消生命周期、来源隔离测试、Windows 验收启动脚本与 minimatch 修复均保留；训练、交易、内置 MA/MACD/KDJ、区间测量不是 M9。

验收返回时用原 C2 包；认可后，在届时的 `main` 上新开恢复 PR，反向应用本次撤出差异、适配其后维护，重新核对 DB、回放、完整候选和 Windows 包。由于候选本来就是主线祖先，直接 merge 留存分支不会恢复功能。

本轮 RED：在改产品前，真实 Fastify / SQLite 两例失败，GET /api/formulas 实际返回 200，首次 migrateDatabase 会创建 formulas。撤出后同样测试两例通过；已另行运行生产构建。全量测试与浏览器检查分别记账；旧候选的 262/262 不能复用于本次产品撤出。
