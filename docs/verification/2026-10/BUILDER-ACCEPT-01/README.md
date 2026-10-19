# BUILDER-ACCEPT-01 验收候选

候选基于 `81558ad3b176c07e1f368ef3ea2fdd2fb5da82ed`，生产输入与 `8d08a5a0920abb04964f1e6f68fd20291db55ce7` 一致。未发布，未覆盖个人数据或已安装程序。

[五分钟验收说明](../../../release/builder-accept-01.md)；[ZIP 身份与校验和](delivery-zip.json)。解压后进入 `BUILDER-ACCEPT-01-20261020`，运行 `Start-Acceptance.cmd`；数据位于包内 `.acceptance-data/`。

## 本次交付

- 成绩单七列成交表在 390 窄窗溢出，已改为可聚焦的局部横向滚动。真实买入/结算、深浅主题、390/1024/1440、键盘/鼠标到费用列均有回归。[断言与 RED/GREEN](execution-notes.md)。
- 修复 20 个原始文档错误：规范任务状态、补阶段/依赖、恢复四份原始日志和失效链接；检查器未改。[修复收据](docs-repair-receipt.json)。
- 真实 v1.2.7 旧界面生成训练及录像，经真实导出页迁入新桌面并回放；已有数据保留，重导不增副本。[迁移分层证据](migration-validation.md)。
- 独立 ZIP 包含程序、启动脚本、冻结行情、说明、包内证据和逐文件清单。最终 ZIP 重新解压后经真实 CMD 显示窗口，数据库与浏览器路径隔离，原生关窗 exit 0。[解压收据](delivery-extraction.json)、[启动收据](zip-launcher-smoke.json)。

## 验证结果

| 检查 | 结果与范围 |
|---|---|
| 单测 | `npm test` exit 0：server 1750 + desktop 357；首次失败/复跑均保留。 |
| 构建 | `npm run build`、`build:desktop:main` exit 0；独立全新依赖目录也构建通过。 |
| 文档 | check / impact / status / status --check 全 exit 0；0 errors，保留 125 项旧文档长度警告。 |
| M2 | 24/24，exit 0；冻结行情样本，见[报告](M2-e2e-report.md)。 |
| 窄窗定向 | 2 passed，exit 0；run `4f6514fc-5536-45f8-a29b-8ee335923532`。 |
| Journey 首轮 | 193/196，无 skip；三项失败与独立原始日线核算见[回归诊断](journey-diagnosis.md)。 |
| Journey 修正后定向 | 23/23，exit 0。 |
| Journey 最终全量 | **196/196，0 failed / 0 skipped / 0 flaky，native exit 0**；真实旧包用例启用，[完整收据](journey-final.json)、[日志与机器报告](journey-final-evidence.zip)。 |
| 矩阵 | report-layout 1、local-http-origin 3、drawing-persistence 3、random-training-mode 25、migration-tool-v127 12 行引用 strict 0；不代表全工作区矩阵。 |
| 包身份 | [187 项生产输入](production-inputs.json)无漂移，[89 项 ASAR 运行文件](asar-contents.json)与 staged 构建逐字节相同。 |

[执行日志归档](evidence-logs.zip)保留单测、构建、迁移、定向回归及失败日志，[逐文件清单](evidence-logs-index.json)可复核哈希。首轮全量浏览器失败另有[截图与 trace](journey-first-evidence.zip)。

[最终门禁收据](final-gates.json)与[文档/状态命令日志](final-gates.zip)对应本次交付。

安装器已本地生成，但未执行 NSIS 安装、覆盖升级、自动更新安装或卸载。未覆盖全市场完整性或当前通达信原生 M1 逐值对照；用户体验验收待进行。准备错误、失败与构建处理见[执行说明](execution-notes.md)。
