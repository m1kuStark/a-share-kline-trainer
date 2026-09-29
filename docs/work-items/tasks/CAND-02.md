# CAND-02

```json
{
  "id": "CAND-02",
  "title": "SETUP-01 纯模块片卡对账收编",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M5",
  "summary": "对账性收编（docs-only，不合码）：实测 SETUP-AUTH-01/SETUP-CLUES-02/SETUP-API-01/SETUP-SAVE-01 四片代码提交均为基线 5bf4484 祖先，回填各片最终代码提交至 integration_ref，并按对账结论将四卡随基线收编关闭（工程门禁以卡内记录为据，用户验收尚未记录）；不改产品代码，本卡随 S1 收口即关闭。",
  "next_action": "四卡回填与关闭、状态页再生成已完成；浏览器 journey 回归等最终门禁由集成阶段串行补跑后并入 main。",
  "base_commit": "aa1d1f1f07efc9c7edc91852a287ef0d49cd2dff",
  "allowed_paths": [
    "docs/status.md",
    "docs/work-items/tasks/CAND-02.md",
    "docs/work-items/tasks/SETUP-API-01.md",
    "docs/work-items/tasks/SETUP-AUTH-01.md",
    "docs/work-items/tasks/SETUP-CLUES-02.md",
    "docs/work-items/tasks/SETUP-SAVE-01.md",
    "docs/verification/2026-09/CAND-02-gate-flake/**"
  ],
  "depends_on": [
    "CAND-01"
  ],
  "docs_impact": {
    "reason": "本任务即文档对账：四张片卡与状态页生成区就是全部影响面，不触运行代码，无其他现行正文需要更新。",
    "update": []
  },
  "verification_refs": [
    "docs/verification/2026-09/CAND-02-gate-flake/report.md"
  ],
  "integration_ref": "main@5bf4484a37a5a233ff12524cafd0166390cb274b",
  "acceptance_ref": null
}
```

## 对账记录（2026-09-29，本卡建立时以 git 实测）

- 祖先核实：四片代码提交 `d481c1e`/`e8181d3`/`14310f4`/`2ef9dd7` 经 `git merge-base --is-ancestor <sha> 5bf4484` 全部为基线祖先（另实测片最终提交 `27ea639`/`b0b5608` 亦然），代码已在基线内，不合码、不回迁任何产品代码。
- 提交与卡片对应（按 `git log 5bf4484 -- <片文件>` 逐片定位）：`d481c1e` 题名自证属 SETUP-AUTH-01（control-guard.ts 唯一提交）；`2ef9dd7` 题名自证属 SETUP-CLUES-02（candidate-diagnostics 唯一提交）；`14310f4` 属 SETUP-CLUES-01，该卡已由 CAND-01 收编（integration_ref@4237880），不属本轮四卡；SETUP-SAVE-01 为 5e07c31 交付、经 e8181d3 与 b0b5608 两轮修正，最终提交 b0b5608（saved-choice 两文件均为片内 allowed_paths）；SETUP-API-01 为 27ea639（端点经共享 api.ts/config.ts 落地，片测试 setup-api.test.ts 唯一提交，其后 api.ts 改动属 SETUP-DRAIN-01 等其他片）。
- 集成引用回填口径沿用 SETUP-DRAIN-01/CAND-01 既有的 `integration/product-integration-20260926@<片最终代码提交>` 写法；四片最终提交均实测在该集成分支上。
- 关闭依据：四片均为 SETUP-01 冻结核合同的纯模块片，卡内门禁记录通过（CLUES-02 9/9＋相邻 61/61、AUTH-01 15/15、API-01 9/9＋相邻 85/85＋E2E 4/4、SAVE-01 10/10）；代码内容已随用户拍板并入基线的 58cc210/5bf4484 在册（2026-09-29）；后续接线（原生目录选择、原子保存生效、受控重启）仍由 SETUP-01 活动卡另片推进，片本身无未竟事项，按 FRESH-01/TDX-CHECK-01/RANGE-01/TRAIN-02「工程验收通过、用户验收尚未记录」写法关闭（state 不等于用户验收）。
- 复核记录如实说明：仓内无 SETUP-AUTH-01/SETUP-CLUES-02/SETUP-SAVE-01 的独立 GPT 复核通过记录（三卡卡面当时以「GPT 定向复核」为下一步），SETUP-API-01 卡面记录审查会话 setup-api-01-complete-20260926-18；本卡关闭以卡内工程门禁记录与基线用户拍板为据，不以 GPT 复核通过为据。
- 既有观察（不改动，仅记录）：SETUP-API-01 与 SETUP-SAVE-01 卡面均自题「SETUP-01 第四片」，编号重复系历史遗留，不影响片范围。

## 缓收清单（2026-09-29 盘点，本卡不收编）

- **无用户认可记录不收编用户验收**：四张片卡 `acceptance_ref` 保持 null，关闭属工程收编；用户验收按 2026-09-27 暂停口径，恢复后经控制层 FIRST-USE-PRODUCT 当前快照核对候选 SHA 与依赖再走。
- **未提交改动不触碰**（等待原会话完成后再收编；当日只读盘点与 CAND-01 缓收清单一致）：trainer-worktrees/GLM-MONITOR-02（15 处）、GLM-MONITOR-UI（2）、ORCH-02-receipts（2）、ORCH-04-review（2）、RUN-CANCEL-01（4，含 runtime-isolation.test.ts）。

## 边界

- 不改 server/web/e2e/脚本任何运行代码；不触碰共享单写文件；SETUP-01 父卡保持 active 不动（其接线片未竟）。
- 浏览器 journey 回归不归本卡执行，由集成阶段串行补跑。
