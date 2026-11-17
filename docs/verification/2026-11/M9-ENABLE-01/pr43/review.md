# PR #43 独立只读评审

日期：2026-11-18，Asia/Shanghai。裁决：**修后可合（先补当前主线集成与 Electron 实机验证；目前不直接合入）**。Critical 0 / Important 2 / Minor 0。未发现需要修改该依赖补丁的静态代码缺陷；“修后”指补齐以下验证缺口，不要求为了通过审查另改产品逻辑。

## 对象与证据身份

- GitHub：`github.com`，账号 `m1kuStark`，仓库 `m1kuStark/a-share-kline-trainer`；CLI 安装、认证及身份检查均成功。
- PR head：`87c368f2556ba25d3fceef14ea89065307dc8ef0`；OPEN、MERGEABLE、CLEAN；一笔 Dependabot 提交，只改 `package.json` 和 `package-lock.json`。
- `git/ref/heads/main` 与本地 main 均为 `2c66477f0c4875ac3a100338fdbc42b4878dadd8`。PR 的 `baseRefOid=53b516f6a12738faf492272b3173befe6e9e435d` 是分叉点，不能当当前 main；从真实 main 比较为 ahead 1 / behind 10。
- 缓存：`pr43.json`、`pr43.diff`、`compare-current-main.json`、`main-since-fork.json`、`pr-package.json`、`pr-package-lock.json`。
- diff SHA256：`ebe313009932aac6d4d09955960f44feb329b2447092807e204af42434a5a0c9`。

## 具体变更与兼容分析

| 包 | main → PR | 上游变更与集成判断 |
|---|---|---|
| `@vitejs/plugin-vue` | 6.0.10 → 6.0.11 | 2026-11-12：修复模板编辑后撤回脚本时 HMR 的重载行为；移除 Vapor 的 `__multiRoot` 标记。工程 `web/vite.config.ts:6` 使用标准 `vue()`，未启用 Vapor，当前 Vue 3.5.45 仍满足 `^3.2.25`；peer 的 3.6 RC 分支由 rc.10 改 rc.15 不排除稳定 3.5。 |
| `vite` | 7.3.7 → 7.3.8 | 2026-11-09：修复虚拟模块解析 ID 的转义；Node 范围仍 `^20.19.0 || >=22.12.0`，容纳项目 Node 24.15.0；未更换主版本或配置接口。需在当前新增 Vue 公式界面上重做构建与页面交互。 |
| `electron` | 44.10.2 → 44.11.3 | 同 44 主版本内的 minor/patch。44.11.0 增加 Windows 菜单高亮 API，并修复权限回调、重定向、鼠标事件转发与上传流；44.11.1/3 回移浏览器/图形/V8 修复；44.11.2 撤销信任 eMudhra 被撤销的 RSA 中间证书，另修 macOS 通知观察者；44.11.3 修复 DevTools Fetch 恢复时的崩溃。官方说明未列 breaking API，仍需验证真实二进制、渲染与生命周期。 |

锁文件为 v3；相对 main 只有根记录与上述三个包记录改变，没有其他包的增删或版本变化；plugin-vue 的 Vue peer 变化已解释。`shell-quote: 1.12.0` override 保留，klinecharts 10.0.3 未动。三项均符合 `.github/dependabot.yml` 的日常 minor/patch 范围，不触发 major 专项要求。若后续自动重建分支把范围扩大到其他 major，须重新审查。

PR 内七处 minimatch 与 main 完全相同：3.1.5 / 9.0.9 / 3.1.5 / 5.1.9 / 11.0.5 / 10.2.6 / 3.1.5；其中顶层 10.2.6 与 universal 下 9.0.9 没有被修复。PR43 是独立例行维护，不能作为 DEP-SEC-MINIMATCH-01 的安全修复证据。若安全维护先合入，刷新 PR43 时须保留该任务三条定向链的 override 与锁文件结果，不能用旧锁文件整体覆盖。

## 优点

- `package.json:61/63/67` 与 lock 根 devDependencies、各包 version/resolved/integrity 同步，差异范围清楚。
- `web/vite.config.ts:2/6` 的标准 Vue 插件用法与新 peer 范围兼容；未引入升级后的预发行 Vue 或新的构建器。
- 没有删测试、加 skip、放松断言、改工作流或修改产品逻辑；klinecharts 钉定和 major 忽略策略保持原样。

## 问题

### Important 1：旧 CI 未覆盖当前主线新增的公式产品链路

位置：PR43 head `87c368f` 的 run `43922271829`；当前 `web/src/components/FormulaSettings.vue`、`KlineChart.vue`、`web/src/formulaIndicators.ts` 与公式构建接线。

证据：docs / verify / pr-policy 全部 SUCCESS，但该 run 于 2026-11-16 在 head87c368f 运行，分叉点是 M9-04A。当前 main 之后的10个提交包含 M9-04B 管理界面、04C 图表挂载、04D 示例/Agent 接口及相应新增回归。旧 run 的 build/test 无法证明这些代码与新 Vite/plugin-vue 的组合通过。

影响：把旧绿色直接当成当前主线依赖集成通过，会漏掉新 SFC 编译、公式动态挂载/刷新及引擎 bundle 的集成回归。MERGEABLE/CLEAN 只证明可合并和现有 GitHub 条件，不能补上这项证明。

