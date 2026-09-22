# REL-LAUNCH-UX-01 浏览器关闭后的受控退出

```json
{
  "id": "REL-LAUNCH-UX-01",
  "title": "浏览器关闭后的受控退出",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "发布包服务当前独立于浏览器运行；为新手提供保存完成后可用的“退出训练器”入口，同时保留安全的Stop.cmd兜底。",
  "next_action": "已获v0.3.2实施与发布授权；由REL-03分批派发/接线，首批合同见release-032-contracts。",
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
  "integration_ref": null,
  "acceptance_ref": null
}
```

当前事实：`server/src/index.ts`已有shutdown函数，但发布启动为detached且无IPC；`launcher.cjs --stop`核对状态、健康身份、PID和端口后使用SIGKILL，不能称为正常关闭。Windows信号不能替代应用层正常退出协议。浏览器标签页关闭不会发送停止信号，这是现有设计；未证明朋友的故障由此导致。

第一步提供“保存并退出训练器”：等待本轮在途写入、录像和画线保存并保留训练进度，不自动结算/放弃；保存失败显示重试/取消。有其他页面时广播退出请求，各页确认保存完成，拒绝或无响应则不自动停止。退出接口只允许本机应用页面：校验Host、Origin及不可用公开health中的runId替代的随机控制令牌，禁开放CORS调用；关闭开始后拒绝新写入，等在途请求排空、app.close和database.close完成再退出。与启动互斥，核对版本/库/runId，确认PID退出和端口结果；超时如实报失败，不能静默转强杀。

第二步评估并验证“关闭最后标签后延迟回收”：各页独立会话标识和续约，关闭提示仅作提示；刷新/重新打开宽限期内重连取消退出，其他有效页面存在时不退出。不得把visibilitychange/最小化视为退出。浏览器冻结、断网、崩溃和系统睡眠造成的失联无法可靠区分，不能单靠短心跳超时宣称精确关闭识别；保存未确认时保守保留服务。若产品要求任何关闭都保证立即结束进程，应评估受控桌面窗口拥有服务生命周期，不能声称普通浏览器能保证。宽限时间通过行为测试确定，不因随意常量新增停录或丢弃逻辑。

只对本启动器管理的便携会话启用生命周期管理，开发预览、--no-open和外部自管服务保持显式管理。稳定端口与origin保留录像；Stop.cmd仍是身份核验后的应急兜底，不作为新按钮的正常保存方案。

GLM拆分：退出协议/会话纯状态机和测试；前端保存协调与状态；启动桥接及Windows进程回归。最多三并发独立worktree；App/API/launcher共享接线由集成人单写，与SETUP-01错开同文件任务。

验收：单标签保存后退出；交易在途、保存失败、多标签未确认；刷新/回退缓存恢复不停止；最后页关闭和宽限内重开；浏览器崩溃/冻结/休眠恢复；伪造跨站退出被拒；错误PID/端口占用/身份不匹配继续拒绝；退出后原训练继续、数据库和浏览器录像保留；Start/Stop并发及Windows干净包真实回归。最终单测/构建/M2/Journey与主代理深浅视觉通过才交付。
