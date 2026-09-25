# zcode desktop 两项提交复核与产品接续

2026-09-25。用户报告在zcode desktop完成两项提交，并要求同步进度、验收及讨论后续开发方式。本轮只复核代码、运行定向检查和更新文档，不合并候选、不推送、不启动新的产品实现。

## 结论

两个新提交都完成了独立纯模块和对应测试，工作树干净，但不能作为DATA-05、TRAIN-02完整产品功能验收通过。它们复用了已过期的纯模块基线，与main已经包含的FRESH-01、RANGE-01形成替代实现；产品API、页面和录制接线仍未开发。本次不整份替换已集成模块。新分支和提交原样保留，新增有效测试可在后续接线中有选择地吸收。

| 候选 | 提交 | 独立验证 | 验收判断 |
|---|---|---|---|
| DATA-05 | 22fcdace102609ea6ae72b5cdc29cbc58cb8dd9e | 新套件30/30，服务端编译退出0 | 日历校验回退，不接受直接替换FRESH-01 |
| TRAIN-02 | 747d259b95b0c10907c6e147990c67e91b25985f | 新套件33/33，服务端编译退出0 | 存在无证据的休市陈述和返回语义差异，不接受直接替换RANGE-01 |
| 当前main已有模块 | af0efafc48ce24e247f3c273b1ee4926be8765c5 | freshness26项＋range30项，合计56/56通过 | 继续作为产品接线起点；并非宣称不存在其他缺陷 |

命令分别为 `npm test -- server/test/data-freshness.test.ts --maxWorkers=2`、`npm test -- server/test/train-range.test.ts`、`npm run build:server`。已有模块联合检查使用 `npm test -- server/test/data-freshness.test.ts server/test/train-range.test.ts --maxWorkers=2`。全部退出0、无跳过，Node24/Vitest3.2.7，测试仅用合成数据；未读取个人训练库或通达信目录。没有复跑产品UI门禁，因为新提交没有可验收的页面/API功能。分支原始RED过程未取得完整日志，本报告不补造TDD历史。

## DATA-05 发现

**P2：不可信日历仍可返回current。** 候选 `server/src/data/freshness.ts:100` 的trustCalendar只检查日期格式/范围，未检查closedDates升序唯一，id只检查length、不去除空白。注入上海2026-09-24 15:00、sourceMaxDate=2026-09-24、日历范围2026-09-01到2026-10-31：

- closedDates为 `[2026-10-02, 2026-10-01]`，候选current，已有实现unknown。
- closedDates为 `[2026-10-01, 2026-10-01]`，候选current，已有实现unknown。
- id为两个空格，候选current，已有实现unknown。

这违反[首批合同](../../../engineering/release-032-contracts.md)对无效/排序异常日历保守unknown的要求。新测试没有覆盖这些旧回归。候选部分unknown原因还缺少原合同统一的“来源末日不证明所有股票完整”说明；不能因新套件通过而删除旧套件保护。

## TRAIN-02 发现

**P2：把日期缺口断言为非交易日。** 候选 `server/src/train/range.ts:255` 在首根晚于请求日起点时统一写“请求起点为非交易日”。反例：dates为2026-09-18、09-22、09-23，请求preset从周一09-21到09-23，today=09-23，没有knownClosedDates。两版都对齐22日，但数据缺少21日不能证明当天休市。已有实现只说明首根对齐，不推断原因。

另有需要保持兼容或先明确版本的差异：latest的requestedEnd从null变为today；窗口内无日线从INSUFFICIENT_DATA变成NO_DATA；非法mode/count校验后移，可能先返回NO_DATA/BEFORE_HISTORY。这些差异不是“导出签名一致”能够消除的，也不全部构成原合同已明定的错误。

新实现有可保留的测试素材：闰日回减12月、24月回减、不同输入重新规划、knownClosedDates非数组等。对0–99年和20万日期数组，新实现在探针中比旧版更稳健；这是低现实相关性的边界改进，尚不足以支持整模块替换。后续按实际产品规模保留有价值的回归，避免为了采用新实现重新定义既有返回口径。

## 进度与现场

两项提交父节点均为d75da88aad28d316a481a009554bc877977ca186；main已在其后前进24个提交。DATA-05只新增freshness模块/测试，TRAIN-02只新增range模块/测试，没有接线。main的两个模块字节与main已提交版本一致，并非仅存在于脏工作区的临时文件。

搜索server/src与web/src，assessFreshness、presetDates、planTrainingRange仅出现在各自定义，未有产品调用。`refresh.ts`仍用lastWeekdayBeforeToday，Launcher仍以当日初始化startDate、提交旧tier结构，训练引擎仍用原周期计算终点。因此盘后状态修正与新范围创建不能标为完成。

用户补充：task create因脏树拒绝，随后采用git worktree add；基线任务卡不存在且被禁止修改，所以没有创建任务卡；Mimosa未拦提交。这些约束本轮保留。task create是整洁性门禁，绕开它建立隔离工作树不等于已经获得正确产品基线。直接原因是父任务卡仍留下d75da88和“只实现纯模块”的过时交接，本轮已纠正，不能将重复开发单纯归因于GLM能力。

精简反例及提交散列见[checks.json](checks.json)。完整比较脚本、结果和测试日志在本机控制层desktop-20260925-audit；两个任务工作树及未推送提交原样保留，未删除或改写。

## 接下来

先整理包含已验收模块和现有工程工具的可复用提交基线，逐项保留main现存改动，不把全部脏树盲目提交。之后复用FRESH-01接通日历来源、新鲜度API/首页状态和跨收盘刷新；复用RANGE-01接通日期元信息预览、创建复核、页面及新旧录制兼容。SETUP-01完成发现/选择/保存；V4时钟、B/S笔记、条件单仍按依赖在后。

本轮建议的协作方式见[产品开发分工](../../../engineering/product-development.md)。ORCH阶段保持关闭，已有门禁用于产品交付；这次没有新增编排器工程任务。

## 文档同步验证

已更新DATA-05/TRAIN-02任务、首次接入批次说明及产品分工入口，并重新生成status。docs:check与docs:status --check退出0；10项篇幅提示保留。docs:impact要求具体SHA（首次用HEAD被参数校验拒绝），改用--base af0efaf --task DATA-05后已执行；main混有此前多任务未提交变化，检查报告大量非本任务范围，因此未将其称为一个可合入DATA-05候选。本轮不使用扩大allowed_paths来掩盖这些历史变化；下一实际开发批次须先整理可追溯基线。
