# TRAIN-02 修复：并发双创建与权息字节指纹（GPT-WAKE-02）

2026-09-26，worktree `task/TRAIN-02-integration`。代码提交 11eef7a（本报告所在文档提交之前）；门禁在该提交树上复跑确认。依据 GPT 裁决 control-handoff-20260926-05 附带集成人审查（GPT-WAKE-02 `integrator-review-20260926.md` TRAIN-02 节两项 P2，存于主工作区，本工作树外）；先独立复现（RED）再修复，未机械照抄结论。

## 缺陷一：并发双创建（已修复）

复现：同一 previewId 两次 `Promise.allSettled` 创建均 201，running=2；旧tier路径同样竞争。原因：`createTraining`/`createRangeTraining` 在 async 读取前检查 running，落库前不重查；训练行与初始权益分属两条独立语句。

修复：新增 `commitTrainingCreation` 共同提交边界——全部异步读取完成后 `BEGIN IMMEDIATE` 取写锁，同步段内重查"单活动训练"，训练行与初始权益同事务提交，任一失败（含测试注入的 equity 触发器 ABORT）整体 ROLLBACK。旧tier与范围模式路径共用；原先的提前 running 检查删除，避免假成功。

## 缺陷二：权息快照指纹可过期（已修复）

复现：sh600519 合成 gbbq 记录（rightsShares=0，明文尾 4 字节即 float32）改 rightsShares→1、保留 size 与 mtime，派生 m 1.1→1.2；重预览指纹不变、旧 token 创建仍 201。原因：指纹事件来自 stat 缓存的 `adj_factors`，`scanAdjustmentChanges` 以 size:mtime 判定"无变化"即跳过。

修复：`readRangeSnapshot` 直接 `readFile` gbbq 字节并经 `parseGbbqBuffer` 解码目标股票事件（按日期排序）参与指纹；不再读 DB 缓存。`ensureAdjustmentCache` 照常执行维护缓存本身；训练引擎复权与缓存一致性问题属全局复权规则，本修复未扩大（审查明示允许的最小范围）。tdx 侧仅新增 `gbbqFilePath` 路径公式导出，供缓存扫描与字节快照共用。

## 事实

- RED 先行：4 项新回归在实现前全部失败（同 token 并发×2、旧tier并发、回滚、gbbq 字节过期），16 项既有通过；实现后 20/20。
- gbbq 明文尾（记录第 25–28 字节）为 rightsShares float32，改字节无需实现加密器；两条变体尺寸相同且均可被解码器接受。
- 测试内显式断言改写后 size 与 `mtime.toISOString()` 与改写前一致，保证 RED/GREEN 差异来自修复而非 stat 恢复失败。
- 事务边界依赖单连接同步执行：`BEGIN IMMEDIATE`→重查→INSERT→COMMIT 无 await，事件循环内原子；`refreshAdjustmentCache`/`refreshStockCatalog` 的事务均在各自函数内闭合后才进入创建边界。

## 门禁记录

命令与退出码见 [checks-wake02.json](checks-wake02.json)。定向（range/engine/preview）+ v1/v2 录像回归共 22 文件 424 项在 11eef7a 树上通过；全量 878 项在实现后、提交前工作树（内容与 11eef7a 一致）通过。`npm run build:server` 通过。

后续：新范围录像的录制/回放兼容仍属第二片（审查同节确认旧tier枚举拒绝新 RANGE 录像为第二片未完成，非旧录像回归缺口）；Launcher 预览失效守卫等集成待 DATA 冻结提交后串行。
