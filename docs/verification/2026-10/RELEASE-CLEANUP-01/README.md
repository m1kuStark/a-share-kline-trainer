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

## 2. 待执行（等真机验证＋用户验收拍板后）

**发布节奏纪律（本轮确立）**：GitHub 发布是 outward-facing 动作，执行前须向用户呈报执行清单并获确认——不再连续自动发版。

1. （可选前置）3060 真机烟测定版包：全新安装→TDX 首配直连→一键迁移两侧→回放推进→设置页无迁移分栏。
2. 删旧 v1.3.0 release＋远端 tag（id=410826591）。
3. main 打 v1.3.0 tag → 建新 Release 上传 7 资产（setup exe/blockmap/zip/latest.yml/migrate-v127.zip/SHA256SUMS×2）。
4. CloudBase 镜像同步（sync-feed --notes，指向新 release 资产）。
5. （用户拍板后）发 v1.3.1 测试版验证 update 链（v1.3.0→v1.3.1 检查+下载+安装），测试＋用户验收通过后删除 v1.3.1。
6. 已装 v1.3.3 的过渡期说明：v1.3.1/2/3 release 删除后其更新检查 404 属预期（定版发布后恢复）；用户本机与 3060 均以定版重装。

## 3. 打包收据追记

（打包完成后回填：命令、退出码、产物清单与 hash。）

## 4. 偏差与说明

- v1.3.1/2/3 的 setup exe 本地无备份（仅 GitHub），删除即不可取回——评估为无保留价值（中间测试版，源码与 tag 引用均在 git 历史）。
- 「触发本体的 update 功能」解读 A/B（INSTALLER-UPGRADE-01 呈报）不影响本任务执行。
