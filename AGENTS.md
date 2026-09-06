# a-share-kline-trainer 智能体工作指南

> A 股 K 线模拟训练器：基于通达信本地数据（.day/.gbbq）的离线复盘训练系统。
> 技术栈：Node 24 + TypeScript + Fastify + Vue 3 + Vite + klinecharts 10.0.3（钉定）+ node:sqlite。
> 本文件是 AI 入口路由（保持 ≤100 行）。规则细节在 docs/ai/ 分主题文档；改哪类事先读哪份，改完同步更新对应文档——**勿把规则堆回本文件**。

## 仓库地图

- `server/` Fastify API＋TDX 数据层（dayfile/gbbq/复权）＋训练引擎（train/account.ts、train/engine.ts）
- `web/` Vue 3 前端：views/Training.vue（训练视图）、components/KlineChart.vue（图表核心＋交互模式机）
- `docs/` 开发计划.md（产品全文）、bug-pattern-分析与journey自动化设计.md、verification/（验收证据）、ai/（AI 分层文档）
- `scripts/` verify-m1/m2（真实数据验证管线）
- `e2e/` Playwright journey 套件（真实事件用户旅程，六幕）

## 常用命令

- `npm run dev` 开发（服务端 8787＋前端 5173）
- `npm test` vitest 全量（server/test，进程内 inject＋源码契约断言）
- `npm run build` tsc＋vite 构建
- `npm run verify:m1` / `verify:m2` 真实数据验证管线
- `npm run journey` Playwright 用户旅程（六幕，提验前必跑）

## 文档路由（改哪类事，先读哪份）

| 主题 | 文档 |
|---|---|
| 架构/数据流/交互模式机/内部 API 钉定登记 | docs/ai/architecture.md |
| 产品口径/修订决策/V1 边界与 V2 候选 | docs/ai/product-specs.md（产品全文：docs/开发计划.md） |
| 测试矩阵/failure pattern 分类/新 bug→回归流程 | docs/ai/testing.md |
| 不变量与已知未修项 | docs/ai/known-invariants.md |
| 更新日志 | docs/ai/changelog.md |
| Bug 统计与 journey 设计依据 | docs/bug-pattern-分析与journey自动化设计.md |

## 顶部不变量（速查十条，细则见分主题文档）

1. 国内口径：红涨绿跌、阳线空心/阴线实心、通达信配色与画法，覆盖库默认前必读绘制源码。
2. 交易规则：T+1、整手（100 股）、按当日收盘价成交、买入仓位按总权益。
3. 防未来：训练 K 线先按推进日截断→前复权（基准=推进日）→聚合；训练中禁 /api/kline。
4. 权息入账：分红入现金/送转加股/配股足额自动缴款；成交价须换算图表空间（chartPrice）。
5. klinecharts 钉定 10.0.3；任何内部结构依赖（_chartStore/_event 等）必须在 architecture.md 登记，升级逐项复查。
6. 覆盖库样式/行为前必须读绘制源码确认生效键，并在 frontend-contract.test.ts 加断言。
7. 交互模式机集中守卫：default/画线/多选/轴缩放/框选的互斥与状态清理只在 KlineChart 事件入口链处理，新模式必须挂入并加契约断言。
8. 画线默认 1px 虚线黄色（dashedValue [4,4] 全局与应用两处同源）；多选选中标识为天蓝色（恢复原色）。
9. 单功能验收闸门：每单元开发→自查→npm test→build→journey→截图→停机提验，通过才进下一单元。
10. 新 bug 必须转化为回归断言（contract 正则或 journey 断言）并在 testing.md 登记 failure pattern。

## 已知未修项

见 docs/ai/known-invariants.md。
