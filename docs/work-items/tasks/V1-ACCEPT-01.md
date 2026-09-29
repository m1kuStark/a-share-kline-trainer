# V1-ACCEPT-01 用户验收组织与记录回填

```json
{
  "id": "V1-ACCEPT-01",
  "title": "V1 用户验收组织与记录回填（UI-03 复验/UI-02/DATA-05/TRAIN-02/REL v0.3.2/v0.3.3 结论）",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "组织用户验收并回填记录：①UI-03 已定并入基线（用户 2026-09-29 拍板），8899 测试包复验组织就绪（清单与 record 骨架见 docs/verification/2026-09/UI-03-8899-recheck/，UI-03 卡明示用户验收通过前不提升发布；不通过返工归槽B、插 order 17、REL-V1-01 顺延 18）；②UI-02（c8f8836 实测在基线）③DATA-05 ④TRAIN-02 验收记录均未记录、待用户；⑤REL v0.3.2 用户最终验收未记录，待补记或用户明确豁免；v0.3.3 验收结论待复验后一并记录（供 S11 发布确认拍板）。本槽自主运行无用户在线，本轮不产生任何验收记录、不补造。",
  "next_action": "组织件已就绪，待用户：执行 8899 复验并回填 record.json；给 UI-02/DATA-05/TRAIN-02 验收结论；对 REL v0.3.2 补记验收或明确豁免；复验结论出来后回填 UI-03/CHANGELOG 并汇总 v0.3.3 验收结论供 S11 拍板。",
  "base_commit": "0d525f691786948f71c5aca657d960c410bd6734",
  "allowed_paths": [
    "docs/status.md",
    "docs/work-items/tasks/V1-ACCEPT-01.md",
    "docs/work-items/tasks/UI-03.md",
    "docs/work-items/tasks/UI-02.md",
    "docs/work-items/tasks/DATA-05.md",
    "docs/work-items/tasks/TRAIN-02.md",
    "docs/verification/2026-09/UI-03-8899-recheck/**",
    "CHANGELOG.md"
  ],
  "depends_on": [
    "CAND-01",
    "CAND-05"
  ],
  "docs_impact": {
    "reason": "复验组织件（清单+记录骨架）、被组织卡的去向指针与 CHANGELOG 复验状态行；验收结论本体待用户产生后另行回填。",
    "update": []
  },
  "verification_refs": [
    "docs/verification/2026-09/UI-03-8899-recheck/README.md"
  ],
  "integration_ref": "main@5bf4484a37a5a233ff12524cafd0166390cb274b",
  "acceptance_ref": null
}
```

## 组织记录（2026-09-29，git 实测）

- 独立卡依据：ACCEPT-01 已 closed（「Accepted by user 2026-09-21」），其证据被 M3/REC 引用，不得复用；本轮 ls docs/work-items/tasks/ 复核无 V1-ACCEPT/CAND 同名卡，故新建本卡。
- ①UI-03：实现 58cc210 实测在基线 5bf4484（用户 2026-09-29 拍板并入）；复验组织就绪——清单（对照用户反馈三点+创建链路 sanity）、record.json 骨架（status=not_performed，字段全待填）、不通过处置（返工归槽B、插 order 17 于 REL-V1-01 前、REL-V1-01 顺延 18）。发布闸门：UI-03 卡明示用户验收通过前不提升发布。
- ②UI-02：c8f8836（2026-09-23）经 `git merge-base --is-ancestor c8f8836 5bf4484` 实测在基线；卡内 integration_ref 已记录 c8f8836；first-use-batch.md P1 行明示「补用户验收记录」——待用户，未补造。
- ③④DATA-05/TRAIN-02：两卡 acceptance_ref 均为 null（CAND-01 关闭时已按「工程验收通过、用户验收尚未记录」口径），验收记录待用户。
- ⑤REL v0.3.2：status.md REL 行明示「用户最终验收尚未记录」；两条路径——用户补记验收，或用户明确豁免——均需用户决定，本轮不代选。
- v0.3.3：CHANGELOG v0.3.3 节（用户测试版，未公开发布）在案；验收结论待 8899 复验后由用户产生，届时一并记录供 S11 发布确认拍板；本轮仅在 CHANGELOG 增加复验状态与清单指针，不写结论。

## 诚实边界

- 本槽为自主运行、无用户在线：用户验收行为本身不在本槽可执行范围内，五项验收记录（UI-03 复验、UI-02、DATA-05、TRAIN-02、REL v0.3.2）本轮全部保持未记录，骨架字段全部 null，不补造、不代填；组织件与回填路径已就绪，用户操作后由后续会话按本卡回填。
