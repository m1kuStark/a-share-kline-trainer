# Git 与 PR 工作流

本页是训练器仓库 Git/PR 的单一来源，与[并行开发](parallel-development.md)（任务/候选工具）、[提交规范](commit-convention.md)、[CI 门禁](ci.md)、[发布](release.md)配套。与用户规格、任务卡或证据冲突时，以更具体的事实为准，并在本页修正。

## 不变量

1. **main 是唯一主线**：任何时刻可构建、CI 绿、已推送；只从 main 切任务分支，只合回 main。
2. **所有变更走 PR**：main 禁止直接 push、force push 和删除；required checks 见 [CI 门禁](ci.md)。
3. **一个任务 = 一个分支 `task/<ID>` = 至多一个 worktree**：分支 ID 与任务卡一致，合并后立即删除。
4. **提交可追溯**：Conventional Commits + 维护者任务分支的 `Task: <ID>` trailer；发布只从 main 打签名 tag。
5. **push ≠ 发布**：main 持续推送；只有 Release / 更新 feed 需要等用户验收。不要再用"验收前不 push"把本地和远端拆成两个项目。
6. **不 rebase 已推送历史**：修正用新提交或 `git revert`；共享历史禁止 `reset --hard`。
7. **短期分支**：一个任务一个分支，不长期养分支；审查/对照 worktree 的生命周期等于一次审查。

## 分支模型

| 场景 | 分支 | 说明 |
|---|---|---|
| 维护者功能/修复 | `task/<TASK-ID>` | 从 main 切出；任务卡先立；ID 全仓一致 |
| 外部贡献（fork） | `feat/<slug>`、`fix/<slug>` | 不强制 task 前缀；维护者合并前建卡并补 trailer |
| 依赖升级 | `dependabot/<...>` | Dependabot 自动；合并前确认 CI |
| 发布 | 不建 release 分支 | 从 main 打 tag，见 [发布](release.md) |

worktree 只在需要并行时使用：目录 `.control/worktrees/<ID>`，一个 worktree 只对应一个分支。任务合并后 `git worktree remove`，主检出回到 main。

## 日常循环

```powershell
$repo = "D:\Superlinear_Academy\Stock_WorkSpace\a-share-kline-trainer"
git -C $repo fetch origin --prune
git -C $repo switch main
git -C $repo pull --ff-only
git -C $repo switch -c task/<TASK-ID>

# 小步提交（至少每步可编译）；分支每天至少 push 一次
git -C $repo add -A
git -C $repo commit -m "feat(scope): <TASK-ID> 摘要" -m "Task: <TASK-ID>"
git -C $repo push -u origin task/<TASK-ID>

# 开 PR（draft 早开；CI 是反馈，不是最后一步）
gh pr create --draft --fill
gh pr ready
# 门禁通过、审查完成后合并（自己的任务 squash）
gh pr merge --squash --delete-branch
git -C $repo switch main
git -C $repo pull --ff-only
git -C $repo push origin main
```

合并后回填任务卡 `integration_ref`（合并提交 SHA）和验证记录；状态变化后运行 `npm run docs:status`，提交前 `npm run docs:status -- --check`。

## PR 规则

- 标题：`<type>(<scope>): <TASK-ID> 中文摘要`；正文含 `Task: <TASK-ID>` 与门禁结果。
- 一个 PR 只做一件事；draft 早开；不把多个任务捆绑进一个 PR。
- 合并策略：**自己的任务 squash**；**外部贡献 merge commit**，保留作者提交与归属；不启用 required linear history。
- 合并后删除头分支；main 拉取后再开始下一个任务。

## 保护与审计

- main Ruleset：Require a pull request、required checks `docs` / `verify` / `pr-policy`、block force pushes、restrict deletions；签名要求（required signatures）在 SSH 签名公钥注册并验证后再启用。
- Secret scanning + push protection；自动删除头分支。
- 每个 commit 可追溯：`Task` trailer → PR → 合并提交 → 任务卡 `integration_ref` → 签名 tag/Release → 验证记录。
- 每周体检：`git fetch -p`、`git branch -vv`、`git worktree list`、`gh pr list`、`gh release list`、main CI 状态、Dependabot/Scorecard。

## 例外

- **紧急 hotfix**：`task/hotfix-<slug>` 从 main 切出，仍走同一 PR 门禁；发布后补任务卡与证据。
- **外部贡献**：见根 [CONTRIBUTING](../../CONTRIBUTING.md)；分支名不强制 task 前缀，但 PR 标题仍需 Conventional Commits。
