# RUNTIME-CANCEL-02 Windows 子进程取消与清理失败

```json
{
  "id": "RUNTIME-CANCEL-02",
  "title": "定位并修复 Windows 子进程取消与进程树清理失败",
  "owner": "integrator",
  "state": "planned",
  "milestone": "ENG",
  "base_commit": "3b5fb110e506eb2e139f754c966cee3a64f55ea1",
  "summary": "ENG-HEALTH-02 在本机完整 npm test 与原配置隔离复跑均复现 runtime-isolation 取消用例15s超时及 EBUSY；desktop 真实进程树终止用例首轮与隔离复跑也均15s超时。实现 taskkill 的20–30s上界与测试15s预算冲突是待核实线索；尚未修复，不归类为已消除flaky。",
  "next_action": "以原失败用例为 RED，观测受管进程树退出与目录句柄释放；确认是取消实现、进程清理或测试预算问题，再做最小修复。不能只加 timeout/skip 令测试转绿；保留首次失败、隔离复跑及完整验证收据。",
  "allowed_paths": ["scripts/runtime/run.ts", "server/test/runtime-isolation.test.ts", "desktop/src/port-conflict.ts", "desktop/test/port-tree-kill.test.ts", "scripts/runtime/README.md", "docs/engineering/testing.md", "docs/work-items/tasks/RUNTIME-CANCEL-02.md", "docs/work-items/milestones/ENG.md", "docs/work-items/README.md", "docs/status.md", "docs/verification/2026-11/RUNTIME-CANCEL-02/**"],
  "depends_on": [],
  "docs_impact": {
    "update": ["docs/work-items/tasks/RUNTIME-CANCEL-02.md", "docs/work-items/milestones/ENG.md", "docs/work-items/README.md", "docs/status.md"],
    "reason": "运行时取消可能影响验证清理和受管子进程生命周期；必须先证实根因，记录修复范围及真实进程回归。"
  },
  "verification_refs": ["docs/verification/2026-11/ENG-HEALTH-02/validation.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

失败位置：`server/test/runtime-isolation.test.ts` 的 `cancels an owned child command and preserves its failure log`。首轮 `npm test` exit 1，隔离同 spec 复跑 exit 1（1 failed / 14 passed）；错误同时包含 15000ms timeout 与临时目录 `EBUSY`。个人训练数据未参与。

桌面对应边界：`desktop/test/port-tree-kill.test.ts` 的真实两级 Node 进程树终止测试，首轮与隔离复跑均15s超时（复跑1 failed /6 passed）；实现位于 `desktop/src/port-conflict.ts`，taskkill guard 为30s。预算冲突尚不足以单独证明根因，应同时观测实际退出与目录句柄释放。
