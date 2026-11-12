# CHART-MEASURE-04 测量工具（一键进入、拖动/两次点击建立）

```json
{
  "id": "CHART-MEASURE-04",
  "title": "可发现的测量工具：顶栏入口＋拖动/两次点击建立区间测量",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "7895a22",
  "summary": "用户 2026-11-10 在 Issue #8 请求类似 MT5 的测量工具（快速得到价差/涨跌幅/根数）。现有 CHART-MEASURE-02/03 已具备 Shift 两次点击 K 线的区间测量与完整数据窗口，但入口不可发现。本任务新增顶栏「测量」开关：进入测量模式后无需 Shift，在主图拖动或两次点击起止 K 线即可建立同样的区间测量并显示既有数据窗口；端点可继续拖动调整；Esc/退出模式/切周期清除；与绘图取点/多选/框选/轴/分隔条/时间轴按既有仲裁互斥。不写训练/画线/录像，回放只读可用，镜像按真实价。",
  "next_action": "已合入 main（ab04972）并集成 v1.3.7（REL-137）；用户验收随 v1.3.7 人工验收节点。",
  "allowed_paths": [
    "web/src/components/KlineChart.vue",
    "web/src/components/RangeMeasurement.vue",
    "web/src/views/Training.vue",
    "web/src/chartStatistics.ts",
    "web/src/styles.css",
    "e2e/measure-tool.spec.ts",
    "e2e/chart-analysis.spec.ts",
    "e2e/README.md",
    "docs/specs/chart/interaction.md",
    "docs/user/chart-analysis.md",
    "web/src/components/README.md",
    "docs/work-items/tasks/CHART-MEASURE-04.md",
    "docs/status.md",
    "docs/verification/2026-11/CHART-MEASURE-04/**"
  ],
  "depends_on": ["CHART-MEASURE-03"],
  "docs_impact": {
    "update": ["docs/specs/chart/interaction.md", "docs/user/chart-analysis.md", "web/src/components/README.md", "e2e/README.md"],
    "reason": "新增测量工具模式与拖动建立交互，需同步交互规格、用户使用说明、组件实现地图与 e2e 套件索引。"
  },
  "verification_refs": ["docs/verification/2026-11/CHART-MEASURE-04/README.md"],
  "integration_ref": "ab04972",
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-10 Issue #8；维护者 2026-11-12 细化）

- 入口：训练页顶栏新增「测量」toggle 按钮（与「划线」同区，aria-pressed，中文 title/名称）。进入后光标为十字，状态区/图上提示「测量模式：拖动或两次点击选择起止K线，Esc 退出」。
- 建立方式（两条都要）：①主图按住左键从起点拖到终点松开；②两次左键单击（第一次起点、第二次终点）。起止索引排序归一，反向拖动得到同一区间。
- 显示：复用现有 RangeMeasurement 数据窗口与 Select Box/可拖边界；字段与 Shift 两点测量完全一致（起止收盘、涨跌幅、价差、K线数、区间高低/振幅/量额/涨跌根数）。测量模式内可继续拖动边界调整；再次拖动/点击可建立新测量（替换旧的）。
- 退出与仲裁：Esc 或再次点「测量」退出模式并清除；切周期、失焦、滚轮不打断既有仲裁（按现行为清除）；分隔条/价格轴/时间轴/绘图取点/多选/Ctrl-Alt-Meta 组合优先于测量；测量模式激活时与画线工具互斥（进入测量清除 drawTool，反向亦然）。
- 不写训练/画线/撤销史/录像；回放只读可用；镜像开启时按真实价计算与显示数值。
- 既有 Shift 两点测量行为零回归（chart-analysis 既有用例必须保持通过）。
- 文案/视觉属 proposed_default（按钮位置、提示措辞、图标），随用户验收确认。

## 行为

- 入口在 1024×680 及以上桌面可见、可键盘聚焦与切换。
- 拖动建立后窗口数值与真实 bars 手算一致；反向建立归一；边界可拖。
- 不产生训练/画线写入请求；不改变视窗（除既有清除规则）；无 pageerror。

## 本轮交付

- 交互：Training.vue 顶栏「测量」toggle（Ruler 图标＋aria-pressed；≤1180px 压缩为图标入口、aria-label/title 保留中文可访问名称），进入后十字光标、图上提示「测量模式：拖动或两次点击选择起止K线，Esc 退出」、按钮高亮；KlineChart.vue 沿既有指针入口新增 measureMode 手势——拖动建立（拖动期只预览 Select Box，松手出窗口）、两次点击建立（既有 measurementAnchor 虚线锚点，本任务补其渲染）、正反向归一、建立后替换旧值且模式保持；复用 RangeMeasurement 数据窗口/可拖边界与 chartStatistics 计算（算法零改动）；Esc/再点/切周期/结束训练/画线/多选退出并清除，滚轮/缩放/失焦只清测量；分隔条/价格轴/时间轴/绘图取点/多选/修饰键优先，交易/推进/删除热键被吞。
- 测试：新增 e2e/measure-tool.spec.ts（整改后 8 例：入口 1024×680 双主题/键盘、拖动建立＋反向＋边界、两次点击锚点＋替换、互斥与仲裁、可配置热键与输入框、失焦取消预览、镜像真实价、只读回放）；e2e/chart-analysis.spec.ts 9 例零回归。RED `run-0aa7c954-0d59-404e-b238-f77cf918a2ff`（6 failed，入口/探针缺失，manifest.commit=7895a22 未提交工作树）；GREEN：整改前 `run-4a06f420`（measure-tool 6/6）＋ `run-4183bacc`/`run-977cb2f1`/`run-d6484028`（合跑各 15 passed，manifest.commit 依次 7895a22 未提交/7895a22 未提交/1dadcc9 干净）；整改后 `run-19cdac39`（合跑 17 passed，manifest.commit=a87d296 未提交）。`run-df776de4` 为整改前**整轮 15 例 13 passed/2 failed**（chart-analysis 子集 9/9），不是独立通过 run。
- 证据与截图：docs/verification/2026-11/CHART-MEASURE-04/README.md（入口双主题 1024、窗口 1440、镜像 1440；截图来源＝整改后 run-19cdac39）。
- 评审整改（PR #38 只读评审）：I-1 训练热键吞改到 Training 键盘入口按 keyboardShortcuts 可配置键位（含 isTyping/isComposing 保护）；I-2 blur/窗外松键统一取消拖动预览；I-3 本卡与证据表格按 run 实际构成如实修正；M-1 副图指标开关 watch 内先清测量再增删窗格（e2e 断言）；M-4 run manifest.commit 与截图来源标注；M-5 用户指南补「空白处起手建立新测量」与面板 Esc 模式语义；M-7 MA 原生模态 Esc 判定前置。
- CI 首轮失败与最终修法：整改最初直接修改副图开关 watch 的源码契约行，导致 `server/test/frontend-contract.test.ts:276` 失败（CI run 43094100947 verify fail，真实失败记录保留）。最终改为**保留原契约行不动、新增独立 watch** 做 `cancelMeasureGesture()+closeMeasurement()`，未改契约断言、未扩展 allowed_paths；CI 复跑收据见验证记录。
- 未决/边界：回放页本轮不加顶栏入口（SessionReplay.vue 不在 allowed_paths，Lead 口径：回放仍用 Shift 测量且新模式零报错零写；一键入口如需另立卡）；按钮文案/位置/提示措辞属 proposed_default，随用户验收确认。