# UPD-02 验证记录：在线版本更新·设置页 UI 与 e2e

- 任务卡：[docs/work-items/tasks/UPD-02.md](../../../work-items/tasks/UPD-02.md)
- 设计：[design.md](design.md)（组件图／状态机呈现表／apply 流程／守卫映射／e2e 架构／文案表）
- base：098c442（UPD-01 服务端核心）；消费契约＝[UPD-01 design.md §2](../UPD-01/design.md)（只读，零服务端改动）
- 日期：2026-10-06

## 1. 交付物

| 文件 | 角色 |
|---|---|
| `web/src/updateFlow.ts`（新） | 纯呈现逻辑：状态文案表／busy·终态判定／守卫人话映射／2s×15 重连参数与计划／进度百分比（夹取）／版本标签／**轮询决策核心 decidePollStep** |
| `web/src/components/TrainingSettings.vue` | 设置面板第 5 分栏「关于与更新」：当前版本＋检查更新（三态）＋下载并更新（确认→POST→轮询状态机→断线重连→completed/failed 呈现）；薄执行（fetch→decidePollStep→渲染/排程），卸载清定时器，分栏重开自动恢复进行中更新 |
| `server/test/updater-ui.test.ts`（新） | 12 例：kdj 提取执行模式测 updateFlow 真实导出＋组件接线源码契约（沿 UPD-VERSION-EXPOSE 先例） |
| `e2e/update-settings.spec.ts`（新） | 3 例真实浏览器：分栏＋版本＋既有分栏回归／检查三态（本地 fixture 清单）／apply 守卫 503 人话不进轮询 |
| `README.md`＋`docs/user/images/training-example.png` | 附加授权修复：图片移入发布包含的 docs/user 树，链接门禁恢复可过 |

矩阵：`updater.yaml` 追加 5 行 UI 行（UPD-UI-SECTION／UPD-UI-CHECK-STATES／UPD-UI-APPLY-FLOW／UPD-UI-GUARD-MESSAGES／UPD-UI-SETTINGS-INTACT），全部 covered；UPD-01 既有 11 行零改动仍 covered。

## 2. RED→GREEN 证据

