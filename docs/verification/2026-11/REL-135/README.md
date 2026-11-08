# REL-135 v1.3.5 发布记录（2026-11-09）

任务：CHART-MEASURE-02 两点测量改为 K 线区间统计；里程碑 V135；分支 `verify-pr7`。
版本：**1.3.5**；功能提交 `3ef59fe`，测试稳定性提交 `fa7d4ff`。

## 工程自验

- 定向：`e2e/chart-analysis.spec.ts` **8/8**；`server/test/chart-statistics.test.ts + frontend-contract` **43/43**；`typecheck:web` 0；矩阵 `chart-measurement` **covered=6 RED=0**。
- 全量：`verify:baseline` 在当日 Windows 满载环境多次出现**既有无关 e2e 随机冻结/超时**；最新轮 234 passed/2 failed（m4-rankings 页面冻结、recording-long 满载首笔未成交），两项隔离复跑 3/3 全绿。详见 [CHART-MEASURE-02](../CHART-MEASURE-02/README.md) 的「全量门禁」记录。v1.3.4 上版全量曾 236 passed 全绿。

## 打包与镜像

待填：NSIS、zip、sync-feed、CloudBase 上传与 HTTP 核验。

## 用户交付

- 从 v1.3.4「设置 → 关于与更新」检查更新到 **v1.3.5**（镜像 latest.yml 指向本版）。
- 验收重点：Shift 两次点击 K 线形成 Select Box；数据窗口起止收盘/涨跌幅/价差/K线数/区间高低/振幅/量额/涨跌根数；拖动左右边界实时更新；Esc/滚轮/切周期取消；镜像与回放。
- GitHub Release 待用户验收后补发。
