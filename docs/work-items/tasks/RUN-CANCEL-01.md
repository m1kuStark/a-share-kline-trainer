# RUN-CANCEL-01 通用命令取消的有界回收

```json
{
  "id": "RUN-CANCEL-01",
  "title": "通用命令取消的有界回收",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "DEV",
  "summary": "REL-03基线取消用例超时后EBUSY已修复；通用taskkill等待与取消Promise现在有界，无法证明整树回收时保留失败证据。",
  "next_action": "工程验收已通过；保留清理不完整证据的边界，用户验收尚未记录。",
  "allowed_paths": ["scripts/runtime/run.ts", "scripts/runtime/process-stop.ts", "server/test/runtime-cancel.test.ts", "server/test/runtime-isolation.test.ts", "server/test/runtime-shutdown.test.ts", "scripts/runtime/README.md", "docs/work-items/tasks/RUN-CANCEL-01.md"],
  "depends_on": [],
  "docs_impact": {"update": ["docs/work-items/tasks/RUN-CANCEL-01.md"], "reason": "脚本取消语义修复需记录测试和未回收边界；根代理同步测试协议与整批门禁。"},
  "verification_refs": [
    "docs/verification/2026-09/REL-03/baseline.json",
    "docs/verification/2026-09/REL-03/runtime-cancel-review.json",
    "server/test/runtime-cancel.test.ts",
    "server/test/runtime-isolation.test.ts"
  ],
  "integration_ref": "1db66dc",
  "acceptance_ref": null
}
```

源码基线4e640a5，完整单测774/775；runtime-isolation取消用例15秒超时，继而清理临时目录EBUSY。原日志未证明当时taskkill是否卡住，因此不写成已确认唯一根因。当前单独重跑同文件15/15通过；不能用它替代全量门禁。

已确认代码缺口：通用stopChild无界等待taskkill，runNode丢弃取消Promise又无限等close；停止失败没有可靠传播。带runId的服务退出已有测试，但不能给任意命令塞runId来跳过树清理。Vite/Playwright会创建后代，只杀根PID会泄漏。

拆小步骤：先用真实父子进程和无关哨兵、受控tree killer故障建立可重复失败；缓存并等待单一取消Promise，明确tree killer/close期限、传播错误并保留原abort理由与日志；回收需证明整个所属树退出、哨兵存活、日志句柄关闭、目录可删除。后备树回收只能使用预先验证的创建身份或Job Object，无法证明则明确报清理失败保留目录，不能猜PID或按端口杀。测试不增时限、不吞EBUSY、不改生产交易逻辑。实际执行前再把任务拆成最多一个独立可验收变更，不一次要求新进程管理框架。

## 工程验收（2026-09-23）

- 集成提交 `1db66dcb9c67c0562bc394a7059a047e95a02644` 已通过根代理复核；历史 Mimosa 拦截与“半量落地”记录保留为过程证据，不代表当前主分支状态。
- 聚焦取消/隔离/关闭测试 16/16，全量单测 858/858，`npm run build` 通过；taskkill 停滞有界、日志保留和无关进程隔离均有回归。
- 不能证明整棵进程树回收时仍报告 `cleanup incomplete`，未把根进程退出冒充完整清理；用户验收仍未记录。