| 步骤 | RED（以正确原因失败） | GREEN |
|---|---|---|
| updateFlow 纯函数 | `npx vitest run server/test/updater-ui.test.ts` → 8/8 failed，全部 `ENOENT ...web/src/updateFlow.ts`（缺功能） | 实现后 8/8 passed，exit 0 |
| decidePollStep 决策核心 | 扩展 3 用例 → 3 failed（`mod.decidePollStep is not a function`，缺函数），既有 8 例仍绿 | 实现后 11/11 passed，exit 0 |
| 接线源码契约 | （随分栏实现同步落；断言集合含 confirm 文案/health 回读/断线文案/三端点/卸载清理） | 12/12 passed，exit 0 |
| e2e 分栏 | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/update-settings.spec.ts --retries=0` → 3/3 failed，全部 `waiting for getByRole('button', { name: '关于与更新' })` 超时（缺分栏；fixture＋次级服务基础设施先立起来＝失败点正确） | run-03ead7af：3 passed (14.4s)，exit 0；截图 update-settings-section/check-states/apply-guard.png |
| README 链接门禁（附加修复） | 最小等价命令（复用 build.mjs 导出的 `findBrokenPackageLinks`，staging＝真实文档面四根 md＋LICENSE＋docs/user＋third-party）→ `broken: ["README.md -> docs/verification/2026-10/GITHUB-HEALTH-01/training-example.png"]`，exit 1 | 移图＋改链接后 `broken: []`，exit 0；`server/test/release-package.test.ts` 23/23 passed |

## 3. e2e fixture 注入通道（零 api.github.com）

- 通道＝**env `TRAINER_UPDATE_MANIFEST_URL`**（manifest.ts 四级优先级之首；journey `runEnv` 透传 `...process.env` → spec 次级服务 env 注入，指向 spec 自起的本地 fixture 清单 HTTP）。
- **次级真实服务**：journey 隔离服务 APP_ROOT 落 `<repo>/.runs`（无 package.json）→ currentVersion=null、updateAvailable 恒 false——「有新版」态不可经主 journey 服务触达（UPD-01 环境盲点，见 §6 待拍板/呈报项）。spec 种子 `.runs/package.json`（=仓库版本）后 spawn `run.serverDir/index.js`（开发形态、临时端口、IPC `trainer:shutdown` 关停、finally 必清种子文件），浏览器直连其次级 baseURL。
- fixture HTTP：`node:http` listen 0（**无硬编码端口**，守 e2e/AGENTS.md），模块级可变内容承接三态（v9.9.9 新版／v1.0.0 已最新／HTTP 500 失败）。

## 4. 门禁记录（gate 表）

| 门禁 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 绑定检查 strict（含未跟踪） | `check-binding.mjs --repo <repo> --matrix updater.yaml --strict --include-untracked` | 16 行：covered=16 open=0 RED=0（L1 引用全解析）；UPD-01 11 行未动 | 0 |
| 定向（新＋UPD-01 不许红） | `npx vitest run server/test/updater-ui.test.ts server/test/updater-{check,verify,swap,apply}.test.ts server/test/release-package.test.ts` | 6 文件 68/68 passed（12 新＋33 UPD-01＋23 release-package） | 0 |
| 全量 | `npm test` | 119 文件 1513/1513 passed（UPD-01 基线 1501＋12 新；无存量失败——UPD-01 已登记的 history-report 偶发未复现） | 0 |
| 构建 | `npm run build` | typecheck:web＋build:server＋build:web 过（chunk>500kB 警告为既有信息级） | 0 |
| journey 新 spec | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/update-settings.spec.ts --retries=0` | 3 passed，exit 0（run-03ead7af） | 0 |
| journey 既有设置类抽查（防回归） | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/animation-settings.spec.ts --retries=0` | 1 passed，exit 0（run-4a57d5d7） | 0 |
| 链接门禁（附加修复） | 最小等价命令（§2 表末行）＋`release-package.test.ts` | broken=[]；23/23 | 0 |

## 5. 变异抽检（paper_only，P4 语义锁定推演）

- **UPD-UI-APPLY-FLOW**：变异「断线重连计数从 1 起改为 0 起」（attempt: failedReconnects+1 → failedReconnects）→ `treats a fetch failure as the restart window...` 断言 `first.attempt===1` 死；变异「completed 仍继续排程」（continueDelayMs 对终态给 1000）→ `stops on terminal states...` 的 continueDelayMs null 断言死；变异「组件 completed 时不重拉 health」（删 onApplyCompleted 内 loadUpdateVersion）→ 源码契约 regex `onApplyCompleted[\s\S]{0,200}loadUpdateVersion\(\)` 死。杀手指名：上述三用例。
- **UPD-UI-SETTINGS-INTACT**：变异「新增分栏挤掉既有 nav」（数据目录按钮被 v-if 移除）→ e2e 首用例 `for (const name of ['默认设置','偏好设置','动画效果','数据目录']) toBeVisible()` 死；变异「activeSection 默认值改为 about」→ 该用例切「默认设置」后表单字段可见性断言死。杀手指名：update-settings.spec.ts 首用例。

## 6. 待拍板项（needs_user_decision ／ proposed_default）

**行为/语义类（无阻断——均按派发简报 provisional 决策实现，验收时确认或调整）：**

1. e2e 范围裁剪：真实换装全流程（发布包布局＋真重启＋断线窗口＋completed 端到端）不进 e2e，留真机验收（简报决策 5 原文）。
2. 守卫四码人话文案（简报决策 3 冻结原文）：UPDATE_NOT_PACKAGED→「当前为开发/源码运行，请使用发布包更新」；UPDATE_IN_PROGRESS→「更新已在进行中」；ACTIVE_TRAINING→「请先结束当前训练」；UPDATE_NOT_AVAILABLE→「没有可用的更新」；其余码回退服务端 message。
3. 断线重连参数 2s×15（简报示例冻结）；超尽文案「等待训练器恢复超时：若页面长期无响应，请手动运行 Start.cmd 启动」。
4. completed 呈现以 health.currentVersion 为准（简报决策 2 原文「以 health.currentVersion 为准刷新」）。

**呈现类 proposed_default（已按保守默认实现，验收确认后升级）：**

5. 分栏名「关于与更新」（nav 第 5 项）；分栏说明文案。
6. 版本行「当前版本：v1.2.7／当前版本：未知」。
7. 检查按钮「检查更新／检查中…」；重试按钮「重试」。
8. 有新版态文案「发现新版本 v9.9.9」＋release notes 以 `<details open>` 折叠块（默认展开可收起）呈现，摘要「更新内容」。
9. 已最新态「已是最新版本」（currentVersion=null 时同样以此态呈现——check 响应 updateAvailable=false）。
10. 检查失败态前缀「检查失败：」＋服务端 error 人话。
11. 确认弹窗＝window.confirm（沿 History.vue 先例）文案「将下载新版本并自动重启训练器，更新过程中请勿关闭窗口。确定继续？」。
12. apply 按钮态「下载并更新／正在准备更新…」；进行中禁用防重复提交。
13. 状态机文案（8 态）＋下载百分比整数呈现（0..1 夹取 0..100）。
14. 断线文案「正在重启，等待服务回来…（重连尝试 n/15）」。
15. 分栏打开时自动拉一次 /api/update/status：busy/终态恢复呈现（设计 §2；更新跨重启窗口，用户可能关开面板）。
16. 完成态绿色 settings-saved 风格「已更新到 vX.Y.Z」；失败态「更新失败：{原因}」。

**呈报项（非本任务授权可修）：**

17. **UPD-01 环境盲点**：journey 隔离服务（`.runs/<runId>/server` 编译产物）APP_ROOT 落 `<repo>/.runs`，无 package.json → currentVersion=null、updateAvailable 恒 false。开发运行（server/dist）与发布包正常。影响：主 journey 服务上不可测「有新版」态（本任务以次级服务绕开）。是否让 journey runEnv/runDir 提供版本（如 runDir 复制 package.json）由 UPD-01/工具链侧拍板；本任务未改 `scripts/runtime/**`（越界）。
18. 附加授权修复已独立提交（README 图片→`docs/user/images/training-example.png`）；GITHUB-HEALTH-01 目录仅移出图片，report.md/result.json 未动且无对该图的引用。

## 7. 局部绿≠整版通过

本轮覆盖：updater 矩阵 16/16 行（UPD-01 11 行运行证据沿其收尾收据；UPD-UI 5 行本轮收据如上）。未覆盖：真实换装窗口端到端（§6.1，真机验收）；journey 主服务上「有新版」浏览器态（§6.17 环境盲点）；既有其余 e2e 套件未全量复跑（按简报只抽查设置类 1 个＋全量 vitest 1513 绿）。
