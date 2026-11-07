# REL-134 v1.3.4 发布记录（2026-11-08）

任务：DIAG-OPLOG-01 本地操作日志；里程碑 V134；分支 `verify-pr7`。

## 版本与门禁

- 版本：**1.3.4**（package.json / package-lock）。
- 全量门禁：`npm run verify:baseline` **0**，run `run-63201f7a-f100-41c7-a313-a63ef578ab75`，被测提交 `9123f31`，passed=true、cleanBefore/After=true；journey 236 passed / 1 skipped / 0 failed（32.3m），总 38.8min。
- 收据详见 [DIAG-OPLOG-01](../DIAG-OPLOG-01/README.md) 与 [BATCH-GH-202611](../BATCH-GH-202611/README.md)。

## 打包（NSIS）

- 构建：`npm run build:desktop`（exit 0）→ `npm run release:desktop`（exit 0；`TRAINER_RELEASE_OUT_DIR=desktop\release-134`）。
- 产物（SHA256SUMS-desktop.txt，migrate-v127.zip 按 v1.3.x 规则剔除）：
  - `kline-trainer-desktop-setup-v1.3.4-windows-x64.exe` 117,349,763 B（约 111.9 MB）sha256 `b72b9a51ffce02e1bdb98caf0319c78e1ee20a23a1dab8687eadf5093fbf1270`
  - `…exe.blockmap` 122,325 B sha256 `35f78eae1f13865cc9702ad7e6359ca4a0a68dfdf1ec53a2854c479486aaa4f2`
  - `latest.yml` 634 B sha256 `ec025e99abd0b04116861b57803887981fc8300ee607b132194c66716dd955f3`
- 隔离 ZIP 兜底：`node --import tsx scripts/release/build.mjs --node-archive D:\tmp\node-archive\node-v24.15.0-win-x64.zip --node-checksums … --out …`（exit 0；构建提交 `1e6ce5f`）：`kline-trainer-v1.3.4-windows-x64.zip` 55,717,662 B sha256 `2d58b6186a196f302c52788dd828949d73ed2bad53f51d5f7ba321bd990a641b`＋`SHA256SUMS`。
- NSIS 报告：app-update.yml 入包；latest.yml version/sha512/size 与 setup exe 字节核验通过。

## 国内镜像（CloudBase）

- sync-feed：输出 `dist-cn-feed/` 6 文件（latest.yml、manifest.json、setup exe、blockmap、zip、SHA256SUMS），自校验通过（URL 前缀＋sha512/size＋sha256）。
- 上传（CloudBase MCP，逐文件/小批累计 4 批）：auth READY、env `k-line-trainer-d9gbbg6il6bf8c320`；batch1 setup exe **OK 33.5s**，batch2 zip **OK 29.3s**，batch3 blockmap OK 0.9s，batch4 latest.yml/manifest.json/SHA256SUMS OK 1.0s；latest 类最后上传。MCP `findFiles` 摘要对 exact-key 返回 MISS（已知 MCP bug），改用 HTTP 独立核验。
- HTTP 验证（2026-11-08）：
  - `GET /feed/latest.yml` → version **1.3.4**，url/sha512/size 指向本版 setup；
  - `GET /feed/manifest.json` → tag_name **v1.3.4**；
  - `HEAD /feed/kline-trainer-desktop-setup-v1.3.4-windows-x64.exe` → **200**，content-length **117,349,763**；
  - `HEAD /feed/kline-trainer-v1.3.4-windows-x64.zip` → **200**，content-length **55,717,662**。

### 本地 v1.3.3 更新口径

桌面 v1.3.3 默认更新源＝自动（CloudBase 镜像优先、失败回退 GitHub）；镜像 latest.yml 已指向 1.3.4，因此「设置 → 关于与更新 → 检查更新」即可下载安装。GitHub Release 尚未发布（用户验收后补发），若用户把更新源手工设为 GitHub/official 则暂时看不到 1.3.4。

## 发布范围

- 发布到 CloudBase 镜像 feed（供 v1.3.3 桌面更新检查使用）；GitHub Release 待用户验收后补发。
- 升级对用户数据目录零动作；本地操作日志目录 `%USERPROFILE%\.a-share-kline-trainer\logs` 保留，不属于更新包/备份内容。

## 用户验收

- 从 v1.3.3「设置 → 关于与更新」检查更新 → 下载安装 v1.3.4。
- 验收操作日志：设置 → 关于与更新 → 打开操作日志目录；或 `%USERPROFILE%\.a-share-kline-trainer\logs\operations.log`。
