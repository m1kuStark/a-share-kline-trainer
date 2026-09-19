# REC-V2-CODEC：审查修正

你是GLM5.3Flash开发Agent，最高思考档。工作树D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/REC-CODEC，基础2f773c9。原17tests/typecheck通过但根审查未通过。只改compactCodec.ts、compact-codec.md、server/test/recording-compact-codec.test.ts；compactTypes.ts和v2合同已冻结，禁止修改（另一个独立Agent正在开发validator）。不要Git提交/合并/push，不其他工作树、不TDX/个人DB/浏览器。

读局部AGENTS及v2合同。按顺序先失败回归、最小修复：
1. restoreTable没有重建byFingerprint：capture→getResources→newBuilder→同capture，meta/account/context由1增2，trade同问题。恢复时重建内容索引。
2. appendSeriesDelta写depth时对恢复父版默认0：已存depth30→恢复→两步实测depth32，validator会拒绝自己文件。父深度必须恢复/计算且计入追加，连续刷新不突破31。
3. internSeries相同bars未知asOf→已知时无条件append空delta，已有31层会到32；同样基础回退。
4. ContentTable指纹桶存canonical完整大JSON重复内存，与合同不符。桶仅持entry/id引用，命中临时规范化比较；恢复走同逻辑。不得为了通过删碰撞复核。
5. A→B→A目前只与链头比较，不复用A。请实现历史完全相同series/drawings内容复用（在asOf/firstCheckpoint许可内），索引不保存全部展开历史或巨型字符串，临时还原比对可复用有界reader/cache。恢复后此索引也正确。若此项需要大改，请先完整修1-4并明确返回余项，不偷偷放松合同。

root额外150checkpoint逆序还原与缓存8已通过，不破坏它。价格/顺序/对象值保真。按“变化大于全量”最终应比较序列化字节而非仅行数，特别带长text的drawings新大对象；如改此点补实际字节例。输入无序画线回退full保顺序。

跑npm test -- server/test/recording-compact-codec.test.ts + npm run typecheck:web，尽量只用2测试worker避免本机资源并发。返回变更和真实结果即停止。
