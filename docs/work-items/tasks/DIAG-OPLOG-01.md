# DIAG-OPLOG-01 本地操作日志（验收/问题定位）

```json
{
  "id": "DIAG-OPLOG-01",
  "title": "本地操作日志：Web 埋点/业务 API 自动记录/脱敏滚动/诊断页打开与复制",
  "owner": "integrator",
  "state": "active",
  "milestone": "V134",
  "base_commit": "1a9fcb5",
  "summary": "用户 2026-11-08 要求 v1.3.4 验收前增加埋点，获取验收操作行为以确认/定位 bug，未来用户也可用。实现本地 JSONL 操作日志（<dataDir>/logs/operations.log，滚动 4×2MiB）：Web 点击/错误/生命周期、业务 API 调用（状态/耗时/脱敏数据）、服务端启动事件；设置页诊断区显示本机不联网说明、复制诊断、打开日志目录；桌面诊断文本加入日志路径。不做联网上报。",
  "next_action": "工程门禁+全量 verify:baseline 绿后，随 v1.3.4 打包发布到 CloudBase 镜像供用户从 v1.3.3 更新验收。",
  "allowed_paths": [
    "server/src/diagnostics/**",
    "server/src/index.ts",
    "server/test/diagnostics-operation-log.test.ts",
    "server/test/diagnostics-operation-trace.test.ts",
    "web/src/operationTrace.ts",
    "web/src/main.ts",
    "web/src/diagnosticsFlow.ts",
    "web/src/components/TrainingSettings.vue",
    "desktop/src/diagnostics.ts",
    "desktop/src/main.ts",
    "desktop/src/preload.cts",
    "desktop/test/diagnostics.test.ts",
    "e2e/operation-trace.spec.ts",
    "docs/specs/diagnostics/operation-log.md",
    "docs/user/README.md",
    "docs/user/diagnostics.md",
    "docs/engineering/testing.md",
    "SECURITY.md",
    "README.md",
    "CHANGELOG.md",
    "package.json",
    "package-lock.json",
    "docs/work-items/tasks/DIAG-OPLOG-01.md",
    "docs/work-items/milestones/V134.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/DIAG-OPLOG-01/**",
    "docs/verification/2026-11/REL-134/**"
  ],
  "depends_on": ["REVIEW-FIX-01"],
  "docs_impact": {
    "update": [
      "docs/specs/diagnostics/operation-log.md",
      "docs/user/README.md",
      "docs/user/diagnostics.md",
      "SECURITY.md",
      "README.md",
      "CHANGELOG.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/V134.md",
      "docs/status.md"
    ],
    "reason": "新增本地操作日志行为与隐私边界，需同步用户文档、安全声明与任务卡；发布 v1.3.4。"
  },
  "verification_refs": ["docs/verification/2026-11/DIAG-OPLOG-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 范围与边界

- 服务端：`server/src/diagnostics/operation-log.ts`（脱敏/滚动/串行写）＋`api.ts`（事件端点/info/tail/onResponse 业务记录）。
- Web：`web/src/operationTrace.ts`（点击标签/错误/生命周期批量上报，2s/20 条；不采输入文本）＋`main.ts` 安装。
- 桌面：诊断文本加操作日志路径；IPC 增加 `openLogDir`；preload 暴露 `desktopDiagnostics.openLogDir`。
- 设置页：本机不联网说明＋打开日志目录按钮（旧桥 fail-closed 隐藏）。
- 不做远程上传、不做逐帧录制、不记录键盘字符。

## 验证

- `server/test/diagnostics-operation-log.test.ts`（脱敏/真实文件/降级/API/中间件）、`server/test/diagnostics-operation-trace.test.ts`（Web 纯逻辑）、`e2e/operation-trace.spec.ts`（真实点击/错误/API→日志 tail）。
- 矩阵 `diagnostics-oplog.yaml`；全量 `verify:baseline`；v1.3.4 打包与 CloudBase 镜像发布记录在 REL-134。
