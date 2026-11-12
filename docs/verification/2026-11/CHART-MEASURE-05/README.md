# CHART-MEASURE-05 验证记录（2026-11-13）

任务：移除顶栏「测量」入口与测量模式，保留既有 Shift 两点测量（用户 2026-11-13 验收反馈）；见[任务卡](../../../work-items/tasks/CHART-MEASURE-05.md)与[V137 用户验收记录](../V137-user-acceptance/README.md)。

## 结论

已按反馈回退 CHART-MEASURE-04 的顶栏入口与测量模式；既有 Shift+左键两次点击的区间测量、数据窗口、可拖边界、镜像真实价与只读回放零回归；其余 v1.3.7 已验收内容（图表铺满、面板固定/调宽高）不变。版本 1.3.8，未发布。

## 回退清单

| 文件 | 处置 |
|---|---|
| web/src/views/Training.vue | 删除「测量」按钮、measureMode/Ruler 导入与模式互斥 watch |
| web/src/components/KlineChart.vue | 删除 measureMode prop/emit、拖动/两击模式手势、预览层、journey 探针 measure/measurementTool 字段；保留 Shift 区间测量 |
| web/src/components/RangeMeasurement.vue | 回退 measureMode prop/脚注分支 |
| web/src/styles.css | 删除测量模式提示/预览样式 |
| e2e/measure-tool.spec.ts | 删除（随入口移除）；新增 chart-analysis 回归「顶栏不再提供测量入口：Shift 两次点击仍是唯一区间测量方式」 |
| e2e/journey.spec.ts | Act1 mode() 期望恢复三字段 |
| e2e/README.md / docs/specs/chart/interaction.md / docs/user/chart-analysis.md / web/src/components/README.md | 删除新入口说明 |
| CHANGELOG/README/package*.json | 版本 1.3.8 + 1.3.8 更新记录（未发布） |

## RED 说明（诚实边界）

本任务为**回退型**改动：回退前 v1.3.7 验收候选包内顶栏「测量」按钮确实存在（反例见 docs/verification/2026-11/REL-137/screenshots/03-measure-window-dark.png）。新增回归用例 `顶栏不再提供测量入口：Shift 两次点击仍是唯一区间测量方式` 若在回退前运行必然失败；本轮未单独保留该 RED run（回退与测试同轮提交），以 v1.3.7 已验收候选反例 + 回退后 GREEN 收据为准，未用截断/跳过的历史掩盖。

## 门禁（2026-11-13，真实命令与退出码）

| 检查 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| build | `npm run build` | 0 | web/server 生产构建含 vue-tsc |
| unit+desktop | `npm test` | 1（2 例环境前置） | 2617 passed / 2 failed：`server/test/release-launcher.test.ts` PORT-01 两例因**用户验收用 K线训练器.exe（PID 46252，2026-11-13 00:43 启动）占用 8787** 失败（REL-136 已有同例登记）；隔离复跑该文件同样 2 failed/50 passed，证明与环境一致、与本改动无关。CI verify 在无用户实例的 runner 上运行，PR 结论以 CI 为准 |
| 全量 journey 分片 1/2 | `npm run journey:parallel -- --shards 2` | 0（shard1） | run-8d939a70：**123 passed / 0 failed / 1 skipped**（设计内跳过） |
| 全量 journey 分片 2/2 | 同上 | 1（shard2） | run-dc29525d：**122 passed / 1 failed**（唯一失败＝recording-long 已知满载环境 flake） |
| 已知 flake 隔离复跑 | `npm run journey -- e2e/recording-long.spec.ts --retries=0` | 0 | run-9feb0546（隔离通过，未覆盖首轮失败记录） |
| docs | `npm run docs:check` / `docs:status -- --check` | 0 / 0 | 0 errors；生成区一致 |
| docs impact | `npm run docs:impact -- --base 7687766 --task CHART-MEASURE-05` | 0 | 27 变更路径/9 运行路径，0 errors |
| 视觉检查（主代理） | 真实页面（隔离预览 run-2ad99730） | — | 顶栏「测量」按钮数 **0**；Shift 两次点击仍弹出「两点测量」数据窗口；pageerror 0；截图 01-topbar-no-measure.png / 02-shift-measure-kept.png |

## 视觉检查截图

- `01-topbar-no-measure.png`：1366×705 深色，顶栏仅「划线」，无「测量」。
- `02-shift-measure-kept.png`：同页面 Shift+两次点击主图 K 线后「两点测量」窗口正常显示。

## 边界

- 本版本不发布：未打 tag、未发 GitHub Release、未移动更新 feed、未上传国内镜像（用户 2026-11-13 明确要求暂不发布）。
- CHART-MEASURE-04 卡片/证据保留为 v1.3.7 历史；矩阵 chart-measurement 的 MEASURE-TOOL-* 三行由 `MEASURE-ENTRY-REMOVED` 取代（Lead 单写区）。