修法：由 root 在独立候选中试合并当前 main（或安全维护先落地后的主线），重新正常 `npm ci`、`npm run build`、`npm test`，并复验公式管理/图表的现有浏览器用例和受影响真实交互。记录准确候选 commit/tree、字面退出码；已知本地基线失败逐名对照，不能用隔离复绿拼整轮全绿。通过后再刷新 PR checks 和审查 SHA。

### Important 2：Electron runtime 升级缺少真实 Electron 与 Windows 包验证

位置：`package.json:63`、`.github/workflows/check.yml:46/48`、`desktop/vitest.config.ts:6`。

证据：CI 的 `npm run build` 只运行 Web 类型检查、server 和 Web 构建（`package.json:16`），不运行 `build:desktop:main` 或 desktop 打包。desktop 369 测试在 Node 环境运行，没有证明 Electron44.11.3 的 BrowserWindow/preload、实际 Chromium 渲染与打包资源正常。

影响：新的 Electron 二进制和内嵌浏览器/图形引擎是此 PR 实际分发变化；现有 Node 测试和静态 peer 校验不足以验证沙箱 preload、SQLite/子进程宿主、正常退出/端口释放、Canvas 图表及安装/便携包形态。

修法：由 root 安排本次候选的 desktop main 编译和当前手册规定的 Windows 候选打包，在隔离数据目录中真实启动，核对 `process.versions.electron=44.11.3`、版本/提交/SHA256、图表与公式窗格、preload 更新窄接口、退出及子进程释放；验证包内公式引擎 bundle。此项不要求发布 Release、上传 feed 或改个人数据。

## 五维结论

| 维度 | 结论 |
|---|---|
| 计划对齐 | 符合 DEP-POLICY-01 的例行 minor/patch 分组；不承担 minimatch 安全任务，不更改交易/防未来口径。 |
| 代码质量 | 元数据一致，只有三个依赖记录的预期变化；未见新增源码缺陷或额外包漂移。 |
| 架构与集成 | Node/Vue peer 静态兼容；当前主线的新增公式链和 Electron 实际宿主仍需补验，形成两项 Important。 |
| 测试真实性 | 缓存的真实 Windows CI 日志为 server 185 files/2641 tests、desktop 34 files/369 tests 通过；未出现基础设施重试 marker。无删断言/加 skip。它们属于旧分叉范围，不代表当前候选、Journey、UI 或包通过。 |
| harness 收据 | 已核查 CI 的命令和终态；分组依赖更新没有新增行为 oracle，不强求伪造 RED。未运行本地 check-binding、vitest list 或矩阵变异，不能声明相关门禁通过；试合并验证的命令/退出码、绑定范围与候选身份须由 root 补录，台账也由 root 单写。 |

## 搁置不判

- 不判当前 main 与 PR 的动态兼容、Electron 二进制启动、真实 UI、Journey、Windows 包及升级迁移是否通过；本轮按任务限制没有执行安装、构建、测试、打包或试合并。
- 不判 DEP-SEC-MINIMATCH-01 拟采用的 11.0.9 定向 override 兼容性或告警关闭；该变更不在 PR43 中。
- 不判用户是否接受 M9 限制或批准发布；依赖审查不生成这些授权。

## root 可接续步骤

1. 明确 PR43 与 minimatch 安全修复的落地顺序；建议安全修复先完成，PR43随后刷新，避免旧锁文件盖回安全结果。
2. 在独立候选中试合并并安装，执行当前主线的构建、完整测试和受影响公式交互回归，保留已知失败对照。
3. 补 Electron44.11.3 的真实启动与 Windows 包证据，再对准确 head 重审/合入。若出现依赖引入的新失败，按实际根因拆分或调整版本，不放松门禁。

本次仅写 `CODEX_HOME/headroom-cache/PR43-review`。未写任何工作树/index/HEAD/分支、外部state或矩阵；没有 fetch/checkout/试合并/push，也没有发布 GitHub review、comment 或 Issue 消息。

## 上游一手来源

- plugin-vue 6.0.11：[发行说明](https://github.com/vitejs/vite-plugin-vue/releases/tag/plugin-vue%406.0.11)、[固定tag变更记录](https://raw.githubusercontent.com/vitejs/vite-plugin-vue/plugin-vue%406.0.11/packages/plugin-vue/CHANGELOG.md)、[包元数据](https://raw.githubusercontent.com/vitejs/vite-plugin-vue/plugin-vue%406.0.11/packages/plugin-vue/package.json)。
- Vite7.3.8：[固定tag变更记录](https://raw.githubusercontent.com/vitejs/vite/v7.3.8/packages/vite/CHANGELOG.md)、[包元数据](https://raw.githubusercontent.com/vitejs/vite/v7.3.8/packages/vite/package.json)。
- Electron：[版本语义](https://www.electronjs.org/docs/latest/tutorial/electron-versioning)、[44.11.0](https://github.com/electron/electron/releases/tag/v44.11.0)、[44.11.1](https://github.com/electron/electron/releases/tag/v44.11.1)、[44.11.2](https://github.com/electron/electron/releases/tag/v44.11.2)、[44.11.3](https://github.com/electron/electron/releases/tag/v44.11.3)。四份发行说明正文另缓存为 `electron-v44.11.*.md`。

GitHub 工程与 CI 身份事实来自已认证 `gh` API/CLI 原始缓存；公开 Web 工具访问本工程 PR/API 未成功，不以这些失败页面替代已认证查询。
