# RANGE-01 训练范围纯规划模块

```json
{
  "id": "RANGE-01",
  "title": "训练范围纯规划模块",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "M5",
  "summary": "为TRAIN-02提供自然月、到末日和日K根数的范围计划。",
  "next_action": "工程验收已通过；TRAIN-02 的引擎、数据库和录制接线另行实施，用户验收尚未记录。",
  "allowed_paths": [
    "server/src/train/range.ts",
    "server/test/train-range.test.ts",
    "docs/work-items/tasks/RANGE-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/RANGE-01.md"
    ],
    "reason": "模块首批按固定合同独立实现；运行行为接线、规格和公共文档由REL-03集成人负责。"
  },
  "verification_refs": [
    "server/test/train-range.test.ts",
    "docs/verification/2026-09/REL-03/module-acceptance.json"
  ],
  "integration_ref": "8db9fb5",
  "acceptance_ref": null
}
```

合同：[v0.3.2首批](../../engineering/release-032-contracts.md)。Prompt在派发前独立保存；仅改allowed_paths，不改共享文件。

## 实际结果（2026-09-23，GLM-5.3-Flash）

- 交付：`server/src/train/range.ts` 纯函数模块（零导入，不接引擎/数据库/文件），`server/test/train-range.test.ts` 30 用例，全部合成夹具（公历周一~五生成），未触碰通达信目录、8787/7529 库或本机服务。
- RED/GREEN：先写测试确认 RED（exit 1，模块缺失），实现后 GREEN（30/30，exit 0）；`npm run build:server` exit 0。
- 覆盖：presetDates 月末裁剪（闰/平年、跨年、抛错）；preset 自然月推终点、显式 endDate 窗口、周末尾段取末根、knownClosedDates 末日、UNCONFIRMED_COVERAGE 点名、空窗口、终点晚于 today；latest 钉定末根；bars N=1/恰好/超量不截短、周末起点对齐；BEFORE_HISTORY（免责口吻）、AFTER_DATA、NO_DATA；dates/today/request/knownClosedDates 异常形状从 JS 调用一律 INVALID_INPUT 不静默成功。

### 合同未明处的实现口径（供集成人复核）

1. 显式 `endDate > today` 按请求畸形返回 `INVALID_INPUT`（合同"禁止晚于today"）；自然月推算终点 > today 才是 `INSUFFICIENT_DATA`（合同"请求终点晚于today"句）。两者互斥、都测试。
2. 显式 endDate 的窗口是 `[startDate, endDate]`（起点不重算），`months` 仅在未给 endDate 时用于加月；与 `presetDates` 的"从终点回溯"互为两方向。
3. `AFTER_DATA` 触发条件取"请求起点晚于本地末根"；`BEFORE_HISTORY` 为"起点早于本地首根"，消息含"不代表早于上市"免责表述。
4. 窗口内零日线（如周末对周末的显式窗口）返回 `INSUFFICIENT_DATA`；合同只规定尾段欠缺，未规定零选中窗口。
5. 首根对齐只检查尾段，头段缺口（请求起点到对齐首根之间）按合同"首根>=请求起点"允许对齐并写 note，不做未证实工作日检查。

### 剩余边界

- "周末"仅按公历周六/周日判断；调休上班日无法表达，只能出现在 knownClosedDates 反向（工作日休市）语义中，周末上班不适用——如 TRAIN-02 需要处理，需上层另行确认。
- 不做新鲜度评估（末根滞后由 FRESH-01 负责）；不做内部缺口检测（合同禁止凭日期断言停牌/完整）。
- 未覆盖风险：真实官方日历下的行为未验证（合同要求集成人另行核实发布日历来源/范围）；模块未接线，运行行为验收属后续任务。

### 交接：Mimosa 拦截提交（记录一次，未绕过）

2026-09-23 commit 被 Mimosa L3 pre-commit 钩子强制拦截：全库 16 高危、2 中危（最高 high）。被点名的均为既有共享文件，不在本任务 allowed_paths：`scripts/verify-candidate.ts`（runNode/buildRun/startServer command-injection 入口）、`scripts/runtime.ts:28`（buildRun 经 1 跳到达 command-injection）、`server/test/recording-context.test.ts:236`、`server/test/runtime-isolation.test.ts:128`。Mimosa 原始报告即钩子输出全文，由集成人在原现场重放 `git commit` 可见；未做二次全库扫描、未换工具或参数绕过。本任务三个文件保持未提交：`server/src/train/range.ts`、`server/test/train-range.test.ts`（新文件，untracked）、`docs/work-items/tasks/RANGE-01.md`（修改，diff 存 `.runs/range01-uncommitted.diff`，.runs 已 gitignore）。HEAD 仍为基线 4e640a5。

## 工程验收（2026-09-23）

- 上述 Mimosa 拦截是 GLM 工作树的历史交接；集成提交 `8db9fb5526b9c36d030abf39f706ebc24b003d90` 已由根代理审查并纳入当前主分支。
- 聚焦测试 30/30，全量单测 858/858，`npm run build` 通过；自然月、latest、bars 和不足数据边界均实际执行。
- 用户验收仍未记录；TRAIN-02 的产品接线不属于本模块。
