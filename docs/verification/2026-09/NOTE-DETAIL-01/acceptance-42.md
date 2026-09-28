# NOTE-DETAIL-01 限定验收通过

2026-09-27；GPT review `note-final-review-started-20260927-42`。
受验候选 `6effeb34e4dbb8881146f847dcb585e1675a2a59`；代码修复 `6cbf7a679849f7a3cf1d33ac64018b2dabf3f448`。

接受只读成交详情的四个冻结场景。F1–F4全部闭合，无新增阻断。不代表NOTE-01理由编辑、TRAIN-03、整个V4或发布完成；尚未集成/main提升。

| 返修 | GPT真实页面验证 |
|---|---|
| F1标题响应 | 同一面板B#1→S#4→B#1，标题、事实方向、序号一致 |
| F2焦点转发 | hover→Shift+Tab进浮层→鼠标移开，面板和焦点保留；Tab离开且指针在外才收起 |
| F3固定离屏 | 真实滚轮平移至0徽标，面板仍显示当前#2事实；Home回视口后3徽标恢复，选择不丢 |
| F4深色列表 | 深/浅×840/1440截图与computed style核对，文字分别rgb(228,228,228)/rgb(51,65,85)，笔次可辨且面板在视口内 |

防未来回归：禁止API访问后导入两日录像，选#2固定→上一日清空→下一日不自动复活，业务写请求0。当前浏览器控制台0错误/0警告。既有盲训及热键隔离正式回归保持，未扩大要求。

## 证据与范围

- 独立runtime `run-7ec4e9d3-70e8-4dc4-9835-42e1ad7a40df`绑定6effeb3；冻结样本隔离拷贝、独立库/端口4238；构建、25项定向单测退出0。
- 执行者最终Journey `run-cf752374` 9/9、`run-7ed14962` 4/4，均绑定6cbf7a6、零重试/零flaky；6effeb3仅新增repair-39.md，继承成立。
- GPT证据：`C:/Users/Stark_Du666/.codex/headroom-cache/note-final-review-20260927-42/`，含ui-results.json、targeted.meta.json、evidence-check.md及F1/F3/F4截图。
- 执行者普通unit/build/docs日志缺单独.meta的限制保留，不升级为认证收据；本轮独立新证据有准确绑定。完整unit/Journey、verify:candidate和发布门禁尚未运行，仍属整合阶段条件。

## 流程与后续

首次修复先于RED；后续在d804be8补测四失败是真实反例，但不改称实施前RED。此流程偏差保留，不据此拒收现已正确的实现。防遗漏必须同时覆盖跨方向props更新、focus-only、数据仍在但标记离屏的真实渲染、主题computed style与截图。

离屏固定仅保留选中事实、长行ellipsis、最低840px支持沿原边界，不增加返修。任务卡closed表示本片接受，集成与发布另计。本功能5/5（设计1、执行2、审查2），不重复派发本片。SETUP继续按用户决定停止。
