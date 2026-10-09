# v2 文件封装（recordingFile）

实现 [REC-01 v2紧凑存储合同](../../../docs/engineering/recording-v2-contract.md)「校验、文件封装」节的文件读写部分：`readRecordingFile` / `writeRecordingFile`。只用浏览器标准API（Blob / CompressionStream / DecompressionStream / TextDecoder，Node 24 同API可测），不引入 Node fs/zlib，无新依赖。校验复用 [v1 校验](./validation.ts)、[v2 紧凑校验](./compactValidation.ts) 与 [纯codec](./compactCodec.ts)，本模块不做结构校验、不解析业务字段。IndexedDB 增量存储、CompactRecorder/useRecording 接线为后续独立任务。

## 接口

- `readRecordingFile(blob: Blob): Promise<CompactRecordingFile>`：按 magic 识别 gzip（前两字节 `1f 8b`），支持 v2 明文/gzip 与旧 v1 JSON 迁移；未知 schema 显式拒绝，不能只 cast。
- `writeRecordingFile(file: CompactRecordingFile, compressed = true): Promise<Blob>`：先 `validateCompactRecording` 再序列化；默认 gzip JSON v2，`false` 为可读 JSON。扩展名由调用方设置（gzip 用 `.trainer-session.json.gz`）。
- 预算常量：`MAX_GZIP_INPUT_BYTES`（25MiB）、`MAX_PLAINTEXT_BYTES`（256MiB）、`MAX_DECOMPRESSED_BYTES`（256MiB）、`MAX_V2_BYTES`（128MiB）与聚合对象 `RECORDING_FILE_BUDGETS`。
- 内部注入入口（仅供测试注入更小阈值省内存；生产入口固定用常量，**绝不从录制文件内容读取预算**）：`readRecordingFileWithBudgets(blob, budgets)`、`writeRecordingFileWithBudgets(file, compressed, budgets)`、`inflateGzipWithBudget(stream, maxBytes)`。

## 读取流程

1. 读前 2 字节 magic 判定 gzip；不看扩展名/MIME/类型（测试覆盖双向伪装）。
2. gzip：`blob.size`（压缩输入真实字节数）先对 25MiB 拦截 → 流式解压（见下节）→ fatal UTF-8 解码 → `JSON.parse` → schema 路由。
3. 明文：`blob.size` 先对 256MiB 拦截再读入 → fatal UTF-8 解码 → `JSON.parse` → schema 路由。
4. schema 路由：`schemaVersion === 2` → 字节数 ≤ 128MiB → `validateCompactRecording`；`schemaVersion === 1` → 字节数 ≤ 256MiB（v1 迁移外层预算）→ `validateRecording(value, { maxCheckpoints: 20000 })` → `compactRecording` → `validateCompactRecording`；其它（含字符串 `"2"`、3、格式错）走 validator 的 `fail` 中文拒绝。迁移检查点预算 20000 只由调用方写死传入，不读文件内容。

## 流式解压与取消

解压预算 256MiB（外层，含 v1 兼容），判定 v2 后收紧到 128MiB（解析后按实际字节数复查，测试注入小阈值验证与 v1 的差异）。

实现**不用 `pipeThrough`**：其后台管道会急切拉满整个源流，且 Node 24 中取消 DecompressionStream 的 readable 不向源传播。改为手动泵送：源 chunk → `gunzip.writable.getWriter().write()`（写完成才拉下一块，背压生效），并发 `for await` 排空 `gunzip.readable` 逐 chunk 累计解压字节数；越界立即置位、打断两端并抛中文错误——绝不先完整解压再判断，也不先 `arrayBuffer` 后检查。

**取消语义（高压缩率死锁回归）**：解压输出跨多个 chunk 时，若输出端（draining）越界或解压异常后停止读，主循环可能正悬挂在 `writer.write()`/`writer.close()`——输出未排空时 close **永不返回**，且 `writer.abort()` 救不了已挂起的 close（Node 24 实测唯一可靠出口是 cancel 解压读出端，close 会以 cancel 原因被拒绝）。因此越界/异常瞬间在输出端同步触发 `interrupt`：**立即同时**（不顺序 await，否则任一端悬挂都会互相等待）fire 挂起的 write/close 共用的死亡信号、`outReader.cancel(reason)`、`sourceReader.cancel()`、`writer.abort(reason)`；主循环所有 `write`/`close` 一律与死亡信号 `Promise.race`，不裸 await，等待中的 write 被立即打断。兜底清理对三端只触发不 await（abort 在 close 挂起时自身不 settle）。错误优先级保持预算错误 > 解压损坏，成功输出不受影响；所有 fire-and-forget promise 均挂空 catch，无 unhandled rejection。

## 写出自洽

- 序列化前先 `validateCompactRecording`（拦截 NaN/undefined 静默序列化损失与损坏引用，不产生无效文件）。
- v2 JSON 字节数 ≤ 128MiB；gzip 输出 ≤ 25MiB（与读取端压缩输入预算一致），超限拒绝并说明「产生的文件无法被 readRecordingFile 接受」——write 不产生自己读不了的文件（测试以同套注入预算做写出→读回闭环）。

