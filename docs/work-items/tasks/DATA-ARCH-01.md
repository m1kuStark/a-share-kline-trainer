# DATA-ARCH-01 训练数据目录分离：录像自动归档＋语义化文件名

```json
{
  "id": "DATA-ARCH-01", "title": "训练数据独立目录下录像自动归档＋语义化文件名（结束即落盘，摆脱手动导出）", "owner": "feature-dev",
  "state": "review", "milestone": "PACK",
  "summary": "已实现：训练结束（结算/自然到期/放弃）且保留录像时自动归档到 <dataDir>/recordings/，文件名 <股票名>-<训练模式>-<训练周期>-<yyyymmdd>-收益±x.xx%.trainer-session.json.gz（未结算＝「未结算」，同名 -2/-3 序号）。Electron 经 preload desktopRecordings→main IPC 原子写（临时文件＋rename、裸文件名防穿越、结构化错误）；纯 Web 降级控制台提示不打扰；归档失败不阻塞结算。server 新增只读 GET /api/settings/recordings-dir。RED→GREEN：命名纯函数 21 测＋桌面 IPC 6 测（注入 fs）＋e2e 浏览器降级 1 例；定向回归 134+412、test:desktop 121、build 全绿。",
  "next_action": "待协调者追认两处 allowed_paths 字面外配套（desktop/src/archive-recording.ts 新文件、desktop-updates.test.ts 契约修订）；待用户真机（Electron）验收归档落盘与文件名呈现；命名 proposed_default 细节见验证记录待拍板清单。",
  "allowed_paths": ["web/src/recording/**", "web/src/views/Training.vue", "web/src/api.ts", "desktop/src/preload.cts", "desktop/src/main.ts", "server/src/api.ts", "server/test/archive-naming*.test.ts", "desktop/test/archive-ipc*.test.ts", "e2e/archive-recording.spec.ts", "e2e/README.md", "docs/work-items/tasks/DATA-ARCH-01.md", "docs/verification/2026-10/DATA-ARCH-01/**", "docs/status.md"],
  "depends_on": [],
  "docs_impact": { "update": ["e2e/README.md"], "reason": "新增 e2e 套件登记一行；对外行为新增自动归档与只读端点，验证记录承载细节。" },
  "verification_refs": ["docs/verification/2026-10/DATA-ARCH-01/README.md"], "integration_ref": null, "acceptance_ref": null
}
```

## 需求（oracle，2026-10-11 用户原话）

「需要对 K 线训练器的软件安装包目录做优化设计，将 K 线训练器主程序和用户训练积累的训练数据分隔开……训练数据文件命名不能再使用原来那种无意义字符串的形式，而要结合用户对应的训练数据，包括股票名称、训练模式、训练周期、起始时间、结算收益这几个信息……训练默认保存并导出录像文件到指定目录中，不要再像 v1.2.7 版本那样如果不手动导出就找不到文件」

## 实现落点

- `web/src/recording/archiveNaming.ts`（新，纯函数）：命名规则全案——段清洗（非法字符/截断/结尾点）、模式标签（经典/随机股票/随机时间/全随机，维度取自录像内运行中元信息）、周期标签（tier 缩写 / 自定义 / N根 / 随机月份窗±7 天容差判档）、收益段、`describeRecordingForArchive`（末检查点元信息＋实时快照覆盖）与 `resolveArchiveConflict`（序号规则纯函数）。
- `web/src/recording/archive.ts`（新）：`window.desktopRecordings` 桥探测＋`archiveRecordingFile`（降级提示/结构化错误，绝不抛出）。
- `web/src/recording/useRecording.ts`：新增只读 `retainedRecording()`（其余零改动）。
- `web/src/views/Training.vue`：`archiveFinishedRecording()`＋三个出口接线（confirmEnd/backToLauncher/finishSessionAndOpenHistory）；已定案会话（历史复用视图）不重复归档。
- `desktop/src/preload.cts`：第二个窄桥 `desktopRecordings.archiveRecording(fileName, bytes)`。
- `desktop/src/main.ts`：仅新增段——`archiveDataDir` 捕获（bootServerAndOpen 内 config 解析后）＋`registerArchiveIpc` 注册；不触碰更新绑定段。
- `desktop/src/archive-recording.ts`（新）：IPC 实现（注入 fs；原子写、冲突序号、载荷上限 26MiB、裸文件名校验、错误结构化）。
- `server/src/api.ts`：只读 `GET /api/settings/recordings-dir`。
- 测试：`server/test/archive-naming.test.ts`（21）、`server/test/archive-naming-dir.test.ts`（1）、`desktop/test/archive-ipc.test.ts`（6）、`e2e/archive-recording.spec.ts`（1，浏览器降级＋手动导出零回归）。

## 边界与登记

- 数据目录与主程序目录的分离由既有 data-home/PACK-03 体系承担；本任务补齐其下的 recordings/ 子目录、自动落盘与用户可读命名。
- IndexedDB 主存、单条导出、批量导出/导入、迁移工具零改动（归档为并行新增层）。
- allowed_paths 字面外配套两处（新文件 desktop/src/archive-recording.ts；desktop-updates.test.ts 的 IPC-MINIMAL 契约改为枚举白名单），理由与追认请求见验证记录。
