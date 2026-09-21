# DATA-01 数据整批发布与超时屏障

```json
{
  "id": "DATA-01",
  "title": "数据整批发布与超时屏障",
  "owner": "GLM-5.3-Flash",
  "state": "active",
  "milestone": "R1",
  "summary": "让目录、权息、文件状态和刷新结果按同一版本提交；失败和超时不能迟到写入。",
  "next_action": "复现目录已改后权息失败、超时迟到提交和刷新任务重入，再实现最小原子发布屏障。",
  "allowed_paths": [
    "server/src/data/**",
    "server/src/tdx/**",
    "server/src/db.ts",
    "server/test/data-refresh.test.ts",
    "server/test/catalog-protection.test.ts",
    "server/test/adjustment-cache.test.ts",
    "docs/work-items/tasks/DATA-01.md",
    "server/src/data/docs/publication.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": ["server/src/data/docs/publication.md", "docs/work-items/tasks/DATA-01.md"],
    "reason": "刷新事务、失败回退和超时边界改变时必须同步实现说明和证据。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

当前任务不改变训练交易规则，也不写用户 7529 数据库或通达信目录。
