# CAND-01

```json
{
  "id": "CAND-01",
  "title": "product-integration-20260926 载体卡对账收编",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M5",
  "summary": "对账性收编（docs-only，不合码）：核实 integration/product-integration-20260926（3f8c612）为 main 祖先且 DATA-05/TRAIN-02/SETUP-CLUES-01/SETUP-DRAIN-01 四卡内容已在基线 5bf4484；回填 DATA-05/TRAIN-02/SETUP-CLUES-01 集成引用至各片最终代码提交，修正 DATA-05 隔离保留与 TRAIN-02 提升后关闭两条过时卡注；SETUP-DRAIN-01 经核实基线已在册，无需取回。",
  "next_action": "卡面修正与状态页再生成已完成；待集成阶段串行执行浏览器 journey 回归等最终门禁后并入 main。",
  "base_commit": "5bf4484a37a5a233ff12524cafd0166390cb274b",
  "allowed_paths": [
    "docs/status.md",
    "docs/work-items/tasks/CAND-01.md",
    "docs/work-items/tasks/DATA-05.md",
    "docs/work-items/tasks/TRAIN-02.md",
    "docs/work-items/tasks/SETUP-CLUES-01.md",
    "docs/work-items/tasks/SETUP-DRAIN-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "reason": "本任务即文档对账：四张载体卡与状态页生成区就是全部影响面，不触运行代码，无其他现行正文需要更新。",
    "update": []
  },
  "verification_refs": [],
  "integration_ref": "integration/product-integration-20260926@3f8c61246d5c057743fc312b07ebdd704d23658a",
  "acceptance_ref": null
}
```

## 对账记录（2026-09-29，本卡建立时以 git 实测）

- 祖先核实：`git merge-base main integration/product-integration-20260926` → `3f8c612`；`git rev-list --count main..integration/product-integration-20260926` → 0，即集成候选尖端是 main 祖先。内容进入 main 的路径：3f8c612 → V1-INTEGRATE-01 组合候选 888778c（`git merge-base --is-ancestor` 双向核实）→ 合并 8858dc4「merge: promote accepted V1-INTEGRATE-01 candidate 888778c to main (user-authorized test build)」（2026-09-28）→ 基线 5bf4484。
- 四卡内容核实：`git diff 5bf4484 integration/product-integration-20260926 -- docs/work-items/tasks/{DATA-05,TRAIN-02,SETUP-CLUES-01,SETUP-DRAIN-01}.md` 全部为空，内容已在基线，不合码。
- 集成引用回填口径沿用 SETUP-DRAIN-01 既有的 `@<片最终代码提交>` 写法；三张卡的裸分支引用写于 6c93aea，晚于各片最终修复（按 `git log <集成分支> -- <片路径>` 定位）：DATA-05 → 76ca6c8（unreadable-source 降级，GPT-WAKE-02 review，其后 server/src/data 仅余 SETUP-DRAIN-01 的 wip 6429907），TRAIN-02 → 0ae28a5（errorMessage 生命周期修复，2026-09-26 19:47，此后集成分支无 TRAIN-02 范围提交；其前依次为 1756751 后端串行化、44e1c62 表单契约＋recording.md 同步、87f9cf9 根数校验＋rules.md 同步），SETUP-CLUES-01 → 4237880（跨块 UTF-8 中文路径，其后无该片范围提交）。
- SETUP-DRAIN-01 分支条件核实为否：`git ls-tree 5bf4484` 含该卡（blob 44b6577），基线已在册且其 `integration_ref@8e7da052` 无需回填，本卡不改其内容。
- TRAIN-02 关闭依据：其卡面既定条件「待候选提升到 main 后关闭任务」已满足（8858dc4）；关闭时用户验收仍未记录，与 FRESH-01/TDX-CHECK-01/RANGE-01 首批模块卡「工程验收通过、用户验收尚未记录」的收编写法一致（state 不等于用户验收，见[任务与阶段](../README.md)卡片格式节）。关闭前复核其 docs_impact 声明的 rules.md/recording.md 规格同步已分别由 87f9cf9、44e1c62 在候选冻结前落地。
- 2026-09-27 用户暂停产品开发、恢复须以控制层 FIRST-USE-PRODUCT 当前快照核对候选 SHA 与依赖，系各载体卡既有口径，本卡仅沿用不新设。

## 缓收清单（2026-09-29 盘点，本卡不收编）

- **无用户认可记录的候选不收编用户验收**：四张载体卡 `acceptance_ref` 均为 null——DATA-05/SETUP-CLUES-01 保持 review，TRAIN-02 随提升关闭仅属工程关闭（与 FRESH-01/TDX-CHECK-01/RANGE-01 写法一致），SETUP-DRAIN-01 已 closed 亦无用户验收记录。恢复按 2026-09-27 用户暂停口径，经控制层 FIRST-USE-PRODUCT 当前快照核对候选 SHA 与依赖后再走验收。
- **未提交改动不触碰**（等待原会话完成后再收编；只读盘点，均不在本卡四载体卡范围）：trainer-worktrees/GLM-MONITOR-02（15 处）、GLM-MONITOR-UI（2）、ORCH-02-receipts（2）、ORCH-04-review（2）、RUN-CANCEL-01（4，含 runtime-isolation.test.ts）。

## 边界

- 不合并集成分支任何代码；不改 server/web/e2e/脚本；不触碰单写文件（server/src/api.ts、server/src/db.ts、web/src/api.ts、web/src/App.vue、启动器主文件、共享类型、迁移），见[批次计划](../../proposals/first-use-batch.md)并行调度节。
- 浏览器 journey 回归不归本卡执行，由集成阶段串行补跑。
