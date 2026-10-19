# BUILDER-REVIEW-01 验证记录

本轮落实「公开下载、本机运行」尺度下的访问边界、恢复验证和交付说明。基线 `main@a91bad2`；候选分支 `codex/builder-review-followup`。只使用隔离 SQLite、浏览器配置与端口，通达信只读。没有上传发布、修改云预算或操作个人训练库。

## 改动

- 普通 HTTP API 加统一来源守卫：外站/不透明 Origin、跨站 Fetch Metadata、非回环 Host 返回 403，不开放 CORS；本机同源和无浏览器头的本地脚本保持兼容。既有控制令牌守卫保留。
- Vite 字符串代理实际会改写 Host，真实回归曾得到 403；显式 `changeOrigin: false` 后，真实代理和 Edge 读写通过。
- 接入 `dfbf3af`、`df6819e` 的画线与日期修复，候选内为 `215528a`、`6251f4b`。画线推进后可撤销、恢复保留样式、录像包含全部周期画线；随机日期只在实际 K 线位置揭示，不显示右侧空白的外推日期。
- 统一桌面/ZIP 安装、数据路径、完整备份、迁移、更新和卸载说明。[用户入口](../../../user/README.md)、[桌面迁移](../../../user/desktop-upgrade.md)。

## 已取得的机器证据

| 检查 | 命令 / 原生退出码 | 结果与范围 |
|---|---|---|
| 来源 RED → GREEN | Vitest local-request-guard；各 RED=1、GREEN=0 | Origin、Fetch Metadata、Host 分别复现；完整入口、真实临时库；外站读取/写入拒绝且设置未改变 |
| 开发代理 RED → GREEN | 同文件 `-t 'actual Vite proxy'`：1 → 0 | Vite 真实配置经 HTTP 转发，锁住 Host/Origin 一致；完整守卫 6 项通过 |
| 真实 Edge 开发代理 | `npx tsx docs/verification/2026-10/BUILDER-REVIEW-01/verify-dev-proxy.ts`：0 | [收据](dev-proxy-receipt.json)：读写 200、保存值为 false、无 pageerror；生命周期接口沿用自身跨端口限制 |
| 全量单测最终版本 | `npm test`：0 | server 1750、desktop 357，通过全部用例；含第 6 个真实代理用例 |
| 生产构建 | `npm run build`：0 | Vue 类型、后端 TS、前端生产构建；保留既有大 chunk 提示 |
| M2 核心闭环 | `npx tsx scripts/verify-m2.ts`：0 | 冻结 TDX 样本、内存 SQLite、24 项通过；[报告](M2-e2e-report.md) |
| 新增浏览器旅程 | `npm run journey -- e2e/local-origin.spec.ts e2e/backup-restore.spec.ts --retries=0`：0 | 2/2；来源与恢复；run `d21a1ec2-b38a-4045-97e7-0ac9fde7b427` |
| 矩阵严格绑定 | `check-binding.mjs --strict --include-untracked`：0 | local-http-origin 3/3；drawing-persistence 3/3；random-training-mode 25/25；均 open=0、RED=0。这是引用检查，L2 与运行证据另列 |
| 公开发布核对 | `node desktop/scripts/verify-release-assets.mjs --tag v1.3.0 --expect-latest`：0 | GitHub 7/7、latest=v1.3.0；CloudBase latest.yml/manifest 同版本。只核对资产与清单，未逐字节重下全部二进制 |

完整浏览器 Journey：`npm run journey -- --retries=0`，原生退出 **1**，**193 通过、1 失败、1 跳过**（195 项，32.1 分钟）。run `54e0a9b3-4665-42f9-968a-a4eb5b78f13b`；[逐项结果与完整错误](journey-results.json)。本轮来源、恢复、画线、随机日期与录像相关用例均通过。窄窗成绩单的失败已在未改主仓库使用相同测试历史时复现；跳过项要求提供真实 v1.2.7 旧包。详见[回归边界](regression-boundaries.md)。

该运行的生产服务代码包含访问守卫与两项图表修复；运行中补的是 Vite 开发代理，生产页面构建产物名称/内容未变化，另有真实代理收据。收尾核对[源码指纹](source-fingerprint.json)的 16 个文件全部相同，没有在已测版本上继续修改产品代码。

## 恢复实验与视觉检查

[恢复收据](backup-restore-receipt.json)：真实 UI 创建训练、买入、推进、画线、结算、导出 gzip。通过 SQLite backup API 生成一致快照，复制到另一个自有 run；新服务返回的训练、成交、画线和报告逐项深比较相同。空浏览器录像库导入文件后可回放，画线存在，买入入口不存在，回放前后数据库训练事实一致。

主代理已看[深色 1440×900](images/backup-restored-replay-dark.png)与[浅色 1280×800](images/backup-restored-replay-light.png)：图表、画线、成交摘要、播放控件可见，无横向溢出和错误遮罩，pageerror 为空。浅色 MACD 白线/标签对比偏弱属于存量观感，不在本轮调整。

