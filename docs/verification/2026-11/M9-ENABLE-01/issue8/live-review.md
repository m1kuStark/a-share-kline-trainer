# Issue8 真实页面复现补记

2026-11-18，run-d29a01d3-a4f4-440b-b6fb-2c86ae705216。主代理已逐张阅读1600×1000、1280×800的深浅主题四图：浅色MACD DIF与KDJ K曲线及同色图例难辨，深色正常。原工具面板遮住左侧部分图例，右侧曲线仍足以确认问题；保留首轮画面，不据此宣称完整视觉验收。

使用真实Edge、隔离run DB/端口/profile、TDX只读快照；训练夹具经隔离HTTP创建，非个人数据库。真实点击KDJ及主题；pageErrors为空，run原生退出0由主代理在执行时观察。live-result.json和wrapper自报0与原生结果区分；归档代理未独立执行产品。

[1600浅色](live/issue8-1600-light.png) · [1600深色](live/issue8-1600-dark.png) · [1280浅色](live/issue8-1280-light.png) · [1280深色](live/issue8-1280-dark.png)。结果见[现场JSON](live/live-result.json)，脚本为同目录归档的base64原件。

KlineChart.vue固定MACD/KDJ实例lines近白色，theme watcher仅setStyles；与截图吻合。该问题独立于M9用户公式显示链。本批只复现、分诊和提出后续回归范围，未改主题行为、未自动回复Issue。旧[静态分诊](triage.md)保留原“未动态复现”时间边界，本补记接续其后。
