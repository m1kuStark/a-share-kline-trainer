# CI-01 验证记录：CI 对齐 Windows-only＋dependabot 安全收编

- 任务卡：`docs/work-items/tasks/CI-01.md`
- 执行：zcode:CI-01-dev（2026-10-07 任务，机器时间戳 2026-10-06T18:2x~18:5x UTC）
- base：`ee6c162`（main=origin=base，工作树干净，仅 .control/ untracked 属常态）
- 诊断时间线：`ai-harness-lab/dialogue/batch-20261007-ci-tracker.md`（用户 2026-10-07 拍板 Windows-only；原跨平台修复计划作废；ubuntu 技术根因登记为已知债）
- 提交：`5a3a781` chore(ci): CI-01 windows-only matrix and dependabot security adoption（一轮即绿，无修复轮）

## 一、改动清单（3 文件，60+/7-）

| 文件 | 改动 |
|---|---|
| `.github/workflows/check.yml` | ①文件头加 2 行英文注释（2026-10-07 用户拍板 Windows-only、ubuntu 失败系 Windows 专属测试基建债）；②`matrix.os` 从 `[windows-latest, ubuntu-latest]` 收窄为 `[windows-latest]`。**其余步骤零改动**：checkout@v4／setup-node@v4（node 24.15.0＋npm 缓存）／npm ci／npm run build／npm test／test-results artifact 上传（名称含 `${{ matrix.os }}` 保留）。YAML 解析复验通过（matrix.os=["windows-latest"]，六步骤齐全） |
| `package.json` | 新增 `"overrides": { "shell-quote": "1.12.0" }`（唯一改动；dependencies/devDependencies 零变化，无新增直接依赖） |
| `package-lock.json` | 12 行：`source-map-js` 1.2.1→1.2.2（node_modules/source-map-js 单实例，三父路径 dedupe 共享）；`shell-quote` 1.9.0→1.12.0（npmmirror resolved+integrity 同步） |

## 二、dependabot 收编前后对照

### npm ls（前 → 后）

| 包 | 前 | 后 | 路径（前后一致） |
|---|---|---|---|
| source-map-js | 1.2.1 | **1.2.2** | vite→postcss＋vue→@vue/compiler-dom→@vue/compiler-core＋@vue/compiler-sfc（deduped 单实例） |
| shell-quote | 1.9.0 | **1.12.0 (overridden)** | concurrently@9.2.4 |

### npm audit（前 → 后，`--registry=https://registry.npmjs.org`，本机默认 npmmirror 不支持 audit 端点）

| 项 | 前 | 后 |
|---|---|---|
| shell-quote（critical，GHSA-pqg4-j6r4-53mv，受影响 1.8.4–1.10.0） | 1.9.0 命中 | **清零** |
| source-map-js（high，GHSA-68fv-2mgg-jv7q，受影响 1.0.0–1.2.1） | 1.2.1 命中 | **清零** |
| 总计 | 11（8 moderate＋1 high＋2 critical） | 8（全 moderate，sprintf-js→roarr→global-agent→@electron/get→electron-builder 链） |

### 手段与理由

- **source-map-js**：`npm update source-map-js` 即可——postcss@8.5.26 与 @vue/compiler-core@3.5.42 的范围均为 `^1.2.1`，1.2.2 在范围内。
- **shell-quote**：`npm update` 无效（实测仍 1.9.0）——concurrently@9.2.4 将其**精确钉死**为 `1.9.0`（非 semver 范围），lockfile 层无解。按任务预案用 package.json `overrides` 精确钉 `"1.12.0"`（审计受影响区间 1.8.4–1.10.0，1.11.0+ 安全，1.12.0 为最新）。**不新增直接依赖**，concurrently 本体不动。
- **范围外登记**：剩余 8 条 moderate 全部来自 sprintf-js→electron-builder 链，audit 明示修复需 `--force` 破坏性降级 electron-builder@26.5.0（现 ^26.15.3，会牵动 PACK-05 发布流水线验证结论）——超本任务范围，登记呈报待拍板，不动。

### dependabot PR 处置状态（GitHub API 实证 2026-10-06T18:4xZ）

