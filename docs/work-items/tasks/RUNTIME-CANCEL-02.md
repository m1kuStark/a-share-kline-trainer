# RUNTIME-CANCEL-02 Windows 子进程测试生命周期修正

```json
{
  "id": "RUNTIME-CANCEL-02",
  "title": "修正 Windows 子进程取消与树终止测试生命周期",
  "owner": "integrator",
  "state": "review",
  "milestone": "ENG",
  "base_commit": "b1ff3e9f241e60b3e85c7572084dbc306b259d08",
  "summary": "已观测原生产实现正确终止受管父孙进程、保留日志并释放目录；确定两条显式15s测试预算短于20–30s taskkill上界，超时后异步命令未先排空还会撞到目录回收。本片仅修测试生命周期与预算，增加detached孙进程、树外哨兵、目录释放和原始取消理由断言；撤去/T的两条真实变异均因孙存活失败。生产实现保持原字节，完整npm test与审查结果见本任务验证记录。",
  "next_action": "PR51已合入；生产文件字节未改。完整本地3023项通过；CI首次设置用例超时、准确同head第二次完整通过均保留。工程实现已落地，完整候选/包与人工验收归后继M9，不能把review标签当成仍待重做。",
  "allowed_paths": [
    "scripts/runtime/run.ts",
    "server/test/runtime-isolation.test.ts",
    "desktop/src/port-conflict.ts",
    "desktop/test/port-tree-kill.test.ts",
    "scripts/runtime/README.md",
    "docs/engineering/testing.md",
    "docs/work-items/tasks/RUNTIME-CANCEL-02.md",
    "docs/work-items/milestones/ENG.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/RUNTIME-CANCEL-02/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/RUNTIME-CANCEL-02.md",
      "docs/work-items/milestones/ENG.md",
      "docs/work-items/README.md",
      "docs/status.md"
    ],
    "reason": "运行时取消可能影响验证清理和受管子进程生命周期；必须先证实根因，记录修复范围及真实进程回归。"
  },
  "verification_refs": [
    "docs/verification/2026-11/ENG-HEALTH-02/validation.md",
    "docs/verification/2026-11/RUNTIME-CANCEL-02/validation.md"
  ],
  "integration_ref": "f4bbc6af283562c8d567918fb4a59f3f51d71ffe",
  "acceptance_ref": null
}
```

失败位置：`server/test/runtime-isolation.test.ts` 的 `cancels an owned child command and preserves its failure log`。首轮 `npm test` exit 1，隔离同 spec 复跑 exit 1（1 failed / 14 passed）；错误同时包含 15000ms timeout 与临时目录 `EBUSY`。个人训练数据未参与。

桌面对应边界：`desktop/test/port-tree-kill.test.ts` 的真实两级 Node 进程树终止测试，首轮与隔离复跑均15s超时（复跑1 failed /6 passed）；实现位于 `desktop/src/port-conflict.ts`，taskkill guard 为30s。预算冲突尚不足以单独证明根因，应同时观测实际退出与目录句柄释放。

2026-11-18 接续调查：原实现的真实诊断中，runtime 取消返回用时10.959s、desktop 终止返回12.281s；父孙均已退出、哨兵存活、目录可删除。独立原样复跑本次通过，历史失败仍成立。保留原断言，补齐生命周期保护并按已有等待上界给出45s/60s测试预算；detached孙进程保证只杀父进程会被断言识别。生产文件未修改，结论是测试预算及夹具清理缺陷，未证实生产进程泄漏。完整历史、尝试与边界见[验证记录](../../verification/2026-11/RUNTIME-CANCEL-02/validation.md)。
