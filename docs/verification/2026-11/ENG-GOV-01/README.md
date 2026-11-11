# ENG-GOV-01 验证记录

> 状态：进行中（本地门禁执行中；GitHub 保护配置在合并后回填）。
> 基线提交：`3fa9a76`（main，v1.3.6）；分支：`task/ENG-GOV-01`。

## 交付内容

- L0：`docs/engineering/git-workflow.md`、`commit-convention.md`、`ci.md`、`release.md`；ADR `docs/decisions/0002-git-governance.md`。
- L1：`.githooks/pre-commit|commit-msg|pre-push` + `scripts/git/*` + `npm run hooks:install`（零新增依赖）。
- L2：CI 拆分为 `docs` / `verify` / `pr-policy`；新增 PR 模板与 `.github/dependabot.yml`。
- L3（合并后执行）：main Ruleset、secret scanning/push protection、自动删除头分支、SSH 签名（用户注册签名公钥后启用 required signatures）。

## 本地门禁

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档结构/链接/任务卡 | `npm run docs:check` | 执行中 |
| 状态生成区 | `npm run docs:status -- --check` | 执行中 |
| 构建/类型 | `npm run build` | 执行中 |
| hooks 冒烟 | 合法/非法提交信息、直推 main 模拟 | 执行中 |
| 单测/契约 | 由 PR CI `verify` job 证明（本任务不改产品源码） | 执行中 |

## 已知边界

- 本任务不改产品代码与产品行为；全量 journey 与 `verify:baseline` 不在 PR 内执行，发布门禁仍需按 [CI 门禁](../../../engineering/ci.md)执行。
- 签名需要用户把签名公钥注册到 GitHub；在完成前不启用 required signatures，避免锁死自己。
- GitHub 保护/secret scanning 属于仓库设置操作，证据在合并后的补充记录中回填。