## 错误处理

全部中文可行动错误：大小超限（含对应预算名与字节）、gzip 解压失败（损坏或被截断，附底层原因）、UTF-8 损坏（fatal 模式拒绝，绝不替换后误接受）、JSON 解析失败（可能截断）、未知 schema 版本、写出超预算。gzip 输入只信 magic，不信文件扩展名/MIME。

## 测试证据（server/test/recording-file.test.ts）

真实 Blob gzip 往返逐 checkpoint 深等（实际 codec/validator）、unicode 无损、v1 迁移（2001 检查点 > 旧默认 2000 仍 ≤ 20000）保持旧数据、未压缩 v2、magic 与类型无关、截断 gzip/JSON、未知 schema、NaN 导出失败、write 先校验、三档预算分层差异、明文 size 先拦、超预算 cancel reader（128KB 跨多 deflate 块的不可压缩字节注入 64B 阈值：小文件 zlib 在 close 才一次性吐出，源已读完，cancel 不可观测）。死锁回归（`Promise.race` 时限包装，超时明确失败并清理，不悬挂进程）：高压缩率 65B gzip→32KiB/64B 与 1MiB/65536 预算在时限内以预算错误拒绝（修复前挂死于 `writer.close()`）、16384/64 正常拒绝不回归、1MiB 随机正常 gzip 按 1/16/16384/65536/1MiB 输入块逐字节往返无损、多块源流截断 gzip 及时拒绝；单字节块用例保留30秒内部截止与120秒整体测试时限；具体平台耗时见对应验证记录。

## 本轮不做

IndexedDB 增量存储、CompactRecorder/useRecording 接线、页面导入导出入口、v1 导出（新实现目标只有 v2）。

## 小块输入合并

输入的小块立即复制到一个64KiB自有缓冲，填满或结束时以独立副本写入解压器，避免每字节一次异步写入。既不依赖上游保留原数组，也不假定原生解压器在write结束时已放弃对输入视图的引用。大块仍直接写入。取消、预算、损坏分类和文件格式不变，禁止先读取全部压缩数据再解压。回归覆盖边界残余、复用源内存、源错误及预算触发取消。

## 录像合并包（REC-BULK-01：批量导出/导入的文件契约）

版本迁移工具链与日常备份/恢复以本节为准。合并包是**单个明文 JSON 文件**（扩展名建议 `.trainer-recordings.json`，文件名 `训练录像库-<yyyyMMddHHmm>.trainer-recordings.json`），结构如下：

```json
{
  "format": "trainer-recordings-bundle",
  "version": 1,
  "exportedAt": "2026-10-09T08:00:00.000Z",
  "items": [ /* CompactRecordingFile, ... */ ]
}
```

字段定义：

- `format`：固定字符串 `trainer-recordings-bundle`，区分于单条录像文件的 `trainer-session`。
- `version`：合并包结构版本，当前为 `1`；未来不兼容变更递增，读取端对未知版本显式拒绝。
- `exportedAt`：导出时刻的 ISO 8601 字符串（`Date.prototype.toISOString`），必须可被 `Date.parse` 解析。
- `items`：数组；每个元素是**现有单条导出 JSON 的载荷**（v2/v3 紧凑录制文件，即 `writeRecordingFile(compressed=false)` 的 JSON 对象）。导出侧先逐条 `validateCompactRecording`（导出自洽，不产出读不回的包）；旧录像（v1 明文/已迁移 v2）按现有导出路径的规范化形态进入包，不做新转换。

实现：`web/src/recording/bundle.ts`（`buildRecordingBundle` / `parseRecordingBundle` / `exportRecordingBundleFile` / `isRecordingBundleFile` / `bulkImportRecordingFiles`）。

### 批量导入语义（容错与去重口径）

- 导入入口接受三类输入：合并包（单文件多录像）、既有单条录像文件（明文 JSON / gzip / v1，完全向后兼容，单条 gzip 一律按单条处理）、多选文件混合。**单条非合并包文件保持既有单条导入路径不变**（导入后直接回放的行为不回归）。
- 逐条校验：损坏文件或包内损坏条目**计数为失败并继续**，不整批失败；结构错误的合并包（format/version/exportedAt/items 不合法）整文件计一次失败。
- 去重：候选条目与库中既有条目（或同批已导入条目）`trainingKey` 相同、或 `sessionId`/`originalSessionId` 相同即**跳过并计数，不覆盖**（防止迁移/备份场景误覆盖）。`trainingKey` 为 null 的条目不参与去重，按新条目导入。
- 结果报告：`成功 N / 跳过 M / 失败 K`，失败原因逐条列出。
- 合并包不 gzip、不设独立字节预算（单条预算仍由 `readRecordingFile` 在单条路径上执行）；如未来需要压缩再按合同另立版本。
