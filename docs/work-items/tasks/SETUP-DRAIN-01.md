# SETUP-DRAIN-01 受保护排空与优雅退出通道

```json
{
  "id": "SETUP-DRAIN-01",
  "title": "SETUP-01 第六片：受保护排空与优雅退出通道（drain/cancel/shutdown 服务端闭环）",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "drain-controller.ts：业务接纳 gate＋租约跟踪＋prepare/cancel/shutdown 状态机（同 attempt 重复 prepare 共用结果与原 deadline 不延长租约；其他 attempt 409 CONTROL_BUSY；排空预算到期 504 DRAIN_TIMEOUT 撤销接纳；prepared 租约 30s 到期自动撤销；排空完成后无 await 同步复查活动训练，在途创建刚提交则 409 ACTIVE_TRAINING 并撤销；cancel 幂等，closing 后不可逆；关停不双调）。control-api.ts：POST /api/setup/control/{prepare,cancel,shutdown} 严格防护链——body 仅 {runId,attemptId}(400 CONTROL_REQUEST_INVALID)→remoteAddress loopback→Host 逐字等于实际绑定 127.0.0.1:port(PORT=0 取 address)→Origin 完全缺席(空串也拒)→Sec-Fetch-Site 出现即拒(均 403 CONTROL_HELPER_ONLY)→令牌三态(401 TOKEN_UNCONFIGURED/MISSING/INVALID，不接数组)→config.runId 非空(503 CONTROL_UNAVAILABLE)→body.runId 逐字(409 RUN_ID_MISMATCH)；全部验证前零副作用。api.ts：注册阶段统一包装全部 /api/ 业务路由（含 GET 隐式缓存写与 recording-context），gate 关闭后 503 SERVER_DRAINING，已接纳 handler 在 Promise 真正完成前持有租约（客户端 abort 不提前放行）；豁免 /api/health 与控制端点；静态资源不受影响。refresh.ts：仅增加在途刷新任务完整 Promise 可观测（202 返回后的 watchdog/catch/finally 写库纳入排空；源头 track 与返回之间无竞态），不改发布语义。index.ts：创建控制器/注册控制端点/onClose 清理定时器；真实 shutdown 由 control-api 在 202 回包后调用现有 shutdown 一次（202 不证明 PID 退出）。真实子进程测试（实际入口经 tsx、动态端口、临时 DB/static/ready、独立 runId/token、TDX_ROOT 空）验证 202→exit 0→端口可重绑→ready 清理→SQLite 完整。测试 46 项（本片新增）：drain 单元 18＋控制端点 HTTP 14＋真实子进程 1＋刷新观测 1＋既有 data-refresh 12。",
  "next_action": "GPT 复核；通过后下一片为一次性 launcher 助手跨旧服务退出执行重启（detached 模式保留，不建常驻 daemon），spawn 独立依据=助手 ChildProcess.pid＋预定新 runId（ready/health 为服务自报需交叉核对）。",
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
    "server/test/data-refresh.test.ts"
  ],
  "integration_ref": "integration/product-integration-20260926@e5a7b8f",
  "acceptance_ref": null
}
```

## 冻结语义要点（对照合同逐条）

1. **四种误判防入账**：GET 不等于只读（GET /api/stocks、/api/env 等隐式写缓存/查询，gate 全覆盖）；HTTP 202 不等于后台结束（refresh 202 后 runTask/watchdog/finally 仍写库，其完整 Promise 纳入排空）；SIGTERM 不等于跨平台优雅退出（Windows 跨进程为 TerminateProcess；本片 shutdown 走 HTTP 调用现有 shutdown 函数，SIGINT/SIGTERM/IPC 处理兼容保留）；ready 与 health 均为服务自报，不构成独立正确性（spawn 独立依据属未来助手 ChildProcess.pid，本片不预填）。
2. **一次性语义**：同 attempt 重复 prepare 共用结果与原 deadline；cancelled/drain-timeout/expired attempt 结果保留，同 id 不作为新动作；closing 后 cancel→CONTROL_CLOSING、prepare→CONTROL_CLOSING、gate 永不重开。
3. **排空真实性**：租约在 handler Promise 完成/finally 后释放（注册阶段统一包装，非 onResponse 计数、非仅 createTraining 布尔）；refresh 后台任务经 pendingTasks() 注册进 gate 任务来源，prepare 收集租约＋任务来源快照 allSettled 等待；源头 track 与 202 返回之间无竞态（任务 Promise 在 start() 返回前同步入册）。
4. **保守收敛**：排空预算到期或租约到期均撤销接纳重开 gate（后台任务永不结束→prepare 超时撤销，不关库）；恢复/失败状态稳定，迟到事件不覆写；shutdown 仅迁移 closing，真实调用在回包后且仅一次。

## 恢复轮（control-handoff-20260927-32，babb70b WIP 之后）

- **旧全量 11 失败分类定案：environment_failure（非代码缺陷）**。串行复核：docs-tooling 30/30、worktree-tools 28/28 全过（glmr32-serial-*）；npm ci 退出码 3221225794（0xC0000402 fail-fast）与 20s 超时均为并行负载下的环境症状，verify:candidate 未执行是 npm ci 失败的下游表现，非独立缺陷。
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

## 门禁

- 新 3 测试（setup-drain/setup-control-api/setup-control-process）＋data-refresh/catalog-protection＋原 6 个 SETUP 测试；完整 unit 单次；npm run build；docs:check；docs:impact --base e5a7b8f --task SETUP-DRAIN-01；docs:status --check；git diff --check。
- RED 证据：red30-tests.log/.meta（基线 e5a7b8f 仅测试在场，exit=1）。
- 全部日志唯一前缀 drain30-*，每命令 .meta 成对（cmd/cwd/HEAD/源码 hash/起止/exit）。
