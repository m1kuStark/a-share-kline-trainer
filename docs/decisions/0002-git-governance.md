# 0002 Git 与发布治理

状态：accepted；日期：2026-11-11；执行：[ENG-GOV-01](../work-items/tasks/ENG-GOV-01.md)；验证：[ENG-GOV-01 记录](../verification/2026-11/ENG-GOV-01/README.md)。

## 背景

2026-11-11 体检发现：真正的最新代码在工作树的 `verify-pr7` 分支，本地 main 落后 46 个提交，origin/main 落后 69 个提交；main CI 自 10-24 起红、PR #7 已本地合入但仍 open、v1.3.4～v1.3.6 无 tag。根因不是缺文档，而是**缺少强制执行层**：没有 branch protection、没有 commit 校验、没有签名、没有把任务/证据/发布串起来的机器可读链。

## 决策

1. **trunk-based**：main 唯一主线 + 短期 `task/<ID>` 分支 + PR；不引入 git-flow 的 develop/release 长期分支。
2. **main Ruleset**：Require PR、required checks（`docs`/`verify`/`pr-policy`）、禁 force push/删除；签名要求在 SSH 公钥注册并验证后启用。
3. **提交链**：Conventional Commits + 维护者 `Task: <ID>` trailer + SSH 签名；外部贡献豁免 Task trailer，合并用 merge commit 保留作者。
4. **门禁分层**：本地 hooks 快速拦截；PR 跑 docs/build/test/policy；全量 verify:baseline 与 journey 作为发布门禁，不塞进每个 PR。
5. **发布**：只从 main 打签名 tag；稳定/预览通道分离；push main 与发 Release 解耦。
6. **零新增依赖**：hooks 用 Node 脚本 + `core.hooksPath` 实现，不引入 commitlint/lefthook 二进制；规则与 Conventional Commits 对齐，减少供应链面。

## 被否决的替代方案

- 继续本地直推 main / 只靠文档：会重复 69 提交积压与远端失真。
- 引入第二个方法论（BMAD/OpenSpec/Spec Kit 全套）：与现有 ai-harness、任务卡、docs/specs 形成两个真相。
- 立即上 release-please 或全量 ESLint/Prettier：变更面过大，先稳定执行层再评估。
- required linear history：与外部贡献 merge commit 的归属保留冲突，暂不启用。

## 后果

- 多一步 PR 与 hook 成本；换来 main 可审计、可回滚、可自动化。
- Ruleset 与 required checks 的 job 名成为契约；改 CI 必须同步改 Ruleset。
- 签名是唯一需要用户手动注册公钥的步骤；在完成前不启用 required signatures，避免锁死自己。
- 后续 ENG-GOV-03（发布追溯）、ENG-GOV-04（安全审计）在此基线上推进。
