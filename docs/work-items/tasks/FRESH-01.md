# FRESH-01 新鲜度纯计算模块

```json
{
  "id": "FRESH-01",
  "title": "新鲜度纯计算模块",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "R1",
  "summary": "为DATA-05提供上海收盘时刻与显式日历的可信计算。",
  "next_action": "REL-03集成人独立审查：核对合同行为与测试口径后再接线；运行行为接线、规格和公共文档由集成人负责。",
  "allowed_paths": [
    "server/src/data/freshness.ts",
    "server/test/data-freshness.test.ts",
    "docs/work-items/tasks/FRESH-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/FRESH-01.md"
    ],
    "reason": "模块首批按固定合同独立实现；运行行为接线、规格和公共文档由REL-03集成人负责。"
  },
  "verification_refs": ["server/test/data-freshness.test.ts"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

合同：[v0.3.2首批](../../engineering/release-032-contracts.md)。Prompt在派发前独立保存；仅改allowed_paths，不改共享文件。

## 实际结果（2026-09-23，基础提交 4e640a5）

- RED：先写 `server/test/data-freshness.test.ts`，在模块不存在时运行确认失败（vitest 报 Failed to load url ../src/data/freshness.js，1 个测试文件失败）。
- GREEN：`node node_modules/vitest/vitest.mjs run --config server/vitest.config.ts server/test/data-freshness.test.ts --maxWorkers=2`，退出码 0，26 个测试全部通过（日志 `.runs/freshness-test.log`）。
- 构建：`npm run build:server`（tsc -p server/tsconfig.json），退出码 0。
- 实现口径：日历只信调用方完整提供的 `from/through/closedDates`（升序唯一、范围一致），范围外/缺失/无效一律 unknown；上海时刻以 UTC+8 纯算术计算，主机时区不参与；15:00（含）后包含当日（当日须为交易日），否则回溯前一已收盘交易日，日历覆盖不足返回 unknown；`sourceMaxDate` 为空/格式非法/类型非法/晚于上海系统日均 unknown，仅当 expectedDate 可信且 `sourceMaxDate >= expectedDate` 才 current，小于为 stale；非法 `now` 抛 `TypeError('now must be a valid Date')`；每条 reason 均含"来源末日不证明所有股票完整"。
- 未覆盖风险/边界：测试夹具为合成休市表，非官方上证日历；发布日历的来源/范围核实与登记归集成人（合同约定）。未在真实 DST/跨时区主机上实证（实现不读主机时区，逻辑上不受影响）。极端超出四位年份的 `now` 会被判 unknown 而非报错，属保守失败。15:00 恰好收盘的口径取"含当日"，依据合同"之后包含当日"。
- 提交状态：**未提交，留待集成人**。2026-09-23 首次 `git commit` 被 Mimosa L3 pre-commit 钩子拦截（报 16 高危、2 中危，最高 high），所报问题全部位于本任务未触碰的既有文件（`scripts/verify-candidate.ts`、`scripts/runtime.ts`、`server/test/recording-context.test.ts:236`、`server/test/runtime-isolation.test.ts:128`，主要为 command-injection/不可信解释器输入类基线发现），按派发指令只记录一次、不换工具或参数绕过、未做二次全库扫描；原报告即该钩子输出（Mimosa 扫描历史默认在 `~/.mimosa/security-scans/<project-id>`）。未提交 diff 保留在工作树：`server/src/data/freshness.ts`（新增）、`server/test/data-freshness.test.ts`（新增）、本卡（修改）。
