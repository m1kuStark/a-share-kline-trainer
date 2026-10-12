# PORT-GHOST-SESSION-QUIT 验证记录（v1.2.7 遗留浏览器标签页拖慢 v1.3.0 退出）

- 任务：v1.3.0 桌面接管 8787 后，v1.2.7 遗留浏览器标签页在心跳 catch 里以 rc() 重注册
  为活跃会话，页内退出协调被拖进 awaiting 直到 120s TTL 失败（S1 repro2 实证）。
- 用户拍板（2026-10-12）：退出排空不被遗留页重注册拖拽；遗留页给出「版本已升级请刷新」
  类提示而非无限重试。
- 分支：ghost-session（基于 main=f2fc43f，worktree D:\tmp\ghost01）。
- 矩阵行：`launcher-lifecycle.yaml::PORT-GHOST-SESSION-QUIT`（预登记 planned，本任务不编辑矩阵）。

## 一、识别方案实证（v1.3.0 server 怎么认出 v1.2.7 老页面）

1. **请求形状无法区分**：v1.2.7 dist（D:\tmp\v127-repro\...\web\dist\assets\index-CwhfIfkH.js）
   实证其生命周期客户端与 v1.3.0 完全同形：
   - `rc()`＝`POST /api/lifecycle/session`，**无 body、无任何版本字段**；
   - 心跳/退出/确认/拒绝＝同端点同 payload 形状（`{sessionId, exitToken[, requestId]}`）；
   - 同源（127.0.0.1:8787）同 UA——Origin/Referer/UA 均不可判别。
2. **行为不可靠区分**：「只发心跳从不推进」同样适用于 v1.3.0 合法后台标签页（节流后
   心跳是唯一流量），按行为剔除会破坏 REL-LAUNCH-UX-01 多页确认语义（后台页未保存
   画线必须能阻塞退出）。
3. **任务候选 a 的前提不成立**：会话表 `lifecycleSessions` 是进程内存 Map，接管后为空；
   僵尸会话是在**新进程启动之后**重注册进来的，「注册时间 < 进程启动时间」恒为空集。
   排空控制器 `controller.prepare` 也从不等待会话（只等在途请求租约＋后台任务，预算
   10s）——拖拽唯一来源是 `/api/lifecycle/exit` 冻结的活跃集（awaiting 120s TTL）。
4. **结论（采用）**：代际标记判别。v1.3.0 web 注册时新增 `clientProtocol: 2`；server 对
   缺失该字段的注册一律 426 拒绝（不进活跃集）。旧页代码已发布不可改，但其 rc() 无 body
   ——「是否会说新协议字段」即代际判别，可靠且不误伤（v1.3.0+ 页面全带标记）。

## 二、修复设计（落点全部在 v1.3.0 侧）

| 改动 | 文件 | 内容 |
|---|---|---|
| 注册代际门 | `server/src/api.ts` | `/api/lifecycle/session` 要求 `clientProtocol` 为 ≥2 的有限数，否则 426 `CLIENT_UPGRADE_REQUIRED`＋「请刷新本页（F5）」文案；会话表内存态 ⇒ 旧页永远进不了活跃集 ⇒ 退出协调不再被拖 |
| 陈旧凭证提示 | `server/src/api.ts` | heartbeat/exit/confirm/cancel 的 403 `SESSION_TOKEN_INVALID` 全部补 `message`（请刷新）；v1.2.7 的 `Ge` 错误链 `message ?? error` 实证会把它显示进旧页退出弹窗 |
| web 注册标记 | `web/src/api.ts` | `createLifecycleSession()` 携带 `clientProtocol: 2`（App.vue 无需改动） |

旧页行为闭环（v1.2.7 dist `Ie()` 实证）：心跳 403（带提示）→ catch → rc() → 426 →
内层 catch → `Z()` 停心跳计时器——**无限重试链在接管后一个心跳周期内自然终止**；
用户若在旧页点退出，弹窗显示 403 的「请刷新」message。

不采用候选 c（TTL 收紧）：影响 v1.3.0 自身后台标签页（节流心跳间隔可达分钟级），风险大。
不做活跃集二次过滤：旧会话已不可能存在于会话表，过滤为死代码（YAGNI）。

## 三、测试与收据（命令＋退出码，均在 D:\tmp\ghost01）

| 阶段 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| 基线（改动前） | `npx vitest run server/test/api.test.ts --config server/vitest.config.ts` | 0（18/18） | — |
| RED | 同上 | 1（3 failed：代际门缺失/403 无 message/真实监听被拖 awaiting） | `red-run.log`＋`red-exit.txt` |
| GREEN | 同上 | 0（22/22） | `green-run.log`＋`green-exit.txt` |
| 构建 | `npm run build`（typecheck:web＋build:server＋build:web） | 0 | `build-run.log`（web dist 已含 clientProtocol） |
| 全量 | `npm test`（server 131 文件＋desktop 23 文件） | 0 | `full-test-run.log` |
| 变异 M1（禁用代际门 `if (false && …)`） | `npx vitest … -t PORT-GHOST-SESSION-QUIT` | 1 | `mutation-M1-run.log`：杀「versionless…refused」「real listener…not dragged」两条 |
| 变异 M2（heartbeat 403 去 message） | 同上 | 1 | `mutation-M2-run.log`：杀「stale pre-takeover credentials…refresh hint」一条 |
| 变异后复绿 | `npx vitest run server/test/api.test.ts …` | 0（22/22） | 见 gate 台账 |

## 四、.repro 式复现对照（真实 HTTP 边界，`repro-ghost.mjs`）

