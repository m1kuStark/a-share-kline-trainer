> 历史设计稿：2026-09-17已获用户接受，以下“尚未实施”描述原提案时点。现行执行规则见[工程协议](../../../engineering/README.md)。

# 目录与文档职责

状态：提案。上级入口：[文档架构](README.md)。本页确定“放在哪里、谁是权威来源”；读取办法见 [reading](reading.md)，更新办法见 [updates](updates.md)。

## 目标目录

以下代码目录沿用当前实际位置。新结构只用于文档设计，尚未创建或搬移；未列的源代码保持原位。

```text
a-share-kline-trainer/
├─ AGENTS.md                         全局硬边界＋任务路由
├─ README.md                         产品、启动、主要目录入口
├─ server/
│  ├─ AGENTS.md                      后端变更与验证规则
│  ├─ README.md                      后端模块索引
│  └─ src/
│     ├─ data/
│     │  ├─ AGENTS.md                发布、失败与版本约束
│     │  ├─ README.md                扫描/发布/来源入口
│     │  └─ docs/                    publication.md、source-contract.md
│     ├─ train/
│     │  ├─ AGENTS.md                账户、防未来、结算约束
│     │  ├─ README.md                命令、查询、领域核地图
│     │  └─ docs/                    lifecycle.md、accounting.md
│     └─ tdx/
│        ├─ README.md                解析、目录、权息模块入口
│        └─ docs/                    formats.md、adjustment.md
├─ web/
│  ├─ AGENTS.md                      前端变更与视觉验收规则
│  ├─ README.md                      页面、图表、状态模块入口
│  └─ src/
│     ├─ components/
│     │  ├─ AGENTS.md                当前图表入口的库与交互约束
│     │  ├─ README.md                组件职责与图表文档导航
│     │  └─ docs/                    interaction.md、library-adapter.md
│     └─ views/
│        └─ README.md                页面编排与依赖，初期无需AGENTS
├─ e2e/
│  ├─ AGENTS.md                      真实事件、隔离及进程清理规则
│  └─ README.md                      套件、夹具、运行与诊断入口
├─ scripts/
│  └─ README.md                      命令、输入、输出、副作用
└─ docs/
   ├─ AGENTS.md                      文档类型、更新和证据纪律
   ├─ README.md                      按任务导航，不铺全量文件清单
   ├─ status.md                      当前阶段/阻塞/任务/最近证据摘要
   ├─ specs/                         现行产品行为；按领域拆分
   │  ├─ README.md
   │  ├─ training/                   交易、结算、防未来
   │  ├─ chart/                      工具、交互、显示口径
   │  └─ market-data/                更新、覆盖与历史版本要求
   ├─ architecture/                  仅跨模块架构
   │  ├─ README.md
   │  └─ data-flow.md                模块边界、依赖与关键流
   ├─ engineering/                   跨目录的开发协议
   │  ├─ README.md
   │  ├─ documentation.md            本方案接受后的精简执行规则
   │  ├─ testing.md                  测试层次与交付门禁
   │  └─ parallel-development.md     工作副本、所有权、集成队列
   ├─ decisions/                     有效/被替代的关键决策，一项一页
   │  └─ README.md
   ├─ work-items/                    一任务一文件，稳定ID和路径
   │  ├─ README.md
   │  ├─ tasks/                      DATA-01.md、DOC-01.md…
   │  └─ milestones/                 M3.md、R1.md…阶段范围/验收引用
   ├─ verification/                  测试、人工检查、用户验收事实
   │  ├─ README.md
   │  └─ 2026-09/<record-id>/         result.json、report.md、选定附件
   ├─ proposals/                     待定设计，不能作现行规范
   │  └─ README.md
   └─ archive/                       历史讨论、旧进度与过程记录
      ├─ README.md
      └─ 2026-09/                    保留适用版本及后继入口
```

目录是渐进目标，不是一次性文件创建清单。比如 specs/training 初期只有两篇正文，可以由 specs/README 直接索引；出现子主题和独立导航需求后再加下一层 README。

## AGENTS 与索引分工

| 类型 | 应包含 | 避免包含 |
|---|---|---|
| 根 AGENTS | 项目边界、不可丢失的硬约束、按任务读哪里、交付责任 | 逐日日志、全量目录、全部测试结果 |
| 模块 AGENTS | 本模块新增约束、危险操作、必须验证的行为、正文链接 | 复制父级规则、功能进度、长篇原理 |
| README 索引 | 目录职责、下一层入口、什么时候读、来源指向 | 另一套规格正文、逐次验收结果 |
| 主题正文 | 一个明确问题、当前行为/设计依据、关联实现与测试 | 无关历史、通用规则副本 |

新增 AGENTS 的判据：该范围存在独立且必须执行的工作约束，或者遗漏规则曾导致回归。仅因“这是一个目录”不创建。新增 README 的判据：读者需要在多个主题或子模块之间做选择。

局部规则只补充该子树；不能静默放松父级硬约束。更改门禁或产品规则要按对应变更流程处理。文档目录的 AGENTS 管理文档编辑，不会自动成为 server 代码规则；跨目录必读资料必须显式链接。

## 事实归属

| 信息 | 唯一权威来源 | 其他位置 |
|---|---|---|
| 用户要求与现行产品行为 | specs 主题页，稳定规则ID | 入口保留必要警示＋链接 |
| 模块当前如何实现 | 模块 README/docs；跨模块关系在 architecture | 根目录只导航 |
| 为什么采用某项重要设计 | decisions 单项决策 | 当前正文指出生效结论并引用 |
| 任务范围、责任、当前工作状态 | work-items/tasks 任务卡 | status 汇总 |
| 阶段范围及其验收条件 | work-items/milestones 阶段卡 | status 汇总 |
| 实际测试和人工检查结果 | verification 的单次记录 | 任务卡引用，不重复抄统计 |
| 用户验收决定 | verification 中独立验收记录 | 阶段卡引用其范围、提交与来源 |
| 当前分支、未提交差异 | Git 实时状态；审查结果是有日期的快照 | 全局status只链接最近审查，不随worker覆盖 |
| 历史状态、讨论与旧报告 | archive 或原证据路径 | 不进入默认阅读链 |

“单一来源”不要求把所有信息集中到一个文件。它要求每一类事实有明确归属，其余位置引用或生成摘要。产品规格描述应有行为，代码和测试揭示当前实现；两者冲突时建立差距任务，不能为了让文档看起来一致就改低规格。

## 规则索引与元信息

用稳定 ID 连接规则和证据，例如 `TRAIN-NO-FUTURE`、`DATA-PUBLISH-ATOMIC`、`CHART-GESTURE-PRIORITY`。局部 AGENTS 可以保留一句关键警示和 ID，具体定义只在权威主题页。

普通正文可采用小型元信息：`id`、`kind`、`status`、`owner`、`updated`。日期只说明编辑时间，不表示验证通过；需要证明的页面再加 `evidence_ref`。根 AGENTS 与短索引不用为了整齐强塞元信息模板。

模块负责人用稳定职责名，如 data-maintainer；临时 agent 名和 worktree 放任务卡。文档路径使用仓库内相对链接，搬移时修复反向链接；不依赖个人机器绝对路径。

历史决策即使归档，其仍生效的约束也必须能从现行规格找到。提案、目标目录和未实现的命令要明确标识，不能因被索引收录就变成已启用规则。
