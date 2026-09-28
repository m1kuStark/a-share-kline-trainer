# TRAIN-02 第一片：服务端范围预览/创建复核与兼容迁移

2026-09-25，worktree `task/TRAIN-02-integration`（D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/TRAIN-02-integration）。代码提交 e9d7e8c（本报告所在文档提交之前）；全部测试与构建均在该提交树上复跑确认。合同为[冻结派发Prompt](../../../work-items/prompts/TRAIN-02-integration.md)；合成夹具（临时目录 .day 文件 + :memory: SQLite），未读取个人训练库、TDX 真实目录，未改 web/录制/Launcher。

## 交付内容

- 新增 `POST /api/training-ranges/preview`：返回 `{preview:{version:1,code,market,request,requestedStart,requestedEnd,startDate,endDate,barCount,notes,sourceFingerprint,expiresAt,previewId}}`。today 取 Asia/Shanghai 当前完整数据日期（15:00 前回退一日）；单次 `readFile` 派生元信息与 SHA-256 指纹（完整日线+权息事件）；RANGE-01 纯规划器未改动。
- 创建复核：`POST /api/trainings` 新 body `range`+`previewId`（与 `tier` 互斥）；创建时重读同一快照，过期/指纹/请求/复权/股票不匹配均 409 `RANGE_PREVIEW_STALE`，错误体附 `code` 字段（全局错误处理器 additive 扩展）。
- 范围元数据冻结：trainings 兼容增列 9 列（`range_version` 默认 0、`range_mode` 默认 'tier'、requested_start/requested_end/range_start/range_end/range_bar_count/range_source_fingerprint/range_notes），不重建表、不清理旧训练；范围模式训练 tier 列写 `RANGE` 哨兵，`start_date/planned_end` 取复核后的实际起止，查询响应附可选 `range` 对象；旧 tier 创建/查询/推进路径不变。
- 错误码映射：`INVALID_INPUT`→400，`NO_DATA`→404，`BEFORE_HISTORY`/`AFTER_DATA`/`INSUFFICIENT_DATA`/`UNCONFIRMED_COVERAGE`→409，消息复用 RANGE-01 中文原因。本片无节假日日历，knownClosedDates 未注入。

## 事实与偏差

- RED 先行：`server/test/train-range-preview.test.ts` 在实现前运行 15 failed / 1 passed（旧tier兼容守卫按现状通过）；实现后 16 passed。
- 冻结合同的预览响应字段清单未列 `previewId`，但创建请求必须消费它；实现按 additive 在 preview 对象内回传 `previewId`，其余字段与清单一致。属合同清单遗漏，不是语义变更，需集成人确认。
- 预览请求 `range` 放行 `preset.endDate`（RANGE-01 类型支持、规划器校验），合同请求示例未列出；用于系统日期回推与覆盖待确认场景测试。
- 预览有效期取 10 分钟（`RANGE_PREVIEW_TTL_MS`），合同未规定具体 TTL；`previewId` 存进程内存，服务重启后需重新预览。
- 范围模式训练的可见行情仍为既有 `buildTrainingSeries` 链（按推进日截断），起始日之前的历史仍作暖机/观察区加载，与旧 tier 行为一致；本片不改防未来与结算规则。

## 门禁记录

定向命令（`--maxWorkers=2`）与构建均在 e9d7e8c 树上通过；全量 66 文件 874 测试在实现后、提交前的工作树上通过（工作树内容与 e9d7e8c 一致）。命令与退出码见 [checks.json](checks.json)。RED 基线运行于实现前工作树（基线提交 7c01b11 + 新测试文件）。

后续：第二片（前端表单、预览版本守卫、录制 schema）需在本片响应稳定后由集成人单独派发；`docs/specs/training/rules.md`、`docs/specs/recording.md` 的产品口径同步随第二片/集成进行，本片未改。
