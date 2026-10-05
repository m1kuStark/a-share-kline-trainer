# UPD-02 设计文档：在线版本更新·设置页 UI 与 e2e

- 任务：UPD-02（里程碑 UPD 第二任务；服务端核心已由 UPD-01 完成，提交 098c442）
- 日期：2026-10-06
- base：098c442
- 消费契约：`docs/verification/2026-10/UPD-01/design.md` §2（只读，不改服务端）
- 行为矩阵：`.zcode/skills/ai-harness/matrix/updater.yaml`（镜像 `ai-harness-lab/skill-v1/matrix/updater.yaml`）追加 5 行 UI 行

## 1. 现状核实结论（先核实再依赖）

| 事实 | 结论 | 证据 |
|---|---|---|
| journey 隔离服务版本 | **currentVersion=null**：隔离服务从 `.runs/<runId>/server` 编译产物运行，`APP_ROOT` 上溯三级落 `<repo>/.runs`（无 package.json）→ health/check 的 currentVersion=null、updateAvailable 恒 false——「有新版」态不可经主 journey 服务触达（UPD-01 环境盲点，非产品 bug：开发运行/发布包版本正常） | `server/src/update/version.ts` APP_ROOT 推导＋node 实测 `.runs/run-X` 布局（rootDir=src） |
| serverVersion 进程内缓存 | `cachedDefault` 首次调用（就绪探针的 /api/health）即固化——服务启动后再种 `.runs/package.json` 对**已运行**服务无效，须先种再spawn | `version.ts:30-35` |
| 清单注入通道 | env `TRAINER_UPDATE_MANIFEST_URL`（优先级之首）＞ trainer.config.json ＞ release.json publicURL ＞ 仓库常量；**逐请求解析**（check/apply handler 内 resolveUrl）；journey `runEnv` 透传 `...process.env` | `server/src/update/manifest.ts:53-79`、`scripts/runtime/run.ts:118-126` |
| apply 守卫（e2e 现实） | 隔离/开发运行：包根无 release.json、无 TRAINER_LAUNCHER_CJS/dataDir 缺 → 503 `UPDATE_NOT_PACKAGED` | `server/src/update/api.ts:224-231` |
| 设置入口 | ⚙ rail 按钮（aria-label 训练默认设置）在 app-shell 常驻，任意视图可达——e2e 无需创建训练 | `web/src/App.vue:601,676` |
| 前端单测先例 | kdj 模式：server/test 读 web 源码＋`ts.transpile`＋`new Function` 提取执行真实导出（vitest include 仅 server/test/**） | `server/test/kdj-indicator.test.ts:60-77` |
| confirm 先例 | `window.confirm`（History.vue:97） | `web/src/views/History.vue:97` |
| e2e 纪律 | 必须 npm run journey；**不得硬编码端口**、不得连接未知进程；workers=1；截图走 evidencePath | `e2e/AGENTS.md` |

## 2. 组件图（改动面）

```
web/src/updateFlow.ts（新，纯函数，无 Vue 依赖）
  ├─ UPDATE_STATE_TEXT: Record<UpdateFlowState, string>        // 8 态中文呈现
  ├─ isBusyUpdatePhase / isTerminalUpdateState                  // 轮询控制
  ├─ updateGuardText(error, serverMessage): string              // 守卫码→人话（4 码＋回退）
  ├─ RECONNECT_INTERVAL_MS=2000 / RECONNECT_MAX_ATTEMPTS=15
  ├─ nextReconnectDelayMs(attempt): number|null                 // 退避计划
  ├─ updateProgressPercent(progress): number|null               // 0..1→0..100（夹取）
  └─ versionLabel(v): string                                     // '1.2.7'→'v1.2.7'；null→'未知'

web/src/components/TrainingSettings.vue（改，跟随 M6-07 动画分栏先例）
  ├─ settings-nav 追加第 5 个分栏按钮「关于与更新」（activeSection 增 'about'）
  └─ section about：
      ├─ 当前版本：versionLabel(health.currentVersion)（分栏激活时拉取 /api/health 一次）
      ├─ 「检查更新」按钮 → GET /api/update/check → 三态渲染（§3 表）
      ├─ 「下载并更新」按钮（仅 available 态）→ window.confirm（说明将自动重启）
      │    → POST /api/update/apply
      │       ├─ 202 → 轮询循环（§4）
      │       └─ 非 202 → updateGuardText 呈现，留在 available 态可重试
      └─ 轮询渲染：状态文案＋下载百分比；completed→重拉 health 显示已更新到 vX.Y.Z；failed→原因＋重试
  （分栏打开时额外 GET /api/update/status 一次：busy 态自动恢复轮询——更新跨重启窗口，用户可能关开面板）

server/test/updater-ui.test.ts（新）：kdj 提取执行模式测 updateFlow.ts 真实导出
e2e/update-settings.spec.ts（新）：journey＋次级服务＋fixture 清单（§5）
```

## 3. 状态机呈现表（UPD-01 契约 state → UI）

| check/status 字段 | 分栏呈现 |
|---|---|
| check.updateAvailable=true | 「发现新版本 v{latestVersion}」＋`<details>` 折叠「更新内容」（releaseNotes）＋按钮「下载并更新」 |
| check.updateAvailable=false 且 error=null | 「已是最新版本」（无更新按钮；currentVersion=null 时显示「当前版本未知」） |
| check.error≠null | 「检查失败：{error}」＋按钮「重试」 |
| status.state=downloading | 「正在下载新版本…（{percent}%）」progress∈[0,1]→整数百分比 |
| status.state=verifying / backing_up / applying | 「正在校验安装包…／正在备份数据…／正在安装新版本…」 |
| status.state=restarting | 「正在重启训练器…」 |
| 轮询 fetch 失败（断线窗口） | 「正在重启，等待服务回来…」（重连尝试 n/15） |
| status.state=completed | 「已更新到 v{health.currentVersion}」（以 health 重拉为准，非 targetVersion 回显） |
| status.state=failed | 「更新失败：{status.error}」＋「重试」回检查态 |

## 4. apply 流程（applyState 触发呈现＋断线重连）

```
点击「下载并更新」
  └─ window.confirm('将下载新版本并自动重启训练器，更新过程中请勿关闭窗口。确定继续？')
       ├─ 取消 → 无事发生
       └─ 确认 → POST /api/update/apply
            ├─ 非 202 → updateGuardText(payload.error, payload.message) 呈现（§5 守卫表），不进入轮询
            └─ 202 → 轮询循环：
                 每 1s GET /api/update/status
                  ├─ 成功 → 按 §3 呈现；busy 态继续 1s；completed/failed 终态停
                  │   completed → GET /api/health → 「已更新到 v{currentVersion}」
                  └─ fetch 异常（旧服务已退/新服务未起）→「正在重启，等待服务回来…」
                       每 2s 重试（RECONNECT_INTERVAL_MS），至多 15 次（RECONNECT_MAX_ATTEMPTS）
                       ├─ 恢复 → 回正常轮询分支（status 可能直接 completed——UPD-01 契约明示）
                       └─ 超尽 → 「等待训练器恢复超时：若页面长期无响应，请手动运行 Start.cmd 启动」
                 组件卸载（关面板）→ 清定时器（服务端更新不受影响；分栏重开时按 §2 的 status 一次性拉取恢复）
```

## 5. 守卫消息映射（updateGuardText）

| payload.error | UI 文案（人话） |
|---|---|
| UPDATE_NOT_PACKAGED | 当前为开发/源码运行，请使用发布包更新 |
| UPDATE_IN_PROGRESS | 更新已在进行中 |
| ACTIVE_TRAINING | 请先结束当前训练 |
| UPDATE_NOT_AVAILABLE | 没有可用的更新 |
| 其余（UPDATE_MANIFEST_FAILED/UPDATE_VERSION_UNKNOWN/…） | 回退服务端 message；再回退「更新失败：{error}」 |

## 6. e2e 设计（e2e/update-settings.spec.ts）

**架构**（受「不得硬编码端口」与 journey currentVersion=null 现实约束）：

1. **fixture 清单 HTTP**（spec 自起，`node:http`，listen 临时端口 0）：模块级可变状态 `{status, body}`——所有路径返回当前状态；测试在三态间切换内容后点「检查更新」，服务端逐请求重取清单。
2. **次级真实服务**（spec 自起）：种子 `<repo>/.runs/package.json`＝`{"version": <仓库 package.json 版本>}`（测试侧独立读取）→ `spawn(node, [run.serverDir/index.js])`，env：`HOST=127.0.0.1 PORT=0 TRAINER_DB=<artifacts>/update-e2e/trainer.sqlite TRAINER_STATIC_DIR=run.webDir TRAINER_READY_FILE=<artifacts>/update-e2e/ready.json TRAINER_UPDATE_MANIFEST_URL=http://127.0.0.1:<fixture端口>/manifest TDX_ROOT='' OPEN_BROWSER=0`（无 TRAINER_RUN_ID＝开发形态，APP_ROOT=.runs 读种子版本）→ 就绪等 ready.json（含 port/baseURL，身份＝本次子进程）。
   - 关停：IPC `{type:'trainer:shutdown', runId:null}`（index.ts 消息分支 null===null 匹配）→ 等 close，超时 SIGKILL；finally 删种子 package.json。
   - apply 守卫：包根（.runs）无 release.json → 真实 503 UPDATE_NOT_PACKAGED 经 UI 呈现。
3. **浏览器**：`page.goto(次级 baseURL)`（首页）→ ⚙ 设置 →「关于与更新」分栏——三态与守卫全在次级服务上测；主 journey 服务承载 journey 框架本身。

**用例**（对应矩阵行）：
- `update section shows the real current version and keeps existing sections`：版本=v{仓库 package.json version}（独立 oracle）；既有四分栏 nav 仍在且「默认设置」可切回呈现（UPD-UI-SECTION＋UPD-UI-SETTINGS-INTACT）。
- `check update renders the three states from a local fixture manifest`：fixture v9.9.9（含更新说明 body）→ 发现新版本＋折叠更新内容＋下载并更新按钮；fixture v1.0.0 → 已是最新（无更新按钮）；fixture HTTP 500 → 检查失败（含「无法检查更新」）＋重试可用（重设 fixture 后点重试回到有新版态）。
- `apply guard UPDATE_NOT_PACKAGED shows the human message without polling`：有新版态→下载并更新→confirm 接受→呈现「当前为开发/源码运行，请使用发布包更新」，且无任何状态机轮询文案（UPD-UI-GUARD-MESSAGES 的 e2e 面）。

**真实换装全流程（downloading→completed/断线窗口）不进 e2e**：需发布包布局＋真重启（YAGNI＋简报裁剪），留用户真机验收；状态机呈现/重连/终态语义由 updater-ui.test.ts 纯函数级锁定（层级如实记入矩阵 binding_note）。

**纪律**：零 api.github.com（env 注入 fixture；主 journey 服务无任何测试触其 check）；临时端口（listen 0）；workers=1 既有配置；截图走 evidencePath。

## 7. 文案表（全部 proposed_default，收尾报告逐条列呈）

| 位置 | 文案 |
|---|---|
| 分栏名 | 关于与更新 |
| 版本行 | 当前版本：v{version}／当前版本：未知 |
| 检查按钮 | 检查更新／检查中… |
| 有新版 | 发现新版本 v{latestVersion}；更新内容（details 摘要）；下载并更新 |
| 已最新 | 已是最新版本 |
| 检查失败 | 检查失败：{error}；重试 |
| 确认弹窗 | 将下载新版本并自动重启训练器，更新过程中请勿关闭窗口。确定继续？ |
| apply 按钮 | 下载并更新／正在准备更新… |
| 状态机 | 正在下载新版本…（{n}%）／正在校验安装包…／正在备份数据…／正在安装新版本…／正在重启训练器… |
| 断线 | 正在重启，等待服务回来…（重连尝试 {n}/15） |
| 完成 | 已更新到 v{version} |
| 失败 | 更新失败：{error}；重试 |
| 重连超尽 | 等待训练器恢复超时：若页面长期无响应，请手动运行 Start.cmd 启动 |
| 守卫 4 码 | 见 §5 |

## 8. 附加授权修复（README 图片链接，独立提交）

- 现状：README.md:11 `![训练界面，使用独立测试数据](docs/verification/2026-10/GITHUB-HEALTH-01/training-example.png)` 指向不入包目录；发布包链接门禁 `findBrokenPackageLinks`（build.mjs:380）自 b783633 加入该链接起确定性失败。
- 打包事实：staged 面＝ROOT_FILES＋docs/user 整树＋third-party＋assets/trainer.ico（仅此一个 assets 文件，其余 assets 路径分类为 null）——图片落点选 **`docs/user/images/training-example.png`**（docs/user 整树自动入包，零 build.mjs 改动）。
- 修复：`git mv` 图片→docs/user/images/；README 链接改 `docs/user/images/training-example.png`；验证＝最小等价命令：临时 staging（README＋docs/user）跑 `findBrokenPackageLinks`，修复前 RED（断链）、修复后 GREEN（零断链）；另跑 server/test/release-package.test.ts 确认门禁测试不回归。
