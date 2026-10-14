# RELEASE-CLEANUP-01 验证记录：GitHub Release 治理与 v1.3.0 定版

- 任务卡：`docs/work-items/tasks/RELEASE-CLEANUP-01.md`（milestone=R5）
- oracle：用户原话（2026-10-13 任务 4）「由于你的贸然发布，github 上多出了很多没用的 v1.3.x 版本 release 包」「最终发布版本号仍设定为 v1.3.0」「可以增加一个 v1.3.1 版本用于测试 update 功能，但是经过你的测试和我的验收都通过之后，就要清理掉」

## 1. 已执行（2026-10-13）

| 动作 | 收据 |
|---|---|
| 删 release v1.3.1（id=411241502 连 7 资产） | HTTP 204 |
| 删 release v1.3.2（id=411567776 连 7 资产，坏镜像版） | HTTP 204 |
| 删 release v1.3.3（id=411654331 连 7 资产） | HTTP 204 |
| 删远端 tag v1.3.1/2/3（本地 tag 保留作历史锚点） | git push :refs/tags ×3 全 [deleted] |
| 清理后 release 目录 | 仅剩 v1.3.0（旧版，待定版替换）＋v1.2.7 |
| 版本号回退 package.json 1.3.3→1.3.0 | commit（CHANGELOG 四版合一同批） |
| 定版打包 `npm run build:desktop`（主仓库真实 node_modules，符合 junction 纪律） | 见 §3 追记 |

依赖关系遵守：四项修复（TDX-RECONNECT/REPLAY-VIEWPORT/MIG-ONECLICK/INSTALLER-UPGRADE）已全部合入 main（574591e）后才执行清理与定版准备。

## 2. 已执行·续（2026-10-14 用户拍板后）

用户拍板（2026-10-14）：删旧 v1.3.0→tag 重发→CloudBase 镜像同步→发 v1.3.1 验证 update 链（仅镜像，不发 GitHub）；用户从 GitHub 下载 v1.3.0 测更新链路。

| 动作 | 收据 |
|---|---|
| 删旧 v1.3.0 release（id=410826591）＋远端 tag | HTTP 204；远端 tag 经 API DELETE（git push 443 间歇抖动改走 API） |
| 打 tag v1.3.0 → 65b7184（main HEAD） | API POST git/refs 成功 |
| 建新 Release v1.3.0（id=412799304）＋上传 7 资产 | 6 中小资产 HTTP 201；setup 111.8MB HTTP 201（125s，--retry 3） |
| 补产 zip 兜底形态 | release:windows（node v24.15.0 归档 SHA256 验证）→ zip 53MB＋SHA256SUMS |
| CloudBase 镜像同步 v1.3.0 | sync-feed（绝对路径）→ 7 文件逐个 manageHosting upload（117MB COS 分片 ETag -112；目录模式 120s 超时→逐文件全通） |
| v1.3.1 测试版 bump＋打包 | commit 964fb32 已推 main；release:desktop 首跑 EPERM（win-unpacked 句柄锁）→清目录重跑 exit 0；zip 补 build（no-clobber→独立 out 目录） |
| v1.3.1 仅镜像发布 | 镜像 setup/blockmap/zip/SHA256SUMS/manifest.json/latest.yml 全传；GitHub 不建 v1.3.1 Release（用户指定） |
| 镜像残留清理 | v1.3.2/3 的 6 文件＋v130-stage 全删；昨日旧 v1.3.1 blockmap 错配风险由当日新 blockmap 覆盖消除 |
| 端到端验证 | CDN GET feed/latest.yml → version 1.3.1＋镜像 URL＋sha512/size 完整；setup/blockmap HEAD 200；feed/ 最终 10 文件 |

## 2b. 待执行

1. 用户从 GitHub 下载 v1.3.0 定版（releases/tag/v1.3.0）安装，设置页「关于与更新」检查更新——应经镜像发现 v1.3.1（releaseNotes 为测试版说明）→下载→安装→重启后版本 1.3.1。
2. 测试＋用户验收通过后：镜像侧删 v1.3.1 文件＋latest.yml 切回 v1.3.0（sync-feed 重跑）；本地 tag 处置待拍板。

## 3. 原待执行清单（历史保留）

**发布节奏纪律（本轮确立）**：GitHub 发布是 outward-facing 动作，执行前须向用户呈报执行清单并获确认——不再连续自动发版。

1. （可选前置）3060 真机烟测定版包：全新安装→TDX 首配直连→一键迁移两侧→回放推进→设置页无迁移分栏。
2. 删旧 v1.3.0 release＋远端 tag（id=410826591）。
3. main 打 v1.3.0 tag → 建新 Release 上传 7 资产（setup exe/blockmap/zip/latest.yml/migrate-v127.zip/SHA256SUMS×2）。
4. CloudBase 镜像同步（sync-feed --notes，指向新 release 资产）。
5. （用户拍板后）发 v1.3.1 测试版验证 update 链（v1.3.0→v1.3.1 检查+下载+安装），测试＋用户验收通过后删除 v1.3.1。
6. 已装 v1.3.3 的过渡期说明：v1.3.1/2/3 release 删除后其更新检查 404 属预期（定版发布后恢复）；用户本机与 3060 均以定版重装。

## 3. 打包收据

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run build:desktop`（误跑） | 0 | 产出便携 exe「K线训练器 1.3.0.exe」——package-desktop.mjs 硬编码 --win portable（PACK-04 时代遗留）覆盖 yml 的 nsis target；**误产物已删除**，脚本漂移登记为相邻问题（见 §4） |
| `npm run release:desktop`（正确发布命令） | 0 | NSIS 定版产物集 4 件＋校验和：kline-trainer-desktop-setup-v1.3.0-windows-x64.exe（111.8MB，sha256:984e630dd7c0…）＋blockmap＋latest.yml（electron-builder 产出并字节核验通过）＋migrate-v127.zip（7 entries，STORE）＋SHA256SUMS-desktop.txt；fail-closed 核验链全过（含便携残留反向门） |

## 4. 偏差与说明

- v1.3.1/2/3 的 setup exe 本地无备份（仅 GitHub），删除即不可取回——评估为无保留价值（中间测试版，源码与 tag 引用均在 git 历史）。
- 「触发本体的 update 功能」解读 A/B（INSTALLER-UPGRADE-01 呈报）不影响本任务执行。
- **相邻问题登记（不本轮修）**：desktop/scripts/package-desktop.mjs 仍硬编码 --win portable（PACK-04 遗留），与 electron-builder.yml 的 nsis target 及 INSTALL-01 便携退役拍板漂移——日常 build:desktop 会打出退役形态产物并触发 release:desktop 的便携残留反向门。建议后续任务收口（改脚本 target 或退役该入口）。
- 发布前核对项：v1.3.x 历史 release 含 kline-trainer-v1.3.x-windows-x64.zip（zip 兜底形态）与 SHA256SUMS（全量），本次 release:desktop 产物集无此二件——按 desktop-release-manual.md 产物集口径发布时核对是否需要补位。
