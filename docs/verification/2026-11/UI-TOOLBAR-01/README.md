# UI-TOOLBAR-01 验证记录（2026-11-07）

任务：顶栏「划线」开关＋可拖拽图形化悬浮工具面板（Issue #8 工具栏布局，用户 2026-11-07 拍板 Q8）
基线：`529105a`（CHART-PAN-01）｜工作树 `verify-pr7`
证据提交：本记录随 `feat(ui): UI-TOOLBAR-01 …` 提交

## 改动摘要

- `web/src/drawTools.ts`：为 23 个画线工具补 `description`（hover 一句中文用途）与 `glyph`（图形种类）；`server/test/draw-tool-descriptions.test.ts` 锁定 23 唯一工具/非空描述/glyph、描述不重复。
- 新增 `web/src/components/ToolGlyph.vue`：内联 SVG 绘制 15+ 种几何图标（不引入依赖）。
- `web/src/views/Training.vue`：顶栏新增「划线」开关（aria-pressed），工具面板改为可拖拽悬浮层（标题栏 pointer capture 拖动、视口内钳制、位置 localStorage 持久化）；默认停靠主图右侧账户区上方，不压价格轴；hover/键盘聚焦显示 `.draw-tool-hover`（中文名称＋具体描述）；工具按钮改为 SVG 图标＋短标签 5 列网格；保存状态/常用工具自定义/其他工具折叠保留。
- `web/src/styles.css`：悬浮面板 300px 宽、紧凑 44px 图标格、深浅主题与 tooltip 样式；1024×680 下 23 工具全部可见且工具列表无纵向滚动。
- 既有 `e2e/m3-feedback.spec.ts` 折叠断言改为比较悬浮面板自身高度（不再改变账户区滚动高度）；新增 `e2e/toolbar-floating.spec.ts` 两条真实交互用例。
- 文档：显示规格、用户画线工具说明同步；矩阵 `uiux-workbench` 增补 4 行。

## 门禁收据（最终一轮）

| 命令 | 退出码 / 结果 |
|---|---|
| `npm run build` | 待填 |
| `npm test` | 待填 |
| `npm run docs:check` / `docs:status -- --check` | **0 errors** |
| `npm run docs:impact -- --base 529105a --task UI-TOOLBAR-01` | **0 errors** |
| `check-binding --matrix uiux-workbench.yaml --strict --include-untracked` | **11/11 covered，RED=0，open=0** |
| `npm run journey -- e2e/toolbar-floating.spec.ts e2e/m3-feedback.spec.ts` | **0**：5/5 通过（53.9s，run `run-2af7751e`） |
| `npm run journey -- e2e/toolbar-floating.spec.ts e2e/journey.spec.ts` | **0**：18/18 通过（2.5m，run `run-ef457c6e`；含 Act3a 轴拖拽回归） |
| 宽回归 journey（chart-analysis/invert/toggles/backup-restore/drawing-basis/kdj/acceptance） | 首轮 37/38，唯一失败 Act3a 因默认面板压价格轴 → 默认位置改为主图右侧账户区上方后复跑全绿 |

## 失败与修复

1. 首轮 e2e：1024×680 展开其他工具时工具列表 scrollHeight 372 > client 354 → 图标格 52→44px、间距收紧、面板 348→300px，复跑通过。
2. m3-feedback 折叠断言仍引用账户区高度 → 改为比较悬浮面板自身高度（符合新布局语义）。
3. 宽回归发现 Act3a「轴拖拽进主图缩放」被默认悬浮面板挡住价格轴 → 默认位置按 `.chart-panel` 右缘 +8px 停靠并收窄面板，复跑 journey 全绿。
4. 全量门禁首轮 3 处既有 frontend-contract 契约因合理 UI 结构变化失败：`class="draw-toolbar"` 精确匹配（新增 is-floating）、drawTools 单行对象正则（新增 description/glyph 字段）、M6-05 样式切片扫到追加在文件尾的 UI-TOOLBAR 样式。分别更新为语义等价断言，并把 UI-TOOLBAR 样式块移动到 M6-05 标记之前（与历史同类修复一致），复跑契约 37/37 通过。
5. 图形化 23 图标/描述由单测与 e2e 双重锁定。

## 视觉检查（主代理）

- 1024×680：[toolbar-floating-1024.png](toolbar-floating-1024.png)：悬浮面板图标网格、hover 描述卡、顶栏「划线」激活态；展开其他工具无纵向滚动/无横向溢出。
- 1440 深/浅：[toolbar-floating-1440-dark.png](toolbar-floating-1440-dark.png)、[toolbar-floating-1440-light.png](toolbar-floating-1440-light.png)：拖动后位置保持、主题配色与阴影正常。
- 无 pageerror；既有画线手势/快捷键/保存状态回归通过。

## 已知边界

- 面板为悬浮层，用户可拖到任意位置（默认在主图右侧账户区上方）；位置持久化于本机 localStorage。
- 快捷键集合未变化；关闭面板时退出当前画线工具与自定义模式，避免隐藏态误操作。
- 本记录为用户整批验收前的工程证据，不代表用户验收。
