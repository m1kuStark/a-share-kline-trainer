# E2E-BASELINE-01 存量浏览器回归失败清偿

```json
{
  "id": "E2E-BASELINE-01",
  "title": "存量浏览器回归失败清偿：分类、修复或显式豁免",
  "owner": "integrator",
  "state": "planned",
  "milestone": "M5",
  "summary": "全套 journey 自 v1.2.0 起因 13 处 spec 文件损坏从未完整运行（V1.2.3 已修复损坏使全套可解析）；2026-10-02 首次完整运行 89/108，19 项失败经 stash 基线复跑证实全部为 v1.2.2 树上已存在的存量失败，与本轮改动无关，尚未归因。",
  "next_action": "逐项归因 19 项失败（真缺陷 / 测试断言过期 / 环境与夹具问题），真缺陷按域拆返修，过期断言更新并登记原因；vitest 存量环境抖动（录像编解码、库迁移、docs 工具、worktree 工具域约 12 项）一并复核。",
  "allowed_paths": [
    "e2e/**",
    "server/test/**",
    "docs/verification/**",
    "docs/work-items/tasks/E2E-BASELINE-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/E2E-BASELINE-01.md"
    ],
    "reason": "全套回归是发布门禁的一部分：19 项存量失败若不归因，后续候选的门禁结论都无法区分新回归与旧欠账。"
  },
  "verification_refs": [
    "docs/verification/2026-10/V1.2.3-feedback/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 失败清单（2026-10-02 全套运行，run-5522d19a；stash 基线复跑同清单复现）

| 域 | 用例 |
|---|---|
| 数据更新 | data-update f) 无可用来源 409 行内展示 |
| 画线基础 | drawing-basis 跨除权日价位线跟随 |
| 主旅程 | journey Act4d 副图画线与多选框选 |
| M3 反馈 | m3-feedback 自动保存布局不变 |
| M3 第三轮 | m3-round3 诅咒线 50% 射线 |
| M3 工具 ×7 | D26-D29 编辑/撤销、D23 文本、D30-D31 主副图保存/跨周期、D31 已结算查看、D31 周月锚点、D28 混选 |
| 历史与排行 | m4-history 加载三态（运行中存在用例间漂移，疑似串扰）、m4-rankings 排行定位与成绩单 |
| 录制 | recording 默认录制交易拒单与离线回放 |
| 成绩单 | report-feedback 主题与独立覆盖层 |
| 设置 | training-defaults ×2（保存失败反馈/键盘路径、F5 在途预览失效）、training-rules 返修 F3 键盘隔离 |

## 边界与口径

- 这些失败发生在 v1.2.2 候选树上（stash 基线复跑证实），不代表 V1.2.3 引入回归；也不能反推"V1.2.2 功能全部正常"——全套门禁在此前各轮从未整体跑通。
- m4-history 的失败用例在两次运行间漂移（118 vs 173），优先排查串行套件内的活动训练串扰与延迟门闩。
- 清偿不改变用户验收边界：V1.2.3 验收以用户对包的人工验收为准，本卡是门禁可信度欠账。
