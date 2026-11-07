# 本地操作日志（DIAG-OPLOG-01）

> 用户 2026-11-08 拍板：v1.3.4 验收需要采集真实操作行为以确认/定位 bug；未来用户反馈问题也能取得操作信息。
> 边界：**只在本机保存，不联网上传**；不采集输入框文本、交易备注等内容字段；可手动删除/导出。

## 目标

1. 将页面点击（目标标签）、前端错误、生命周期、业务 API 调用与桌面主进程关键事件写入
   `<dataDir>/logs/operations.log`（JSONL，按大小滚动，保留 4 份）。
2. 用户/维护者能在设置页看到日志位置、打开日志目录、复制诊断信息（含日志路径与尾部）。
3. 日志脱敏：键名含 token/secret/password/authorization/cookie/note/remark/comment/content 的值、
   Windows 绝对路径（保留末段名称）一律替换；字符串/数组/对象深度有上限。
4. 写入失败只降级告警，绝不阻断业务或启动；日志文件不进入更新/备份包。

## 行为（EARS）

- WHEN 应用启动 THE SYSTEM SHALL 写入一条 `lifecycle:app.ready`（Web）与 `lifecycle:server.started`（服务端），包含版本/端口但不含个人路径。
- WHEN 用户点击按钮/标签/菜单项 THE SYSTEM SHALL 记录 `ui:click`，data.label 取 data-op > aria-label > 可见文本 > title，截断 40 字符；无标签不记录。
- WHEN 页面出现未捕获异常或未处理 Promise 拒绝 THE SYSTEM SHALL 记录 `error:window.error` / `error:unhandledrejection`，message 截断 300 字符。
- WHEN 任意业务 API 完成 THE SYSTEM SHALL 记录 `api:<METHOD> <route>`，含状态码与耗时；请求 query/body 经脱敏并限长，GET 查询参数不记录凭证。
- IF 日志目录不可写/磁盘失败 THE SYSTEM SHALL 仅在控制台/主日志告警并继续业务，API 仍正常响应。
- WHEN 用户打开设置页诊断区 THE SYSTEM SHALL 显示「操作日志（本机，不联网）」说明、复制诊断信息按钮、桌面版「打开操作日志目录」按钮；纯浏览器形态隐藏打开目录按钮。
- WHEN 诊断信息被复制 THE SYSTEM SHALL 包含操作日志路径与主日志尾部（版本/平台/数据目录/更新通道/最近错误）。
- THE SYSTEM SHALL NOT 自动将操作日志发送到任何网络端点；更新检查/软件更新请求不携带日志内容。

## 隐私与保留

- 本机路径最后一段保留用于定位（如 `<path:vipdoc>`），完整路径不入日志。
- 训练/交易内容字段（note/remark/comment/content）一律 redacted；输入框文本不采集。
- 每份最大 2 MiB，current + 3 个旧档；用户可在日志目录手动删除，删除后自动重建。
- 设置页提供「打开操作日志目录」；纯浏览器用户可通过 `GET /api/diagnostics/info` 显示的路径自行访问（本机应用）。

## 接口

- `POST /api/diagnostics/events`：`{clientId?, sessionId?, events:[{type:'ui'|'error'|'lifecycle'|'desktop'|'api', action, data?}]}`；≤50 事件/次，非法载荷 400 零写。
- `GET /api/diagnostics/info`：`{enabled, version, format:'jsonl', logPath, logDir, mainLogPath, tailMax, retention}`。
- `GET /api/diagnostics/tail?limit=1..200`：最近行（已脱敏 JSONL 文本）。
- 桌面 IPC `desktop-diagnostics:invoke` 扩展 `method='openLogDir'`；preload 暴露 `desktopDiagnostics.openLogDir()`。

## 已知边界

- 不采集拖拽轨迹、滚轮增量、键盘输入字符；图表缩放的 API 调用与工具切换可推断，但不做逐帧录制。
- 日志为 best-effort；退出瞬间的队列可能丢失（flush 用 keepalive 尽力发送）。
- 用户关闭/清空日志目录不属于数据破坏（不参与任何训练数据校验）。
