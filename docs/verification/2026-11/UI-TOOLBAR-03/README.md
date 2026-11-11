# UI-TOOLBAR-03 验证记录（2026-11-12）

任务：悬浮工具面板固定（pin）与可调宽高（resize）。范围与冻结口径见[任务卡](../../../work-items/tasks/UI-TOOLBAR-03.md)；用户反馈 2026-11-10 Issue #8。基础提交 `7895a22`。

## 结论

- **固定（pin）**：标题栏新增固定按钮（lucide Pin/PinOff、`aria-pressed`、中文名称与 title）。固定后面板位置锁定：标题栏拖动完全无效（内存位置与 `trainer.drawToolbar.position.v1` 持久化值都不变），固定态存独立键 `trainer.drawToolbar.pinned.v1`（`"true"/"false"`）；刷新后仍为固定态且位置保持；取消固定恢复拖动与位置持久化。固定态下窗口缩放仍把面板钳制在视口内。
- **尺寸（resize）**：右下角尺寸手柄（`role="separator"`＋`aria-label`、`cursor: nwse-resize`、可见抓握图标）拖动调整宽 **240–560px**、高 **200px–min(85vh, innerHeight−24px)**；尺寸存独立键 `trainer.drawToolbar.size.v1`（`{width,height}`），刷新恢复；双击手柄恢复默认尺寸并清除尺寸键。**固定态下双击手柄同样复位**（pin 不阻断）。
- **默认外观守恒**：列数由 JS 按面板宽度计算 CSS 变量 `--toolbar-tool-columns`——默认宽 284px 仍为 UI-TOOLBAR-02 冻结的 **6 列**（e2e 显式锁定），收窄 240px→5 列、拉宽 560px→12 列；240px 下按钮命中区仍 ≥32×32、无横向溢出。
- **内容与边界**：高度不足时 `.toolbar-tool-lists` 按需纵向滚动，23 个工具经真实滚轮可到达（含 125% 字体压力）；窗口 resize／内容折叠／常用工具数量变化后尺寸与位置仍钳制在视口内。
- 不改：画线语义/取点/快捷键、工具顺序与常用自定义、面板显隐开关、既有位置拖拽记忆、保存状态栏固定占位。

## 用户可见说明同步

- `docs/user/README.md`「画线工具」节新增一段用户说明：标题栏右侧**固定**按钮锁定/取消固定面板位置（固定后拖标题栏无效、刷新保持）；右下角**尺寸手柄**拖动调宽高（240–560px、高不超过屏幕 85%）、尺寸刷新保留、双击恢复默认；面板较窄/较矮时工具区自动滚动，仍可看全 23 种工具。
- `docs/specs/chart/display.md` 的 UI-TOOLBAR 段新增 **UI-TOOLBAR-03（用户 2026-11-10 Issue #8）** 条目：pin/尺寸/持久化键/边界口径/滚动与命中区要求。

## RED（先失败测试）

命令：

```powershell
$env:TDX_ROOT='D:\MySoftWares\TDX'
npm run journey -- e2e/toolbar-floating.spec.ts --retries=0
```

- 首跑 run `run-11c79edd-8bea-41dc-b678-2a68becc249e`：**exit 1，3 failed / 2 passed**（6.8m），失败原因均为「新契约元素不存在」而非断言写错：
  - 固定用例：`locator('.draw-toolbar').getByRole('button', { name: /固定工具面板/ })` element(s) not found（缺 pin 按钮）；
  - 尺寸用例：`getByRole('separator', { name: /尺寸/ })` element(s) not found（缺尺寸手柄）；
  - 多尺寸/双主题用例：点击 pin 超时（同上缺按钮）。
  - 既有 2 个 UI-TOOLBAR-01/02 用例保持通过（未删断言、未加 skip）。
- 失败证据：`.runs/run-11c79edd-8bea-41dc-b678-2a68becc249e/artifacts/journey.log` 与 `artifacts/test-results/toolbar-floating-*/error-context.md`。

## GREEN（定向门禁）

命令：

```powershell
$env:TDX_ROOT='D:\MySoftWares\TDX'
npm run journey -- e2e/toolbar-floating.spec.ts e2e/m3-feedback.spec.ts e2e/uiux-training.spec.ts --retries=0
```

- 最终 run `run-cb606b7c-acf2-4a47-84f9-c1c958bcce6d`：**exit 0，10 passed / 0 failed**（3.9m；toolbar-floating 5 + m3-feedback 3 + uiux-training 2）。
- 迭代记录（保留）：`run-75dc8554-78ec-4b84-8206-e88a075a72dc`（10 passed，4.0m）→ 补「刷新恢复」截图后 `run-d25ff0e7-a714-4d10-8850-94675d8a897d`（10 passed，4.0m）→ Lead 审查要求「默认 284px 仍 6 列」后改为 JS 列数变量并新增断言，最终以上述 `run-cb606b7c` 为准。
- 断言覆盖（真实鼠标/键盘事件与几何量取）：
  - pin：`aria-pressed` 状态、中文 aria-label/title、固定后拖动位置 0 位移（内存+localStorage 原始字符串不变）、固定态标题栏 `cursor` 非 grab、刷新后固定态/位置保持、取消固定后拖动恢复正常并写回位置键、视口缩小仍钳制在视口内。
  - resize：手柄 role/aria-label/cursor、默认宽 284（276–292）、拖动 +140/+100 尺寸随之增长、`size` 键持久化、刷新恢复、下界 240×200、上界 560×min(85vh, innerHeight−24)、窗口 resize 后尺寸/位置回钳、双击（真实 `page.mouse.dblclick`）复位并清除尺寸键、**固定态下双击复位**。
  - 内容：最小尺寸下列表 `scrollHeight > clientHeight` 且真实滚轮滚到底后第 23 个工具在列表可视区内且中心命中；按钮宽高均 ≥32；125% 字体压力下重复滚动可达、按钮 ≥32、面板无横向溢出、pin 按钮不被裁切。
  - 默认外观：首例显式断言默认 284px 宽下 `.favorite-tools` 计算列数为 6；240px→5 列、560px→12 列。
  - 多尺寸/双主题：1024×680 / 1366×705 / 1440×900 × light/dark，各含 pin 持久化、resize 持久化、刷新恢复与视口内断言；截图见下。
  - 既有 UIUX 断言未弱化：`m3-feedback` 3 例、`uiux-training` 2 例（含 125% 文字与工具栏可达性）全绿。

