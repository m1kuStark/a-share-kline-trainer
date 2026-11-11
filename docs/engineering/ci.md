# CI 与门禁

本文回答"什么检查在什么时候证明什么"。产品行为规则在 [specs](../specs/README.md)，测试细节在[测试门禁](testing.md)，Git/PR 流程在[Git 工作流](git-workflow.md)。

## 分层

| 层 | 触发 | 命令 | 证明范围 |
|---|---|---|---|
| L1 本地 pre-commit | 每次 `git commit` | `git diff --cached --check`、`scripts/git/check-staged-secrets.mjs`；docs 变更时 `npm run docs:check` | 空白错误、高置信密钥、文档断链 |
| L1 本地 commit-msg | 每次 `git commit` | `scripts/git/check-commit-msg.mjs` | Conventional Commits + Task trailer |
| L1 本地 pre-push | `git push` | `scripts/git/check-push.mjs` | 禁止从当前分支直推 main；分支命名提示 |
| L2 PR `docs` | PR / push main | `npm run docs:check`、`npm run docs:status -- --check` | 链接、任务卡元信息、状态生成区 |
| L2 PR `verify` | PR / push main | `npm run build`、`npm test` | 类型/构建/单测/契约/launcher |
| L2 PR `pr-policy` | PR | `node scripts/ci/check-pr-policy.mjs` | PR 标题、Task 卡、分支名 |
| L3 发布候选（本地/手动） | 发布前 | `npm run verify:baseline`、`journey:parallel` | 全量单测 + 全量 journey + 文档/构建/M2 |
| L4 发布 | tag | 发布检查清单 + 资产 SHA256 + 用户验收 | 可发布性（见 [发布](release.md)） |

`verify:baseline` 和 journey 需要本机 TDX 样本与 Edge，**不放进每个 PR**；PR 只跑快速门禁，发布前再跑一次全量并保留收据。

## 本地安装

```powershell
npm ci
npm run hooks:install   # 设置 core.hooksPath=.githooks；npm install 的 prepare 也会执行
```

hooks 是本地提示与快速拦截，**不是唯一防线**；main Ruleset 与 required checks 才是强制边界。可在 `.git/hooks` 之外用 `npm run hooks:install` 复装。

## CI jobs 与 required checks

`.github/workflows/check.yml` 在 Windows 上运行：

- `docs`：`npm ci` → `docs:check` → `docs:status -- --check`。
- `verify`：`npm ci` → `npm run build` → `npm test`，保留 test-results.json artifact。
- `pr-policy`：仅 PR；校验标题 conventional、同仓 `task/<ID>` 分支的 `Task: <ID>` 与任务卡存在；fork PR 只要求标题规范。

main Ruleset 的 required checks 使用这三个 job 名（`docs`、`verify`、`pr-policy`）。修改 job 名时必须同步更新 Ruleset，否则 PR 会永远等待旧检查。

## 失败处理

- 新失败 → 修；不能删断言、加 skip、放宽验收来自证通过。
- 已知环境 flaky → 只复跑失败项，保留隔离收据，并在验证记录写清；不得把 flaky 当通过。
- docs 失败 → 先修链接/任务卡/生成区；不要手改 `docs/status.md` 生成区。
- CI 红时 main 不再接收新变更，优先修红（见 `gh-fix-ci` 流程）。

## 证据

PR 描述附命令、退出码、CI run 链接；发布候选的完整收据写入 `docs/verification/YYYY-MM/<ID>/README.md`，包含 testedCommit、环境、失败与复跑。CI 通过不等于用户验收。