时序＝S1 repro2：server 接管端口 → 僵尸页旧凭证心跳 → rc() 重注册（无 body）→
当前代际页（clientProtocol 2）发起页内退出。

- **修复前**（`git stash server/src/api.ts` 后重建 dist，`repro-prefix.log`，exit 0）：
  僵尸心跳 403（无 message）→ 重注册 **200 进入活跃集** → 页面退出 **awaiting
  remaining=1**（将卡满 120s TTL 后失败；此处 3s 内取消清理）。
- **修复后**（`repro-fixed.log`，exit 0）：僵尸心跳 403（带刷新提示）→ 重注册 **426
  （CLIENT_UPGRADE_REQUIRED＋请刷新文案）** → 页面退出 **直接 draining**，shutdown 在
  退出请求后 **3~4ms** 完成（无 awaiting、无 TTL 等待）。

（*.log 为仓库全局忽略项，两份复现日志正文内联如下；vitest/build 全量日志存于本
worktree 同目录，可按第三节命令复跑。）

```text
# repro-prefix.log（修复前，exit 0）
[t+   387ms] server up on http://127.0.0.1:13046 (mode=prefix)
[t+   420ms] zombie heartbeat (stale creds): 403 {"error":"SESSION_TOKEN_INVALID"}
[t+   423ms] zombie rc() re-register (no body): 200 {"sessionId":"daea9162-...","heartbeatIntervalMs":15000,"freshWindowMs":90000}
[t+   425ms] v1.3.0 page register (clientProtocol 2): 200
[t+   427ms] page exit view: 202 {"phase":"awaiting","requestId":"df8c5b77-...","remaining":1}
[t+   428ms] status while dragged: {"phase":"awaiting","requestId":"df8c5b77-...","remaining":1} (would sit here up to 120s TTL)
[t+   429ms] cleanup cancel-exit: {"phase":"cancelled"}
[t+   432ms] outcome mode=prefix: AS_EXPECTED
```

```text
# repro-fixed.log（修复后，exit 0）
[t+   374ms] server up on http://127.0.0.1:14285 (mode=fixed)
[t+   406ms] zombie heartbeat (stale creds): 403 {"error":"SESSION_TOKEN_INVALID","message":"页面会话已失效（训练器服务已重启或已升级）：请刷新本页（F5）后重试"}
[t+   409ms] zombie rc() re-register (no body): 426 {"error":"CLIENT_UPGRADE_REQUIRED","message":"当前页面来自旧版本训练器：服务已更换或升级，请刷新本页（F5）后重试，或关闭后重新打开"}
[t+   411ms] v1.3.0 page register (clientProtocol 2): 200
[t+   415ms] page exit view: 202 {"phase":"draining","requestId":"f8fc9709-...","remaining":0}
[t+   415ms] shutdown completed in 3ms after exit request (no awaiting, no 120s TTL)
[t+   415ms] outcome mode=fixed: AS_EXPECTED
```

## 五、矩阵绑定测试 ID（供 orchestrator 升 covered；本任务未编辑矩阵）

- `server/test/api.test.ts::PORT-GHOST-SESSION-QUIT: a versionless v1.2.7-style registration is refused with a refresh-required answer and never joins the live set`
- `server/test/api.test.ts::PORT-GHOST-SESSION-QUIT: stale pre-takeover credentials get 403 with a refresh hint instead of a bare code`
- `server/test/api.test.ts::PORT-GHOST-SESSION-QUIT: current-generation registrations keep the multi-tab confirm protocol intact`
- `server/test/api.test.ts::PORT-GHOST-SESSION-QUIT: real listener exit is not dragged by a stale v1.2.7 tab that keeps polling`

绑定检查（strict，2026-10-12）：`covered=9 open=1 RED=0`，exit 3——唯一 open 即本行
planned（test_ids 空），符合派发预期（合并回 main 后由矩阵单写者绑定升级）。

## 六、bug-loop 归因

- 归类：**缺行**。REL-LAUNCH-UX-01 落地时矩阵只声明了同代际多页协调语义，从未声明
  「跨版本遗留客户端」组合；S1（PORT-COEXIST-V127-NODE）补了进程树终止行，浏览器
  页面侧组合仍缺，直至 2026-10-12 用户拍板后才由 orchestrator 预登记本行。
- 门禁为何没拦住：多页协调测试全部以「同代际客户端」建模（`createSession` 无差别注册），
  没有任何用例模拟「旧版本客户端对新 server 重注册」的入口组合。

## 七、范围与待拍板项

- 实改文件：`server/src/api.ts`、`server/test/api.test.ts`、`web/src/api.ts`、本目录。
  **边界说明（提请架构师确认）**：派发红线枚举的 web 文件是 `web/src/App.vue`，但注册
  客户端 `createLifecycleSession` 实际位于 `web/src/api.ts:346`（App.vue 无需改动）；
  按「web 侧最小配合」意图落一字段，若认定越界可回退该文件改由 App.vue 内联 fetch
  （不推荐，绕开 request()/ApiError 错误链）。
- 语义拍板项（proposed_default，已按默认实现）：① 旧代际注册拒绝的**呈现**（426＋文案）
  属呈现类默认，待用户提验；② 兼带效应——升级后未刷新的**同代旧构建 v1.3.0 页面**
  （注册无标记）也会被拒并停心跳，其退出弹窗得到「请刷新」提示；因其旧 server 会话
  已随进程消失，无可保护状态，判定为正确行为，仍提请知悉。
- 僵尸页若不与退出交互则静默停在后台（不再轮询）——这是旧页既有行为边界，本任务
  不扩大（相邻问题登记不顺手修）。
