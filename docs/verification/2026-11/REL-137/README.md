# REL-137 v1.3.7 集成与人工验收包（2026-11-12）

任务：[REL-137](../../../work-items/tasks/REL-137.md)；阶段：[V137](../../../work-items/milestones/V137.md)。
范围：CHART-LAYOUT-01、UI-TOOLBAR-03、CHART-MEASURE-04 三项合入后的 v1.3.7 集成、全量门禁与 NSIS 安装包。

## 结论

待填：三项合入、全量门禁、打包与用户人工验收边界。

## 合入提交

| 任务 | 功能提交 | 合并提交 | 说明 |
|---|---|---|---|
| CHART-LAYOUT-01 | c8dbeb5 | 8eec4cf | 图表铺满可用高度 |
| UI-TOOLBAR-03 | 48a1495 + 413bd52(合并 main) | 599f40d | 面板固定/调宽高 |
| CHART-MEASURE-04 | 5e987c9 + 审查整改 a58964d | ab04972 | 测量工具（顶栏入口＋拖动/两次点击） |
| REL-137 | 本提交 | 待合并 | 版本/CHANGELOG/门禁/打包（base main 599f40d） |

## 全量门禁

| 检查 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| unit+desktop | `npm test` | 待填 | 待填 |
| docs | `npm run docs:check` | 待填 | — |
| docs status | `npm run docs:status -- --check` | 待填 | — |
| docs impact | `npm run docs:impact -- --base 8eec4cf --task REL-137` | 待填 | — |
| build | `npm run build` | 待填 | — |
| 浏览器 journey（全量） | `npm run journey:parallel -- --shards 2` 或 verify:baseline | 待填 | run id |
| M2 真实闭环 | `npm run verify:m2`（或 verify:baseline 内） | 待填 | run id |

## 打包（NSIS）

| 产物 | 大小 | sha256 |
|---|---|---|
| kline-trainer-desktop-setup-v1.3.7-windows-x64.exe | 待填 | 待填 |
| latest.yml | 待填 | 待填 |
| …blockmap | 待填 | 待填 |
| SHA256SUMS-desktop.txt | 待填 | — |

## 用户人工验收（A3 节点）

- 交付包：待填本地路径。
- 验收清单：见任务卡与交付消息；通过后才执行 GitHub Release/tag、更新 feed 与国内镜像（本轮未做）。
- 反馈处理：待填。

## 环境与边界

- Windows / Node 24 / Edge；`TDX_ROOT=D:\MySoftWares\TDX`；独立 run 的端口/SQLite/构建；未使用个人训练库。
- 版本 1.3.7 仅本地候选：未 push tag、未发 GitHub Release、未移动更新 feed/上传镜像。