# 画线历史、保存与恢复

本页解释 `DRAWING-PERSISTENCE` 的当前实现；保存上限、工具行为等产品要求见 [交互规格](../../../../docs/specs/chart/interaction.md)。链路为：KlineChart → DrawingHistory → Training → DrawingOutbox → SerialDrawingSaver → drawings API/SQLite。

## 对象与本地历史

[drawingState.ts](../../drawingState.ts) 只序列化已完成的用户图形，排除 `bsMark`、`costLine` 和未完成取点。每个锚点仅保留有限数值的 `timestamp + value`，不能保存 `dataIndex`；动态补历史与周期切换后仍以时间定位。窗格保存 `candle_pane`、`VOL`、`MACD` 语义名，恢复时映射回库当前 pane id。

序列化按 id 排序，避免库 hover 重排被误记为编辑；样式与 extendData 深拷贝。DrawingHistory 记录创建、编辑、拖拽、删除后的快照，最多保留 100 个状态；新编辑截断 redo 分支，相同快照不入历史。恢复期间禁止把自身恢复动作记成新编辑。

未确认文本不得进入保存集合。折线恢复调用与右键结束相同的 `forceComplete` / `progressOverlayComplete` 路径，详见 [库依赖](./library-adapter.md)。引擎成本线与交易标记不参加用户历史，也不可选中、拖动。

## 读取和写入

[Training.vue](../../views/Training.vue) 先 GET 远端 drawings，再读本机 outbox；本地待保存副本优先恢复并重新进入保存链。两者任一读取失败都显示加载失败，保持绘图禁用，不能用空集合覆盖旧线。

每次图形改变同步写 localStorage，递增 `drawingRevision`，在 1200ms 防抖后 flush。保存请求对对象深拷贝，由 SerialDrawingSaver 串行 PUT；前一个请求失败不会让后续请求永久阻塞。响应成功后，仅当 revision 仍等于发出时的值才清除 pending 并显示“已保存”。失败保留待保存内容和错误供重试。

[DrawingOutbox](../../drawingOutbox.ts) 的 key 是 `trainer.drawings.<trainingId>.<createdAt>`，避免训练 id 复用串线。`acknowledge(snapshot)` 只在当前存储内容与已确认快照完全一致时删除，旧请求成功不能删掉后来编辑。非法 JSON、无效锚点等恢复数据抛错，不静默当空。

localStorage 写入失败会显示“本地备份失败”；这时不能声称已具备关页恢复保障。服务端保存仍可继续，最终失败原因保留在界面。

## 离开页面

- `pagehide` 设置 closing 并尝试 flush；`visibilitychange` 进入 hidden 也尝试 flush。
- closing 且序列化 UTF-8 数据小于 60,000 字节时启用 fetch keepalive。浏览器额度仍可能限制送达，大副本依靠已写入的 outbox 在重开后恢复，不能把 pagehide 当提交保证。
- 主动返回首页先等待 flush，失败则留在当前页。卸载清保存计时器、尝试 flush，并移除 pagehide/visibilitychange；App 以训练 id 重建组件。

待保存、保存中、失败、重试、成功只更新固定保存栏，不改变工具区和账户区几何或 scrollTop。常用工具偏好由 [toolFavorites.ts](../../toolFavorites.ts) 单独维护，与训练画线存档分离。

服务端按 training_id 保存至 SQLite，限制为 256 KiB、500 个对象、单对象 256 锚点。存量表只增补 updated_at 列，未知旧时间保留空串，真实 PUT 后更新；不得为了迁移删旧线或重建旧表。

回归入口：[drawing-state](../../../../server/test/drawing-state.test.ts)、[drawing-outbox](../../../../server/test/drawing-outbox.test.ts)、[m3-tools](../../../../e2e/m3-tools.spec.ts)、[m3-feedback](../../../../e2e/m3-feedback.spec.ts)。测试需覆盖保存竞态、损坏恢复副本、远端加载失败和旧库兼容；历史通过记录见验证目录，不代表新变更已经验证。
