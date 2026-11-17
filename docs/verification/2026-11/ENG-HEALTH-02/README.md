# ENG-HEALTH-02 工程健康检查（2026-11-17）

本轮对账对象为 `main@3b5fb110e506eb2e139f754c966cee3a64f55ea1`，对应 M9-04D / PR #47。执行环境 Windows、Node 24.15.0、npm 11.12.1；使用 GH 当前登录账户核对公开仓库。本文是当日检查快照；当前任务继续沿[状态](../../../status.md)与[任务卡](../../../work-items/tasks/ENG-HEALTH-02.md)查阅。

## 判断与范围

GitHub 的主线、保护和 CI 运转正常；主要维护问题是文档与任务摘要滞后。M9-04 A-D 均已合入，尚未组织整批候选与用户验收。安全告警和本地单测失败仍需单独跟进，不能将工程判为全绿或可发布。

- 保留开工前已有的 `desktop/build-resources/migration-export-inline.html`，原始 SHA256 为 `7b4ca69a4b620d891749ecab7cbc3cd542870b18a66139e7245cde0dd04a93e0`；不暂存、不还原。
- 只更新 Markdown、工作区统一任务状态和过时本地 tracking refs；未修改产品、测试、配置、依赖或发布资产。行为矩阵、RED/GREEN 与产品视觉检查不适用。
- 正式验证证据、用户验收与旧候选保留历史身份；不按文件年龄删除，不把旧验收缺口批量关闭。

GitHub、分支及发布范围见[远端核对](github.md)；命令、退出码、首轮失败与复跑见[本地验证](validation.md)。

## 已执行的整理

1. 清理 26 个已在远端删除的本地 `refs/remotes/origin/*`；保留 origin/main、origin/HEAD 与开放 PR #43 分支。本地主分支及工作树未删除。
2. 移除“当前/最近会话＝2026-10-04”“最新发布＝v1.2.7”等过时入口说法；原文和证据路径仍保留。
3. 修正文档中无 CI 保护、双平台 CI、旧 worker/timeout、pre-commit 检查内容，以及旧 promote 工具与现行 PR 工作流冲突的说明；ADR 追加后继注记，不重写原决定。
4. 回填 M9-04D、TEST-BUDGET-04、CHART-MEASURE-05 的已合并引用和下一步；M9 阶段表对齐既有 review 与 PR #44–47，不推断用户已验收。
5. 补录 Issue #8 在 11 月 14 日的两项反馈，建立 [DEP-SEC-MINIMATCH-01](../../../work-items/tasks/DEP-SEC-MINIMATCH-01.md) planned 卡。没有替用户确定新增产品行为。

## 接下来开发前的事项

| 项目 | 接续动作 |
|---|---|
| 本地门禁失败 | 按 [RUNTIME-CANCEL-02](../../../work-items/tasks/RUNTIME-CANCEL-02.md) 接续子进程取消/清理的稳定失败；首轮与隔离复跑均保留，不加 skip 或放宽预算掩盖失败 |
| 构建依赖安全告警 | Dependabot #48 / GHSA-g3hv-75wg-m249，medium；按 DEP-SEC-MINIMATCH-01 核对上游兼容修复与实际依赖树。当前未修复 |
| M9 公式整批 | A-D 已集成；先明确内置示例默认停用且无 UI 启停开关的产品口径，再准备完整候选与人工验收包 |
| Issue #8 | 浅色主题白线可见性待复现分诊；涨停板起点训练待用户讨论，见[批次反馈表](../../../work-items/milestones/GH-202611.md) |
| Dependabot PR #43 | 独立评审与验证后处理，不能当作过时分支删除 |
| 历史任务/候选 | 旧 v1.2.7 candidate 与仍无验收证据的旧卡不自动关闭；当前维护只对账相关任务，不替历史造验收 |

任务锚点：A1 第 7 项为 `docs/engineering/git-workflow.md`；A2 基础 SHA 与开工 HEAD 相等；A3 按维护卡最终 `docs_impact.update` 的 20 项检查。统一状态经 API 更新；候选和发布批准不改变。
