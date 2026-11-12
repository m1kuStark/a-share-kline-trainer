# REL-137 v1.3.7 集成与人工验收包（2026-11-12）

任务：[REL-137](../../../work-items/tasks/REL-137.md)；阶段：[V137](../../../work-items/milestones/V137.md)。
范围：CHART-LAYOUT-01、UI-TOOLBAR-03、CHART-MEASURE-04 三项合入后的 v1.3.7 集成、全量门禁与 NSIS 安装包。

## 结论

待填：三项合入、全量门禁、打包与用户人工验收边界。

## 合入提交

| 任务 | 功能提交 | 合并提交 | 说明 |
|---|---|---|---|
| CHART-LAYOUT-01 | c8dbeb5 | 8eec4cf | 图表铺满可用高度 |
| UI-TOOLBAR-03 | 48a1495 + 413bd52(合并 main) | 599f40d | 面板固定/调宽高 |
| CHART-MEASURE-04 | 5e987c9 + 审查整改 a58964d | ab04972 | 测量工具（顶栏入口＋拖动/两次点击） |
| REL-137 | 本提交 | 待合并 | 版本/CHANGELOG/门禁/打包（base main 599f40d） |

## 全量门禁（2026-11-12）

| 检查 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| unit+desktop | `npm test` | 1（1 例环境 flake）→ 隔离复跑 0 | server 178 files / 2619 tests + desktop 34/369；唯一失败 `server/test/api.test.ts::lifecycle exit protocol …` 报 `fetch failed/bad port`（与 journey 分片并发抢占端口所致）；隔离复跑 `npx vitest run server/test/api.test.ts` **22/22 exit 0**（环境 flake，保留首次失败） |
| docs | `npm run docs:check` | 0 | 0 errors / 166 warnings（均为既有长度建议） |
| docs status | `npm run docs:status -- --check` | 0 | 生成区与卡片/统一状态一致 |
| docs impact | `npm run docs:impact -- --base 599f40d --task REL-137` | 0 | 18 变更路径（含集成测试同步），0 errors |
| desktop build | `npm run build:desktop` | 0 | 含 vue-tsc/TS/vite/desktop main/package-desktop |
| 浏览器 journey（全量 2 分片） | `npm run journey:parallel -- --shards 2` | 见下节 | 首轮 2 分片均 fail（4 例归因见下），修复后复跑 |

### 首轮全量 journey 失败归因（保留，未豁免）

首轮 `journey:parallel --shards 2`（run-4389bbbe / run-9c60aa1a，各约 16.5m，两分片 exit 1）共 4 例失败：

| 失败 | 归因 | 处置 |
|---|---|---|
| journey.spec.ts「Act1 创建训练并进入训练视图」 | CHART-MEASURE-04 在 journey 探针 `mode()` 新增 `measure` 字段，旧用例整对象 deep-equal 过时 | 期望补 `measure:false`（探针同步，非产品行为） |
| m3-tools.spec.ts「M3 工具清单与默认吸附」 | UI-TOOLBAR-02 起「其他工具」默认展开，旧用例无条件点 `.other-tools-toggle` 反而收起 → 工具不可见；属 UI-TOOLBAR-02 合入后首次全量 journey 暴露的既有 spec 债 | 改为「仅收起时才点开」（与同套件既有条件式写法一致） |
| kdj-indicator.spec.ts「KDJ pane participates …」 | UI-TOOLBAR-01/02 悬浮工具面板默认左下停靠，盖住 KDJ 窗格左下取点区域（原坐标 .25/.45 落在浮层上） | 取点改到窗格右侧（.62/.85），框选/双击同步避开浮层；不改产品 |
| recording-long.spec.ts | 满载/并发下既有环境 flake（REL-136 已有同例记录） | 隔离复跑通过 |

### 集成测试同步（test-only，无产品行为变更）

