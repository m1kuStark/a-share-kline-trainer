# CHART-INVERT-01 K 线多空反转（空头视角）

```json
{
  "id": "CHART-INVERT-01",
  "title": "K 线多空反转：视图层镜像开关（训练/回放、水印防混淆、不影响交易与录像）",
  "owner": "integrator",
  "state": "active",
  "milestone": "M6",
  "base_commit": "66b719e",
  "summary": "四功能拍板第二序（2026-10-26，docs/proposals/后续四功能-方案细化讨论-20261026.md 第四节＋拍板记录「按本文第四节建议开发」）：视图层镜像开关，K 线数据镜像 p′=2P₀−p（P₀＝首根收盘价，开高低收全镜像、阴阳形状互换），指标按镜像序列重算（MACD 到水下）；防混淆三件套＝显眼水印「多空反转视角」＋开关态高亮＋回放页同步适配；范围＝训练页＋回放页；纯视图——不影响交易与结算、录像与画线持久面零污染（M2-DRAWING-01「显示层变换、持久面不变」同构约束）。M6（图表交互）为此单卡重开。",
  "next_action": "本轮＝全卡交付：priceMirror 纯函数（RED 先行）→KlineChart 集成（喂入层镜像、capture/画线/标记隔离）→训练页/回放页开关与水印→e2e；矩阵 9 行 root 预登记（worker 不编辑矩阵）；完成后停机提验（用户当前不在家，验收 deferred 与 REC-COLLECT-01 一同排队）。",
  "allowed_paths": [
    "web/src/priceMirror.ts",
    "web/src/components/KlineChart.vue",
    "web/src/views/Training.vue",
    "web/src/views/SessionReplay.vue",
    "server/test/chart-invert.test.ts",
    "e2e/chart-invert.spec.ts",
    "web/src/components/docs/interaction.md",
    "docs/specs/chart/display.md",
    "docs/specs/chart/interaction.md",
    "docs/work-items/tasks/CHART-INVERT-01.md",
    "docs/verification/2026-10/CHART-INVERT-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": ["web/src/components/docs/interaction.md", "docs/specs/chart/display.md"],
    "reason": "图表新增多空反转显示模式与开关交互说明"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 已冻结判断（2026-10-26 用户拍板）

- 视图层镜像方案（第四节推荐项随拍板整体采纳）：`p′ = 2×P₀ − p` 绕首根收盘价翻转（保持正值域）；开高低收全镜像（阳线形状变阴线形状）；价格派生指标按镜像序列重算（MACD 翻转到水下）。
- 防混淆三件套：开启时显眼水印「多空反转视角」、开关态高亮、回放页同步适配。
- 范围＝训练页＋回放页；**不影响交易与结算（纯视图）**；与随机模式、既有画线兼容（画线价格坐标跟随镜像）。
- 说明文案防误导：这是「多头分析之镜」，不是做空信号。

## root 预判定的 proposed_default（呈现/次级行为，先实现后提验）

- 镜像基准 P₀ 冻结语义：冻结于**本会话首次启用开关时已加载序列的首根收盘价**；镜像开启期间按需补历史（MA-01）不移动基准、图表不整体跳变（镜像对 P₀ 平移形状不变，仅轴值平移）。
- VOL 副图不镜像（成交量非价格派生，镜像无义）；B/S 标记与成本线随镜像坐标显示，但**订单面板与悬浮信息卡（涨幅%/现价）保持真实值**——交易决策信息不撒谎。
- 价格轴显示镜像值（数值无实义），水印/说明注明「坐标为镜像值」。
- 开关位置：训练页图表工具条（周期按钮行近旁）＋回放页同位；开关状态**不持久化**（每次会话从关开始，防混淆优先）。
- 指标副图（MACD/KDJ）默认随镜像同步重算，无独立开关。

## 执行计划

1. 矩阵骨架 chart-invert.yaml（root 预登记 9 行，worker 不得编辑矩阵）。
2. RED：server/test/chart-invert.test.ts（priceMirror 纯函数＋capture 隔离；transpile 提取真实模块；独立 oracle 内嵌——镜像值手算样例）＋e2e/chart-invert.spec.ts（开关/水印/形状互换/capture 不污染）。
3. GREEN：web/src/priceMirror.ts（纯函数：mirrorBar/mirrorPrice/unmirrorPrice/P₀ 解析与冻结）＋KlineChart 集成（喂入层镜像；capture/emit/画线持久面/标记锚定走真实价——循 drawingPriceBasis 仿射先例）＋两页开关与水印。
4. 变异抽检 ≥2（喂入镜像缺省时杀手死；capture 误用镜像序列时杀手死）。
5. 门禁：定向＋typecheck:web＋全量 server 回归＋journey（新 spec＋邻接 chart 类 spec）＋check-binding --strict。
6. 停机提验（与 REC-COLLECT-01 同列 deferred 验收队列）。

## 关键工程事实（root 侦查，worker 必读核实）

- KlineChart.vue 为 Training.vue 与 SessionReplay.vue **共用**（props 驱动、回放 readOnly）——镜像集成点单一，开关经 props/事件从两页传入。
- **capture 泄漏风险（最高风险）**：KlineChart.vue:538 `buildChartCapture({ ..., bars: toCaptureBars(data), ... })` 读的就是喂给图表的数据——镜像若直接替换喂入数组，录像/回放载荷会被污染（与 M2-DRAWING-01「周期过滤渗入 capture」同构事故）。设计约束：**真实序列必须保留为唯一 capture/emit 源**，镜像只存在于 chart feed 与渲染锚定。
- 画线价格仿射先例：web/src/drawingPriceBasis.ts（前复权累计仿射投影）——镜像（p→2P₀−p 为仿射）沿用同一结构：restoreDrawings 喂入前镜像、drawingsChange/持久面前反镜像。
- B/S 标记与成本线：refreshMarks 以 props.trades/costPrice（真实价）驱动，镜像态需经同一 P₀ 变换后锚定。
- 补历史路径：fetchEarlier（KlineChart.vue:449 附近）前置 older bars——P₀ 冻结语义在此验证。
- 涨幅百分比悬浮卡（candle-percent-hover 模块）与 hover 卡数据源保持真实值。

## 本轮交付

（开发轮完成后回填）
