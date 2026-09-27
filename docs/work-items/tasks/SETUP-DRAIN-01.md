# SETUP-DRAIN-01 受保护排空与优雅退出通道

```json
{
  "id": "SETUP-DRAIN-01",
  "title": "SETUP-01 第六片：受保护排空与优雅退出通道（drain/cancel/shutdown 服务端闭环）",
  "owner": "integrator",
  "state": "closed",
  "milestone": "M5",
  "summary": "受保护排空/取消/优雅关闭服务端行为已通过控制层冻结范围复核，F1/F2/F3闭合，带4项非阻断followup接入隔离候选8e7da05。完整首次接入/launcher重启/UI仍待交付。",
  "next_action": "复用本片实现SETUP完整用户闭环，不重做已验收模块；followup与证据见本片验收报告。",
  "allowed_paths": [
    "server/src/setup/drain-controller.ts",
    "server/src/setup/control-api.ts",
    "server/src/api.ts",
    "server/src/index.ts",
    "server/src/data/refresh.ts",
    "server/test/setup-drain.test.ts",
    "server/test/setup-control-api.test.ts",
    "server/test/setup-control-process.test.ts",
    "server/test/data-refresh.test.ts",
    "docs/work-items/tasks/SETUP-DRAIN-01.md",
    "docs/status.md"
  ],
  "depends_on": ["SETUP-RESTART-PLAN-01"],
  "base_commit": "e5a7b8ff0b786caf3022d6ee9a9ddb04f3a307a4",
  "docs_impact": {
    "reason": "冻结合同授权切片：服务端排空/取消/优雅退出闭环，不改 launcher/DB schema/engine/UI/交易与录像逻辑。",
    "update": ["docs/work-items/tasks/SETUP-DRAIN-01.md", "docs/status.md"]
  },
  "verification_refs": [
    "server/test/setup-drain.test.ts",
    "server/test/setup-control-api.test.ts",
    "server/test/setup-control-process.test.ts",
    "server/test/data-refresh.test.ts",
    "docs/verification/2026-09/SETUP-DRAIN-01/report.md"
  ],
  "integration_ref": "integration/product-integration-20260926@8e7da052f557d0fda1e75b0a262dd9914c39e7a3",
  "acceptance_ref": null
}
```

## 冻结语义要点（对照合同逐条）

1. **四种误判防入账**：GET 不等于只读（GET /api/stocks、/api/env 等隐式写缓存/查询，gate 全覆盖）；HTTP 202 不等于后台结束（refresh 202 后 runTask/watchdog/finally 仍写库，其完整 Promise 纳入排空）；SIGTERM 不等于跨平台优雅退出（Windows 跨进程为 TerminateProcess；本片 shutdown 走 HTTP 调用现有 shutdown 函数，SIGINT/SIGTERM/IPC 处理兼容保留）；ready 与 health 均为服务自报，不构成独立正确性（spawn 独立依据属未来助手 ChildProcess.pid，本片不预填）。
2. **一次性语义**：同 attempt 重复 prepare 共用结果与原 deadline；cancelled/drain-timeout/expired attempt 结果保留，同 id 不作为新动作；closing 后 cancel→CONTROL_CLOSING、prepare→CONTROL_CLOSING、gate 永不重开。
3. **排空真实性**：租约在 handler Promise 完成/finally 后释放（注册阶段统一包装，非 onResponse 计数、非仅 createTraining 布尔）；refresh 后台任务经 pendingTasks() 注册进 gate 任务来源，prepare 收集租约＋任务来源快照 allSettled 等待；源头 track 与 202 返回之间无竞态（任务 Promise 在 start() 返回前同步入册）。
4. **保守收敛**：排空预算到期或租约到期均撤销接纳重开 gate（后台任务永不结束→prepare 超时撤销，不关库）；恢复/失败状态稳定，迟到事件不覆写；shutdown 仅迁移 closing，真实调用在回包后且仅一次。

## 恢复轮（control-handoff-20260927-32，babb70b WIP 之后）

- **旧全量 11 失败：environment_failure 迹象、根因 unknown（不编造确定归因）**。串行复核 docs-tooling 30/30、worktree-tools 28/28 全过（glmr32-serial-*），恢复后完整单跑也未复现；npm ci 退出码 3221225794（0xC0000402 fail-fast）与 20s 超时属环境/进程异常迹象，verify:candidate 未执行系 npm ci 失败的下游表现。未复现≠排除，不开全仓 flaky 工程。
- **完整 unit 单跑（恢复后）**：81 文件 / 1075 tests 全绿 exit=0（glmr32-full-unit），含此前失败的两文件。
- **Journey/M2 子门禁缺 oracle → needs_replan**：prepareJourneySnapshot 与 verify:m2 均要求 TDX_ROOT/真实通达信源制作冻结快照（runtime/snapshot.ts:73-77 无源即抛错）；磁盘检索 51 份 tdx-browser-sample manifest 仅存 sha256 清单，快照字节本体已随临时 run 目录清理，重建必须读用户真实 TDX（本片禁止）。请控制层指定现存冻结样本路径或裁决快照制作授权；其余门禁全部完成，不受此阻塞。
- **证据卫生更正**：暂停前对全量门禁的"仅中断无结果"说法不完整——drain30-full-unit.log 实为 11 failed/1064 passed 且 meta 缺 exit/end（原件保留未改写）；本轮已按恢复指令以新前缀 glmr32-* 补齐串行复核与完整单跑证据。