- 仓库实际仅 1 个 PR：**#1 "chore(deps): bump source-map-js from 1.2.1 to 1.2.2"**（head `dependabot/npm_and_yarn/source-map-js-1.2.2`）——state=closed、**未合并**（merged_at=null）。主仓 lockfile 已含 1.2.2，该 PR 语义已满足，无需任何合并动作。
- shell-quote 无 PR（仅安全告警＋一次失败的 "Dependabot shell-quote update" run id 37487704308）——overrides 收编后 main 清单不再引用受影响版本，GitHub 安全告警预期自动消除。
- 用户无需在 GitHub 点任何合并。

## 三、本地门禁收据

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `npm test` | **1523/1524，exit 1→隔离复跑后归因存量 flaky**。唯一失败：`server/test/review-profile.test.ts > docs-only classification > accepts root README and CONTRIBUTING edits and plain markdown deletions`＝beforeEach `mkdtemp` 15s 钩子超时（4 worker 并行 637s 高负载 Windows 环境性，与本轮零文件交集）。隔离复跑 `npx vitest run --config server/vitest.config.ts server/test/review-profile.test.ts` → **16/16，exit 0**。该 flaky 为 PACK-03/M7-01/PACK-02 三轮已登记同款（docs/verification/2026-10/PACK-03/README.md 等） |
| 构建 | `npm run build` | **exit 0**（typecheck:web＋build:server＋build:web；chunk>500kB 警告为存量提示） |
| lockfile 一致性 | `npm ci --dry-run` | **exit 0**（up to date） |
| 绑定检查 | `check-binding.mjs --strict`×9 矩阵 | **RED=0 全清**；5 矩阵全闭合（account-odometer 8/8、chart-toggles 3/3、launcher-lifecycle 8/8、random-training-mode 18/18、updater 22/22），4 矩阵含设计内 planned open（candle-percent-hover 10/11、conditional-orders 9/20、desktop-app 23/32、kdj-subchart 4/5）——均为存量基线（PACK-05 已录"23 covered/9 open 设计内"），本轮零新增 |

## 四、CI 实测收据（最终 GREEN）

- 提交：`5a3a78107ccf73e86071decda46b2a1dde4f801d`（ee6c162..5a3a781 推送一次成功）
- Run：**id 37513281342**（"Source checks"，run #35，push by m1kuStark，created 2026-10-06T18:41:49Z）
- Run 级：status=completed，**conclusion=success**
- Job 级：**仅 1 个 job `test (windows-latest)`（id 112439672059）——无任何 ubuntu 任务＝矩阵收窄生效证据**；18:41:54Z→18:44:53Z（约 3 分钟）；步骤全 success（checkout/setup-node/npm ci/npm run build/"Test source and compiled launcher"/artifact 上传）
- runner 上全量测试**零失败零 flaky**（本地 1 例环境性 flaky 未在 runner 复现）
- 对照：收编前 ee6c162 上的 run 37487681461（Source checks，双矩阵）conclusion=failure（ubuntu 红）；"Dependabot shell-quote update" run 37487704308 failure

## 五、变异抽检（以 CI 收窄生效证据替代，本任务无测试语义变更）

本任务不改产品码与测试语义，无 oracle 可变异。替代证据＝第四节的 job 清单：新 run 的 jobs 数组中**不存在任何 ubuntu-labeled job**，`test (windows-latest)` 单 job 全绿——若矩阵收窄未生效（改回 `[windows-latest, ubuntu-latest]`），jobs 数组必含 `test (ubuntu-latest)` 且该 job 将复现 ee6c162 上的失败（37487681461 实证 ubuntu npm test 步骤红）。收窄生效已被 runner 端事实锁定。

## 六、待拍板项（needs_user_decision）

1. **sprintf-js→electron-builder 链 8 条 moderate 告警**：唯一修复路径＝`npm audit fix --force` 降级 electron-builder@26.5.0（破坏性，牵动 PACK-05 发布流水线）；本轮按范围冻结未动。
2. **actions 版本升级消 Node20 弃用警告**（checkout@v5/setup-node@v5 等）：纯警告不阻断，本轮未动，是否升留用户拍板。
3. （信息项，无需动作）dependabot PR #1 已 closed-unmerged，主仓收编后语义满足，无需点合并。
