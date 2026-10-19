# GAP1-DIAG 验证记录：设置页诊断信息（自实现日志落盘＋复制诊断按钮）

> 任务卡：`docs/work-items/tasks/GAP1-DIAG.md`；矩阵行（root 单写）：DESKTOP-DIAG-LOG-PERSIST /
> DESKTOP-DIAG-CLIPBOARD / DESKTOP-DIAG-IPC（desktop-app.yaml，2026-10-19 预登记 planned，
> test_ids 由本记录回传、root 回填后升 covered）。
> 依据：复盘缺口 G1（用户 2026-10-19 拍板）＋拍板 8「日志落盘自实现，不引入 electron-log」；
> root 2026-10-19 阶段1 批准令（含裁定 2：「最近错误」＝主进程 ring，renderer 不采集）。

## E1 实验结论（阶段0，2026-10-19）

**桌面端主进程日志【完全不落盘】**（阶段0 实证，详见任务卡开工简报）：

- 源码侧：main.ts 全部日志＝console.log/warn/error（唯一去向 stdout/stderr）；无 electron-log、
  无日志用途的 appendFile/createWriteStream（唯一 createWriteStream 在 portable-updater.ts
  下载管线）；uncaught/unhandled 兜底（main.ts:124-129 原貌）同为 console.error。
