# REC-02 录制有效操作及结束保留选择

```json
{
  "id": "REC-02",
  "title": "录制有效操作及结束保留选择",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "REC",
  "summary": "存储remove(id)、业务口径businessEvents、useRecording业务计数/finishSession(keep)/口径过滤/canonicalChart已实现并通过定向与全量回归，待集成人审查串行合入。",
  "next_action": "集成人处理Mimosa L3门禁对既有scripts/发现的拦截后提交本变更，审查合入ACCEPT-01并接线Training/App（canonicalChart、结束确认、业务计数展示），同步更新e2e对training.create的断言。",
  "allowed_paths": [
    "web/src/recording/useRecording.ts",
    "web/src/recording/compactStorage.ts",
    "web/src/recording/businessEvents.ts",
    "server/test/recording-business-events.test.ts",
    "server/test/recording-compact-removal.test.ts",
    "docs/work-items/tasks/REC-02.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/REC-02.md"
    ],
    "reason": "依据用户阶段反馈实施，集成人统一更新规格与证据。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

[返修合同](../../engineering/stage-feedback-20260919.md)。工程完成不等于用户验收。

## 本次交付（2026-09-19，基础提交 e8bdddf）

1. `compactStorage.ts`：`CompactRecordingStorage` 新增可选 `remove?(id)`（兼容旧自定义实现）；`IndexedDbCompactStorage`/`MemoryCompactStorage` 必有实现。与 save 共用串行队列（在途批次先落盘再整体删除，已提交批次不复活）；IndexedDB 单 readwrite 事务删除 compact header+记录行区间与旧 v1 行，不存在则幂等成功，任一失败整体回滚并拒绝；事务 complete 后才丢弃目标会话的本地 revision/游标缓存，其他会话不受影响。内存实现将 `failWith` 注入的持久化故障同样作用于 remove（同队列持久化操作）。
2. `businessEvents.ts`（新）：`isBusinessAction(action)`＝买卖与图形 create/edit/move/delete/undo/redo/clear；`businessEvents(events)` 仅保留 finished、去 started 重复、排除 cancelled/interrupted；拒单/失败/未知结局交易计入（拒单标注、未知不静默丢失）。推进、工具/主题/视口/周期/加载/保存、画线取消、training.create/settle/abandon、pause/resume/interrupted 均非业务，但保留在事件流中作时间轴数据；旧文件按同口径筛选，不改历史。
3. `useRecording.ts`：公开 `businessEventCount`（computed，恢复会话取已落盘事件基线+本地完成业务动作累加，不做全资源深拷贝）与 `finishSession(keep:boolean):Promise<void>`（冻结新捕获→等待在途初始化与持久化→keep=true 保留最终检查点、keep=false 调 `remove` 删除全部落盘数据→移除本页 session 指针、释放续录锁；失败解除冻结、错误可见、可整段重试；成功后 unmount/pagehide flush 不再触碰录制器，防止丢弃会话复活）。`begin/operation` 过滤 `ui.theme/chart.tool/chart.viewport/chart.timeframe/chart.load/drawings.save/training.create`（创建样板不再记录，`createdParams` 参数保留兼容但不产生事件）；暂停缺口、推进、交易、实际图形事件照录。新增可选 `canonicalChart?: () => ChartCapture | null`：提供时检查点 chart 只用同期 1D 数据+当前显示画线，返回 null 不回退、不虚构旧日线；缺省保持原行为。

## 证据

- 首次失败（TDD）：`npx vitest run …recording-compact-removal…recording-business-events` → 11/11 失败（`storage.remove is not a function`、businessEvents 模块缺失），退出码 1。
- 定向+既有录制回归：同命令加 compact-storage/compact-recorder/storage/core/codec/validation 共 8 文件 153 用例全部通过。
- 全量 `npm test`：54 文件 639 用例通过，退出码 0；`npm run typecheck:web` 退出码 0。
- 未运行 e2e/Journey/M2：本批为 GLM 定向返修，页面接线与真实 UI 检查归集成人/主代理。

## 交集成人的接线说明（本次未改 Training/App/e2e）

1. Training 传入 `canonicalChart`：返回与检查点同期的 1D ChartCapture（当日已见日线+当前显示画线）；无可靠同期日线时返回 null（不得回退当前周月视图或旧日线）。
2. 结束/放弃确认默认勾选「保留到本机训练历史」：`await recording.finishSession(keep)`，reject 时保持弹窗、展示 `error` 并允许重试；resolve 后再离开页面。
3. 业务列表/计数用 `businessEvents(events)` 与 `recording.businessEventCount`，拒单标注；推进仅作交易日轴。
4. 「训练录像」删除入口可调 `recordingStorage.remove?.(id)`（生产/内存实现均已提供）。
5. `e2e/recording.spec.ts` 对新录制断言 `training.create` started/finished 各一条，随创建样板不再落账需同步更新。
6. REC-03 对 `businessEvents` 的共享导入由集成人串行合并后统一。

## 风险

- `unknown` 结局交易计入业务数（结果未知不静默丢失）；若用户验收希望更严，可在展示层过滤。
- 业务中断（页面关闭）留下的悬挂 started 由 restore 补 interrupted，不算业务；中途开始未完成的业务操作在 finishSession 后不再补记。
- canonicalChart 为 null 时检查点允许 chart=null（与既有「加载期无行情检查点」语义一致），回放侧需如实提示缺失。
- 交付状态：代码/测试/文档已全部完成并验证，但 `git commit` 被 Mimosa L3 Git 门拦截——其 high 级发现全部位于本任务 allowed_paths 之外的既有 `scripts/`（`verify-candidate.ts`/`runtime.ts` 的 runNode/buildRun/startServer 调用点、`agent-monitor/monitor.py` SSRF），修复或调整门禁（`MIMOSA_GIT_GATE_*`）均超出本任务授权。变更保留在工作树（未推送、未重置），由集成人决定：授权补丁式加固 scripts 后提交，或由集成人自行处理门禁并提交。
