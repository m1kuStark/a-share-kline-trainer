# E2E-SPEC-SYNC-01 桶B 规格同步＋画线隔离口径定案

```json
{
  "id": "E2E-SPEC-SYNC-01",
  "title": "e2e 存量失败规格同步：桶B 九条按建议更新＋画线按周期隔离定为正式口径",
  "owner": "integrator",
  "state": "closed",
  "milestone": "M5",
  "summary": "用户 2026-10-19 验收批复 1：桶B（spec 过时）9 条按分类报告建议直接更新断言（不删例）；桶A-③「画线按周期过滤」经用户拍板为正式口径（原话：画线不要跨周期可见，维持现状）——受影响用例断言改为隔离语义，并同步规格文档 docs/specs/chart/interaction.md 与 web/src/components/docs/drawing-persistence.md。完成后定向复跑受影响 spec 应转绿。零产品码改动（若探针发现产品行为与隔离口径不符，停下呈报，不改产品）。",
  "next_action": "按内嵌桶B清单逐条更新；画线三条先探针实证现行为再写断言；journey 定向复跑（TDX_ROOT 必填）。",
  "allowed_paths": [
    "e2e/**",
    "docs/specs/**",
    "web/src/components/docs/**",
    "docs/verification/**",
    "docs/work-items/tasks/E2E-BASELINE-01.md",
    "docs/work-items/tasks/E2E-SPEC-SYNC-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/E2E-BASELINE-01.md"
    ],
    "reason": "桶B 与 A-③ 处置结果回填分类账本；画线隔离口径入规格文档。"
  },
  "verification_refs": [
    "docs/verification/2026-10/E2E-BASELINE-01/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 桶B 九条更新清单（来源：E2E-BASELINE-01 分类报告第五节，用户批复"依建议直接更新"）

| # | 用例 | 旧断言 | 新断言方向 |
|---|---|---|---|
| B-1 | data-update f) | 按钮文案「未检测到通达信数据」 | 「连接通达信」（App.vue:683）；409 行内展示核心保留 |
| B-2 | journey Act4d | overlayInfo(0)＋固定坐标 | 动态窗格定位＋按 id 取 overlay（KDJ 默认第 4 窗格） |
| B-3 | m3-feedback 自动保存 | 「继续查看图表」 | 「留在当前界面」（a71139a） |
| B-4 | m3-tools D23 | JSON 含未转义换行 | 改断言 extendData.text（转义属正确行为） |
| B-5 | D31 已结算 | 同 B-3 | 同 B-3 |
| B-6 | report-feedback | rgb(255,255,255) | var(--surface-background)=rgb(243,246,244)（token 化） |
| B-7 | training-defaults:110 | 弹层「取消」按钮 | ✕ 关闭＋保存设置路径 |
| B-8 | training-defaults F5 | 单 date 输入 | 起止双输入定位器 |
| B-9 | training-rules F3 | 弹层「取消」按钮 | 同 B-7 |

## 桶A-③ 画线隔离口径（用户拍板 2026-10-19）

- 正式口径：**画线不跨周期可见，按周期隔离**。受影响用例（D30-D31 主副图保存/跨周期、D31 快速切换、D31 周月锚点）断言改为：A 周期画的线在 B 周期视图不可见；切回 A 周期恢复可见。
- 先探针实证现行为再落断言；若产品在周期切换间**丢失**画线（而非过滤显示），属新发现缺陷——停下写 needs_user_decision，不得改产品码。
- 规格文档同步：docs/specs/chart/interaction.md、web/src/components/docs/drawing-persistence.md（如该行为已有记载则核对一致）。

## 验收要点

- 九条＋画线三条全部更新且定向 journey 复跑转绿（run 收据）。
- E2E-BASELINE-01 卡与分类报告回填处置结果；剩余失败应只剩桶A-①②④与待复核 1 项（属 M2 产品修复轮，本任务不碰）。

## 完成记录（2026-10-19）

- 全部完成：12 用例断言更新＋探针实证（隔离=过滤显示非丢失，六项断言 exit 0）＋规格文档两处同步＋回填。执行中两处分类报告假设经复跑证伪并按其备选建议修正：B-1（unavailable 按钮现走接入向导、409 行内展示由 data-update-feedback:96 独立覆盖）、B-8（结束日默认今天超出冻结样本覆盖，起止均填覆盖内日期）。
- 复跑收据（--retries=0）：data-update/training-rules/training-defaults/report-feedback/m3-feedback/journey exit 0；m3-tools exit 1＝18 过 2 败（桶A-② 存量：D26-D29、D28 混选，非本轮范围）。
- 详见 [验证报告](../../verification/2026-10/E2E-SPEC-SYNC-01/README.md)。
