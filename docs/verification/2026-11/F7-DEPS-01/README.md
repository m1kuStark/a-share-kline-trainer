# F7-DEPS-01 验证记录（2026-11-07）

任务：依赖安全升级（Dependabot PR #4/#5/#6 的本地等价 chore；用户 2026-11-07 Q9 拍板）
基线：`ae9f6b8`（UI-TOOLBAR-01）｜工作树 `verify-pr7`
证据提交：本记录随 `chore(deps): F7-DEPS-01 …` 提交

## 变更（package.json / package-lock.json）

| 依赖 | 升级前 → 升级后 | Dependabot PR | 主要内容 |
|---|---|---|---|
| vite（devDependencies，范围 ^7.3.7） | 7.3.6 → **7.3.7** | #4 | 3 项 bug fix（launch-editor、transformIndexHtml、safeModulePaths） |
| fast-uri（ajv 嵌套 / 根） | 3.1.8 → **3.1.9**；4.2.1 → **4.2.3** | #5 | 4 个 URI 解析/规范化安全修复（CVE-2026-110306/110180/110095/110725） |
| undici（node-gyp 嵌套 / 根） | 6.29.0 → **6.29.1**；7.30.0 → **7.30.1** | #6 | 5 个 TLS/DoS/EventSource/WebSocket 安全修复（含 3 个 High） |

保留项目版本 1.3.3（PR 分支里的 1.2.7→1.3.x 为旧 base 漂移，不采纳）。

## 真实安装验证（非仅改 lock）

`npm install --ignore-scripts --no-audit --no-fund` 后实测（工作树真实 node_modules）：

- `vite/package.json` = **7.3.7**
- 根 `fast-uri` = **4.2.3**；`node_modules/ajv/node_modules/fast-uri` = **3.1.9**
- 根 `undici` = **7.30.1**；`node_modules/node-gyp/node_modules/undici` = **6.29.1**
- `git status` 仅 package.json / package-lock.json 变更

## 门禁收据

| 命令 | 退出码 / 结果 |
|---|---|
| `npm run build`（升级后依赖） | **0** |
| `npm test` | **0**：server 175 文件 / 2604 用例；desktop 34 文件 / 367 用例全部通过 |
| `npm run docs:check` / `docs:status -- --check` | **0 errors** |
| `npm run docs:impact -- --base ae9f6b8 --task F7-DEPS-01` | **0 errors** |
| `npm run journey -- e2e/toolbar-floating.spec.ts --retries=0` | 待填 |

## 发布边界

- 本 chore 不含产品行为/规格变化；升级后全量门禁通过。
- 随整批合并 main 并 push 后，关闭 Dependabot PR #4/#5/#6，说明已由本地等价提交覆盖（提交哈希随最终 push 记录）。
- 旧安装包/发布产物不回填；后续发布使用升级后的 lockfile。

## 失败与修复

- 无门禁失败。npm install 因工作树 node_modules 原为 junction 而改为真实安装（441 包），此后所有测试均在新依赖上运行。
