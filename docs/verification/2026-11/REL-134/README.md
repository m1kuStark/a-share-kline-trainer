# REL-134 v1.3.4 发布记录（2026-11-08）

任务：DIAG-OPLOG-01 本地操作日志；里程碑 V134；分支 `verify-pr7`。

## 版本与门禁

- 版本：**1.3.4**（package.json / package-lock）。
- 全量门禁：`npm run verify:baseline` **0**，run `run-63201f7a-f100-41c7-a313-a63ef578ab75`，被测提交 `9123f31`，passed=true、cleanBefore/After=true；journey 236 passed / 1 skipped / 0 failed（32.3m），总 38.8min。
- 收据详见 [DIAG-OPLOG-01](../DIAG-OPLOG-01/README.md) 与 [BATCH-GH-202611](../BATCH-GH-202611/README.md)。

## 打包（NSIS）

待填：`npm run build:desktop` → `npm run release:desktop` 产物、SHA256SUMS-desktop 与 release-manifest。

## 国内镜像（CloudBase）

待填：sync-feed 输出 6 文件、逐文件上传结果、HTTP latest.yml/manifest/exe 验证。

## 发布范围

- 发布到 CloudBase 镜像 feed（供 v1.3.3 桌面更新检查使用）；GitHub Release 待用户验收后补发。
- 升级对用户数据目录零动作；本地操作日志目录 `%USERPROFILE%\.a-share-kline-trainer\logs` 保留，不属于更新包/备份内容。

## 用户验收

- 从 v1.3.3「设置 → 关于与更新」检查更新 → 下载安装 v1.3.4。
- 验收操作日志：设置 → 关于与更新 → 打开操作日志目录；或 `%USERPROFILE%\.a-share-kline-trainer\logs\operations.log`。
