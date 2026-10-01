# REL-V1-01 V1.2.1 发布收尾

```json
{
  "id": "REL-V1-01",
  "title": "V1.2.1 发布收尾：版本 bump、候选包验收与发布说明",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "版本 1.2.1 源码候选已完成本轮阶段价位线、条件单边界、长按快捷键、搜索缓存和退出生命周期修订；Windows 干净解压包待生成并校验，用户验收与公开发布仍未确认。",
  "next_action": "在干净提交上执行发布脚本，核对 Node 24 官方归档、manifest、SHA256、版本与提交；只生成一个新的 v1.2.1 output 目录，再交用户验收。",
  "base_commit": "80c67ce2ca26ebd522ebc0cefaf77ca5a7966c64",
  "allowed_paths": [
    "package.json",
    "package-lock.json",
    "CHANGELOG.md",
    "docs/status.md",
    "docs/specs/roadmap.md",
    "docs/work-items/tasks/REL-V1-01.md"
  ],
  "depends_on": [
    "V1-ACCEPT-01"
  ],
  "docs_impact": {
    "reason": "版本号与发布线是产品口径变化：CHANGELOG、roadmap、安装包 manifest 与状态页必须指向同一候选提交；发布证据在本次包构建后回填。",
    "update": []
  },
  "verification_refs": [],
  "integration_ref": "main@5bf4484a37a5a233ff12524cafd0166390cb274b",
  "acceptance_ref": null
}
```

## 槽内已完成（2026-09-29）

- 版本 bump：package.json:4 与 package-lock.json:3,9 由 0.3.3 → 1.0.0（仓内无代码断言版本号，全量 grep 实测）；基线即 main tip 5bf4484（已含 58cc210/5bf4484 用户裁定），与 main 并回无冲突。
- CHANGELOG：`## v0.3.3（用户测试版，未公开发布）` 改题 `## 1.0.0（发布待用户确认；内容即原 v0.3.3 用户测试版，未公开发布）`，内容与 UI-03 复验状态行原样保留——未宣称已发布。
- roadmap：新增「1.0.3 发布线（进行中）」节，登记发布前置与 1.0 后范围边界。

## 流水线集成/发布阶段待执行（本槽不做）

1. `npm run verify:baseline` 全量门禁（docs/engineering/testing.md:38：docs＋单测＋类型＋独立生产构建＋样本 M2＋全量 Journey）；样本 M2 与全量 Journey 必须显式设 TDX_ROOT（只读通达信样本根目录绝对路径；scripts/runtime/snapshot.ts:52 与 scripts/verify-m2.ts:24 实测无源即抛错；冻结样本来源待控制层指定，见 CAND-03 骨架）。与 main 并回：基线＝5bf4484，无并回问题；与本轮槽 B/槽 E 的同文件（server/src/api.ts、web/src/views/Launcher.vue）变更由集成人在集成工作树一次性裁决（first-use-batch.md:53 单写规则）。
2. Windows 干净解压包全流程：首次接入→训练→结束保存→导出/导入回放→重启/升级保留设置（first-use-batch.md:68），完成后交用户验收；不直接替换运行中的 8787/7529 实例。
3. tag 1.0.0 与发布说明，按既有发布流程执行。

## 隐私红线终检（发布阻断项，实测）

- docs/work-items/current-feature.json 实测含本机绝对路径：第 11/70/75 行区域 `D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/...`（repo/source_worktree），第 15/61 行区域 `C:\Users\Stark_Du666\.codex\headroom-cache\...`（contract 路径）。按 SETUP-01 卡要求，发布包与仓库可见文件不得含个人绝对路径——收编时必须清理该文件（本槽 allowed_paths 未含它，且口径指定收编时处理，故只记录不改）。
- 终检范围：发布包内容与仓库可见文件双检；docs/verification 现有记录在抽查前保持原样（正式证据不按年龄自动删除，公开仓库前由集成人按隐私规则裁剪）。

## 发布前置依赖（均未满足，如实）

1. V1-ACCEPT-01：8899 复验结论与 UI-02/DATA-05/TRAIN-02/REL v0.3.2 验收回填未完成；若复验触发返修，须待 order 17 返修任务合入（REL-V1-01 顺延 order 18）。
2. 全部槽位任务按 order 合入且 S9 集成 journey/e2e 回归通过。
3. S11 用户发布确认；60+ 未合并分支清理按 S11 结论执行，SETUP-DRAIN-01/SETUP-RESTART-PLAN-01 等分支独有内容先核对再删。
