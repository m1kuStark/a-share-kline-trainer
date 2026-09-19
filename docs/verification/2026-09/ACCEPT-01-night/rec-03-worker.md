# REC-03 worker handoff

[返修合同](../../../engineering/stage-feedback-20260919.md)。工程完成不等于用户验收。

## 返修轮（2026-09-20，独立有效文件探查四阻塞）

独立探查在既有自验全绿背景下发现四个阻塞，全部先立失败回归再修：

1. **SessionReplay 图表 ref 未绑定**：模板 KlineChart 缺 `ref="chartRef"`，键盘缩放/复位/十字线与重挂前视窗捕获全部静默落空（旧 e2e 只断言日期不变，掩盖了缺陷）。已绑定；e2e 改为实测 `getBarSpace`：ArrowUp 柱宽增大、ArrowDown 减小、Home 复位默认柱宽且右缘对齐最新根，并断言缩放后跨画线日重挂柱宽保留。
2. **周期回退不覆盖挂载首日**：旧文件首日只有周/月快照时，非 immediate 的 watcher 不运行，首日停在不可用的 1D 上只剩空态。已改 `{ immediate: true }`，并补「回落不改偏好、偏好重新可用自动切回」分支；e2e 新增旧文件首日周K用例：首日即时回退周K+图表真实渲染+「缺日线」提示，次日日线可用恢复日K。
3. **buildDailyIndex 幻影重复日**：推进已在 seq2 接受分界、但新日首个带元数据检查点因捕获去抖迟到（afterSeq=4，中间隔空检查点）时，`insideDay` 把迟到的首次观察当段内日期前移再补分界——两个真实日出现前一日两次。改为只认「已观察过日期的日段内再次前移」为真实补分界；单测夹具经真实 compactRecording+validator 校验，覆盖 null-chart 中间检查点。
4. **盲训跨日借用昨日日线**：currentDate=null 时 `dailyComplete` 失去日期防线，runningDaily 让 day2 继承 day1 日线并把 day2 标成 day1 日期。`effectiveDaily` 改为只记当日段内 1D 检查点，跨段沿用须证明候选检查点与当日同日（盲训无日期无从证明，如实缺日线回落当日周K并保留 T+序号）；单测夹具真实校验。

返修证据（分支 task/REC-03）：

- `server/test/recording-daily-replay.test.ts`：20 项全过（新增 4 项返修回归，先红后绿）。
- `e2e/recording-daily.spec.ts`：2 项全过（绿 run `run-38abbc22`）；红证据 `run-491909c2`/`run-3eb1fdf9`（ref 未绑柱宽 6.56 不变；首日周K未回退）。夹具扩为 5 个交易日（见下方残留说明），缩放断言放日线充足的第 4/5 日。
- `typecheck:web` 通过；相邻 recording 套件 17 文件 330 项全过（未跑全量）。

## 残留（归根所有，未跨写）

- `KlineChart.zoomBy` 按 1.3 档取整存在缩放下限：可见根数 ≤2 时 `round(count/1.3)===count` 直接早退，按↑无效果。回放早期日天然只见过少量日线会踩中；训练页数据量大不受影响。回放侧不跨所有权修改，e2e 以 5 日夹具走真实量级；根后续可调因子/取整口径。

## 实现口径（2026-09-19；返修前基线，现行证据见上节）

自验证据（2026-09-19，分支 task/REC-03 基 e8bdddf）：

- `server/test/recording-daily-replay.test.ts`：16 项定向单测全过——日期分组/被拒推进不加日/当日终态/防未来、部分周月聚合与跨月、缺口补日不借未来、旧文件缺日线回退、同日早日线+终态账户、盲训 T+n 与真实日期回填、空录制、业务过滤/拒单标注。
- `e2e/recording-daily.spec.ts`：`npm run journey -- e2e/recording-daily.spec.ts --retries=0` 通过（run-a702b6db、hint 调整后 run-a69fec64）。合成 1D 规范检查点经真实导入校验，导入后 API 全断言离线；真实键盘 Space/PgUp/PgDn/[ ]/方向键/Home/B/S/Delete；画线日重挂后 `__trainerChart.drawings()` 还原终态；0.2 秒/日自动播放末日自停；全程无写请求、无 pageerror。
- `typecheck:web` 通过；相邻 recording-replay / compact-codec / compact-replay / compact-validation 共 111 项通过（未跑全量套件，避免重复占用）。

口径说明：

- `dailyReplay.ts` 只读紧凑元数据建稀疏日期索引：分界=已接受的推进事件，暂停缺口内被吞的推进按检查点元数据日期前移补分界（盲训无日期则保持推进计数并保留缺口提示）；建索引不解码任何检查点。
- 当日终态=范围内最后可用检查点（training+chart 齐全）；账户可来自 training 检查点、日线可来自同日更早 1D 快照，均严格不晚于当日末；范围内无快照如实提示并展示此前最近状态。
- 观察周期与播放日期独立：有当日日线则日/周/月全可（周一周键、自然月键，聚合与 server `aggregateBars` 同口径、纯浏览器无 Node 依赖）；旧文件缺当日日线只展示该日快照自身周期并明确提示缺更细数据。
- SessionReplay 单图表实例不随日期重建；仅当日画线内容（内容寻址 drawingsRef）变化时重挂一次，重挂前捕获当前视窗、挂载后经 `replay-view` 还原，用户缩放/平移跨日保留；不重放每日期捕获视窗。
- 业务列表=完成的买卖+图形/文字变更（拒单/失败标注，取消与生命周期不入列），有界窗口渲染，点击跳转发生日。
- 播放为固定秒/日（0.2/0.5/1/2/5/10），唯一计时器，间隔变更即时重排，末日停止，卸载清理。

## 集成人注意

- 旧 e2e（recording.spec.ts / recording-long.spec.ts / recording-migration.spec.ts）仍按逐步回放按钮（上一步/下一步/最后一步/倍速）断言，需在 ACCEPT-01 按「一步=一个交易日」口径统一改写；本任务不改旧测试。
- KlineChart/useRecording 未改；画线逐日还原依赖「重挂+savedDrawings 首次恢复」现有公开行为，未跨所有权。
