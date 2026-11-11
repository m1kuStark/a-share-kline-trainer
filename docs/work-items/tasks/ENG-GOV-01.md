# ENG-GOV-01 工程规范与操作门禁基线

```json
{
  "id": "ENG-GOV-01",
  "title": "工程规范与操作门禁基线（Git/GitHub 执行层）",
  "owner": "integrator",
  "state": "active",
  "milestone": "ENG",
  "base_commit": "3fa9a76",
  "summary": "在现有 ai-harness、任务卡与 verify 门禁之上补齐 Git/GitHub 强制执行层：Conventional Commits 与 Task trailer 校验、本地 pre-commit/commit-msg/pre-push hooks、PR 模板、Dependabot 分组、CI docs/verify/pr-policy 三个必需检查，以及合并后的 main Ruleset、SSH 签名、secret scanning 与自动删分支。不移动现有 docs 目录，不引入第二套流程；并修复首次 push 后 CI 暴露的公式语料绝对路径依赖（无语料时醒目跳过，不掩盖断言）。",
  "next_action": "实现并自验 docs:check / docs:status --check / build / hooks 冒烟；发 PR；合并后配置 GitHub 保护与签名，回填验证记录并收口。",
  "allowed_paths": [
    ".github/workflows/check.yml",
    ".github/dependabot.yml",
    ".github/pull_request_template.md",
    ".gitattributes",
    ".githooks/**",
    "scripts/git/**",
    "scripts/ci/**",
    "scripts/docs/status.ts",
    "server/test/workflow-docs.test.ts",
    "docs/engineering/git-workflow.md",
    "docs/engineering/commit-convention.md",
    "docs/engineering/ci.md",
    "docs/engineering/release.md",
    "docs/engineering/README.md",
    "docs/engineering/testing.md",
    "docs/decisions/0002-git-governance.md",
    "docs/decisions/README.md",
    "server/test/formula-engine/crossPeriod.test.ts",
    "server/test/formula-engine/corpus-smoke.test.ts",
    "server/test/formula-engine/marketContext.test.ts",
    "docs/work-items/tasks/ENG-GOV-01.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/ENG-GOV-01/**",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "package.json"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/engineering/git-workflow.md",
      "docs/engineering/commit-convention.md",
      "docs/engineering/ci.md",
      "docs/engineering/release.md",
      "docs/engineering/README.md",
      "docs/engineering/testing.md",
      "docs/decisions/0002-git-governance.md",
      "docs/decisions/README.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/ENG.md",
      "docs/status.md"
    ],
    "reason": "新增 Git/PR/发布规范与门禁文档、任务卡和阶段卡；CI/hooks/模板属于工程流程变化，需同步索引与状态页；测试语料改为环境变量可覆盖，CI 无语料时醒目跳过。"
  },
  "verification_refs": ["docs/verification/2026-11/ENG-GOV-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-11 拍板：按推荐执行）

- 保留现有 `task/<ID>` 分支、worktree、`npm run task` 和 verify 体系，不推翻。
- main 只经 PR 合入；required checks 为 `docs`、`verify`、`pr-policy`；禁 force push / 删除。
- 提交信息遵守 Conventional Commits；维护者任务分支必须带 `Task: <ID>` trailer。
- 自己的任务 squash merge，外部贡献 merge commit 保留作者；不启用 required linear history。
- 签名采用 SSH 签名；签名与 required signatures 在秘钥注册并验证后再启用。
- **push ≠ 发布**：main 持续推送；Release / 更新 feed 等用户验收。
- 本轮不引入 ESLint/Prettier 全量格式化，不整体采用 BMAD/OpenSpec/Spec Kit 第二套流程，不安装 DSH 插件。

## 范围

- L0 规范：git-workflow / commit-convention / ci / release / ADR。
- L1 本地门禁：`.githooks` + `scripts/git/*` + `npm run hooks:install`。
- L2 PR 门禁：docs / verify / pr-policy 三个 CI job，PR 模板。
- L3 main 保护：Ruleset、secret scanning push protection、自动删除头分支、Dependabot 分组（合并后执行并回填证据）。

## 验收

1. `npm run docs:check` 与 `npm run docs:status -- --check` 0 error。
2. `npm run build` exit 0。
3. hooks 冒烟：合法提交信息通过；缺 `Task:`、非 conventional、直推 main 被拒绝。
4. PR 的 `docs` / `verify` / `pr-policy` 全绿。
5. 合并后：main Ruleset 生效（直推/force push 被拒）、secret scanning 开启、自动删除头分支、签名配置可验证（用户注册签名公钥后启用 required signatures）。
6. 验证记录写入 `docs/verification/2026-11/ENG-GOV-01/README.md`，任务卡 integration_ref 回填。
