# REC-HIST-LINK 排查实证报告：历史 18 条 vs 本机录像 1 条

> 任务性质：**只排查出报告，不实现**（矩阵行 `recording-bulk.yaml::REC-HIST-LINK`，status=planned）。
> 用户场景：v1.3.0 桌面版历史 18 条、本机录像 1 条（v1.3.0 跑的一局）；用户要求"历史训练都带上播放录像和导出、二者对应得上"，怀疑二者读取的数据目录不同。
> 排查日期：2026-10-12（分支 p2-hist-recording，base=b506e77）。SQLite 均以 node:sqlite 只读实测；leveldb 证据来自二进制字符串提取（snappy 压缩的 .ldb 不可直读，仅未压缩 WAL 000003.log 可提取）。

## 一、三问直接答案

**Q1（18 vs 1 原因）**：历史与录像读的**都不是错目录**，各读各的正确位置——18 条历史来自 v1.3.0 便携 exe 首启"沿用历史训练数据"采纳的 `~/.a-share-kline-trainer/trainer.sqlite`（settled 实测=18，精确匹配）；1 条录像是该局训练（遗留的 running 训练 46）在桌面 Electron 的 IndexedDB 里新录的会话。其余 v1.2.7 时期的录像物理上在 **Edge 浏览器 profile 的 IndexedDB**（origin=`http://127.0.0.1:8787`），桌面 app 读不到。原假说"历史=SQLite 迁来 17＋新 1；录像=桌面 IndexedDB 只有新 1 局；v1.2.7 录像在 Edge"**大体证实**，但"迁来 17"不成立：18 条全部是 legacy-home 库的原生数据（不是迁移产物），且新那局不是新训练行，而是**续玩 10-02 遗留的 running 训练 46 至放弃**（详见 §3.3）。

**Q2（"二者读取的数据目录不同"真假）**：**方向半对、性质不对**。二者确实是两个存储介质（历史=SQLite 文件，录像=Chromium IndexedDB），但不存在"读错目录"——是**三重隔离**把 v1.2.7 时期录像挡在桌面 app 视野外：①浏览器 profile 隔离（Edge vs Electron userData `%APPDATA%\a-share-kline-trainer`）；②origin 隔离（IndexedDB 按 `http://127.0.0.1:<port>` 分库，端口回退即换库，App.vue:261-268 的常驻提示已如实声明该行为）；③库级 namespace 隔离（IndexedDB 库名 `trainer-recordings.<uuid>`，uuid=所连 SQLite 库的 `cache_meta.recording_namespace`，换库=换库名）。

**Q3（历史能否都有录像）**：**不能全部**。18 条 settled 按录制时代二分：9 条创建于 2026-09-19（录制默认开启 landed 55c2842）之前，**物理无录像**；9 条录制时代的录像在 Edge IndexedDB，**可经 migrate-v127 迁回**；训练 46 那局的录像已在库。另有一个迁移陷阱：对本机桌面 v1.2.7 包跑 migrate-v127 会读到**错误 namespace**（见 §5）。

## 二、历史数据源（排查清单 1）

- 代码链：`GET /api/trainings/history`（`server/src/api.ts:1072`）→ `historyList`（`server/src/train/history-report.ts:160-172`）→ 同一 SQLite 的 `trainings` 表 `WHERE status='settled'`，`ORDER BY settle_date DESC, id DESC`。库文件路径 `databasePath = TRAINER_DB ?? ~/.a-share-kline-trainer/trainer.sqlite`（`server/src/config.ts:76`）。
- 桌面 exe 的 dataDir 解析（`desktop/src/data-home.ts:191-279`）：env 显式 > trainer.config.json > 采用记录 > 首启发现（候选序冻结：①exe 旁 `data/` ②`~/.a-share-kline-trainer`，`data-home.ts:109-114`）；采用记录=exe 旁 `desktop-data-choice.json`。
- 用户 18 条的来源实测（node:sqlite 只读，2026-10-12）：

| 候选库 | total/settled | recording_namespace | 判定 |
|---|---|---|---|
| `C:\Users\Stark_Du666\.a-share-kline-trainer\trainer.sqlite`（legacy-home） | 41 / **18** | `3edee316-cb83-4989-8496-8d55bcaec70b` | **用户 18 条来源** |
| `Desktop\kline-trainer-v1.2.7-windows-x64\data\trainer.sqlite`（exe 旁） | 6 / 2 | `28da8dc4-2f94-483f-aae7-d1fd3acd4a4f` | 验收复现库（训练行全部创建于 10-03，与 orchestrator 验过的"6 局"吻合），非用户 18 条来源 |