## 首次失败记录与根因（RED→GREEN 过程如实）

- RED：实现暂存后在基线 e5a7b8f 仅放新测试 → 2 failed/20 passed exit=1（red30-tests.log：模块缺失导入失败、控制端点 404、pendingTasks 缺失）。
- 过程失败（均未删除记录，见 red30 后的本地运行）：①gate.admit 探针未释放租约致 prepare 超时（测试数据错）；②非 JSON 字符串 payload 被 Fastify 415 拦截未到 400（传输层与合同层分层，测试改用 `[]` 合法 JSON）；③config.runId 未配置用例误用空 body.runId 先触发 400（改为合法 body 验证 503）；④装饰器补丁未 bind this 致 Fastify 崩溃、且 Fastify 方法挂实例而非原型（delete 恢复失败，改为属性重赋值恢复）；⑤真实子进程 Host 头缺端口号被防护链 403（防护链按合同正确工作，测试修正）。
- 根因教训：PATCH 实例方法必须保存属性值并在恢复时重赋值（Fastify 方法在实例上）；裸 HTTP 客户端 Host 必须逐字含端口——防护链先于便利性。

## 尚未验证的边界（如实）

- 多进程同库并发不在本片保证内（launcher 后续验证服务归属/锁）。
- 助手崩溃后 prepared 租约到期自动撤销已测，但"租约撤销时有在途 handler"的组合属超时路径已由预算覆盖，未单列长稳测试。
- 202 后子进程收到关闭但 DB 写入失败等极端 IO 错误路径未注入故障验证。
- drain-timeout 的 504 映射在 control-api 层由代码路径保证，HTTP 层断言以单元层等价覆盖（无业务路由夹具可制造排空阻塞）。

## 限定返修轮（control-handoff-20260927-34，首次 repair）

- **F1/P1 admission-and-inflight**（implementation_defect）：runDrain 原只对任务来源做一次快照，已接纳刷新 202 后才注册的 scan 后台任务逃出排空等待。修复：静默循环反复重收任务来源直到确无新增在途（预算内强制收敛）；beginShutdown 增加在途守卫（任务在途 → CONTROL_NOT_PREPARED）。交错场景已入正式回归（setup-control-api F1 用例：available 挂起→prepare→202→scan 未完成不得 prepared/shutdown 拒绝→scan 完成→prepared→closing），scan 完成正例钉住。
- **F2/P2 authentication**（implementation_defect）：actualHostPort 只取端口拼 127.0.0.1，实际监听 0.0.0.0 也放行。修复：校验 address.address 逐字为 127.0.0.1，非合同监听一律 403 且零副作用；127.0.0.1 动态端口正例保留。回归入 setup-control-api F2 用例。
- **F3/P2 real-process-shutdown**（implementation_defect）：index `void shutdown()` 丢 Promise（同步 throw 绕过 catch 变 uncaughtException、rejection 变 unhandledRejection）；setImmediate 在异步 onSend 完成前触发关闭。修复：control-api 经微任务调用（同步 throw 与 rejection 一律进受控 catch 留日志）；触发点改为原生 res `finish`（连接提前关闭按既有关闭语义保守触发，只触发一次）。回归入 setup-control-api F3 用例（sync-throw/async-reject 均无 unhandled）。
- **非阻断 followup（不拖住本片）**：SETUP-CONTROL-ATTEMPT-REPORT（closing 后非匹配 attempt 也返回 202 closing，只关一次无副作用）、SETUP-CONTROL-HEADER-STRICTNESS（含逗号 token 与重复 header 拼接等值边界，未显示绕过凭据）。
- 旧失败归因措辞修正：环境/进程异常迹象、根因 unknown、串行与恢复后完整单跑未复现；不编造"并行负载"确定结论。

## 门禁

- 新 3 测试（setup-drain/setup-control-api/setup-control-process）＋data-refresh/catalog-protection＋原 6 个 SETUP 测试；完整 unit 单次；npm run build；docs:check；docs:impact --base e5a7b8f --task SETUP-DRAIN-01；docs:status --check；git diff --check。
- RED 证据：red30-tests.log/.meta（基线 e5a7b8f 仅测试在场，exit=1）。
- 全部日志唯一前缀 drain30-*，每命令 .meta 成对（cmd/cwd/HEAD/源码 hash/起止/exit）。


## 控制层最终裁决

2026-09-27 accepted_with_followups；原历史条目均保留，当前结论见 [验收报告](../../verification/2026-09/SETUP-DRAIN-01/report.md)。正式测试弱断言及Journey flaky均如实登记，非整体验收或main提升。
