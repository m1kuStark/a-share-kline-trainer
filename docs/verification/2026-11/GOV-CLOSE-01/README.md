# GOV-CLOSE-01 验证记录

> 状态：治理收尾；产品代码零改动。基线 8319048（main）。

## 任务状态对账

| 任务 | 收口 | 证据 |
|---|---|---|
| ENG-GOV-01 | closed | PR #9/#19/#20；Ruleset 27018412；required signatures 已启用 |
| TEST-BUDGET-02 | closed | PR #21/#22；mig 用例 30s 预算 |
| CI-STABILITY-01 | closed | PR #23/#24；无摘要崩溃重试 runner |
| ENG-GOV-03 | closed | PR #25/#26；v1.3.4–6 签名 tag + v1.3.6 pre-release |
| TEST-BUDGET-03 | closed | PR #27；CI desktop --testTimeout=30000 |
| GOV-CLOSE-01 | review | 本记录；用户验收后关闭 |

## Dependabot 处置（2026-11-12）

- 已合并：#10（github-actions 分组）、#16（fastify patch）、#12（npm-development 分组）。
- 已关闭：#11（含 klinecharts 10.1.0，违反 10.0.3 钉定）、#13（lucide 1.0 major）、#14（TypeScript 7 major）、#15（Vitest 5 major）、#17（lockfile 冲突，补丁版本稍后重建）、#18（被 #12 覆盖）；均留关闭理由。
- 当前开放 Dependabot PR：0。
- dependabot.yml 已忽略 klinecharts 全部更新与 typescript/vitest/@vitest/mocker/lucide-vue-next major，避免重复噪声。

## 最终状态（本记录写入时）

- main head 8319048；main CI run 43058321672 docs/verify 绿。
- main Ruleset 27018412：PR + docs/verify/pr-policy + 禁 force push/删除 + required signatures；auto-delete 开启。
- 三个签名 tag 与 v1.3.6 pre-release 保持；latest 稳定仍 v1.3.3。
- 产品开发入口：F3（图表布局）/ F2（MT5 测量工具）尚未启动；任务卡历史与状态页可接续。

## 边界

- 本收尾不改产品代码；不启动 F3/F2。
- 分项用户验收未单独记录；治理工作流收口不等于用户对每项产品的验收。