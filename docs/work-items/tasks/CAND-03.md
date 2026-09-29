# CAND-03

```json
{
  "id": "CAND-03",
  "title": "收编后全量门禁前置准备与记录模板",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M5",
  "summary": "按流水线执行口径，verify:baseline 全量门禁由集成阶段脚本统一执行（集成工作树 trainer-wt/int-v1，固定 18810/18910），开发槽位只做门禁前置准备与记录模板：docs/verification/2026-09/CAND-03/ 骨架（result.json 全字段待填＋report.md 记录门禁构成、TDX_ROOT 前置、已知基线失败处置、失败二分回退协议与通过后效力），不在槽内执行 verify:baseline。",
  "next_action": "骨架已就绪；集成阶段确认前置（冻结样本来源、工作树干净、runtime-isolation 处置）后执行并回填，通过后收编基线确立。",
  "base_commit": "77a3ed6f2dabb72b860aa687b64baf211b395958",
  "allowed_paths": [
    "docs/status.md",
    "docs/work-items/tasks/CAND-03.md",
    "docs/verification/2026-09/CAND-03/**"
  ],
  "depends_on": [
    "CAND-02"
  ],
  "docs_impact": {
    "reason": "本卡产出即证据骨架与执行口径记录，不触运行代码；门禁结论留待集成阶段实际执行后回填，不在槽内预填。",
    "update": []
  },
  "verification_refs": [
    "docs/verification/2026-09/CAND-03/report.md"
  ],
  "integration_ref": "main@5bf4484a37a5a233ff12524cafd0166390cb274b",
  "acceptance_ref": null
}
```

## 准备记录（2026-09-29，口径以 git/源码实测）

- 门禁构成实测：`npm run verify:baseline` = `tsx scripts/verify-candidate.ts`（package.json:29）；步骤序 docs→unit→types→build→snapshot→m2→journey→cleanup（scripts/verify-candidate.ts:15-27），baseline profile 无 impact、无候选 proof。
- TDX_ROOT 前置实测：Journey 快照 scripts/runtime/snapshot.ts:52 无可读源抛错；样本 M2 scripts/verify-m2.ts:24 无源抛错。已知阻塞：现存冻结样本仅 sha256 清单、字节本体已清理（SETUP-DRAIN-01 恢复轮 needs_replan 记录），样本来源须控制层指定或裁决授权。
- 已知基线失败如实登记：runtime-isolation.test.ts（RUN-CANCEL-01 范围）在收编前基线两轮全量 npm test 均失败且串行复跑仍失败；unit 步骤会命中，集成阶段须先修复或显式裁决豁免，不得静默豁免。负载抖动串行复跑口径沿用 CAND-01/CAND-02 轮实测（docs-tooling/review-profile/worktree-tools 等夹具类）。
- 执行边界：58cc210/5bf4484 已用户拍板在基线内，无重跑需要；门禁通过后收编基线确立，开发槽位成果方可进入集成队列，开发分支仍并行自 5bf4484 切出；浏览器 journey 不归开发槽位执行。
