# DATA-ARCH-01 训练数据目录分离：录像自动归档＋语义化文件名：验证记录

- 日期：2026-10-11（worktree `D:\tmp\arc` 分支 `data-archive`，基于 main=263d224）
- 任务卡：[DATA-ARCH-01](../../../work-items/tasks/DATA-ARCH-01.md)
- 需求来源（oracle）：用户 2026-10-11——训练数据与主程序目录分隔；训练数据文件名结合股票名称、训练模式、训练周期、起始时间、结算收益；训练默认保存并自动导出录像到指定目录，不再依赖手动导出。

## 设计摘要（全案见任务卡与收尾报告）

1. **归档目录**：`<dataDir>/recordings/`（dataDir＝data-home 生效目录＝SQLite 训练库所在目录；与主程序目录已分离）。不新增用户配置项。
2. **自动归档触发**：训练结束（结算/自然到期/放弃）且保留录像时，训练页结束钩子把本场录像按既有导出格式（gzip CompactRecordingFile，`writeRecordingFile(file, true)` 同载荷）写入归档目录。出口覆盖：确认弹窗（confirmEnd）、结算面板「完成，返回首页」「查看历史成绩单」、结束后顶栏「返回首页」（均走 backToLauncher/finishSessionAndOpenHistory）。
3. **文件命名**（`web/src/recording/archiveNaming.ts` 纯函数）：`<股票名>-<训练模式>-<训练周期>-<yyyymmdd>-<收益段>.trainer-session.json.gz`；同名冲突 `-2/-3…`（写入端探测）；非法字符→下划线、股票名 20 字符截断、结尾点/空白清除；未结算（放弃/中断/收益不可得）＝`未结算`。
4. **降级策略**：Electron（preload `desktopRecordings.archiveRecording` → main IPC `desktop-archive-recording:invoke` → `desktop/src/archive-recording.ts` 原子写：mkdir＋临时文件 wx＋rename，路径为 `<dataDir>/recordings`，裸文件名校验防穿越，错误结构化返回）；纯 Web/dev 无 `window.desktopRecordings` → 控制台提示＋既有行为，不弹窗。归档失败不阻塞结算（提示＋录像仍在 IndexedDB 可手动导出）。
5. **目录暴露（只读）**：`GET /api/settings/recordings-dir` 返回 `join(dirname(databasePath), 'recordings')`；查询不创建目录。本任务无前端消费方（Electron 归档路径由 IPC 结果直接返回），供设置页/后续提示使用。

## RED（实现前，按预期失败）

| 命令 | 退出码 | 失败点 |
| --- | --- | --- |
| `npx vitest run --config server/vitest.config.ts server/test/archive-naming.test.ts` | 1 | `Cannot find module '../../web/src/recording/archiveNaming'` |
| `npx vitest run --config server/vitest.config.ts server/test/archive-naming-dir.test.ts` | 1 | `GET /api/settings/recordings-dir` → 404 |
| `npx vitest run --config desktop/vitest.config.ts desktop/test/archive-ipc.test.ts` | 1 | `Cannot find module '../src/archive-recording.js'` |
| `TDX_ROOT=D:/MySoftWares/TDX npm run journey -- e2e/archive-recording.spec.ts` | 1 | 结算/导出/返回首页全过，仅缺降级控制台提示断言：`expected degrade console info`（run-0dd72bf9） |

## GREEN 与回归

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npx vitest run --config server/vitest.config.ts server/test/archive-naming.test.ts server/test/archive-naming-dir.test.ts` | 0 | 2 files, 21 passed |
| `npx vitest run --config desktop/vitest.config.ts desktop/test/archive-ipc.test.ts` | 0 | 1 file, 6 passed |
| `TDX_ROOT=D:/MySoftWares/TDX npm run journey -- e2e/archive-recording.spec.ts` | 0 | 1 passed（run-e9c8978e：降级提示断言过＋手动导出 gzip magic 过） |
| `npx vitest run`（定向 9 文件：recording-file/library/core/storage＋frontend-contract＋frontend-data-status-contract＋tool-favorites＋training-rules-frontend＋settings-data-dir） | 0 | 9 files, 134 passed |
| `npx vitest run`（定向 24 文件：api.test＋全部 recording-*.test.ts） | 0 | 24 files, 412 passed |
| `npm run test:desktop` | 0 | 13 files, 121 passed（含修订后的 UPD-DESKTOP-IPC-MINIMAL 契约，见下） |
| `npm run build:server` | 0 | tsc 全过 |
| `npm run typecheck:web` | 0 | vue-tsc 全过 |
| `npm run build` | 0 | typecheck＋server＋web 全过 |
| `npm run build:desktop:main` | 0 | main.ts/preload.cts 编译过 |
| `TDX_ROOT=D:/MySoftWares/TDX npm run journey -- e2e/archive-recording.spec.ts e2e/recording.spec.ts`（最终代码复跑） | 1 | archive 1/1 过＋recording 3/4 过；唯一失败＝recording.spec.ts:57「默认录制…离线只读回放」回放画线恢复断言（run-fc18171f，重试亦败） |

### recording.spec.ts:57 失败归属（基线二分实证，非本任务回归）

- 同机同日干净基线复跑（`git stash -u` 后 HEAD=263d224，`--retries=0`）：recording.spec 3 passed、**同一用例 recording.spec.ts:57 以同一断言失败**（`expect.poll(drawings().length).toBeGreaterThan(0)` 收到 0；run-f14cf81d）→ 存量失败，恢复 stash 后工作区已还原。
- 该用例失败模式与 E2E-BASELINE-01 登记的「画线恢复等问题」一致（GITHUB-HEALTH-01 全量 journey 29 项存量失败清单内）。

## 既有契约修订（任务驱动的显式修订，非静默）

- `desktop/test/desktop-updates.test.ts` 的 UPD-DESKTOP-IPC-MINIMAL 原断言 preload 仅一个 `exposeInMainWorld`。DATA-ARCH-01 新增第二个窄对象 `desktopRecordings`（单一方法）后按枚举式白名单修订：桥面仅允许 `desktopUpdates`＋`desktopRecordings`，desktopUpdates 四成员不变。窄面精神（无未登记桥面）保留。**该修订与新增 `desktop/src/archive-recording.ts` 均超出 allowed_paths 字面范围，属「执行要求②desktop/test 注入 fs」的必要配套，待协调者追认。**

## 已知边界（登记，不静默）

- 随机月份窗口的周期段用起止跨度±7 天容差判定档位；250 根默认窗（≈12.1 个月）会标成 `1Y`（信息粒度而非错误）。见收尾报告待拍板项。
- 自然到期后「留在当前界面」再经 rail「历史/录像/排行」离开（prepareForLibrary 路径）不触发自动归档；主出口（结算面板两按钮＋顶栏返回首页）均覆盖。登记为相邻问题。
- 结束时若录制处于暂停且无末检查点，命名元信息以训练页实时快照覆盖兜底（已实现）；随机维度若整场未落盘则按经典命名。
- e2e 存量失败 recording.spec.ts:57（回放画线恢复）在基线与本任务分支上同样失败，非本任务引入（见上节二分实证）。
