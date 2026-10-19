# UIUX-REFINE-01 验证与监督

2026-10-17 UIUX候选交付待体验验收。基于 `6d557a12`，工作树 `trainer-worktrees/uiux-refine-20261017`，分支 `codex/uiux-refine-20261017`。源码/包身份见[candidate-identity-final.json](candidate-identity-final.json)。全量回归未绿，用户验收与公开发布未完成。

研究交接：已读指定 ZCode 会话及 UIUX 设计聊天，来源 skill v0.4.0；Harness v1.11。已有 B1-B6 不视为本轮通过证据。旧 dist 入包与 1024 历史网格溢出分别核验。

首轮监督发现：合并长文读取发生截断，三名研究 worker 主动逐文件补读；研究简报无任务卡导致一次 manifest exit 1，补充声明只读研究可用 root 书面 manifest。实现阶段统一使用正式任务卡。

## 可体验结果

创建页按标的/区间与本局规则分区，开始操作固定；设置保存和错误反馈独立于正文。训练页保留图表中心和既有交易习惯，紧凑窗口下账户、下单、画线同时可达。历史/排行使用明确键盘成绩单入口，录像库明确准备、空态与恢复反馈。页面淡入及设置短距离进入支持减少动效，数字滚动偏好保持原合同。

NSIS候选：`output/uiux-package-final/desktop/release/kline-trainer-desktop-setup-v1.3.0-windows-x64.exe`，SHA256=`00e742f1fb9c13ed844cd797ad2823c26ee3187a18271ff82e82c185a75d2b39`。未运行安装器、未覆盖用户安装、未push/tag/release。此包沿用1.3.0版本号，以hash识别本候选。

## 验证结论

| 层级 | 收据与结果 |
|---|---|
| 单元测试 | `npm test` 原生0，server1671+desktop241；[完整日志](original-logs.zip)。首次旧进程异常等早期日志均保留。 |
| 构建 | `npm run build`、`build:desktop:main`、`release:desktop`均原生0；[web](original-logs.zip)、[desktop](original-logs.zip)、本地`output/package-final.log`。 |
| 业务API补验 | M2脚本24项检查0，见[M2报告](M2-e2e-report.md)；不替代全量journey。 |
| 新UIUX 22项 | 最终源码上：e091的launcher4/settings4/training2；2bdcae9c的records8/shell3；8dbfff05的排行1。相应测试未漂移部分组成22项通过收据；不是一次全量22项绿色运行。 |
| 矩阵与L2 | UIUX矩阵7行，covered7/open0/RED0，strict原生0；[绑定](original-logs.zip)、[独立逐断言复核](L2-final.md)。核心变异仅paper_only；其他模块整表open未关闭。 |
| root真实UI/包内渲染 | [主代理验收](root-validation.md)、[unpacked运行](packaged-runtime-final.json)；HTTP/preview/dist/asar四资源一致，实际最小内容1008×641。 |
| 全量journey | 151过/30败/1跳过，native1；后续关闭13个原失败，仍17项未关闭。详见[回归债务](regression-debt.md)，不报告整版通过。 |
| Skill文档 | 9份文档38链接校验0，正式Harness四源未变；[监督](supervision.md)。候选目录保留完整差异、来源与独立情境，未安装。 |
| 文档/状态 | docs:check原生1，17项错误与基线集合逐字一致；docs:impact、docs:status及status --check原生1，16项既有任务元数据错误阻止生成摘要。任务卡与共享状态已对账review，docs/status.md仍为旧生成视图，不把生成失败当通过。 |

## 证据导航

- [设计取舍](design.md)、[W1](W1.md)、[W2](W2.md)、[最小窗口RED和修复](min-window-receipts.md)、[records补验](records-followup.md)。
- [全量失败源码/trace诊断](W2-diagnostics.md)、[原L2缺口](L2-review.md)、[最终L2](L2-final.md)、[root监督](supervision.md)。
- 完整journey日志和trace位于各`.runs/run-<id>/artifacts`，wrapper日志在本目录。可视图片在`output/playwright/uiux-final-*`。不删除首次RED与准备失败。

下一步由用户体验创建、训练、历史/排行与录像路径，确认呈现取舍；回归债务、安装/退出路径另行关闭后才具备发布条件。屏幕阅读器、Windows缩放、全应用200%文字、全WCAG符合未认证。

## 2026-10-20 原始日志补存

上表日志链接指向 `original-logs.zip`，内含原名 `unit-delivery.log`、`build-final.log`、`build-desktop-final.log`、`binding-final.log`。从原 UIUX 工作树逐字节归档，SHA256 见[补存收据](../BUILDER-ACCEPT-01/docs-repair-receipt.json)。这只恢复证据可达性，未重跑或改写 2026-10-17 结论。
