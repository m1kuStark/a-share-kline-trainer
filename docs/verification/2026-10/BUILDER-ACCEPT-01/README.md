# BUILDER-ACCEPT-01 验收候选

本地候选基于 `81558ad3b176c07e1f368ef3ea2fdd2fb5da82ed`，范围为成绩单窄窗修复、文档错误修复、真实旧包迁移和独立验收包。未发布，未覆盖用户安装或个人训练数据。[验收说明](../../../release/builder-accept-01.md)给出约 5 分钟的操作路线。

## 修复与证据

- **成绩单**：非空七列交易表在 390 宽窗口把对话框撑至 391px（可用 368px）。改为有名称、可聚焦的局部横向滚动区域，保留全部列。`report-narrow.spec.ts` 覆盖深浅主题 × 390/1024/1440、真实买入和结算、键盘/鼠标及费用列可达。首次 RED 与两次 GREEN 准备记录保留；最终定向 Journey 2 项通过。
- **文档**：20 个原始错误已修复，未放宽检查器。7 份卡片规范状态，补 R5/R6 与已有合并事实的 MIG-MERGE-01 索引，登记卡补自身路径；恢复 4 份原始 UIUX 日志的 ZIP 链接。两处任务卡按既有 canonical 状态对账，未伪造用户验收。[收据](docs-repair-receipt.json)。
- **真实旧包**：公开 v1.2.7 ZIP 的 SHA256 与发布校验文件一致，7,181 个清单文件逐个验证。[身份](old-package-identity.json)。录像链在实际旧应用播种兼容的 4 种条目，经旧导出页、新导入页和回放；不能表述为所有录像均由旧 UI 实际录制。
- **训练历史**：通过真实旧启动器与 API 创建已结算训练、买卖、笔记、画线；真实工具导出。新库已有记录/录像命名空间保持，原字段和子表保留，重复导入新增 0 条，新 API 可读报告。源数据库哈希不变。[收据](history-migration-real.json)、[复验脚本](../../../../scripts/acceptance/history-v127.mjs)。
- **真实旧 UI → 新桌面**：在旧应用实际勾选录制、创建、买入、推进、结算，旧录像库生成 1 条真实记录。相同浏览器 origin 的导出页产出录像及 SQLite；交付的一键暂存函数写隔离目录，新 Electron 实际启动消费历史与录像，打开历史与回放。[完整收据](old-ui-to-packaged.json)、[包内回放](packaged-actual-old-replay.png)。未用页面内部状态注入替代这些用户动作。
- **已有新库 → 合并 → 再次导入**：同一真实 Electron 包连续 3 次启动，先真实 UI 买入结算，再迁入旧历史，最后重导；两条历史保留，原命名空间保留、重复新增 0。深浅主题在桌面两尺寸检查七列，保存退出后关窗 exit 0。[包内收据](packaged-acceptance.json)。

## 收据分层

| 检查 | 结果与范围 |
|---|---|
| 单测 | 最终完整 `npm test` exit 0：server 1750 + desktop 357；此前原生退出、超时、一次 runtime 取消清理失败均保留。 |
| 类型与构建 | `npm run build`、`build:desktop:main` exit 0；全新 npm ci 目录再次构建通过。 |
| M2 | 24/24，exit 0；冻结三股票/指数样本；[报告](M2-e2e-report.md)。不代表全市场或当前原生 TDX M1 逐值核验。 |
| 窄窗定向 | 2 passed，exit 0；run `4f6514fc-5536-45f8-a29b-8ee335923532`。六组尺寸/主题，鼠标和键盘末列可达。 |
| 矩阵 | report-layout 1/1，strict 0；local-http-origin 3/3、drawing-persistence 3/3、random-training-mode 25/25、migration-tool-v127 12/12 引用检查均 strict 0。未声称全工作区所有矩阵闭合。 |
| 包身份 | [187 项生产输入](production-inputs.json)无漂移；[89 项包内运行文件](asar-contents.json)与 staged 构建逐字节一致；另有真实 Electron 流程，不以字节检查代替运行。 |
| 启动器 | [交付启动器](launcher-smoke.json)真实运行：窗口可见、数据库和 Chromium profile 均在包内；原生关闭窗口后进程消失。此收据 app_exit 未取得，exit 0 证据来自上面的 Electron 三轮。 |

**L2 与变异**：独立预期来自用户修复要求及既有无溢出断言。`e2e/report-narrow.spec.ts` 使用本局 ID，真实买入后测量 dialog.scrollWidth/clientWidth，并锁七列表头、ArrowRight 的 scrollLeft 增加和鼠标滚至费用列。旧实现 RED 为 391>368（executed）；删除任一成交列将触发表头数组断言（paper_only）。首次 GREEN 的失败来自滚到表格底部后仍要求顶部关闭按钮在视口，补真实滚动准备后通过；没有删除/放宽产品断言。

## 当前验证边界

浏览器 Journey 与包内 Electron 分别记录。NSIS 已本地生成，尚未运行安装/覆盖升级/卸载；全市场行情、当前通达信原生逐值对照、收费及联机功能不在本次范围。新包的用户体验验收仍待用户进行。

Windows 曾发生 Node 原生退出 `-1073740791`、单 worker 无结果等待、子进程取消清理超时；日志保留，未修改测试断言。全新依赖轮为 1749/1750，唯一失败是取消子进程时 taskkill 未在预算内确认结束；随后原目录默认 worker 完整单测通过。无法仅据复跑推断原生崩溃的确定根因。

打包临时目录 rename EPERM 后，使用同版本缓存 ZIP 验证并解压，通过本地构建配置 `electronDist` 指向该目录；产品源码配置不变。[运行时身份](electron-runtime.json)。启动脚本初版 Hidden 隐藏了交互窗口，改 Normal 后通过真实窗口验证；打包程序本体未因此修改。

准备错误另存：旧历史脚本最初误用不存在的 `/api/settings`，改成真实 `/api/env`；旧 UI 冷启动的默认 5 秒等待不足，使用 30 秒准备预算；Electron APIRequestContext 无 baseURL，改显式绝对地址。页面“保存并退出”停止服务并显示退出页，关窗才结束 Electron，最终分别验证这两步。ASAR 检查使用 Windows 路径，类型声明和 sourcemap 不是运行资产；89 项运行资产完整匹配。未以这些准备错误冒充产品 RED。