- `e2e/journey.spec.ts`：Act1 的 `mode()` 整对象期望补 `measure:false`；Act4d 多选框选起手点从图表左下移到右侧，避开默认左下浮层。
- `e2e/m3-tools.spec.ts`：「其他工具」改为条件展开（默认已展开）。
- `e2e/kdj-indicator.spec.ts`：KDJ 窗格框选/双击/画线取点移到右侧避开浮层；隐藏浮层会取消画线工具，故不采用隐藏。
- 上述同步属 UI-TOOLBAR-01/02 与 CHART-MEASURE-04 探针已验收行为的 spec 适配（E2E-SPEC-SYNC 先例），未删除断言、未放宽产品判定。

### 全量 journey 最终结果（修复后复跑）

| 分片 | run | 结果 |
|---|---|---|
| shard 1/2 | `run-ca8f01c6-da90-49ad-8c38-e0b140c4b195` | **128 passed / 0 failed / 1 skipped**（设计内跳过） |
| shard 2/2 | `run-c1928131-efb4-4fff-beb0-a29e5cd5f135` | **124 passed / 1 failed**（唯一失败＝recording-long 已知满载环境 flake，保留首轮失败） |
| 隔离复跑 | `run-a49f1d97-f3aa-43af-a27d-83948065499b` | `npm run journey -- e2e/recording-long.spec.ts --retries=0` **exit 0**（已知 flake 隔离通过） |
| 修复后定向复核 | `run-1d0337a2-5fd7-4928-8c54-b20db888aa21` | `e2e/journey.spec.ts e2e/kdj-indicator.spec.ts` **exit 0** |

按 TEST-SPEED-01：全量中仅既有环境 flaky 失败保留并隔离复跑，未用重跑覆盖首轮失败；新失败均已按要求修复。两分片合计 **252 passed / 1 failed / 1 skipped**。

## 主代理视觉检查（UI-VISUAL-ACCEPTANCE，2026-11-12）

真实页面（隔离生产预览 run `run-cd7152c4-2895-42fa-b82c-68dd4511361a`，600519/2Y/2024-09-13）逐项检查，截图见 `screenshots/`：

| 截图 | 检查项 | 结论 |
|---|---|---|
| 01-layout-1366-dark / 05-layout-light | 图表铺满、底部无空白、主图/副图/时间轴填满面板 | 通过 |
| 02-toolbar-pinned-resized-dark | 固定态 pin 图标高亮、面板锁定、尺寸手柄可见、调整后宽高生效 | 通过 |
| 03-measure-window-dark / 04-measure-window-light | 「测量」入口高亮、测量模式状态提示、拖动建立 Select Box、数据窗口字段完整、深浅主题可读 | 通过 |
| 06-layout-1024-dark | 1024×680 下图表仍铺满、无页面滚动/横向溢出、顶栏按钮可达 | 通过 |

- pageerror：0；无横向溢出；深浅主题均未发现遮挡价格轴关键区域（浮动面板为用户可拖动浮层，默认左下停靠）。
- 该检查是工程预检，不替代用户 A3 人工验收。

## 用户人工验收（A3 节点）

- 交付包：待填本地路径。
- 验收清单：见任务卡与交付消息；通过后才执行 GitHub Release/tag、更新 feed 与国内镜像（本轮未做）。
- 反馈处理：待填。

## 环境与边界

- Windows / Node 24 / Edge；`TDX_ROOT=D:\MySoftWares\TDX`；独立 run 的端口/SQLite/构建；未使用个人训练库。
- 版本 1.3.7 仅本地候选：未 push tag、未发 GitHub Release、未移动更新 feed/上传镜像。
## 2026-11-13 用户验收与回退（追加）

- 用户人工验收：图表铺满、悬浮面板固定/调宽高**通过**；顶栏测量入口与既有 Shift 测量重复，要求移除（用户 2026-11-13 原话见 [V137 用户验收记录](../V137-user-acceptance/README.md)）。
- 回退任务：[CHART-MEASURE-05](../../../work-items/tasks/CHART-MEASURE-05.md)（仅移除入口/模式，保留 Shift 两点测量）；版本进入 1.3.8。
- **未发布**：安装包仅本地交付验收；未打 tag、未发 GitHub Release、未移动更新 feed、未上传镜像。