## 轻量门禁

- `npm run verify:fast -- --journey e2e/toolbar-floating.spec.ts`：**见下方复跑记录**（首次运行 exit 1，仅 docs:check 因新任务卡未生成 status 生成区而失败——docs:status 后复跑；同次 build PASS 15s、journey PASS 164s run `run-bc4293a4-0063-4034-9b00-b53f78d2c280`）。
- `npm test`（unit）：首次 exit 1 为**环境事故**（共享主检出 node_modules 缺 `@babel/parser`，Lead 已定位为删工作树穿过 junction 所致并在主检出修复）；修复后复跑 **exit 0**（server 178 files / 2619 tests + desktop 34 files / 369 tests，日志 `.runs/unit-test.log`）。
- `npm run docs:check`：exit 0（0 errors，160 warnings）。
- `npm run docs:status`：exit 0（生成区新增 UI-TOOLBAR-03 一行，diff 仅该行）；`npm run docs:status -- --check`：exit 0。
- `npm run docs:impact -- --base 7895a22 --task UI-TOOLBAR-03`：exit 0（26 个变更路径，其中 3 个运行代码/配置/测试路径；工作树预检，不代表集成或验收）。
- `check-binding --strict --include-untracked --matrix uiux-workbench.yaml`：**exit 1，矩阵 16 行 covered=14 open=2 RED=3**。
  - open=2 即本任务 Lead 预登记的 planned 行 `UIUX-TOOLBAR-PIN` / `UIUX-TOOLBAR-RESIZE`（test_ids 待 Lead 升 covered 时填入，见最终报告）；
  - RED=3 为 `UIUX-TRAINING-FILL-HEIGHT` 引用的 `e2e/layout-fill.spec.ts` 三个用例在 base `7895a22` 不存在（属 CHART-LAYOUT-01，main 已前进合并；合并 origin/main 后复跑见下）。

## 视觉检查（主代理）

- 截图（18 张，已归档本目录）：`toolbar-pin-{1024x680|1366x705|1440x900}-{light|dark}.png`（固定态，pin 按钮高亮）、`toolbar-resize-*.png`（拖动后尺寸）、`toolbar-restored-*.png`（刷新恢复后同态）。
- 自查要点：默认 284px/6 列与 UI-TOOLBAR-02 外观一致；pin 按钮与尺寸手柄在深浅主题均可见、不遮挡工具；默认左下停靠不遮挡交易区；无 pageerror、无页面横向溢出；1024×680 下放宽后右缘不越过右侧交易面板（e2e 断言）。
- `UI-VISUAL-ACCEPTANCE` 仍由主代理在真实页面完成，测试全绿不等同用户验收。

## 环境与边界

- 隔离 journey run（独立端口/SQLite/前后端构建/报告）；`TDX_ROOT=D:\MySoftWares\TDX`；未使用个人训练库；每例开头清理活动训练。
- 列数/尺寸口径：列数＝`clamp(5..12, floor((width−18)/44))`，默认 284→6 列，宽度 240→5、560→12；尺寸上限由 JS `min(85vh, innerHeight−24)` 钳制，CSS 在 `has-custom-size` 时解除默认 `max-height`。
- 面板是用户可拖动的浮层：默认左下停靠且 1024 宽下最大宽度不覆盖右侧交易面板；用户主动拖到图表上方时仍可能遮挡图表（既有浮层设计，不在本任务改动）。
- 固定只管位置：固定态仍可调尺寸与双击复位；窗口 resize 仍会为保持视口内而回钳位置/尺寸（矩阵 UIUX-TOOLBAR-PIN 口径）。
- 环境事故记录：03:08–03:15 主检出 node_modules 被删（Lead 定位为 gh 删工作树穿过 junction），首次 `npm test` 因缺 `@babel/parser` 失败（exit 1，非本任务改动）；Lead 在主检出修复后复跑，差异仅 node_modules，git 工作树无额外变化。
- 边界：125% 字体为压力场景，标签可能省略显示但可经滚动到达（与 UI-TOOLBAR-01/02 口径一致）；固定/尺寸键为浏览器 localStorage，隐私模式不可用时退化为本会话生效（沿用既有位置键的容错口径）。

## 提交

- 功能与证据同提交：`feat(ui): UI-TOOLBAR-03 …`（提交 SHA 见 PR；另含合并 origin/main 后的收据回填提交）。
