# #8 内置副图线与图例对比度：工程验证

基线 `fdd4441`。训练及回放共用一个图表组件。只改 MACD 的 DIF/DEA 和 KDJ 的 K/D/J，深色保留原配色；不重算指标，不更新用户的 MA、画线或录像格式。这里不涉及 #8 后续提出的主图 B/S 标记、#41 价格尺或 M9。

## 当前口径（2026-11-24）：只反转白线

- 维护者指定：浅色仅将 DIF/K 从原白色 `#f2f2f2` 映射至纯黑 `#000000`。DEA/D 始终是原黄 `#f5c343`，J 始终是原紫 `#d446d6`。同色图例随曲线切换，两种主题都是原来 1px 的曲线；不调粗、不重新配色。原来“所有图例都达到 4.5:1”是上一候选的口径，不用于强行改变黄、紫；当前仅检查中性色线的对比度。
- 对照参考：TradingView Lightweight Charts 将图表底色与各条 series 的颜色分开设置（[官方示例](https://tradingview.github.io/lightweight-charts/docs/4.1/series-types)）。本任务借鉴的是逐条设置的做法；黑、白、黄、紫的具体映射来自本项目维护者，不是该产品的配色规范。
- 前测（`run-4cb06d8a-0436-4d7d-be11-6faa70d35a48`）：在暂存于工作树的蓝/橙/玫红试色上，真实周 K 的颜色序列断言按预期失败，exit 1。该试色未提交。

- [同一周 K 深浅对照](white-to-black/week-theme-comparison.png)（从实图同坐标裁切，无缩放或重绘）；[深色整屏](white-to-black/indicator-week-dark.png)、[浅色整屏](white-to-black/indicator-week-light.png)、[浅色回放](white-to-black/indicator-replay-light.png)。周 K 是贵州茅台 600519，训练推进至 2025-01-03，视口 1440×900。
- [本次 Edge 收据](white-to-black/receipt.json)：隔离运行、零重试，2 条指标专测及 10 条既有区间统计/读数回归全部通过。断言读取实际 Canvas 图例文字颜色、同窗格曲线颜色及线宽；覆盖切换、重新挂载、自选 MA 和回放。构建 exit 0，前端契约单测 37/37；strict 绑定：KDJ 6/6、图表分析 6/6、区间测量 7/7。本轮未跑全量 Journey、未打包，也不代表人工验收。

[历史候选 d205343 的前测、临界色变异与旧截图](candidate-d205343.md)仅留作追溯，不代表本轮口径。
