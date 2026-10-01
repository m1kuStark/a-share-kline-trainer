# GPT 与 GLM 协作框架改进提案

本文将 K 线训练器当前的 GPT、GLM、zcode 协作方式，整理为可以长期运行的受控工作流。目标是让 GPT 保留产品决策和验收权，让 GLM 负责边界清晰的实现，让 zcode 负责重复执行、测试和候选包构建，同时降低上下文重复传递和 Codex 额度消耗。

## 当前落地状态（2026-10-01）

`.control/trainer-state.json`、`scripts/workflow/state.ts`、状态 CLI 和 `docs:status` 漂移守卫已进入源码候选；它们把任务、候选、作业、运行、产物和验收作为一个可读写快照，并保留事件历史。GLM 看板、Git candidate、zcode DWF 和任务卡仍需要逐项接入适配器与真实事件投影；未写入统一状态或缺少提交/运行证据的结论保持 `waiting_control` 或“未记录”。本提案描述目标架构和剩余落地顺序，不代表自动发布已启用。

## 当前问题

- 任务看板、zcode 工作流和 Git 工作树各自维护状态，状态变化没有统一事件记录；同一任务可能在看板、任务卡、验证报告和分支上出现不同结论。
- GPT 与 GLM 之间主要传递自然语言，契约、证据、提交和失败原因需要人工重新拼接，容易让 GLM 扩大改动范围或重复执行已经完成的检查。
- 失败后通常只能留下“失败”文本，缺少可重放的命令、环境、提交、检查集合和失败分类；同类问题不能直接复用修复策略。
- zcode 的自动循环可以持续执行，但依赖范围、端口隔离、干净工作树和发布前置目前仍以提示为主，无法阻止错误候选继续进入打包阶段。
- 现有日志缺少统一的成本与干预指标，暂时不能证明自动化确实减少了 GPT 调用量或人工时间。

## 建议架构

```text
GPT Controller
  ├─ 决策：需求、范围、验收标准、是否允许返修
  ├─ Contract：JSON 任务契约、允许文件、依赖、检查集合
  └─ Acceptance：独立读取 diff、证据和候选 manifest
          ↓
Task Board + Event Ledger
  ├─ task.created / leased / handoff / verified / rejected / promoted
  ├─ 每个事件绑定 task_id、commit、worktree、run_id 和 schema_version
  └─ 看板、任务卡、状态页从同一事件账本派生
          ↓
GLM Worker
  ├─ 只读取冻结契约和相关文件
  ├─ 只在独立 worktree 实现，不改变任务范围
  └─ 返回 patch、测试输出、失败分类和下一步建议
          ↓
zcode Runner
  ├─ 领取契约并按固定顺序执行 RED/GREEN、类型检查、构建、Journey
  ├─ 失败即停止，保存完整 run manifest 和可重放命令
  └─ 仅在 proof 完整且提交未漂移时生成候选包
          ↓
GPT Verifier / User Acceptance
  ├─ 验证 diff、证据与契约三者绑定
  ├─ 将失败分为代码、环境、数据、契约和用户验收五类
  └─ 通过后才允许 promote/tag/release
```

## 交接契约

每个任务使用一个版本化 JSON 契约，至少包含 `task_id`、`contract_version`、`baseline_commit`、`allowed_paths`、`depends_on`、`acceptance_checks`、`tdx_root_policy`、`port_policy` 和 `stop_conditions`。GLM 返回同结构的结果，增加 `candidate_commit`、`changed_paths`、`run_id`、`proof_refs`、`failure_class` 和 `replan_required`。

契约只允许引用相对路径和受控数据别名；个人绝对路径、隐式端口、未声明的依赖和“顺便修复”均视为契约错误。交接时只传契约、当前状态摘要和必要证据索引，不传完整历史对话。

## 自动化门禁

1. Controller 创建任务并冻结基线、范围和验收集合。
2. Worker 在独立 worktree 执行实现；超出 `allowed_paths`、依赖未满足或工作树变脏时立即停止。
3. Runner 使用固定端口和隔离运行目录执行测试、构建和 Journey；每一步写入 `run-manifest.json`，记录命令、版本、环境摘要、退出码和输出路径。
4. Verifier 对候选提交重新读取契约，独立检查 diff、proof 的提交绑定、文档检查和包 manifest；任何一项失败都生成 `replan_required`，禁止继续打包。
5. 只有通过候选门禁且用户验收状态满足发布策略时，才允许 promote、tag 和 GitHub 发布。

## 分阶段落地

- **阶段一：统一记录**。复用现有 task/worktree/verify 脚本，先定义事件账本与 `run-manifest.json`，让看板、状态页和验证报告引用同一个 `run_id`。
- **阶段二：强制契约**。把允许文件、依赖、端口、TDX 数据策略和停止条件从提示改为脚本校验；新增契约版本迁移和旧任务只读兼容。
- **阶段三：受控自动规划**。只允许 GPT 根据未关闭任务和失败分类生成下一张卡，GLM 不得自行扩大范围；连续失败达到阈值时停止并交 GPT 复核。
- **阶段四：成本评估**。按“每个通过候选”记录 GPT/GLM 调用次数、输入输出 token、人工介入分钟、重跑次数、缺陷逃逸和发布成功率，与当前人工流程对照至少两轮。

## 近期试点

以 V1.1.1 用户反馈修订作为试点：把用户确认式 TDX 目录选择、成绩单/指数图、排行分组和设置面板拆成独立契约任务；zcode 只执行对应检查集合；GPT 复核同一候选的 diff、统一状态事件和包 manifest。试点期间保留人工发布确认，不自动 tag、push 或公开发布；先完成状态一致性和证据复用，再评估成本收益。
