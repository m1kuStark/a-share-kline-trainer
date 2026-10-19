# GAP1-DIAG 设置页诊断信息：自实现日志落盘＋复制诊断按钮

```json
{
  "id": "GAP1-DIAG",
  "title": "设置页诊断信息：自实现日志落盘＋「复制诊断信息」按钮",
  "owner": "integrator",
  "state": "active",
  "milestone": "PACK",
  "summary": "复盘缺口 G1（用户 2026-10-19 拍板计划＋决策 2/8）：先实证 E1（桌面端日志当前是否落盘）；自实现主进程日志追加 <dataDir>/logs/main.log（无新依赖、按大小滚动）；设置页「关于与更新」分栏新增「复制诊断信息」按钮——版本/平台/数据目录/更新通道与最近检查结果/最近错误＋日志尾部有限行，绝不包含训练与交易数据（负向断言锁定）。矩阵预登记行 DESKTOP-DIAG-LOG-PERSIST / DESKTOP-DIAG-CLIPBOARD / DESKTOP-DIAG-IPC（root 单写，worker 不得编辑矩阵文件）。",
  "next_action": "阶段0：E1 实证＋开工简报呈 root 批准后按 TDD 实现；e2e 浏览器运行等 root 串行通知；gpu3060 关机，真机验收场景登记 deferred 由本机隔离冒烟替代。",
  "allowed_paths": [
    "desktop/src/**",
    "desktop/test/**",
    "web/src/**",
    "server/test/**",
    "e2e/**",
    "docs/verification/**",
    "docs/work-items/tasks/GAP1-DIAG.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/GAP1-DIAG.md"
    ],
    "reason": "诊断按钮为 v1.3.2 用户可见新功能，卡片与验证记录承载验收证据。"
  },
  "verification_refs": [
    "docs/verification/2026-10/GAP1-DIAG/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 验收要点

- E1 结论（落盘/不落盘＋证据路径）回填验证记录。
- 诊断文本字段清单冻结：应用版本、平台（os/arch/electron/chrome）、数据目录、更新通道与最近检查结果、最近错误、日志尾部（有限行数）；负向断言：不含训练/交易数据字段。
- 既有 UPD-DESKTOP-IPC-MINIMAL 暴露面白名单测试同步扩展 desktopDiagnostics（用户拍板 G1 依据留 binding_note）。
- 验收口径：2 分钟内产出可贴 issue 的诊断文本（本机隔离冒烟；真机场景 deferred）。

## 开工简报（阶段0，待 root 批准）

> worker：GAP1-DIAG 阶段0（2026-10-19）。本轮零产品码、零测试码（按派发令），仅 E1 只读实证＋本简报。锚定：task-manifest 已跑，锚点问题 A1=`e2e/**`、A3=本卡；矩阵三行 planned 已读（root 预登记，worker 不动矩阵文件）。

### E1 实验结论：桌面端主进程日志【完全不落盘】

**源码侧证据**（worktree task/GAP1-DIAG @ 6533196，只读 grep）：

- `desktop/src/main.ts` 全部日志调用＝`console.log/warn/error`（约 45 处）；顶层 `uncaughtException/unhandledRejection` 兜底（main.ts:124-129）同为 `console.error`——唯一去向 stdout/stderr。
- `desktop/src/` 全目录无 `electron-log`、无日志用途的 `appendFile/appendFileSync/createWriteStream`（唯一 `createWriteStream` 在 portable-updater.ts:390/402，属更新包下载管线，与日志无关）；无 `logs/` 目录或 `main.log` 字样引用。
- 既有决策层模块（update-ipc / data-home 等）接受 `logger: console` 注入（main.ts:451/466/486/504/534）——新落盘 sink 的现成接线缝。

**本机真实安装/数据目录探测【真实数据安全披露：以下全部为只读命令（reg query / ls / find），未运行应用、未写入任何字节、未读训练库内容】**：

- 注册表 HKLM `Uninstall` 找到 per-machine 安装：`D:\MySoftWares\a-share-kline-trainer\`（`K线训练器.exe`；HKCU/WOW6432Node 无匹配）。
- 数据目录 `C:\Users\Stark_Du666\.a-share-kline-trainer\`：仅 `trainer.sqlite`＋`window-state.json` 两项；**无 `logs/` 子目录**（ls 报 No such file or directory）。
- 安装目录浅层（depth≤2）`find -iname "*.log"` 零命中。

**三选一结论：完全不落盘。** 主进程日志仅 stdout/stderr；打包窗口形态（Electron GUI 子系统、无控制台附着）下该输出对用户不可见（此句为平台常识推论，非实测——本阶段禁止运行应用）。G1 缺口前提成立。

**root 回填用**：DESKTOP-DIAG-LOG-PERSIST 行 binding_note 可记「E1（2026-10-19，GAP1-DIAG worker 阶段0）：源码 console-only＋真机数据目录/安装目录零 *.log → 完全不落盘」。

### 可观察成功条件（逐矩阵行 → 测试怎么断言）

| 矩阵行 | 断言方式（vitest 为主） |
| --- | --- |
| DESKTOP-DIAG-LOG-PERSIST | ① tmpdir 真实 fs（§4.2 真实边界，非全桩）：`createDiagLogger` 追加的行按序出现在 `<dataDir>/logs/main.log`，目录不存在时自动建；② 超阈值滚动后仅保留有限份旧档＋当前文件重新从空开始（份数/阈值断言）；③ 注入 append 失败 → 调用方不收异常、降级路径被触达（spy console），进程继续；④ main.ts 源码契约（同既有 UPD 源码契约用例法）：日志调用点经 diag sink（tee），非裸 console |
| DESKTOP-DIAG-CLIPBOARD | ① `buildDiagnosticsText` 纯函数：输出含版本/平台（os/electron/chrome）/数据目录/更新通道与最近检查结果/最近错误/日志尾部有限行（期望值＝独立常量与注入 facts，非实现回显）；② 负向断言：文本不含训练/交易数据标记（对含训练夹具的环境取证，锁定零泄漏）；③ 注入 clipboard 的 IPC 用例：`clipboard.writeText` 收到组装文本、返回 `{ok:true}`；④ web/e2e：按钮点击后出现已复制反馈（role=status） |
| DESKTOP-DIAG-IPC | ① 既有 allow-list 用例扩展：`exposed.sort()` 精确等于含 `desktopDiagnostics` 的枚举数组＋成员清单（单方法 `copyDiagnostics`）；全文件 exposeInMainWorld 白名单外零出现（既有枚举式负向语义沿用）；② IPC 注册用例/源码契约：`ipcMain.handle` 仅新增 `desktop-diagnostics:invoke` 一条通道 |

### 文件级设计计划

**新建：**

- `desktop/src/diag-log.ts` — 自实现日志器（零新依赖）：`createDiagLogger({ dataDir, deps })` → `{ append(line), readTail(maxLines), filePath }`；启动 mkdir、追加写、按大小滚动保留有限份；写失败降级 console 绝不抛。纯决策＋注入 fs（镜像 data-home.ts 形态）。
- `desktop/src/diagnostics.ts` — 诊断组装＋IPC 粘合：`buildDiagnosticsText(facts)` 纯函数＋`registerDiagnosticsIpc(deps)`（注入 clipboard，镜像 update-ipc.ts；通道 `desktop-diagnostics:invoke`，method `copy`）。
- `desktop/test/diag-log.test.ts` — 上述 LOG-PERSIST ①②③④ 断言（含至少一条真实 fs 用例）。
- `desktop/test/diagnostics.test.ts` — CLIPBOARD ①②③ 断言。
- `web/src/diagnosticsFlow.ts`（proposed_default，可裁） — 纯呈现逻辑（desktopDiagnostics feature detect＋状态映射），镜像 updateFlow.ts 零依赖形态；测试走 server/test 的 transpile 模式 → `server/test/diagnostics-ui.test.ts`。若 root 判定逻辑太薄可并入组件并撤此二文件。
- `e2e/diagnostics-copy.spec.ts` — 纯浏览器形态（无 window.desktopDiagnostics）下的 gating/降级呈现＋（root 串行通知后运行）反馈形态断言；真剪贴板往返不进 e2e，走 desktop 隔离冒烟（既有 smoke-desktop.mjs 加诊断断言段）。

**修改：**

- `desktop/src/main.ts` — dataDir 解析后第一件事 attach diag logger；模块级 `log/warn/error` tee（console＋文件）替换现有 console.* 调用点；注册 `registerDiagnosticsIpc`；uncaught 兜底改为经 tee（attach 前窗口仍 console-only，见边界）。
- `desktop/src/preload.cts` — 追加 `contextBridge.exposeInMainWorld('desktopDiagnostics', { copyDiagnostics })` 窄对象。
- `desktop/test/desktop-updates.test.ts` — allow-list 用例（:235）数组与成员断言扩展 `desktopDiagnostics`（矩阵行指定动作）。
- `web/src/components/TrainingSettings.vue` — `activeSection === 'about'` 分栏（:1038 起）新增诊断动作区：ghost-button＋role=status 反馈＋降级文案，全部复用既有 token/按钮类。

**server 域：** 无产品改动；更新状态复用既有 `/api/update/status`，`server/test` 仅承接 web 纯逻辑测试（updater-ui.test.ts 先例），无需为 server 本体加接线测试。

### RED 计划（获批后阶段1 首动作）

1. RED #1（LOG-PERSIST 基石）：`desktop/test/diag-log.test.ts` 首条「追加行落入 `<dataDir>/logs/main.log` 且目录自动创建」——预期失败原因＝`desktop/src/diag-log.ts` 模块不存在（import 失败），缺功能而非语法/环境错。
2. RED #2（IPC 面）：先扩展 allow-list 用例——预期失败原因＝preload 尚无 `desktopDiagnostics` 暴露，`exposed.sort()` 数组不匹配。
3. RED #3（CLIPBOARD）：`desktop/test/diagnostics.test.ts` 首条「诊断文本含全部冻结字段」——预期失败原因＝`desktop/src/diagnostics.ts` 不存在。
4. 每个 RED 独立运行、亲见正确原因失败并留收据后才写实现；实现顺序 diag-log → preload/IPC → diagnostics 组装 → main.ts 接线 → web UI → e2e。

### UI 呈现方案（均为 proposed_default）

- 位置：「关于与更新」分栏内、更新检查区块之后新增动作区（分栏底部），带小节说明文字一行。
- 按钮：复用 `.ghost-button`（与「检查更新/重试」同体系），文案「复制诊断信息」。
- 反馈：成功后按钮旁 `role="status"` 文本「已复制，可粘贴到问题反馈」显示约 3 秒后消失（按钮本体不变形）；失败显示「复制失败：＜中文原因＞」并保留可重试（对齐 `.update-check-error` 形态）。
- 纯浏览器/e2e（无 `window.desktopDiagnostics`）：按钮不渲染（同 updateFlow 对 `desktopUpdates` 的 channel gating 模式）。
- 不引入新样式体系：仅既有 ghost-button / role=status / `var(--*)` token。

### 边界与异常

- 日志写失败（磁盘满/权限）：append 内部全捕获 → 当次降级 console.error；不抛、不阻断启动、不永久熔断（后续写入继续尝试）。
- 剪贴板失败/被占：IPC 返回 `{ok:false,error 中文}`；UI 失败文案＋可重试；绝不向渲染端抛异常（desktopRecordings/desktopMigration 同纪律）。
- dataDir 不可写：建目录/写文件失败同上降级；诊断文本日志尾部段如实标注「（日志不可用：原因）」，不伪造空串。
- dev/packaged 两形态：均落盘（dataDir 各自解析）；channel 字段进诊断文本；纯浏览器形态无此功能。
- 早启动异常窗口：uncaught 兜底注册（模块顶）早于 dataDir 解析与 sink attach——attach 前异常仍 console-only（已知边界，attach 尽量前移至 dataDir 确定后第一件事）。
- 滚动参数：单文件 2 MiB、保留最近 3 份（main.log＋.1/.2）——数值 proposed_default。
- 诊断文本：UTF-8 纯文本、「标签：值」行式、日志尾部 ≤200 行；绝不包含训练/交易数据（与日志同一红线，负向断言锁定）。

### needs_user_decision 清单（呈 root/用户；阶段0不实现，无阻断违规）

1. **「最近错误」采集口径**：拟取主进程侧（uncaught/unhandled＋error 级 tee 日志的 ring buffer），renderer 页面错误不采集（不新增 renderer→main 上报方法，守住「除此不新增任何其他 IPC 面」最窄读法）。若用户要求纳入 renderer 错误，需在 desktopDiagnostics 面内加方法——超出当前冻结字段清单的自然读法，须拍板。主进程口径不阻断其余部分实现。

### proposed_default 清单（先按默认设计，验收时确认）

1. 滚动参数 2 MiB × 保留 3 份；2. 纯浏览器形态按钮隐藏；3. 已复制反馈＝role=status 文本 3 秒；4. 诊断文本行式＋日志尾部 ≤200 行；5. 日志写失败不熔断（逐次降级）；6. `web/src/diagnosticsFlow.ts` 独立纯模块（可裁并入组件）。

## 阶段1 完成记录（TDD 实现，2026-10-19）

> root 批准令已执行完毕（含裁定 2：「最近错误」＝主进程 ring，从 needs_user_decision 降级为 proposed_default）。完整收据、deferred 登记、test_ids 回传清单见 `docs/verification/2026-10/GAP1-DIAG/README.md`。要点：

- RED 三连先行（exit=1×3，原因均＝缺功能），随后 GREEN；门禁：desktop 全量 299/299 exit=0、`build:desktop:main` exit=0、`typecheck:web` exit=0、server diagnostics-ui 2/2 exit=0；变异抽检 M1（降级→重抛）/M2（删剪贴板写入）均被杀手用例击杀（exit=1）并已还原复绿。
- needs_user_decision 清单（更新）：**空**——原第 1 项已按 root 裁定 2 处置为 proposed_default。
- proposed_default 清单（更新）：在阶段0 六项基础上追加 7. 「最近错误」＝主进程口径（renderer 错误不采集；root 裁定，最终由用户验收拍板）。
- e2e/diagnostics-copy.spec.ts 已写**未运行**（root 硬约束：另一 worker 独占浏览器；待 root 串行通知）。真机验收与 dev 形态 Electron 冒烟 deferred（理由见验证记录）。
- root 指令勘误：批准令第 3 条「三者白名单」与仓库现实冲突（desktopMigration 为既有第四绑定对象），按矩阵优先取四对象精确集合，详见验证记录末节。