- 决定性证据：`D:\Superlinear_Academy\Stock_WorkSpace\a-share-kline-trainer\desktop\release2\desktop-data-choice.json`：`{"mode":"adopted","dataDir":"C:\\Users\\Stark_Du666\\.a-share-kline-trainer","decidedAt":"2026-10-11T14:36:42.728Z"}`——用户实际运行的 v1.3.0 便携 exe 就在 `desktop/release2/`（就地运行，该目录无 `data/trainer.sqlite` → 首启发现单命中 legacy-home → 采纳）。桌面 v1.2.7 目录的 `desktop-data-choice.json`（mode=default，decidedAt 22:38:03）属另一实例（验收侧），其 dataDir=exe 旁 data/（settled=2，若用户用的是它只会看到 2 条）。

## 三、录像数据源（排查清单 2/3）

### 3.1 存储模型（代码链）

- 录像库=IndexedDB：`IndexedDbCompactStorage`（`web/src/recording/compactStorage.ts:742-754`，store：`sessions`(v1)/`compactSessions`/`compactRecords`，`compactStorage.ts:540-552`）；导入栏走独立库 `<dbname>.imports`（`web/src/recording/recordingRepository.ts:31`）。
- 库名=`trainer-recordings.<namespace>`（`web/src/recording/storage.ts:43-56`）；namespace 来自 `/api/env` 的 `recordingNamespace`（`server/src/api.ts:937`）= 所连 SQLite 的 `cache_meta.recording_namespace`（`server/src/db.ts:129-136`，库级随机 UUID，稳定）；web 启动时 `configureRecordingNamespace(next.recordingNamespace)`（`web/src/App.vue:273`，`recordingRepository.ts:22-33`）。
- 桌面 exe 的 IndexedDB 落在 Electron 默认 userData：`%APPDATA%\a-share-kline-trainer\IndexedDB\`（无 setPath 覆盖；应用名来自 `package.json` name=a-share-kline-trainer）。实测该目录下有 **50+ 个按端口分的 origin 目录**（`http_127.0.0.1_<port>.indexeddb.leveldb`，10-06 密集开发测试＋10-11/10-12 少量）。端口回退语义与用户提示见 `web/src/App.vue:261-268`（"浏览器历史录像按访问地址存放，端口变化后需回到原地址查看"）。
- `<dataDir>/recordings/` 归档目录（DATA-ARCH-01）＝**导出物而非库源**：结算/放弃时渲染端把 gzip 导出字节经 IPC 原子写入（`web/src/views/Training.vue:593-612`、`desktop/src/archive-recording.ts:1-9`），失败不阻塞、库本体仍在 IndexedDB。本机所有候选 dataDir（legacy-home、桌面 v1.2.7 data/）**均无 recordings/ 目录**——该局以"放弃"结束且归档未落盘（候选原因：放弃流程勾选不保留→retainedRecording 为 null 跳过归档，或该次结束经无文件系统能力的会话；录像本体在 IndexedDB 不受影响）。

### 3.2 用户"1 条录像"的物理定位（origin 8787 WAL 二进制提取）

Electron `http_127.0.0.1_8787.indexeddb.leveldb/000003.log`（leveldb 生存期 2026-10-11 17:57→22:49，内部 LOG 两次重开 22:41:29/22:49:21）内提取到 3 个会话头：

| sessionId | createdAt（本地） | trainingKey | app 版本 | 归属 |
|---|---|---|---|---|
| 46421e75 | 10-11 17:57:11 | `46.2026-10-02T07:38:37.568Z` | unknown | ns 3edee316（库元数据在 344/3337 字节处先建） |
| 2071e2c2 | 10-11 22:04:30 | `1.2026-10-11T14:04:30.022Z` | unknown | ns b011601b=**/d/tmp/accept-arch 验收库**（与该库训练 id=1 createdAt 逐毫秒吻合） |
| 9325353a | 10-11 22:36:46 | `46.2026-10-02T07:38:37.568Z` | unknown | ns 3edee316； richest 内容（40 处引用、complete T/F 多次翻转） |

- 9325353a 创建于 release2 采纳 legacy-home（22:36:42）后 **4 秒**——即用户打开 app 自动续上遗留 running 训练 46、录制器随即开录（`useRecording.ts:88-165`：running 训练无保存指针即 `recorder.start(trainingKeyOf(),…)`）；22:49 会话结束（complete=T）与 leveldb 末次写入一致。训练 46 现状态=abandoned（`server/src/train/engine.ts:1402` 放弃路径）——**用户的"v1.3.0 跑的一局"= 续玩并放弃了 10-02 的遗留局，未产生新的训练行**，这就是历史仍 18 条的原因。
- 用户报告"1 条" vs 物理 2 个 46 号会话（17:57 的 46421e75＋22:36 的 9325353a，同 trainingKey）：差异未定案（候选：早会话已在库 UI 被删/用户按"一局"计数）。如实披露，不猜。
- 另：10-12 01:16 起的 origin `http_127.0.0.1_8917` 只建了 `trainer-recordings.a34e0f08…` 空库——对应 `/d/tmp/p1port/.repro/v127-data/trainer.sqlite`（0 训练，验收环境），非用户实例。

### 3.3 v1.2.7 时期录像在 Edge（假说证实）

- Edge `User Data\Default\IndexedDB\http_127.0.0.1_8787.indexeddb.leveldb` 实测存在且约 **17MB（.ldb×9+，snappy 压缩不可直读字符串）+ 同名 `.blob` 目录**，末次写入 10-11 22:41——体量与录制时代 9 局 settled＋8 局 abandoned 的录像总量相称（.ldb 内容与 namespace 拆分无法离线解压验证，留给 migrate-v127 发现模式实机确认）。
- 版本史：录制器落地 2026-09-19（REC-01，`0f4bd92` storage + `55c2842` 默认开启 `recordingOptions={enabled:true}`）；namespace 隔离 10-03 落地（`9514ce2`）先于 v1.2.7 tag（10-04，`bbd368b`）→ v1.2.7 在 Edge 中同样用 `trainer-recordings.<ns>` 库名，且所连库=legacy-home → ns 同为 `3edee316`。
- 18 条 settled 按录制时代二分（实测）：**9 条 PRE-REC**（2026-09-03~09-13 创建，物理无录像）＋ **9 条 REC-ERA**（09-21~10-02 创建，录像在 Edge）。

## 四、录像↔历史关联现状（排查清单 4/6）

- **关联键已具备**：录像条目 `trainingKey = ${training.id}.${training.createdAt}`（`web/src/recording/useRecording.ts:72-76`；类型 `web/src/recording/types.ts:124`）；历史条目带 `id` 与 `createdAt`（`HistoryReportPayload.training`，`history-report.ts:184-207`）→ 可零 schema 改动精确 join。`sessionId` 是随机 UUID（与训练行无对应关系）；导入/合并去重同时认 `trainingKey`/`originalSessionId`（`web/src/recording/bundle.ts:39`、矩阵 BULK-IMPORT-DEDUP）。
- **UI 互链为零**：历史页（`web/src/views/History.vue:114-157`）只有删除与只读成绩单弹窗，无任何录像入口；录像库（`components/RecordingLibrary.vue`）无历史回溯。
- **migrate-v127 导入项呈现**：落 `<库名>.imports` 独立库，UI 分栏"导入的分享录像"（`RecordingLibrary.vue:202-204`，source=imported），"本机训练录像与导入的分享录像分开保存，互不覆盖"（:165）；同样不与历史互链。

## 五、migrate-v127 的 namespace 陷阱（排查清单 5 附加发现）

对本机桌面 v1.2.7 包运行导出工具时，工具从**包内 data/trainer.sqlite** 读 ns=`28da8dc4`（验收复现库）→ 在 Edge 同 origin 读取 `trainer-recordings.28da8dc4…`——那是验收 6 局的录像库；**用户真实录像在 `3edee316`（legacy-home 的 ns）**。规避：用工具的发现模式（MIG-NAMESPACE-DISCOVERY：枚举浏览器内 `trainer-recordings.*` 供确认；矩阵 `migration-tool-v127.yaml`）选 `3edee316` 库导出。可迁量预期=REC-ERA 9 局 settled＋若干 abandoned 局录像。

## 六、方案清单（proposed_default，不实现）

1. **历史行"播放录像"按钮（有→播放/无→"无录像"）**：web 侧实现——History 页加载后并行 `listRecordingLibrary()`，按 `trainingKey===id.createdAt` 匹配；命中→行内/成绩单弹窗加"播放录像"（复用 `openRecording`→`view='replay'` 链路，App.vue:144-147）；未命中→置灰按钮＋说明（pre-REC-ERA 局文案"该局早于录制功能上线，无录像"；REC-ERA 未迁局文案"录像仍在旧浏览器，可用迁移工具导入"——需区分两种未命中原因时，可用创建日期 2026-09-19 分界）。
2. **历史行导出该局录像**：命中项走 `writeRecordingFile(file,true)`（gzip，与归档同格式）触发下载；未命中禁用。
3. **关联口径**：统一以 `trainingKey`（`id.createdAt`）为 join 键；导入录像保留的原 trainingKey 参与同一匹配（天然把"导入的 v1.2.7 录像"挂回历史行）。
4. **导入的 v1.2.7 录像挂回历史**：流程=migrate-v127（发现模式选 3edee316）导出合并包→新版批量导入（imports 栏）→历史行按 trainingKey 自动点亮"播放录像"。可选增强：历史行标注"录像来自导入"。
5. **"数据目录不同"的用户可见解释**：历史页脚注/说明区一句话讲清存储模型（SQLite 历史＋浏览器 IndexedDB 录像＋端口/库隔离），复用 App.vue:261-268 端口提示口径；矩阵行 oracle 要求"不得造成用户可见的条数对不上且无解释"，此为最小满足。
6. **归档补齐（可选）**：历史行导出即等价归档文件（方案 2），弥补"放弃局归档未落盘"一类缺口；不建议回溯改库。

## 七、待拍板项

1. 无录像历史行的呈现形态（置灰按钮＋tooltip / 文字"无录像" / 两种未命中原因是否区分展示）。
2. pre-REC-ERA 9 条"物理无录像"的定性文案与是否在列表标记。
3. 导入录像与历史的呈现关系（仅点亮播放按钮 vs 历史行内直接标注来源）。
4. 训练 46 物理上存在 2 个同 trainingKey 会话（17:57/22:36）而用户见 1 条——是否需要排查/清理，还是留待用户反馈（建议不动）。
5. migrate-v127 在用户机器实跑时的库选择（发现模式选 `3edee316`）——真实数据复验按矩阵既有边界留给用户。
6. 端口漂移导致录像库不可见的防护（固定端口指引已有文案；是否做跨端口库合并/迁移另立矩阵行）。

## 八、证据链索引（文件:行号）

- 历史 API：`server/src/api.ts:1072`（路由）、`server/src/train/history-report.ts:160-172`（settled 查询）、`server/src/config.ts:76`（默认库路径）。
- data-home：`desktop/src/data-home.ts:109-114`（候选序）、`:191-279`（发现/采用状态机）、采用记录 `desktop/release2/desktop-data-choice.json`、`Desktop\kline-trainer-v1.2.7-windows-x64\desktop-data-choice.json`。
- namespace：`server/src/db.ts:129-136`、`server/src/api.ts:937`、`web/src/App.vue:273`、`web/src/recording/storage.ts:43-56`、`web/src/recording/recordingRepository.ts:22-33`。
- 录像库/会话：`web/src/recording/compactStorage.ts:540-552,742-754`、`web/src/recording/useRecording.ts:72-76,88-165`、`web/src/recording/types.ts:117-129`、`web/src/recording/bundle.ts:39`。
- UI 现状：`web/src/views/History.vue:114-157`、`web/src/components/RecordingLibrary.vue:165,202-204`、`web/src/App.vue:144-147,261-268`。
- 归档：`web/src/views/Training.vue:593-612`、`web/src/recording/archive.ts:1-31`、`desktop/src/archive-recording.ts:1-9`。
- 版本史：录制默认开 `55c2842`（2026-09-19）、namespace 隔离 `9514ce2`（2026-10-03）、v1.2.7 tag `bbd368b`（2026-10-04）。
- 实测数据：legacy-home settled=18（含 9 PRE-REC/9 REC-ERA 明细见 §3.3）；桌面 v1.2.7 库 6/2；origin 8787 三会话头（§3.2 表）；Edge 8787 leveldb≈17MB＋.blob；本机候选 dataDir 无 recordings/。
