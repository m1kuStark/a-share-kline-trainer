# CAND-04

```json
{
  "id": "CAND-04",
  "title": "GLM-MONITOR-02 卡收尾对账",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M5",
  "summary": "对账性收编（docs-only，不合码）：实测 task/GLM-MONITOR-02 与 task/GLM-MONITOR-UI 分支 tip af0efaf 均为基线 5bf4484 祖先；GLM-MONITOR-02 已提交交付经 git 定位为 3a3f463（题名自证，基线祖先）并回填 integration_ref；两工作树未提交改动（15/2 处）本轮一律不收编，等待原会话完成后再收编；状态保持 review，用户验收未记录。",
  "next_action": "卡面回填与对账记录完成；原会话完成后由集成阶段核对其续接改动与 3a3f463 是否分叉，再行收编。",
  "base_commit": "1efeafebc94f9cedb32bfb9987ae2cf8414efe42",
  "allowed_paths": [
    "docs/status.md",
    "docs/work-items/tasks/CAND-04.md",
    "docs/work-items/tasks/GLM-MONITOR-02.md",
    "docs/verification/2026-09/CAND-04-gate-flake/**"
  ],
  "depends_on": [
    "CAND-03"
  ],
  "docs_impact": {
    "reason": "对账仅触及一张任务卡与状态页生成区，不触运行代码；不收集任何未提交改动。",
    "update": []
  },
  "verification_refs": [
    "docs/verification/2026-09/CAND-04-gate-flake/report.md"
  ],
  "integration_ref": "main@5bf4484a37a5a233ff12524cafd0166390cb274b",
  "acceptance_ref": null
}
```

## 对账记录（2026-09-29，git 实测）

- 分支 tip 核实：task/GLM-MONITOR-02 与 task/GLM-MONITOR-UI 的 tip 经 `git rev-parse` 实测同为 af0efaf，`git merge-base --is-ancestor af0efaf 5bf4484` 通过；af0efaf 系 2026-09-23「docs: close v0.3.2 release verification」，即 GLM-MONITOR-02 卡 base_commit，本身不含该卡交付内容。
- 集成引用取值修正（相对派发口径如实说明）：派发口径以 af0efaf 为实测祖先，对账中按 `git log 5bf4484 --diff-filter=A -- scripts/agent-monitor/zcode_usage.py` 定位到本卡实际交付提交 3a3f463（2026-09-25「feat(monitor): add CLI native usage and quota dashboard (GLM-MONITOR-02)」，新增 zcode_usage.py/quota.py/配套测试/README/usage 与本卡、verification 记录），亦实测为 5bf4484 祖先且在 integration/product-integration-20260926 上。integration_ref 按 CAND-01/02 既有「片最终代码提交」口径回填 3a3f463——af0efaf 不含本卡内容，作引用会误记；两事实均记录在案。
- 未提交改动不收编：trainer-worktrees/GLM-MONITOR-02 计 15 处（6 改 9 未跟踪，未跟踪含与 3a3f463 同名文件）、trainer-worktrees/GLM-MONITOR-UI 计 2 处（1 改 1 未跟踪）；两工作树是否与 3a3f463 分叉由原会话完成时自行核对，本轮一律不触碰、不收编。
- 范围边界：其后 scripts/agent-monitor/ 的提交（214bd19…1fd5c19 等）属 GPT-WAKE/orch 等其他任务；GLM-MONITOR-02 状态保持 review、acceptance_ref 保持 null，用户验收未记录，不随本卡收编。

## 边界

- 不改 scripts/agent-monitor/ 任何文件（含两工作树的未提交内容）；不进入其他 worktree 写操作；浏览器 journey 与原会话续接核对接口归集成阶段。
