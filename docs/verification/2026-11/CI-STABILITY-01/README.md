# CI-STABILITY-01 验证记录

> 状态：进行中（本地自测通过，PR 门禁待跑）；基线 4b7156e（main）。
> 任务：verify 测试执行器在“无 Vitest 失败摘要的非 0 退出”时重试一次；真实断言失败不重试。

## 触发证据

- GitHub run 43012581422（PR #22 docs-only）：verify 在 server 测试早期仅打印 4 个文件后直接 exit 1，日志无 Failed Tests / FAIL 摘要；同 PR 的 docs/pr-policy 均 pass，rerun verify 后通过并合入。
- 同类现象此前出现在 run 42990100639（PR #9 第 2 次 verify），亦为无失败摘要的进程级崩溃。
- 与 TEST-BUDGET-02 的 mig 5s 超时不同：后者有 Failed Tests 2 摘要，已单独放宽预算。

## 本地自测（TRAINER_CI_TEST_COMMAND 注入 fake command）

| 场景 | 结果 |
|---|---|
| 成功命令 | runner exit 0，不重试 |
| 真实失败（输出 Failed Tests 1，exit 1） | runner exit 1，不重试（stderr 明确“检测到 Vitest 失败摘要”） |
| 基础设施崩溃（首次 exit 1 无摘要，第二次 exit 0） | 首次 warning + 重试，最终 exit 0 |

## 门禁

| 检查 | 命令 | 结果 |
|---|---|---|
| runner 语法 | node --check scripts/ci/run-tests-with-retry.mjs | exit 0 |
| 自测三场景 | 上表 | 通过 |
| 文档结构/任务卡 | npm run docs:check | 执行中 |
| 状态生成区 | npm run docs:status -- --check | 执行中 |
| 范围/文档影响 | npm run docs:impact -- --base 4b7156e --task CI-STABILITY-01 | 执行中 |
| PR 门禁 | docs / verify / pr-policy | PR #23 run 43013872411：**三 job 全部 success**；verify 首轮即通过（未触发基础设施重试） |

## PR / 合并收据

- PR [#23](https://github.com/m1kuStark/a-share-kline-trainer/pull/23)：fix(ci): CI-STABILITY-01 verify 基础设施崩溃重试。
- CI run 43013872411：docs / verify / pr-policy 全部 success；verify 首轮通过，未出现 infra retry warning。
- squash 合入 main：5dcb88b18b036a49206459e9fa925595645a9a43（2026-11-11 19:45）。
- 合并后 main CI run 43014631742：verify / docs success（pr-policy 非 PR 事件按设计 skipped）。

## 结论

- verify 现在使用 run-tests-with-retry.mjs；真实断言失败不重试，仅无失败摘要的进程级崩溃重试一次并 warning。
- 自测三场景通过；PR 与 main CI 均绿。
- 用户验收未记录。

## 边界

- 重试仅针对“无失败摘要”的进程级崩溃；真实断言失败不重试。
- 第二次仍失败则红灯，不无限重试；不重试 npm ci / build / docs 等其他步骤。
- 重试不改变测试命令、断言、用例集合或数据范围。