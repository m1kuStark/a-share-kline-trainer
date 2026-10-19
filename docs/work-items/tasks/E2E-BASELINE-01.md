# E2E-BASELINE-01 存量浏览器回归失败清偿

```json
{
  "id": "E2E-BASELINE-01",
  "title": "存量浏览器回归失败清偿：分类、修复或显式豁免",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "全套 journey 自 v1.2.0 起因 13 处 spec 文件损坏从未完整运行（V1.2.3 已修复损坏使全套可解析）；2026-10-02 首次完整运行 89/108，19 项失败经 stash 基线复跑证实全部为 v1.2.2 树上已存在的存量失败，尚未归因；2026-10-04 GITHUB-HEALTH-01 CI 双轮全量（各 125 项）均为 93 通过/29 失败/3 未运行且两轮逐项一致；2026-10-19 E2E-BASELINE-01 分类轮（提交 6533196，run-9db67e72，TDX_ROOT 按授权注入）：191 项＝171 过/18 败/2 跳过（exit 1），CI 基线 29 败中 12 项已自然修复、17 项仍在、新增 1 项；18 项全部归因——桶A 真bug 8 项（4 个根因：推进清空撤销历史、restoreDrawings 丢弃逐画线样式、画线按周期过滤不可见、周期过滤渗入录制捕获致回放丢画线）、桶B spec过时 9 项（v1.0.3~v1.1.1 UI 演进未回写断言，逐条呈报清单见验证报告第五节）、待复核 1 项（random-mask-axis 窗口相关）、设计内跳过 1 项（migration-v127 环境门控）。逐例证据与探针复现实录见 docs/verification/2026-10/E2E-BASELINE-01/README.md。",
  "next_action": "清偿进行中（2026-10-19 E2E-SPEC-SYNC-01 完成一轮，见验证目录同名 README）：① 桶B 9 项已全部按用户批复更新断言并定向复跑转绿（data-update f) 按钮改连导向断言——分类报告「409 行内展示经该按钮仍可达」的假设经复跑证伪，已按报告备选建议改断言点击行为，409 行内展示由 data-update-feedback:96 独立覆盖；journey Act4d 动态窗格＋按 id 断言，Act6 级联一并恢复；training-flow「留在当前界面」两处；D23 extendData.text；report-feedback surface token；设置弹层「关闭」两处；F5 起止双输入）；② 桶A-③（跨周期画线）经用户拍板为正式口径「画线按周期隔离」（原话：画线不要跨周期可见，维持现状），三条用例（D30-D31 主副图/D31 快速切换/D31 锚点）已改隔离语义并复跑转绿，探针实证隔离＝过滤显示而非丢失，规格文档 interaction.md 与 drawing-persistence.md 已同步——移出桶A 待修复清单；③ 剩余待清偿：桶A-①（推进清撤销历史）、桶A-②（restoreDrawings 丢样式，m3-tools D26-D29 与 D28 混选两例复跑确认仍红）、桶A-④（录制捕获周期过滤）、待复核 1 项（random-mask-axis）；④ 桶C 登记 known（migration-v127 环境门控，非缺陷）；⑤ 'e2e 纳入发布门禁必过链'（用户拍板 6）前置更新为：桶A-①②④清零＋待复核定桶＋桶C 登记。",
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
    "reason": "全套回归是发布门禁的一部分：存量失败若不归因，后续候选的门禁结论都无法区分新回归与旧欠账。"
  },
  "verification_refs": [
    "docs/verification/2026-10/V1.2.3-feedback/README.md",
    "docs/verification/2026-10/GITHUB-HEALTH-01/report.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 当前基线（2026-10-04，GITHUB-HEALTH-01）

[GITHUB-HEALTH-01 报告](../../verification/2026-10/GITHUB-HEALTH-01/report.md)在 CI 提交 `0715a0a` 上完成两轮全量 Journey：每轮 125 项，均为 **93 通过、29 失败、3 未运行**，两轮逐项状态与报错一致（无轮间漂移）。套件项数较 2026-10-02 的 108 项增加，源于其间新增 spec（条件单创建回归、退出双主题断言、录像库隔离等）；29 项与旧清单 19 项的交集与差异需对照归因，不能把两份数字互相替代。

初步分类方向（引自报告）：旧页面定位器、缺少录像 namespace 的 mock、夹具/环境问题、真实画线恢复等产品缺陷。

## 分类轮结果（2026-10-19，run-9db67e72）

191 项＝171 通过/18 失败/2 跳过（exit 1）。三桶：**A 真bug 8 项（4 根因）**、**B spec过时 9 项（已逐条呈报）**、**待复核 1 项**、**设计内跳过 1 项**。逐例证据、桶B呈报清单、门禁拦截现状结论见 [验证报告](../../verification/2026-10/E2E-BASELINE-01/README.md)。桶A 根因速记：① `feedData()` 每次推进无条件 `drawingHistory.reset([])`（违背 drawing-persistence.md「推进不清撤销历史」）；② `restoreDrawings()` 以 `configuredOverlayStyle` 覆盖 `item.styles`，编辑过的画线样式刷新/撤销重做后丢失；③ 画线按周期过滤（a71139a）致周/月视图不可见；④ 同过滤渗入 `captureState()` 使录像检查点丢日K画线、回放为空。

## 清偿进度：E2E-SPEC-SYNC-01（2026-10-19，用户批复 1）

桶B 9 条全部按用户批复更新断言；桶A-③（#9/#11/#12 三条跨周期用例）经用户拍板为正式口径「**画线按周期隔离**」（原话：画线不要跨周期可见，维持现状），移出桶A 改标「口径定案（用户拍板）」，探针实证隔离＝过滤显示而非丢失（服务端双周期保留、切回恢复、往返稳定），无新发现缺陷。规格文档 docs/specs/chart/interaction.md 与 web/src/components/docs/drawing-persistence.md 已补正式口径。定向复跑收据（journey、TDX_ROOT 必填、--retries=0）：data-update/training-rules/training-defaults/report-feedback/m3-feedback/journey 均 exit 0；m3-tools exit 1＝18 过 2 败，两败（D26-D29 编辑移动撤销重做、D28 文本线段混选）为桶A-② styles 丢失根因的存量失败，与本轮改动无关。**剩余失败清单：桶A-①（drawing-basis 跨除权日撤销）、桶A-②（m3-round3 诅咒线＋m3-tools D26-D29＋m3-tools D28 混选）、桶A-④（recording 默认录制离线回放）、待复核 1（random-mask-axis）。**改动明细与逐条对照见 [E2E-SPEC-SYNC-01 验证报告](../../verification/2026-10/E2E-SPEC-SYNC-01/README.md)。

## 失败清单（2026-10-02 全套运行，run-5522d19a；stash 基线复跑同清单复现；历史事实保留）

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