边界：本实验验证数据库快照＋导出录像的独立恢复；没有证明用户手动停服复制、整个 Electron 用户配置恢复、桌面自动归档全路径或安装器升级。测试资料留在忽略的 `.runs`，不提交数据库或行情录像文件。

## 首次失败保留

本机 `*.log` 保留完整输出，选定的 32 份日志按原始字节收入[日志归档](evidence-logs.zip)，每份 SHA256 见[收据](verification-receipt.json)。失败没有隐藏或改写：

- `origin-red` / `metadata-red` / `host-red`：均 1，原接口 200、期望 403。
- `targeted.log`：1，控制 API 测试传空 body 得 400；改为有效 body，并逐例重置偏好后 50/50 通过（`targeted-fixed.log`）。
- 新 Journey 首跑 1：录像库尚在初始化时上传；先等待导入按钮可用后 2/2，通过同一恢复断言。
- `unit-all.log`：进程退出 `-1073740791`，未产测试结果；保留全部断言，2 workers 全量 1749 通过，随后默认 4 workers 的完整 `npm test` 亦通过。初次原生退出原因未确定，不能称为产品断言失败。
- `dev-proxy.log`：同样原生退出，未完成检查；后续真实 Vite HTTP 回归识别并修正 Host 问题，Edge 复跑 0。原生退出与 Host 问题不能混为一个原因。

## L2 复核与变异推演

只称纸面推演，未运行临时变异体。去掉 Origin 检查，携带外站 Origin 且 `same-origin` 元数据的用例会从 403 变 200；去掉 Host 检查，匹配攻击域名 Origin/Host 的写请求会通过。真实 Vite 测试锁住实际代理配置，避免只用注入头造成兼容假象。

画线三行的源码形状断言不能单独证明用户行为，结合真实鼠标的 drawing-basis、m3-tools、recording 断言判断。日期测试使用手写黄金周交易日；移除 bar 集合检查，右边距用例将揭示周六并失败。全矩阵 L1 通过不代表本轮审完随机模式其他 24 行。

## Z code 授权与云端现状

只读查询 `.zcode/cli/db/db.sqlite` 的真实 user 消息，未保存登录令牌。会话 `sess_4c210295-5145-4c99-801d-4e41f64609c7`：

- `msg_mv600qek_c7695de6-2690-49db-be6d-a767817b32e7`：批准国内网络可用的更新分发路径。
- `msg_mv6hdlnz_65c64a7a-52c9-4deb-b22e-ceccff2e9548`：明确「开始 CloudeBase 设备授权」。
- `msg_mv6ubsj8_89ad78e7-3ff9-4e79-a24a-3fa8728c7fb7`：正式版本仍为 v1.3.0，测试与用户验收后再清理临时版本。

首次直接 `queryHosting(action=status)` 返回 `AUTH_REQUIRED`，驱动原生退出 0 但响应 `ok:false`。后续同连接先调用 `auth(action=status)` 后查询成功：现有设备授权为 READY、环境 NORMAL、静态托管 online，无需重新登录。[脱敏核对收据](cloudbase-receipt.json)记录站点与 feed 文件。初次失败是连接未加载授权状态，不能据此称凭证过期。

管理面与公开面均可读取；未进行上传、删除或账号 CAM 最小权限审计，不能推断写权限范围。对象列表还留有三项 v1.3.1 测试产物，当前 latest/manifest 均指向 v1.3.0，本轮不删除。MCP 的 findFiles 摘要误报「0 个」，原始 Contents 实际为 10 项，收据按实际数组记录。沿用用户本轮决定：6 个月赠送期内不处理费用告警，未来 200 元/月可接受。

## 文档门禁与交付边界

`docs:check` 退出 1，20 项错误与 `main@a91bad2` 完全相同：[对照](docs-baseline-comparison.json)。16 项来自旧任务卡非法状态/缺失里程碑或依赖，4 项是旧验证记录引用未入库日志；不修改这些历史状态换取通过。`docs:impact`、`docs:status`、`docs:status -- --check` 均退出 1，被上述 16 项卡片错误阻断；没有手工改写生成摘要。

补充调用原有检查函数：[范围收据](docs-scoped-receipt.json)中本任务路径与 docs_impact 满足，实际 ZIP 文档暂存树无断链。此诊断不替代全局门禁；本候选不能宣称整库门禁全绿或可直接发布。用户验收、安装包验收与云账号写权限审计分别保留。

本地交付位置为 `codex/builder-review-followup`；两项已有修复和本轮补充均保留在该候选，主仓库仍是 `a91bad2`。未生成本轮安装包，未推送、打标签或改动云端文件。[机器收据索引](verification-receipt.json)记录命令、退出码和日志指纹。
