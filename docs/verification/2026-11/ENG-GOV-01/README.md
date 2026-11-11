# ENG-GOV-01 验证记录

> 状态：工程验证完成（review）；用户验收未记录。
> 基线：`3fa9a76`（main，v1.3.6）｜主交付 PR：[#9](https://github.com/m1kuStark/a-share-kline-trainer/pull/9)，squash 合入 main `302a902`。
> 本记录为 docs-only 收口；产品代码行为未变。

## 一、交付内容

- **L0 规范**：`docs/engineering/git-workflow.md`、`commit-convention.md`、`ci.md`、`release.md`；ADR `docs/decisions/0002-git-governance.md`；`AGENTS.md`/`CONTRIBUTING.md`/索引同步。
- **L1 本地门禁**：`.githooks/pre-commit|commit-msg|pre-push` + `scripts/git/*`（零新增 npm 依赖），`npm run hooks:install`；pre-commit 空白/高置信密钥，commit-msg Conventional Commits + `Task: <ID>`，pre-push 禁直推 main。
- **L2 PR 门禁**：CI 拆为 `docs` / `verify` / `pr-policy` 三个 required checks；PR 模板；`.github/dependabot.yml` 分组升级。
- **L3 main 保护**：Ruleset `main-protection`（id `27018412`，active）、自动删除头分支、secret scanning/push protection（复核已启用）。
- **CI 可移植性修复**：M9 公式语料测试不再硬编码工作区绝对路径；`TRAINER_TDX_FORMULA_DIR`/`TRAINER_FORMULA_CORPUS_DIR` 可覆盖，无目录时醒目跳过（保留其余合成夹具覆盖）；CI 无统一状态时状态新鲜度显式降级 WARN。

## 二、本地门禁

| 检查 | 命令 | 结果 |
|---|---|---|
| 文档结构/链接/任务卡 | `npm run docs:check` | **0 errors**（157 条既有长度 WARN） |
| 状态生成区 | `npm run docs:status -- --check` | **0 errors** |
| 范围与文档影响 | `npm run docs:impact -- --base 3fa9a76 --task ENG-GOV-01` | **0 errors** |
| 构建/类型 | `npm run build` | exit 0 |
| 公式语料定向 | `npx vitest run --config server/vitest.config.ts server/test/formula-engine/{crossPeriod,corpus-smoke,marketContext}.test.ts` | 22/22、7/7、14/14 |
| 文档工具定向 | `... server/test/workflow-docs.test.ts server/test/docs-tooling.test.ts` | 3/3、30/30 |
| hooks 冒烟 | 合法提交信息 exit 0；缺 `Task:` exit 1；坏 header exit 1；密钥扫描 clean exit 0；pre-push task 分支 exit 0 / main 引用 exit 1 | 全部符合预期 |
| PR policy 冒烟 | 合法 PR 事件 exit 0；缺 Task exit 1 | 符合预期 |
| 全量单测 | `npm test` | 2613 passed / 2 failed：`release-launcher PORT-01`，因本机运行中的 v1.3.6（PID 21008）占用 8787，属环境占用；CI `verify` 全绿覆盖同一套件 |

## 三、CI / 合并收据

- PR #9 最终 CI（run [42991157373](https://github.com/m1kuStark/a-share-kline-trainer/actions/runs/42991157373)）：`docs`、`verify`、`pr-policy` **全部 success**。
- 合并：PR #9 squash → main `302a9029be5a4ab87e34f4a7f960ce645e3f8713`（2026-11-11 17:03）。
- 合并后 main CI（run `42991957300`）：`docs`、`verify` **success**；`pr-policy` 非 PR 事件按设计 skipped。
- 首次 push 暴露并修复的 CI 问题（均留在 PR #9 历史中）：`crossPeriod` 工作区绝对路径（run 42986468657 failure）→ `be8a466`；无统一状态时 docs 状态过期（run 42989230331 docs failure）→ `53473fb`/`d925b6c`。

## 四、GitHub 保护结果

- Ruleset `main-protection`（id `27018412`，target `refs/heads/main`）active：
  - Require a pull request（approvals 0，solo 可用）
  - Required status checks：`docs`、`verify`、`pr-policy`
  - Block force pushes（non_fast_forward）
  - Restrict deletions
  - bypass actors 为空
- `delete_branch_on_merge=true`（自动删除头分支）。
- Secret scanning 与 push protection 状态复核为 **enabled**（仓库托管侧）。
- **签名**：已生成 SSH 签名密钥 `~/.ssh/a-share-kline-trainer-signing`，仓库本地已配置 `gpg.format=ssh`、`user.signingkey`、`commit.gpgsign=true`、`tag.gpgsign=true`；本记录之后的收口提交已签名。GitHub 侧注册公钥需要 `admin:ssh_signing_key` 权限，当前 gh token 无该 scope，**待用户注册后启用 required signatures**（避免先开启锁死自己）。
- 公钥（ssh-ed25519）：`AAAAC3NzaC1lZDI1NTE5AAAAIAv2PpMQlEJFQzXFyiKjN0Kifoqufa4Snogu2YvQ4asq`。

## 五、追溯链

`ENG-GOV-01` 任务卡 ↔ 分支 `task/ENG-GOV-01` ↔ 提交 `56d660f`（基线）、`be8a466`（语料守卫）、`53473fb`+`d925b6c`（docs CI） ↔ PR #9 ↔ main `302a902` ↔ 本验证记录。任务卡 `integration_ref=302a902`。

## 六、未做 / 下一步

- 用户注册 SSH 签名公钥后，验证 GitHub Verified 并启用 required signatures；再做一次受保护 PR 验证。
- PR #7 已被 GitHub 自动标记 **merged**（mergeCommit `7e36136`）；Dependabot 旧 PR #4/#5/#6 已由本地升级与新版分组覆盖关闭；新分组/大版本 PR #10～#15 按正常门禁单独处理。
- ENG-GOV-03（发布 tag/追溯）、ENG-GOV-04（CodeQL/Scorecard/dependency-review）、Issue #8 回执与 v1.3.4～v1.3.6 tag 决策在后续任务推进。
- 用户验收：本任务工程验证完成，用户验收未记录。

## 七、签名验证

- GitHub SSH signing key 已注册（key id `1322370`，2026-11-11 17:53：`a-share-kline-trainer signing 2026-11-11`，指纹 `SHA256:hrJ1UqZdl3TB0gvY8QR1+qJm6vI4WKaqNtPXXXyhdM8`）。
- 本提交用于验证 GitHub Verified；验证结果与 required signatures 启用记录在收口提交中回填。
