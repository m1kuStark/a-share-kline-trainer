# SETUP-PASTE-01 验证记录（2026-11-07）

任务：连接通达信弹层支持手动输入/粘贴目录路径（Issue #8-B，用户 2026-11-07 拍板）
基线：`3a91c4c`（TRAIN-FEE-01）｜工作树 `verify-pr7`
证据提交：本记录随 `feat(setup): SETUP-PASTE-01 …` 提交

## 改动摘要

- `web/src/App.vue`：顶栏「连接通达信」点击后先打开弹层，提供「手动输入/粘贴路径 → 检查路径 → 保存并连接」与「浏览文件夹…（Windows 目录选择器）」两条入口；手动路径必须 `recognized && readable` 才启用保存；保存复用既有 `save-choice → apply → 受控重启` 链路；取消/失败不改动当前连接。SETUP-01 边界不变：不自动发现、不扫描候选、只校验用户确认的单个目录。
- 弹层支持 Enter 触发检查、错误/成功内联提示、深色主题与 840/1280/1440 布局。
- `e2e/data-update.spec.ts` f)：连接入口改为先断言弹层可见，再点「浏览文件夹…」等待原生选择器请求（保持原生命令桥行为锁定）。
- 新增 `e2e/setup-paste.spec.ts`：手动粘贴深层路径（含空格）成功链路（请求体路径精确、save/apply 各一次、不调用 select-directory）、非法目录门控与取消零写入、1280/1440 不溢出与 pageerror。
- 文档：`docs/user/install.md` 首配说明改为「手动输入/粘贴或原生选择器」；矩阵 `tdx-path-settings.yaml` 新增 4 行（手动检查门控/保存应用/取消零写/原生浏览保留）。

## 门禁收据（最终一轮，工作树 verify-pr7）

| 命令 | 退出码 / 结果 |
|---|---|
| `npm run build` | **0** |
| `npm test` | **0**：server 173 文件 / 2596 用例；desktop 34 文件 / 367 用例全部通过 |
| `npm run docs:check` | **0 errors** / 144 warnings |
| `npm run docs:status -- --check` | **0 errors** |
| `npm run docs:impact -- --base 3a91c4c --task SETUP-PASTE-01` | **0 errors** |
| `check-binding --matrix tdx-path-settings.yaml --strict --include-untracked` | **RED=0**；新增 4 行 covered；**exit 3 仅因既有 2 行 planned**（SETUP-PICK-SETTINGS-BUSY / SETUP-ENV-APPLY-REJECTED，base 即登记的未闭合债务，非本任务引入） |
| `npm run journey -- e2e/setup-paste.spec.ts e2e/data-update.spec.ts --retries=0` | **0**：10/10 通过（20.6s，run `run-bc4cc60c`） |

## 失败与修复（如实保留）

1. 首轮 journey：`setup-paste` 两条通过，`data-update` f) 超时——根因是多行替换未命中，测试仍按旧行为（点击后直接等 select-directory）；改为逐行替换后重跑 10/10 通过。
2. 首轮全量测试受并行负载影响出现 2 个已知 flaky 超时（review-profile、worktree-tools）→ 隔离复跑 44/44 通过；最终轮全量 2596/2596 通过。
3. 主代理视觉检查发现连接弹层在 1440 深色下布局完整、按钮禁用态清晰；无 pageerror、无横向溢出。

## 视觉检查（主代理，真实页面截图）

- 1440 深色：[connect-dialog-1440-dark.png](connect-dialog-1440-dark.png)（非法路径内联原因、保存禁用）。
- 1280 深色：[connect-dialog-1280-dark.png](connect-dialog-1280-dark.png)（无溢出/遮挡）。

## 已知边界

- 弹层只做单目录校验；不做自动发现/候选扫描（SETUP-01 红线）。
- 手动路径保存后仍走受控重启；env/explicit-config 钉死来源的 apply 拒绝属既有 SETUP-01 行为（本轮未改动）。
- 本记录为用户整批验收前的工程证据，不代表用户验收。
