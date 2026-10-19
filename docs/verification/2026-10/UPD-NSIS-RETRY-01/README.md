# UPD-NSIS-RETRY-01 验证记录：NSIS 安装中断自愈重试

- 任务：UPD-NSIS-RETRY-01（冷审 P1-2 修复；用户 2026-10-19 批复 2「无感自动诊断与处理」）
- 分支：task/UPD-NSIS-RETRY-01（基 main=337cbec）；worktree D:\tmp\wt-nsisretry
- 矩阵行：UPD-NSIS-INTENT-RETRY（root 预登记，worker 不编辑矩阵；test_ids 见 §6）
- 日期：2026-10-19

## 0. 已读清单（纪律注入）

1. `.zcode/skills/ai-harness/SKILL.md`（v1.12）
2. `.zcode/skills/ai-harness/references/development-principles.md`
3. `docs/work-items/tasks/UPD-NSIS-RETRY-01.md`（任务卡）
4. `docs/verification/2026-10/U5-BRIEF/cold-review.md` A6/A7 条目（论断已亲自核实：
   main.ts exit 分支 quitAndInstall 后无任何标记/恢复面；grep repo 无 update-intent
   相关观测——「repo 无观测无恢复」属实）

## 1. 现状证据（RED 的依据）

- 冷审 A6/A7 窗口＝quitAndInstall 交接后到 NSIS 装完之间中断：应用停在旧版本，无人知晓。
- 修复前代码事实（本 worktree 基线实读）：
  - `desktop/src/main.ts` exit 分支（排空收敛后）只 `sendUpdateEvent({type:'installing'})`
    → `quitAndInstall(true,true)`，无任何落盘标记；
  - 启动路径（bootServerAndOpen/bootstrap）无意图校验——标记在＋版本不符时什么都不发生
    （RED 场景一）、标记在＋版本符时永久残留（RED 场景二）。

## 2. 设计（形状与口径）

### 2.1 标记形状（`<dataDir>/update-intent.json`）

```json
{ "version": 1, "fromVersion": "1.3.2", "toVersion": "1.3.4", "startedAt": "<ISO>", "attempts": 0 }
```

- 严格解析（`parseUpdateIntentRecord`）：version!=1／字段缺失或类型错／attempts 非非负
  整数一律 null——损坏容忍＝视为无标记重发现（参照 data-home「desktop 自有原子写文件，
  写坏≠用户配置错误」先例）。
- 原子写：临时文件（uuid 后缀）＋rename；**退出路径用同步原子写**
  （`persistUpdateIntentMarkerSync`：writeFileSync＋renameSync，失败清理临时文件）——
  quitAndInstall 之后进程随即退出，异步写不保证落盘。
- attempts 语义：每次自愈重试前先持久化 +1；quitAndInstall 续装**同目标**时保留计数
  （`buildInstallIntentMarker`），目标不同则归零——计数是防无限循环的根基。

### 2.2 三分支启动校验（`resolveUpdateIntentAction`＋`runUpdateIntentBootValidation`）

| 分支 | 判据 | 动作 |
|---|---|---|
| none | 无标记／无法确定当前版本 | 照旧（零调用零噪声） |
| complete | 当前版本==toVersion（compareVersions===0，v 前缀容忍；**成功优先于预算**） | 清标记（失败仅日志不阻断，幂等重清） |
| retry | 版本不符且 attempts<3 | 先持久化 attempts+1，再静默重走更新链；persist 失败→放弃本轮（不计数不重试，防无限循环旁路） |
| give-up | 版本不符且 attempts>=3 | 人话指引经既有 `desktop-update:event` error 事件面呈现→清标记收尾 |

### 2.3 主进程接线（main.ts）

- **写标记时机**：dispatchQuitEvent 的 exit 分支，`resolveInstallActionOnExit==='quit-and-install'`
  裁决通过后、`quitAndInstall(true,true)` 调用前（顺序由源码契约用例锁定）。目标版本来自
  controller `downloaded` 事件捕获（sendEvent 包装），数据目录为 boot 解析的生效 dataDir。
  写失败仅降级日志，**绝不阻断安装**（标记是自愈保护面不是安装前置）。
- **校验时机**：bootServerAndOpen 的 proceed 路径尾（服务已起、窗口已建后）fire-and-forget
  （`runNsisIntentBootValidation`；内部全捕获绝不阻断启动）。仅 packaged 通道（dev 不打
  更新源，与 shouldAutoCheckOnBoot 同口径）；reuse 提前返回路径不经手（另一实例在跑，
  更新退出语义不属本进程，标记留待干净启动处理）。
