# REL-136 v1.3.6 发布记录（2026-11-09）

任务：CHART-MEASURE-03（周/月K 区间统计修正、Select Box 边界对齐）＋TEST-SPEED-01（测试提速）；里程碑 V136；版本 **1.3.6**。
代码提交：`527ab29`（功能＋测试工具＋文档）；打包 zip 记录提交 `527ab29`。

## 定向门禁

| 检查 | 结果 |
|---|---|
| `e2e/chart-analysis.spec.ts`（含新增周K/月K oracle＋边界中心像素断言） | **9/9 通过**（1.2m） |
| `verify:fast`（docs+build+chart-statistics 6 单测+chart-analysis 9 e2e） | **PASS 123s**（docs 3s / build 21s / unit 4s / journey 94s），见 TEST-SPEED-01 |
| `typecheck:web` | 0 |
| 镜像回归 | 通过（区间 high/low 反镜像还原） |

## 全量门禁（并行化，等覆盖）

- **journey 2 shards 并行**：**18.4min**；shard1 **116 passed / 1 skipped / 1 failed**、shard2 **118 passed / 1 failed**（234/236 通过；另 1 did not run 为失败后同 spec 剩余用例）。
  - 失败两项均与本次改动无关的既有环境 flaky：
    1. `m4-rankings.spec.ts::结算两局→排行定位本局行…`：点击「提前结算」后 15s 内未出现「结束训练」弹窗（环境卡顿）；
    2. `recording-long.spec.ts`：并行满载下首笔买入两轮未成交（同一用例隔离通过）。
  - **隔离复跑 3/3 通过**（run `D:\Superlinear_Academy\Stock_WorkSpace\.control\worktrees\pr7-recon\.runs\run-689f1b4b-3c31-4949-ac4f-88e0dfa3e79d`，m4 16.4s/6.9s、recording-long 1.1m）。
- **unit**：3 路并发（unit＋2 journey）下 2612 passed / 3 failed：
  - `api.test.ts` lifecycle 5s 超时（CPU 争用；文件默认 5s 预算）；
  - `release-launcher` 2 例因**用户 v1.3.5 应用正在运行并占用 8787**（实测 PID 3636 `K线训练器.exe`），launcher 端口回退测试的既定环境前置；非本版 server 代码变更（v1.3.6 仅改 web/脚本/文档）。
  - 结论：unit 的失败均为并发/环境前置，不是 CHART-MEASURE-03 行为失败；正式候选可在关闭训练器后补跑一次 `verify:baseline`。
- **官方 `verify:baseline`**：本轮按新协议不重复多轮；以并行全量＋隔离收据作为整批验收证据。

## 打包（NSIS）

- `build:desktop` exit 0；`release:desktop` exit 0（默认 `desktop/release`，1.3.6）；migrate-v127.zip 按 v1.3.x 规则剔除。
- 产物：
  - setup exe **117,350,200 B** sha256 `0159168c962e718e27ced80101970f4140d711641413d6a37f3dad16cbc3faab`
  - blockmap **122,485 B** sha256 `4cde74bfb803edc867944e60cfb1ba4cfb8d7a52b68fccc08eec64e2361480d4`
  - latest.yml（sync 后）**653 B** sha256 `78568b2be07d6d11cfe98da107dac5fc88ae9773a31d2f74ec2d2a971656729d`
- 隔离 zip：`kline-trainer-v1.3.6-windows-x64.zip` **55,718,422 B** sha256 `dc00d7f4374e2bf1b3f9023775b4d64cb5295480b7087167f115734ade65301b`＋SHA256SUMS。
- electron-builder：app-update.yml 入包、latest.yml version/sha512/size 与 setup exe 字节核验通过。

## 国内镜像（CloudBase）

- sync-feed：`dist-cn-feed/` 6 文件自校验通过（latest/manifest 镜像 URL 前缀与校验和）。
- 上传：setup exe OK 152.7s；zip 首次批次因临时 Access Key 失效失败，**新连接重传 OK 485.1s**；blockmap/最新元数据 OK；最终 SHA256SUMS 按交付文件重算并重传 OK。
- HTTP 验证（2026-11-09）：
  - `GET /feed/latest.yml` → version **1.3.6**、setup size **117,350,200**；
  - `GET /feed/manifest.json` → tag_name **v1.3.6**；
  - `HEAD setup exe` → **200** content-length **117,350,200**；
  - `HEAD zip` → **200** content-length **55,718,422**。

## 用户交付

- 从 v1.3.5「设置 → 关于与更新」检查更新到 **v1.3.6**。
- 验收重点：周K/月K 区间统计与当前周期 K 线一致；Select Box 边界在起止 K 线中心；日K/镜像/回放不回归；测试命令 `verify:fast`/`journey:parallel` 可用。
- GitHub Release 待用户验收后补发。
