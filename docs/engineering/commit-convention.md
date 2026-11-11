# 提交信息规范

提交信息是审计链的第一环：它把**任务卡**、**PR**、**验证记录**和**发布 tag** 串起来。

## 格式

```text
<type>(<scope>): <TASK-ID> <中文摘要>
<空行>
可选正文（改了什么、为什么）
<空行>
Task: <TASK-ID>
Refs: #<PR 编号>
Evidence: docs/verification/YYYY-MM/<TASK-ID>/
```

- 第一行 ≤ 100 字符；中文摘要可用，结尾不加句号。
- `type`：`feat`、`fix`、`docs`、`test`、`refactor`、`perf`、`chore`、`build`、`ci`、`revert`。
- `scope`：`server`、`web`、`desktop`、`chart`、`train`、`recording`、`e2e`、`docs`、`release`、`deps`、`governance`、`security`、`runtime`、`gate` 等模块名。
- **维护者的 `task/<ID>` 分支必须带 `Task: <ID>` trailer，且与分支 ID 一致。**
- `Evidence` 可选；产品行为/bug 交付建议填验证记录路径。
- 破坏性变更：type 后加 `!`，并在正文写 `BREAKING CHANGE: ...`。

## 示例

```text
feat(chart): CHART-LAYOUT-01 主图与副图窗格铺满可用高度

- 初始化/resize/切周期后按比例分配，消除底部空白
- 不改成交标记带与录像 paneHeights 契约

Task: CHART-LAYOUT-01
Refs: #13
Evidence: docs/verification/2026-11/CHART-LAYOUT-01/README.md
```

```text
fix(server): DATA-05 盘后新鲜度误判改用官方交易日历

Task: DATA-05
```

## 豁免

- 合并提交（`Merge ...`）、`Revert ...`、交互式 rebase 的 `fixup!`/`squash!` 不校验。
- 外部贡献（fork）允许无 `Task` trailer；维护者合并前在 PR 中建卡并补 trailer。
- Dependabot 分支允许 `chore(deps): bump ...` 形式。

## 校验

- 本地：`npm run hooks:install` 后由 `.githooks/commit-msg` 校验；规则在 `scripts/git/check-commit-msg.mjs`，与 Conventional Commits 对齐，零新增依赖。
- CI：PR 标题与任务卡由 `pr-policy` job 校验（见 [CI 门禁](ci.md)）。
- 使用 squash 合并时，**PR 标题就是最终 commit 标题**，因此 PR 标题也必须符合本规范。
