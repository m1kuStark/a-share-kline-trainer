# TEST-SPEED-01 测试集成提速

```json
{
  "id": "TEST-SPEED-01",
  "title": "测试集成提速：轻量迭代门禁＋全量 journey 并行分片＋按失败项复跑纪律",
  "owner": "integrator",
  "state": "active",
  "milestone": "V136",
  "base_commit": "ec9d913",
  "summary": "用户 2026-11-09 反馈单轮集成近 8 小时不可接受。新增 npm run verify:fast（docs:check＋构建＋指定单测/定向 journey，分钟级）用于开发循环；npm run journey:parallel -- --shards 2 把全量 journey 拆到隔离运行并行（保持单 run workers:1）；测试协议建立「迭代轻量、发布一次全量、环境 flaky 只复跑失败项并附隔离收据、默认关闭 trace」纪律。",
  "next_action": "随 v1.3.6 交付；后续轮次按分层门禁执行。",
  "allowed_paths": [
    "scripts/verify-fast.mjs",
    "scripts/journey-parallel.mjs",
    "package.json",
    "docs/engineering/testing.md",
    "docs/work-items/tasks/TEST-SPEED-01.md",
    "docs/work-items/milestones/V136.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/TEST-SPEED-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": ["docs/engineering/testing.md", "docs/work-items/README.md", "docs/work-items/milestones/V136.md", "docs/status.md"],
    "reason": "测试流程/命令变化，更新验证协议。"
  },
  "verification_refs": ["docs/verification/2026-11/TEST-SPEED-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 产物

- `npm run verify:fast [-- --unit <files>] [-- --journey <specs>]`：docs:check → build → 指定单测/定向 journey，输出分步耗时；无参数时 1~2 分钟。
- `npm run journey:parallel -- --shards 2 [-- <specs>]`：2~4 个隔离 run 并行，各自 manifest/端口/DB/构建；完整覆盖同一 spec 集。
- 协议：迭代轮只跑轻量门禁；发布轮跑一次全量（可用并行分片）；全量中仅既有环境 flaky 失败时，只复跑失败 spec 并记录隔离收据，不重复整轮全量。
