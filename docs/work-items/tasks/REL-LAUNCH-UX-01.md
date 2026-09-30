# REL-LAUNCH-UX-01 浏览器关闭后的受控退出

```json
{
  "id": "REL-LAUNCH-UX-01",
  "title": "浏览器关闭后的受控退出",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "保存并退出入口与服务端生命周期协议已在 wt/B-REL-LAUNCH-UX-01 实现（复用SETUP-01冻结排空控制器；Stop.cmd保持应急强制语义并已在文档/帮助文案中明确）；最后标签延迟回收经评估暂不启用，结论记录于卡面。",
  "next_action": "集成串行合入候选；跑受影响回归（api.test lifecycle 组、release-launcher、e2e/exit-flow.spec）与真实浏览器 journey（单标签退出、多标签确认/拒绝、刷新回退缓存、崩溃/休眠恢复、跨站拒绝、端口释放、Start/Stop 并发）；Windows 干净包真实回归在集成工作树/发布包执行。docs_impact 中 docs/engineering/release-m3-contract.md 不在本卡 allowed_paths 内，生命周期与安全边界的服务端合同增补由集成人评估后单独处理。",
  "allowed_paths": [
    "scripts/release/**",
    "server/src/index.ts",
    "server/src/api.ts",
    "server/test/release-launcher.test.ts",
    "server/test/api.test.ts",
    "web/src/**",
    "e2e/**",
    "docs/user/**",
    "docs/work-items/tasks/REL-LAUNCH-UX-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/user/README.md",
      "docs/user/install.md",
      "docs/user/troubleshooting.md",
      "docs/engineering/release-m3-contract.md"
    ],
    "reason": "新增退出入口和服务生命周期说明，必须同步发布包操作文档与安全边界。"
  },
  "verification_refs": [
    "docs/verification/2026-09/LAUNCH-UX-01/report.md"
  ],
  "integration_ref": "worktree trainer-wt/wt-B，分支 wt/B-REL-LAUNCH-UX-01（原从 0f430cd 切出；2026-09-30 已并入 wt/B-SETUP-01 头 93ebc6a 并修复 lifecycle 守卫语义冲突 ca6116a，现包含 SETUP-01 全部提交）",
  "acceptance_ref": null
}
```

## 实现口径（2026-09-29，wt/B-REL-LAUNCH-UX-01）

- **保存并退出**：页面左侧栏"退出"→保存冲刷（训练页复用 `prepareForLibrary`：画线冲刷＋录像冲刷，失败可重试/取消）→ `POST /api/lifecycle/exit`（同源守卫＋每会话随机能力令牌；公开 health 的 runId 不能替代）。多标签协调：请求时刻的活跃会话集合冻结，其中每页都必须**显式确认**（其它页经心跳响应发现请求，弹出确认/拒绝）；拒绝、发起页失联、限时（120s）未确认一律取消退出并如实提示，服务不停止。确认齐后走与控制桥同一冻结排空控制器 prepare→真实 shutdown（app.close＋database.close），排空期间新业务 503；prepare 的活动训练/超时结果如实回传（不转强制结束）。页面轮询状态，轮询失联再用 /api/health 复核，端口确实不可达才显示"已退出，可关闭此页"。退出不结算、不放弃训练。启动互斥由启动器既有 decideRecordedServer 语义保证（活着复用、死了清理），退出不清启动状态文件。
- **会话与心跳**：每页一个会话（sessionStorage 保存，刷新/回退缓存恢复后继续续约），15s 心跳、90s 活跃窗（覆盖后台标签被节流到每分钟一次心跳）、静默超过 270s 的会话视为已关闭页面不再阻塞。visibilitychange/最小化/短暂心跳丢失一律不视为退出；浏览器冻结、崩溃、休眠造成的失联无法与关页区分。
- **最后标签延迟回收：评估结论＝暂不启用**。自动回收依赖"心跳停＝页面关"的推断，而冻结/断网/崩溃/系统睡眠都会造成同样的失联；误停会让仍打开的页面失去服务，且无人在场时无法协调保存。按卡面要求交付可靠的保存退出入口；若未来要求"任何关闭都保证立即结束进程"，应评估受控桌面窗口接管服务生命周期，普通浏览器路径无法承诺。
- **Stop.cmd 语义澄清**：行为保持不变（身份核验后 SIGKILL），但其定位已在 usage 帮助、停止成功输出与三份用户文档中明确为"应急强制结束，不等待页面保存"；正常保存退出只走页面入口。--no-open、开发预览与外部自管服务不受影响：退出按钮对任何会话可用，但生命周期端点未注入时如实返回 503 降级提示。

当前事实：`server/src/index.ts`已有shutdown函数，但发布启动为detached且无IPC；`launcher.cjs --stop`核对状态、健康身份、PID和端口后使用SIGKILL，不能称为正常关闭。Windows信号不能替代应用层正常退出协议。浏览器标签页关闭不会发送停止信号，这是现有设计；未证明朋友的故障由此导致。

第一步提供“保存并退出训练器”：等待本轮在途写入、录像和画线保存并保留训练进度，不自动结算/放弃；保存失败显示重试/取消。有其他页面时广播退出请求，各页确认保存完成，拒绝或无响应则不自动停止。退出接口只允许本机应用页面：校验Host、Origin及不可用公开health中的runId替代的随机控制令牌，禁开放CORS调用；关闭开始后拒绝新写入，等在途请求排空、app.close和database.close完成再退出。与启动互斥，核对版本/库/runId，确认PID退出和端口结果；超时如实报失败，不能静默转强杀。

第二步评估并验证“关闭最后标签后延迟回收”：各页独立会话标识和续约，关闭提示仅作提示；刷新/重新打开宽限期内重连取消退出，其他有效页面存在时不退出。不得把visibilitychange/最小化视为退出。浏览器冻结、断网、崩溃和系统睡眠造成的失联无法可靠区分，不能单靠短心跳超时宣称精确关闭识别；保存未确认时保守保留服务。若产品要求任何关闭都保证立即结束进程，应评估受控桌面窗口拥有服务生命周期，不能声称普通浏览器能保证。宽限时间通过行为测试确定，不因随意常量新增停录或丢弃逻辑。

只对本启动器管理的便携会话启用生命周期管理，开发预览、--no-open和外部自管服务保持显式管理。稳定端口与origin保留录像；Stop.cmd仍是身份核验后的应急兜底，不作为新按钮的正常保存方案。

GLM拆分：退出协议/会话纯状态机和测试；前端保存协调与状态；启动桥接及Windows进程回归。最多三并发独立worktree；App/API/launcher共享接线由集成人单写，与SETUP-01错开同文件任务。

验收：单标签保存后退出；交易在途、保存失败、多标签未确认；刷新/回退缓存恢复不停止；最后页关闭和宽限内重开；浏览器崩溃/冻结/休眠恢复；伪造跨站退出被拒；错误PID/端口占用/身份不匹配继续拒绝；退出后原训练继续、数据库和浏览器录像保留；Start/Stop并发及Windows干净包真实回归。最终单测/构建/M2/Journey与主代理深浅视觉通过才交付。