- 真机侧（只读探测，零写入零运行）：HKLM uninstall 找到 per-machine 安装
  `D:\MySoftWares\a-share-kline-trainer\`；数据目录
  `C:\Users\Stark_Du666\.a-share-kline-trainer\` 仅 trainer.sqlite＋window-state.json，
  **无 logs/ 子目录**；安装目录 depth≤2 `find -iname "*.log"` 零命中。

## 交付物

**desktop/src**：

- `diag-log.ts`（新）：`createDiagLogger`（追加写/按大小滚动/写失败逐次降级 console，
  promise 链串行化）＋`createTeeConsole`（console 透传＋落盘＋error 级错误环回调）；
  默认 2 MiB × 当前＋2 旧档（proposed_default）。
- `diagnostics.ts`（新）：`buildDiagnosticsText`（冻结字段顺序纯组装；尾部 ≤200 行、
  错误环 ≤20 条上限内建）＋`summarizeUpdateCheck`（三态人话）＋`registerDiagnosticsIpc`
  （唯一新通道 `desktop-diagnostics:invoke`，method copy；失败结构化中文，绝不抛渲染端）。
- `main.ts`：模块级 mainLog（tee）替换全部 35 处 console.* 调用点＋5 处 DI `logger: console`；
  dataDir 解析后 `attachDiagLog(config.dataDir)`（幂等，首行自证）；uncaught/unhandled 兜底经
  tee（保住「不退出/不解引用/守卫格式化」全部契约）；boot 检查结果留人话快照供诊断字段。
- `preload.cts`：第四个窄对象 `desktopDiagnostics`（单一方法 `copyDiagnostics`）。

**web/src**：`diagnosticsFlow.ts`（新，零依赖纯逻辑：桥面 fail-closed 探测＋冻结文案常量）；
`components/TrainingSettings.vue` about 分栏新增诊断动作区（ghost-button＋role=status 反馈，
纯浏览器形态不渲染；仅一条区块间距 CSS，零新样式体系）。

**测试**：`desktop/test/diag-log.test.ts`（6 例，含真实 fs 边界）、`desktop/test/diagnostics.test.ts`
（10 例：组装/负向/上限/IPC 三态/main.ts 源码契约/无数据面契约）、
`desktop/test/desktop-updates.test.ts` allow-list 扩展为四对象精确集合、
`server/test/diagnostics-ui.test.ts`（2 例，transpile 模式）、
`e2e/diagnostics-copy.spec.ts`（2 例：无桥 gating＋桩桥成功/失败路径；**未运行**，见下）。

## 门禁收据（2026-10-19，worktree task/GAP1-DIAG）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| RED（先于实现） | vitest diag-log+diagnostics | exit=1×2，原因＝Cannot find module（缺功能） |
| RED（IPC 面） | vitest desktop-updates | exit=1，allow-list 不含 desktopDiagnostics |
| RED（web 纯逻辑） | vitest server diagnostics-ui | exit=1，ENOENT diagnosticsFlow.ts |
| desktop 全量（提交态） | `npm run test:desktop` | **30 files / 299 tests 全绿，exit=0** |
| desktop 编译 | `npm run build:desktop:main` | exit=0 |
| web 类型 | `npm run typecheck:web` | exit=0 |
| web 纯逻辑 | vitest server/test/diagnostics-ui.test.ts | 2/2，exit=0 |
| 变异 M1（降级→重抛） | vitest -t "degrades write failures" | **exit=1 被杀**（promise rejected "disk full"） |
| 变异 M2（删剪贴板写入） | vitest -t "registers exactly one channel" | **exit=1 被杀**（writes length 0≠1） |
| 变异还原复核 | vitest 两文件 | 16/16 绿，exit=0；源码零 MUTATION 残留 |

已知过程事件：desktop 全量首轮 port-tree-kill「真实两级进程树」用例超时失败（15s 预算）——
该用例与本任务零关联（port-conflict 域），单跑 7/7 绿（exit=0）；判为并行 worker 全量 journey
抢占资源的环境性失败。main-process-guards 两例源码契约因 tee 重构需把字面量 console.error
放宽为 mainLog.error|console.error（语义锁未放宽：不退出/不解引用/守卫格式化/console 透传由
diag-log.test.ts tee 用例独立锁定）——该测试修订随本任务交付，root 复核时请抽读。

## 诊断文本形态（proposed_default，待用户验收确认）

字段顺序：K线训练器诊断信息／应用版本：v…／平台：os / arch（Electron …、Chrome …、Node …）／
数据目录：…／更新通道：packaged|dev／最近更新检查：ISO（三态人话｜本进程未执行更新检查）／
最近错误：（- 前缀行｜（无））／日志尾部（最近 200 行）：（行｜（暂无日志）｜（日志不可用：原因））。
滚动参数 2 MiB × 3 份、反馈停留 3 秒、纯浏览器形态按钮隐藏——均 proposed_default。

## deferred 登记（按 root 阶段1 批准令第 4 条）

1. **真机验收「2 分钟内产出可贴 issue 的诊断文本」**：gpu3060 关机，deferred（任务卡与矩阵
   oracle 已注明）；由用户真机按「设置→关于与更新→复制诊断信息→粘贴」路径验收。
2. **e2e/diagnostics-copy.spec.ts 未运行**：root 硬约束（另一 worker 独占浏览器跑全量
   journey），待 root 串行通知后执行；spec 已按 runtime()/evidencePath 约定写好。
3. **dev 形态 Electron 冒烟未做**（root 允许项「如可行」判定为不可行）：dev 窗口形态与真实
   安装共用 Electron 单实例锁的 userData 面，存在锁冲突与桌面窗口打扰风险；链路覆盖由
   真实 fs 单测＋main.ts 源码契约＋IPC 注入用例承担，packaged 形态留真机验收一并闭环。
4. **既有边界披露**：data-home.ts 决策层内部 2 处 console.warn（损坏记录分支）与内嵌 server
   自身 stdout 日志不经 tee 落盘（矩阵行口径＝主进程日志；server 日志属其自身域）；
   attach 前启动早期行仅 console（开工简报已知边界）。

## test_ids 回传（root 回填矩阵用；file::it 全名）

DESKTOP-DIAG-LOG-PERSIST：
- desktop/test/diag-log.test.ts::appends lines in order to <dataDir>/logs/main.log, creating the directory（真实 fs）
- desktop/test/diag-log.test.ts::rotates by size keeping exactly the bounded set（真实 fs＋注入小阈值；手算分布）
- desktop/test/diag-log.test.ts::keeps the default threshold and retention constants（proposed_default 数值断言）
- desktop/test/diag-log.test.ts::degrades write failures to console and never throws nor blocks（注入桩）
- desktop/test/diag-log.test.ts::readTail returns the last N lines; missing file＝empty ok; unreadable＝structured reason
- desktop/test/diag-log.test.ts::tee console passes through to console and appends timestamped level lines（注入桩）
- desktop/test/diagnostics.test.ts::main.ts routes all logging through the tee and wires the diagnostics IPC

DESKTOP-DIAG-CLIPBOARD：
- desktop/test/diagnostics.test.ts::builds the frozen field list in order（版本/平台/数据目录/更新通道与最近检查/最近错误/日志尾部）
- desktop/test/diagnostics.test.ts::renders honest placeholders for absent sections（无检查/无错误/日志尾部空或不可用）
- desktop/test/diagnostics.test.ts::caps the log tail to the last DIAG_TAIL_MAX_LINES lines and errors to the ring limit（独立手算）
- desktop/test/diagnostics.test.ts::never contains training or trading data（负向断言：清洁输入零泄漏）
- desktop/test/diagnostics.test.ts::summarizeUpdateCheck maps the three outcomes with human text
- desktop/test/diagnostics.test.ts::diagnostics.ts stays a pure assembler with no database or server surface（负向：源码零数据面引用）
- server/test/diagnostics-ui.test.ts::detectDesktopDiagnostics accepts only the copyDiagnostics function shape (fail-closed)
- server/test/diagnostics-ui.test.ts::freezes the proposed_default copy feedback constants
- e2e/diagnostics-copy.spec.ts::diagnostics copy stays hidden in the pure browser form (DESKTOP-DIAG-CLIPBOARD fail-closed gating)（**未运行**）
- e2e/diagnostics-copy.spec.ts::diagnostics copy rounds the stubbed bridge: 已复制 feedback fades and the failure path stays retryable (DESKTOP-DIAG-CLIPBOARD)（**未运行**）

DESKTOP-DIAG-IPC：
- desktop/test/desktop-updates.test.ts::UPD-DESKTOP-IPC-MINIMAL: preload exposes exactly the allow-listed contextBridge objects (desktopUpdates + DATA-ARCH-01 desktopRecordings) and nothing else（四对象精确集合，用例名保持不变防矩阵 ref 悬空）
- desktop/test/diagnostics.test.ts::registers exactly one channel desktop-diagnostics:invoke; method copy → clipboard receives the built text and ok:true
- desktop/test/diagnostics.test.ts::rejects unknown methods with a structured error and leaves the clipboard untouched
- desktop/test/diagnostics.test.ts::maps collectFacts / clipboard failures to a structured Chinese error without throwing to the renderer

root 指令勘误呈报：root 批准令第 3 条将白名单表述为「desktopUpdates + desktopRecordings +
desktopDiagnostics 三者且无其他」，与仓库现实冲突——preload 既有第四个矩阵绑定对象
desktopMigration（MIG-EXT-01，manual 兜底通道，其删除会破坏迁移功能与既有绑定）；按矩阵/既有
冻结契约优先，实现取**四对象**精确集合（desktopDiagnostics/desktopMigration/desktopRecordings/
desktopUpdates），用例断言原文见上。
