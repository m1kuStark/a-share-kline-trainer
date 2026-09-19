# SessionReplay：只读录制回放

[SessionReplay.vue](./SessionReplay.vue) 消费已校验的录制文件（v1 `RecordingFile` 或 v2 `CompactRecordingFile`），离线回放检查点图表与账户。纯 helper 在 [../recording/replay.ts](../recording/replay.ts)（缺口/时距/事件说明）与 [../recording/compactReplay.ts](../recording/compactReplay.ts)（v2 检查点索引/事件窗口），数据合同见 [REC-01](../../../docs/engineering/recording-contract.md) 与 [v2合同](../../../docs/engineering/recording-v2-contract.md)。

## 接口与接线

- props `{ recording: RecordingFile | CompactRecordingFile }`，emit `close: []`；组件不改 App，由集成人挂接。
- 入口只迁移一次：`schemaVersion===2` 直接复用；v1 经 `compactRecording` 做一次紧凑迁移（computed 缓存，props 不变不重算），之后统一按 v2 按需还原，v2 不转回完整 v1。
- 检查点还原：`compactCheckpointIndexForSeq` 二分选最近 `afterSeq <= seq` 的轻量检查点下标（同 afterSeq 取靠后＝更完整，无覆盖返回 null 显示"暂无"状态）；单个 `CompactReader` computed 复用，每步只解码当前一个检查点，不解码全部检查点、不展开全会话。
- 图表复用 KlineChart：`read-only=true`、`:bars/:trades/:cost-price`（账户快照）、`:chart-cost-price/:timeframe/:saved-drawings/:replay-view`（检查点快照），不接任何事件输出，不调用图表 expose。
- 每步按 `activeCheckpoint.id` 作 `:key` 整体重建图表，避免跨检查点残留状态；依赖 KlineChart 的 `readOnly`/`replayView` props（本 worktree 已合入，见提交 d58fad9/e92c7be 一线）。

## 步与播放语义

- 步 seq ∈ 0..events.length，0＝初始状态；事件 i 显示为 `events[seq-1]`，操作列表序号文本是真实 `event.seq`。
- 播放：每步等待＝相邻事件 `elapsedMs` 差 ÷ 倍速，封顶 `MAX_STEP_WAIT_MS=2000`；末步播放自动回卷到 0；手动操作即停；倍速热调整重排下一步；卸载清计时器。
- 缺口：暂停期间未记录的时间/操作区间，不产生缺失的事件序号（真实录制 pause 的 afterSeq=N 与 resume 的 resumedAtSeq=N+1 永远相邻）。`gapCoveringSeq` 在暂停边界步（seq=afterSeq）与恢复边界步（seq=resumedAtSeq）命中，未恢复的缺口自 afterSeq 起延续到末尾（含 afterSeq=0 的初始第 0 步）；命中时状态行显示 `role="alert"` 提示，`describeGap` 描述暂停区间，不声称有事件缺失。
- 常驻摘要：状态行固定显示 `summarizeGaps` 的「本录制含 N 段未记录区间」，任何步骤（含恢复之后）都不隐藏历史缺口；选步/翻窗口不影响该摘要。
- 空状态：无检查点显示"暂无可展示状态"；当前步无覆盖检查点或检查点无 chart 显示"该步骤没有图表快照"，无 training 显示"该步骤没有账户快照"。

## 操作列表窗口

- 列表只渲染以窗口锚点为中心、最多 `REPLAY_EVENT_WINDOW=100` 项的事件（`replayEventWindow`，边界只随锚点变化并夹取到 1..事件总数），50000 事件不会整表渲染。
- 上一组/下一组按钮（lucide 图标＋`aria-label`＝上一组事件/下一组事件）按整窗相邻翻页；中间显示当前窗口事件序号范围。
- 点击任一项即 `stepTo(event.seq)` 选中并跳到该步；当前步离开展示窗口（大幅跳步或播放越过手动浏览窗口）时锚点回卷到当前步，播放推进总能回到当前窗口。
- 首/尾/上一步/下一步/range/倍速的可达名不变：开始／上一步／播放录制／暂停回放／下一步／最后一步／回放步骤／播放速度。

## 边界

- 只读离线：不引 recorder/storage/outbox，不注册交易快捷键，不调用训练/交易/画线 API，不写任何训练状态。
- 元信息中 complete 仅表示尾段无悬空 started 与未闭合缺口，显示「尾段已闭合/尾段未闭合」，不暗示没有未记录区间（缺口数见常驻摘要）。
- 文本一律插值，不用 v-html。
- 样式 scoped；主题变量（`--surface-*`/`--text-*`/`--control-background`）仅在 `body.dark` 定义，浅色用同源回退值。

## 已知限制

- 未提供键盘步进控制，避免与全局交易热键冲突；如需接入由集成人统一仲裁。
- 页面接线与索引见 [views README](./README.md)。App/录制接线改用 v2 存储由集成人统一迁移；本页已兼容两种输入。
