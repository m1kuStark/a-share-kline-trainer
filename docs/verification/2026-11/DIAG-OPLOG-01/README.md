# DIAG-OPLOG-01 验证记录（2026-11-08）

任务：本地操作日志（验收/问题定位埋点）；范围与边界见 [任务卡](../../../work-items/tasks/DIAG-OPLOG-01.md) 与 [规格](../../../specs/diagnostics/operation-log.md)。
被测提交：`9123f31`（v1.3.4 功能提交 `100f5c8`＋关停 flush `5a372ab`＋录制回放断言适配 `9123f31`）。

## 实现

- 服务端 `server/src/diagnostics/operation-log.ts`：JSONL 写入 `<dataDir>/logs/operations.log`；脱敏（token/secret/password/authorization/cookie/note/remark/comment/content 键、Windows 绝对路径保留末段名称、长度/深度/数组上限）；滚动 2 MiB×4；写失败降级告警不抛出；`flush()` 供关停。
- `server/src/diagnostics/api.ts`：`POST /api/diagnostics/events`（≤50/次、非法 400 零写）、`GET /api/diagnostics/info|tail`；`onResponse` 记录 /api/** 业务调用（方法/路由/状态/耗时/脱敏 query+body，跳过 diagnostics 自身与 health）。
- Web `web/src/operationTrace.ts`：点击标签（data-op > aria-label > 可见文本 > title，截断 40）、window.error、unhandledrejection、app.ready/page.hide；2s/20 条批量 POST，失败静默丢弃；不采输入文本。
- 桌面：诊断文本含操作日志路径；`desktop-diagnostics:invoke` 新增 `openLogDir`（shell.openPath），preload 暴露 `desktopDiagnostics.openLogDir`；设置页「打开操作日志目录」（旧桥 fail-closed 隐藏）＋本机不联网说明。
- 文档/版本：`docs/specs/diagnostics/operation-log.md`、`docs/user/diagnostics.md`、SECURITY.md 本地诊断声明、README/CHANGELOG、版本 1.3.4。

## 定向门禁

| 检查 | 结果 |
|---|---|
| `npx vitest run server/test/diagnostics-operation-log.test.ts server/test/diagnostics-operation-trace.test.ts` | **0**：10/10 通过（含脱敏/真实文件/降级/事件 API/中间件/桌面源契约/点击标签/队列） |
| `npx vitest run desktop/test/diagnostics.test.ts` | **0**：12/12 通过（诊断文本顺序/操作日志路径/openLogDir IPC） |
| `npm run journey -- e2e/operation-trace.spec.ts --retries=0` | **0**：1/1 通过（真实点击/页面错误/API → tail） |
| `check-binding --matrix diagnostics-oplog.yaml --strict --include-untracked` | **covered=8 open=0 RED=0** |
| `npx tsc -p server/tsconfig.json --noEmit`／`npm run typecheck:web`／`npm run build:desktop:main` | 全部 **0** |
| `npm run build` | **0** |

## 全量门禁（verify:baseline）

**通过（2026-11-08）**：run `run-63201f7a-f100-41c7-a313-a63ef578ab75`，被测提交 `9123f31`，`passed=true`、`cleanBefore/cleanAfter=true`；journey **236 passed / 1 skipped / 0 failed（32.3m）**；总耗时 **38.8min**；docs/unit/types/build/snapshot/m2 全 0。

## 失败与修复

1. 首次全量：`local-request-guard` teardown `ENOTEMPTY .../logs`——操作日志异步写在测试清理后重建目录；修复：`OperationLog.flush()`＋`startTrainerServer.shutdown()` 关停前 flush。复跑该测试 6/6。
2. 第二次全量：`recording.spec.ts`/`recording-daily.spec.ts` 的「回放零写入」断言把诊断事件 POST 当成训练写入 → 两处过滤 `/api/diagnostics/events`（仅排除诊断，训练写断言保留）。隔离复跑 6/6。
3. e2e operation-trace 首次失败：断言 app.ready 早于 2s flush 周期 → 改 poll 等待（真实语义不变）。

## 边界

- 日志仅本机、不自动上传；队列 best-effort，退出瞬间可能丢尾；不采集输入文本/键盘字符/交易备注；日志不属于训练数据，不参与备份/更新包。
