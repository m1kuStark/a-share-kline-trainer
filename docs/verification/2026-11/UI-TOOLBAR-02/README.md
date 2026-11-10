# UI-TOOLBAR-02 验证记录（2026-11-11）

任务：画线工具面板紧凑化（用户 2026-11-11 反馈）。范围与冻结口径见[任务卡](../../../work-items/tasks/UI-TOOLBAR-02.md)。

## 结论

- 工具面板改为**紧凑图标优先**：glyph 16px、按钮高约 36px、6 列自适应、标签 9px、面板默认宽 284px。
- **默认展开「常用工具」与「其他工具」**：23 个工具一眼可见；常用工具 0/5/10/23 个时，工具列表均无纵向滚动（1024×680 / 1280×720 / 1366×705 实测）。
- 默认停靠主图左下（用户反馈笔记本常放左下、不遮挡交易区）；位置拖动、刷新保持、越界钳制回归通过。
- 画线语义、取点手势、hover/键盘名称与用途、常用工具自定义（拖入/移出/排序/刷新恢复）保持不变。
- 125% 字体压力场景仍保留本地滚动兜底，全部工具可经滚轮到达（既有 UIUX 门禁）。

## RED（先失败测试）

命令：

```powershell
$env:TDX_ROOT='D:\MySoftWares\TDX'
npm run journey -- e2e/toolbar-floating.spec.ts --retries=0
```

- 首跑 run `run-310b52d5-9ad4-4665-9664-93c3d85186bc`：**1 failed / 1 passed**，失败点 `.other-tools` 不存在（面板默认折叠，用户需先找「其他工具」入口）；另有 44px 高按钮/20px 图标/5 列布局未满足紧凑断言。
- 该失败证据保留在 `.runs/run-310b52d5-9ad4-4665-9664-93c3d85186bc/artifacts/journey.log`。

## GREEN（定向门禁）

命令：

```powershell
$env:TDX_ROOT='D:\MySoftWares\TDX'
npm run journey -- e2e/toolbar-floating.spec.ts e2e/m3-feedback.spec.ts e2e/uiux-training.spec.ts --retries=0
```

- run `run-46d15cb7-a223-4848-83ab-5027c677cb3e`（最终代码）：**exit 0，7 passed / 0 failed**（toolbar-floating 2、m3-feedback 3、uiux-training 2），总 2.2m。
- 中间过程 run `run-4de52fb5-785c-423a-9ef1-1757a50ed5a5` 已过 7/7；随后把面板宽度从 272 调到 284 并修复面板内容增高时的位置钳制，最终以 `run-46d15cb7` 为准。
- 断言覆盖：默认展开区可见（`aria-expanded=true`）；23 工具全部可见；`.toolbar-tool-lists` scrollHeight ≤ clientHeight+2；glyph ≤18px；按钮 ≤38px 且可点击区域 ≥32×32；面板不越出视口；hover/键盘提示；开关收起/展开；拖拽位置持久化与越界钳制；常用工具自定义/刷新恢复；125% 字体下工具可经滚轮到达。
- 既有 m3-feedback / uiux-training 中默认折叠断言按用户拍板的新行为（默认展开）更新，并新增默认展开断言；未删除既有覆盖断言。

## 轻量门禁

- `npm run verify:fast`：**PASS**（docs:check 0 errors；build 含 vue-tsc/TS/vite 12s；总 13s）。
- `check-binding --matrix uiux-workbench --strict --include-untracked`：**13 行 covered=13 open=0 RED=0**（新增 UIUX-TOOLBAR-COMPACT-DEFAULT / SIZE 两行，旧三行 ref 随测试更名同步）。

## 视觉检查（主代理，真实页面）

- 截图：`toolbar-compact-1024.png`、`toolbar-compact-1280.png`、`toolbar-compact-1366.png`、`toolbar-floating-1440-dark.png`、`toolbar-floating-1440-light.png`、`uiux-training-text125-dark-other.png`、`uiux-training-text125-light-custom.png`。
- 检查项：1024/1280/1366/1440 深浅主题；23 工具全可见且无需滚动；默认左下不遮挡交易区/价格轴；无 pageerror、无横向溢出；hover 提示与选中态正常。

## 环境与边界

- 隔离 journey run（独立端口/DB/构建/报告）；`TDX_ROOT=D:\MySoftWares\TDX`；未使用个人训练库。
- 边界：resize/pin 为后续辅助项，未在本卡实现；默认位置只影响无 localStorage 位置的新会话，已有用户保留既存位置；125% 字体下标签可能两行且列表可滚动（压力场景，不冒充默认无滚动）。

## 提交

- 功能与测试提交：待回填（见 `git log --grep UI-TOOLBAR-02`）。
- 收据/文档提交：随后。
