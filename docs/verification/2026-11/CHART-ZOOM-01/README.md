# CHART-ZOOM-01 验证记录（2026-11-07）

任务：Ctrl+滚轮缩放＋Shift+←/→ 平移快捷键（Issue #8-D S 半，计划拍板）
基线：`7affecb`（CHART-WEEKDAY-01）｜工作树 `verify-pr7`
证据提交：本记录随 `feat(chart): CHART-ZOOM-01 …` 提交

## 改动摘要

- `web/src/components/KlineChart.vue`：`onWheel` 增加 Ctrl 分支→复用键盘 `zoomBy`（deltaY<0 放大、>0 缩小，右端锚定）；普通滚轮保持平移、价格轴滚轮保持原生纵轴缩放；新增 `panBy(bars)`（按当前柱宽平移整数根，+1＝向右/更新），经既有 `scheduleViewportOperation` 上报录像视窗；**关闭 klinecharts 10.0.3 内置热键**（`init(..., { hotkey: { enabled: false } })`）——库自带 Shift+←/→ 全局 hotkey 会与应用快捷键叠加执行。
- `web/src/keyboardShortcuts.ts` / `server/src/settings/shortcuts.ts`：新增 `panLeft/panRight` 动作（默认 Shift+ArrowLeft/Right、中文标签），设置面板可改键，服务端白名单/持久化同步 15 动作。
- `web/src/views/Training.vue`：快捷键分发映射 panBy；顶部状态条帮助文案显示「Shift←→ 平移」；可按住连发。
- 文档：`docs/specs/chart/display.md`、`docs/specs/chart/interaction.md`、`docs/user/README.md`、`web/src/components/docs/library-adapter.md`（CHART-LIBRARY-PIN 登记内置热键关闭）。
- 矩阵：新增 `chart-gestures.yaml` 5 行（Ctrl+滚轮缩放/普通滚轮平移/键盘平移/设置可配/视窗契约）。

## 门禁收据（最终一轮）

| 命令 | 退出码 / 结果 |
|---|---|
| `npm run build` | **0** |
| `npm test` | **0**：server 174 文件 / 2601 用例；desktop 34 文件 / 367 用例全部通过 |
| `npm run docs:check` / `docs:status -- --check` | **0 errors** |
| `npm run docs:impact -- --base 7affecb --task CHART-ZOOM-01` | **0 errors** |
| `check-binding --matrix chart-gestures.yaml --strict --include-untracked` | **5/5 covered，RED=0，open=0** |
| `npm run journey -- e2e/chart-pan-zoom.spec.ts --retries=0` | **0**：1/1 通过（8.2s，run `run-3e63c05e`） |

## 失败与修复（如实保留）

1. 方向语义探针：直接调用 `scrollByDistance`/键盘初测不稳定，一度把 panBy 符号写反；后经真实页面探针确认 klinecharts「正距离＝视窗左移（看更早）」，panBy 以 +1＝向右/更新 收敛。
2. **关键缺陷**：Shift+←/→ 每按一次实际移动 3 根且方向与应用叠加——根因是 klinecharts 10.0.3 自带全局 hotkey `scrollLeft/scrollRight`（document keydown）与新增应用快捷键重复执行。修复：初始化时 `hotkey: { enabled: false }` 关闭库内置热键（登记 library-adapter），应用快捷键成为唯一权威；修复后真实页面 Shift+← 左移 1 根、Shift+→ 右移 1 根。
3. 首轮 e2e 把 Ctrl+滚轮缩放锚点断言写成 realTo 不漂移（实际右侧留白换算会变）→ 改为可见整数右界 `to` 不漂移（与既有 zoomBy 口径一致）。
4. 全量门禁前几跑出现环境性不稳定：两次进程级崩溃（exit -1073740791，无断言失败，崩溃点均在既有 runtime-isolation 子进程清理；与历史环境性崩溃同型）、两次既有 flaky（review-profile hook 超时 / runtime-isolation 清理确认超时）。隔离复跑均通过；review-profile 的 beforeEach 真实 git/磁盘 I/O 在并行满载时超出 15s hook 预算 → 按既有先例放宽到 45s（断言不变，文件列入 allowed_paths 与 docs_impact reason）。最终全量 2601/2601 + 367/367 通过。

## 视觉检查（主代理）

- 1440 深色：[chart-pan-zoom-1440.png](chart-pan-zoom-1440.png)：缩放后同屏 160 根、右端保持；顶部状态条含「Shift←→ 平移」帮助；X 轴/状态条星期显示正常；右侧账户区无遮挡。
- 1280 深色：[chart-pan-zoom-1280.png](chart-pan-zoom-1280.png)：无横向溢出。
- 无 pageerror；设置面板「训练快捷键」可见向左/向右平移两条动作（e2e 断言）。

## 已知边界

- 普通滚轮方向沿用既有语义（滚轮向下＝向历史）；Ctrl+滚轮以视图右端为锚。
- 关闭 klinecharts 内置键盘热键后，库自带的 Shift+Equal 等缩放键不再生效；应用快捷键系统提供同等/更完整能力。
- 本记录为用户整批验收前的工程证据，不代表用户验收。