- **重走链**：`runSilentUpdateRetryChain` 复用既有 controller 编排——checkForUpdates→
  downloadAndInstall（内含 checked 守卫、90s 停滞看门狗、下载完成→排空退出管线），安装
  仍必经 resolveInstallActionOnExit；链内失败经既有 error 事件面呈现。
- **与 UPD-BOOT-AUTO-CHECK 叠加**（同一启动只重触发一次）：单发守卫
  `updateIntentRetryTriggered`；重走链触发时清缓存通知（bootUpdateNotice=null，did-finish-load
  补投不再发生）＋onBootNotice 出口在自愈进行中丢弃通知。

## 3. RED→GREEN 收据

### RED（先于产品码）

- 测试文件：`desktop/test/update-intent.test.ts`（26 用例，oracle＝任务卡冻结口径＋用户
  批复原意，期望值手写不从实现回显）。
- 首跑：`npx vitest run --config desktop/vitest.config.ts desktop/test/update-intent.test.ts`
  → **exit=1**，`Error: Cannot find module '../src/update-intent.js'`——失败于无此逻辑
  （模块缺失），非语法/环境错。
- 模块落地后、main.ts 接线前：22 通过＋4 失败（4 失败全为 main.ts 接线源码契约——
  失败面与未接线一致）。
- 两处核心 RED 场景（任务卡指定）：
  - 场景一「标记在＋版本≠target→应自动重触发」：断言 `calls===['persist','chain']`——
    修复前无此逻辑；
  - 场景二「标记在＋版本==target→应清标记」：断言 `calls===['clear']`——修复前无清理。

### GREEN

- `npx vitest run --config desktop/vitest.config.ts desktop/test/update-intent.test.ts`
  → **exit=0**（26/26）。

## 4. 回归收据（命令＋字面退出码）

| gate | 命令 | 结果 |
|---|---|---|
| desktop 全量 | `npm run test:desktop` | **exit=0**：33 文件 351 用例全绿（含 update-boot-check / desktop-updates / desktop-updates-stall / desktop-updates-fixture / installer-upgrade / main-process-guards / portable-updater 等既有面） |
| 桌面主进程编译 | `npm run build:desktop:main`（tsc -p desktop/tsconfig.json） | **exit=0** |
| 绑定检查基线 | `check-binding.mjs --repo D:\tmp\wt-nsisretry --matrix <updater.yaml> --strict` | **exit=3**：45 行 covered=41 open=4——4 行为 2 个 superseded 历史行＋UPD-STALE-BUSY-SELFHEAL（他任务 planned）＋UPD-NSIS-INTENT-RETRY（本任务行，test_ids 待 root 回填；见 §6）。与本任务相关的既有覆盖面零回归（全量测试绿）。 |

## 5. 变异抽检（P4，杀手测试实证）

1. **M1（重试上界 off-by-one）**：`resolveUpdateIntentAction` 的 `attempts >= maxRetries` 变异
   为 `>` → 跑套件 **exit=1**，恰好 2 用例死：
   - `UPD-NSIS-INTENT-RETRY: 计数达上界→give-up（默认 3，proposed_default）`
   - `UPD-NSIS-INTENT-RETRY: 超界→人话指引经既有事件面呈现＋清标记收尾，不再重走链`
   还原后复跑全量 exit=0。
2. **M2（计数先于链）**：重试分支 `await deps.persistMarker(next)` 变异为 no-op → **exit=1**，
   3 用例死（含 RED 场景一本体）：
   - `UPD-NSIS-INTENT-RETRY: 标记在＋版本≠target→先持久化计数+1 再自动重走更新链（RED 场景一）`
   - `UPD-NSIS-INTENT-RETRY: 重试前计数持久化失败→不重走链（不计数不重试，防无限循环旁路）`
   - `UPD-NSIS-INTENT-RETRY: 更新链自身抛错被吞（链内错误经事件面呈现，校验绝不逃逸）`
   还原后复跑全量 exit=0（还原均定向 Edit，未用 git checkout 整文件）。

## 6. 矩阵绑定（test_ids 回传，供 root 回填 UPD-NSIS-INTENT-RETRY 行）

覆盖 EARS 全部子句（写标记时机/三分支/有界重试/超界人话/不改诊断字段集——后者经「不改
web/src＋呈现走既有事件面」的边界实现与源码契约锁定）：

- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: parseUpdateIntentRecord 接受完整合法形状
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: parseUpdateIntentRecord 对非法形状一律拒绝（null），损坏容忍先例
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: serialize 后可被 parse 完整还原（往返一致）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: buildInstallIntentMarker 新意图 attempts 从 0 起，同目标续装保留计数
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: retryIntentMarker 只递增计数，不改目标与起点
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 无标记→none；无法确定当前版本→none（无从裁决不动作）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 版本==target→complete（v 前缀容忍同口径）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 版本≠target 且未超界→retry（nextAttempts=attempts+1）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 计数达上界→give-up（默认 3，proposed_default）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 标记在＋版本≠target→先持久化计数+1 再自动重走更新链（RED 场景一）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 标记在＋版本==target→清标记收尾，绝不重触发（RED 场景二）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 清标记失败仅日志不阻断（成功收尾不因清理失败报错困住用户）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 无标记→照旧（零调用零日志噪声）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 读标记抛错→按无标记处理且绝不逃逸（损坏容忍）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 超界→人话指引经既有事件面呈现＋清标记收尾，不再重走链
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 重试前计数持久化失败→不重走链（不计数不重试，防无限循环旁路）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 更新链自身抛错被吞（链内错误经事件面呈现，校验绝不逃逸）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 人话文案构造器——超界与更新源无新版两个口径
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 同步写＋双路读往返一致；清标记后读取为 null
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 异步原子写后无临时文件残留且内容可读回
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 文件缺失/内容损坏→双路读均按无标记处理（损坏容忍＝重发现）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 清除不存在的标记不抛错（幂等）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 排空收敛安装分支内 quitAndInstall 发起前同步写标记
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 启动校验接在 proceed 启动路径尾（服务起来之后），reuse 提前返回路径不经手
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 校验仅 packaged 通道放行且重触发单发（同一启动只重触发一次）
- desktop/test/update-intent.test.ts::UPD-NSIS-INTENT-RETRY: 安装分支的标记目标版本来自 downloaded 事件捕获

## 7. 边界与已知限制

1. **真机中断场景 deferred**（任务卡指定）：真装 v1.3.x→v1.3.y 中途杀 NSIS 安装器/断电的
   端到端自愈未跑（gpu3060 关机）；单测锁定的分支语义＋源码契约为本轮证据面。真机验收
   时建议脚本：装旧版→触发更新→安装中杀进程→重启观察静默自愈（boot 日志
   `interrupted update detected ... silently re-running update chain`）。
2. reuse 分支（端口/共存复用另一实例）不经手自愈：更新退出语义不属本进程，标记留待干净
   启动处理（有界预算不受影响）。
3. 通知叠加残余竞态：boot 自动检查的网络回包若早于本地标记读取完成（慢启动＋快网络），
   渲染端可能短暂出现一次首页更新按钮，随后应用静默更新重启——良性瞬态（重启后无标记
   无通知），单发守卫保证重走链本身只触发一次。
4. 便携通道（retired）共享 exit 分支故同样会写标记：其 boot 校验重走链会走便携适配器，
   失败经事件面呈现且有界（3 次后 give-up）——继承语义，无无限循环面。
5. dev 通道不参与（不打更新源，与 UPD-BOOT-AUTO-CHECK 同口径）；dev 形态若经 IPC 手动
   触发安装会写标记，packaged 启动时按三分支正常消费。
6. `npm run workflow:state` 未执行：worktree 内无 workflow 控制根（state 文件），沿
   MIG-ONECLICK-01 §7.2 先例经任务卡＋本报告对账（orchestrator 域）。
7. server/src、web/src 零改动（诊断按钮冻结字段集 DESKTOP-DIAG-CLIPBOARD EARS 一字未动；
   人话呈现全部走既有 `desktop-update:event` 事件面）。

## 8. proposed_default 清单（提验）

1. **重试上界=3**（UPDATE_INTENT_MAX_RETRIES；任务卡建议值）。
2. **give-up 后清标记收尾**：人话指引呈现一次后清标记（自愈生命周期关闭，避免逐启动重复
   呈现）；用户后续手动更新走设置页既有链。
3. **人话文案**：超界＝「自动更新已重试 N 次仍未完成安装。请到 设置 → 关于与更新 手动
   重试，或到 GitHub Releases 下载完整安装包覆盖安装」；更新源无新版＝「检测到上次更新
   未完成，但更新源当前没有提供可用的新版本；已停止本次自动重试」。
4. **标记文件名** update-intent.json＋形状字段名（fromVersion/toVersion/startedAt/attempts）。
5. **重试计数持久化失败→放弃本轮自愈**（不计数不重试）。

## 9. needs_user_decision 清单

- 无（行为语义均有任务卡/用户批复 2 依据；上述 proposed_default 为呈现/参数类自定项）。

## 10. 交付物

- `desktop/src/update-intent.ts`（新增：纯决策＋编排＋真实 fs 适配，不 import electron）
- `desktop/src/main.ts`（接线：downloaded 版本捕获/意图数据目录回填/安装分支同步写标记/
  proceed 路径尾启动校验/重走链＋单发守卫/通知出口门控）
- `desktop/test/update-intent.test.ts`（新增：26 用例）
- 本 README＋任务卡状态更新
