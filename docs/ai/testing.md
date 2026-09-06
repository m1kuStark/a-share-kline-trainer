# 测试（Testing）

> 测试矩阵、failure pattern 分类、新 bug → 回归测试的流程。

## 测试矩阵

| 层 | 工具 | 覆盖 | 运行 |
|---|---|---|---|
| 单元/契约 | vitest（server/test，15 文件 86+ 用例） | 引擎/账户纯函数、API 矩阵、gbbq/dayfile 解析、**frontend-contract 源码正则契约**（交互模式机/画线/多选/样式常量） | `npm test` |
| 真实数据验证 | tsx 脚本＋真实 TDX 数据 | verify:m1（数据层逐值核验）、verify:m2（训练闭环手算对账＋防未来） | `npm run verify:m1` / `verify:m2` |
| 用户旅程 | **Playwright 真实事件**（Edge channel，六幕） | 训练闭环／画线全生命周期／交互矩阵／多选／交易与周期／主题——详见下节 | `npm run journey` |

## 六幕 Journey 与历史 failure pattern 的映射

设计依据与 33 项历史 bug 统计：docs/bug-pattern-分析与journey自动化设计.md §1/§4。

| 幕 | 覆盖的历史 failure pattern（真实事件断言） |
|---|---|
| Act 1 训练闭环 | 创建链路、四区域布局、工具条就绪 |
| Act 2 画线生命周期 | 射线/直线延伸段命中（D3 漏选）、编辑面板回读精度（两位小数）、删除 |
| Act 3 交互矩阵 | 轴拖拽中断（D3）、手动轴后框选纵向叠加（D3）、中键纵向失效与松键残留（D3）、按线整图平移（D3）、框选越界（M2） |
| Act 4 多选 | Ctrl+点选/框选批量/批量删除/选项卡面板（D4 追加） |
| Act 5 交易与周期 | B/S 标记、成本线、T+1、推进、跨周期画线锚定（修订十一） |
| Act 6 主题 | 深浅主题切换（修订二）、覆盖键不丢（修订三教训） |

## failure pattern 分类（统计与典型案例见 bug-pattern 文档 §1）

- **A 库行为与预期不符**（27%）：klinecharts 内部实现/默认值——覆盖前必读绘制源码，修复必须配 contract 断言＋内部 API 登记。
- **B 交互/手势/状态叠加**（33%）：多模式在同一画布的互斥与清理——修复必须配 journey 真实事件断言＋模式机守卫检查。
- **C 视觉/精度一致性**（12%）：常量同源（如 dashedValue 统一 [4,4]）＋按产品精度回显。
- **D 数据/状态映射**（15%）：映射链逐层单测（chartPrice 对账、toK date 保留）。
- **E API 契约**（6%）：full-acceptance 矩阵＋中文错误信息断言。

## 新 bug → 回归测试流程（强制）

1. 修复代码。
2. 转化为回归断言：交互/视觉类 → frontend-contract 正则或 journey 真实事件断言；数据类 → 单测；API 类 → full-acceptance 矩阵。
3. 在 docs/bug-pattern-分析与journey自动化设计.md §1 的清单登记 pattern 与修复日期。
4. `npm test && npm run build && npm run journey` 全绿方可提验。

## Journey 运行

- 前置：`npm run build:journey`（--mode journey 构建，注入 window.__trainerChart 测试钩子；生产构建零钩子。注意：`import.meta.env.DEV` 在 build 时恒 false，钩子条件用 `MODE === 'journey'`）。
- 运行：`npm run journey`（= build:journey + playwright test；global-setup 自动 spawn 隔离服务端：TRAINER_DB=临时库、PORT=8791；端口被占用时直接报错——清理孤儿进程后重跑；teardown 清理）。
- 失败：自动附截图与 trace（test-results/），retries 1。
- 断言纪律：优先 `__trainerChart` 状态断言（overlayCount/selectedCount/mode/yRange/hitTest）；截图仅存档不比对；禁止用 dispatchEvent 合成事件验证交互（与真实事件不同构，历史教训）。
- 库残留训练：journey 库跨重试存活，每个测试开头必须 `resetToLauncher`（API 层放弃活动训练；UI confirm 会被 Playwright 自动 dismiss，不可靠）。
- 画线点位纪律：两点绘制间隔 >500ms（库双击判定窗口）；Ctrl+点选与框选的坐标必须按当前视图比例精算在线上（±7px），锚点 ±8px。

## 当前状态（2026-09-06）

- vitest：16 文件 **88/88**（含 klinecharts-pin 版本哨兵）
- journey：**13/13**（Act1 闭环 / Act2a-c 画线生命周期 / Act3a-d 交互矩阵 / Act4a-c 多选 / Act5 交易 / Act6 主题）
- journey 已抓出并修复的真实回归：**多选 Delete 误删第三条**（画线完成时库的 onSelected 态被追加进删除集合）——首个由 journey 而非用户发现的 bug，验证了本体系的价值。
