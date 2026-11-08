# REL-135 v1.3.5 发布记录（2026-11-09）

任务：CHART-MEASURE-02 两点测量改为 K 线区间统计；里程碑 V135；分支 `verify-pr7`。
版本：**1.3.5**；功能提交 `3ef59fe`，测试稳定性提交 `fa7d4ff`。

## 工程自验

- 定向：`e2e/chart-analysis.spec.ts` **8/8**；`server/test/chart-statistics.test.ts + frontend-contract` **43/43**；`typecheck:web` 0；矩阵 `chart-measurement` **covered=6 RED=0**。
- 全量：`verify:baseline` 在当日 Windows 满载环境多次出现**既有无关 e2e 随机冻结/超时**；最新轮 234 passed/2 failed（m4-rankings 页面冻结、recording-long 满载首笔未成交），两项隔离复跑 3/3 全绿。详见 [CHART-MEASURE-02](../CHART-MEASURE-02/README.md) 的「全量门禁」记录。v1.3.4 上版全量曾 236 passed 全绿。

## 打包（NSIS）

- `npm run build:desktop`（exit 0）→ `npm run release:desktop`（exit 0；默认 `desktop/release`，1.3.5）。
- 产物（migrate-v127.zip 按 v1.3.x 规则剔除；SHA256SUMS-desktop 同步删行）：
  - setup exe **117,349,792 B** sha256 `dc929c05523e3f8a8c8467b7900e57a1cf93b3f21091a839d67e4841a2d8f23c`
  - blockmap **122,361 B** sha256 `911203fe18e7ac7e3881050231cf85e5dd057afe634ae669c3b022c5e42d0b87`
  - latest.yml **638 B** sha256 `b81add631173047814c0fc3b9ff53b362701b26b25431ed8ca626d4034448663`
- 隔离 zip：`scripts/release/build.mjs` exit 0（构建提交 `d0895ba`）：`kline-trainer-v1.3.5-windows-x64.zip` **55,718,155 B** sha256 `7a42cb1dceff6f3a5b161fb973df7dcb77db02f448a64eb36662a7a3f051a9df`＋`SHA256SUMS`。
- electron-builder：app-update.yml 入包、latest.yml version/sha512/size 与 setup exe 字节核验通过。

## 国内镜像（CloudBase）

- sync-feed：`dist-cn-feed/` 6 文件（latest.yml、manifest.json、setup exe、blockmap、zip、SHA256SUMS）自校验通过。
- 上传（CloudBase MCP，逐文件/小批 4 批）：auth READY、env `k-line-trainer-d9gbbg6il6bf8c320`；setup exe **OK 27.9s**、zip **OK 16.0s**、blockmap OK 0.9s、latest 类 OK 0.7s（latest 类最后）。
- HTTP 验证（2026-11-09）：
  - `GET /feed/latest.yml` → version **1.3.5**、setup size **117,349,792**；
  - `GET /feed/manifest.json` → tag_name **v1.3.5**；
  - `HEAD /feed/kline-trainer-desktop-setup-v1.3.5-windows-x64.exe` → **200**，content-length **117,349,792**；
  - `HEAD /feed/kline-trainer-v1.3.5-windows-x64.zip` → **200**，content-length **55,718,155**。

## 用户交付

- 从 v1.3.4「设置 → 关于与更新」检查更新到 **v1.3.5**（镜像 latest.yml 指向本版）。
- 验收重点：Shift 两次点击 K 线形成 Select Box；数据窗口起止收盘/涨跌幅/价差/K线数/区间高低/振幅/量额/涨跌根数；拖动左右边界实时更新；Esc/滚轮/切周期取消；镜像与回放。
- GitHub Release 待用户验收后补发。
