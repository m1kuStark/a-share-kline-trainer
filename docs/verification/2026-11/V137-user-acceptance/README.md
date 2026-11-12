# V137 用户验收记录（2026-11-13）

阶段：[V137](../../../work-items/milestones/V137.md)；版本 **v1.3.7**（未发布）。

## 用户结论

> 顶部添加的测量按钮，经过实际测试，其实和 Shift 加鼠标左键的测量功能是重复的。我认为这个需求的 issue 是因为用户对新功能不熟悉导致的，我会和用户说明这个功能的情况。
> 你可以把顶栏这个多出来的测量功能和入口清除掉、撤回掉，只保留现有的 Shift 加鼠标左键测量。其他内容我已完成验收，并且验收通过。但是你先不要发布。
> 你可以先合入到 main 分支，并提交到 GitHub，完成 Commit 和 Push，并清理本地的分支和工作树，然后开始准备接下来的开发计划。

（用户 2026-11-13 消息摘录）

## 判定

| 项 | 结论 |
|---|---|
| CHART-LAYOUT-01 图表铺满可用高度 | **验收通过** |
| UI-TOOLBAR-03 悬浮面板固定与调宽高 | **验收通过** |
| CHART-MEASURE-04 顶栏测量入口 | 与既有 Shift 测量重复 → 按用户要求由 [CHART-MEASURE-05](../../../work-items/tasks/CHART-MEASURE-05.md) 移除入口/模式，保留 Shift 测量 |
| 发布 | **用户明确要求暂不发布**：不打 tag、不发 GitHub Release、不移动更新 feed、不上传镜像 |

## 证据

- v1.3.7 发布候选包与全量门禁：docs/verification/2026-11/REL-137/README.md（安装包 sha256、journey 2 分片、视觉检查）。
- 回退入口与回归：docs/verification/2026-11/CHART-MEASURE-05/README.md。
