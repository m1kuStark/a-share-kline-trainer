# V1-INTEGRATE-01 组合候选验证报告

状态：**组合门禁已完成（90/91，Journey 单例时序竞态失败，无 proof），候选已保存待控制裁决**（reply_to=control-handoff-20260928-46）。分支 `task/V1-INTEGRATE-01`；base `3f8c61246d5c057743fc312b07ebdd704d23658a`；fast-forward 至 `52889a70b6bd3037339e3414adc47ccdad0d104f`（TRAIN 代码 `c0fa04c126…`、NOTE 代码 `6cbf7a6798…` 均为祖先；已验不含失败 SETUP 提交 `3875941ad2…`/`309e754e70…`）。门禁前文档提交 `965693895594de7ed91b8cbc578c0636e448021f`；门禁后仅本报告等 docs 更新（逐次列于证据 manifest，不宣称旧 proof 绑定新 HEAD）。

## 继承范围（不重实现）

base..52889a7 恰为 49 个变更文件（`inherited-paths.json`），覆盖已接受的两片行为：

- **NOTE-DETAIL-01**（只读成交详情，5/5 接受）：B→S 方向、hover 焦点穿透 Teleport、pin 后离屏仍显当前成交、深浅文本对比、离线回放后退清未来详情且零业务写；schemaVersion v1/v2/v3 读取兼容。
- **TRAIN-01**（训练规则快照，5/5 接受）：费用/T+1 默认 API 与局部弹层、创建冻结快照（数值驱动执行+支持域校验）、raw/forward 权息一致、推进短事务状态重查、legacy raw 只读保护、一次迁移标记防损坏重冻、录像 rules 接本局快照。

本片只做串行组合、完整候选门禁与集成 UI 复验；SETUP 严格排除。

## 组合验证计划

1. `npm run verify:candidate -- --base 3f8c61246d5c057743fc312b07ebdd704d23658a --task V1-INTEGRATE-01`（docs/impact/unit/types/build/snapshot/M2/Journey，Journey retries=0），TDX_ROOT 指向冻结样本 `tdx-20260916-d8339f32`（先核 6 文件 hash 对 snapshot.json，运行时做隔离副本）。
2. NOTE+TRAIN 共存 UI 语义检查：录制进行中打开/修改设置不卸载训练、A 局规则保持/新 B 局用新默认、B→S 交易详情准确、离线回放后退清未来详情、840/1440 深浅、pageerror。

## 门禁结果（run-4b650a61，一次完整 verify:candidate，Journey retries=0）

| 检查 | 结果 |
|---|---|
| docs / impact | exit 0（impact --base 3f8c612 --task V1-INTEGRATE-01） |
| unit | exit 0，1138/1138（86 文件） |
| types / build | exit 0 |
| snapshot / m2 | m2 exit 0，24/24（冻结样本经运行时隔离副本） |
| journey | **exit 1：90 passed / 1 failed** —— `drawing-basis.spec.ts:4` 创建训练返回 409 |

总判定 exit 1，**未签发 candidate-proof.json**（proof 需单次全绿＋前后干净，已按约不重跑全量刷绿）。

## 失败分类（非产品缺陷，非本整合引入）

- 日志 forensic（server.log req-6c/6d/6e/6f）：上一测试的在途 `POST /api/trainings`（响应 ~3.0s）在 drawing-basis 的 `abandon→create` 窗口内才提交，create 的单活动约束正确返回 409——约束本身工作正常。
- 无侵入剖析：`refreshStockCatalog` 每次 ~3.1s（本机实测 3139/3183ms，无缓存），`createTraining` 每次调用它；本轮 12 次创建全部 2.9–3.3s。`server/src/tdx/catalog.ts` 不在 49 个继承变更路径内，两片接受代码均未触碰——慢创建为既有数据层行为，本机当下 I/O 状况放大了竞态窗口。
- 有名检查 verify-only 重放（同候选、retries=0、`--grep drawing-basis`）：run-9c841539，**2 passed / 27.8s**——分类为时序竞态 flake，非确定性缺陷。
- 结论：保存候选与证据，无 proof，交控制层裁决（候选内不授权改测试/产品）。

## NOTE+TRAIN 共存 UI 语义检查（preview run-6de958bb，端口 14778，真实浏览器操作）

- **录制共存**：A 局录制中打开设置→改默认→保存成功，录制条持续"正在记录 · 1 次操作"不中断，Training 不卸载；Esc 关闭弹层。
- **A 冻结/B 新默认**：改默认（费用开/T+1 关）后 A 当日卖出仍拒（"当前没有可卖持仓"，拒单计入第 2 次操作）；结算 A 后新建 B，当日买入 3500 股即可卖出（T+1 关）。
- **快照费率驱动执行**：B 卖出费用 245.60 元＝982,415.00×0.00025（成交详情浮层逐项显示方向/序号/成交价/股数/金额/费用）。
- **NOTE 成交详情**：B→S 双标记正确；hover B 标记弹出"成交详情"固定面板，字段与手算一致。
- **840/1440 深浅**：1440 深色与 840 浅色下设置弹层、详情浮层、训练页均完整可读（截图存证据目录）。
- 离线回放后退清未来详情由门禁 Journey 内 `recording-daily.spec`（"按交易日回放…只读安全"）与既有 trade-marker-details/recording 回归覆盖，本轮全部通过；pageerror 由各 spec 的 `expect(errors).toEqual([])` 断言覆盖，全绿。

## 边界与预算

不声称完整 1.0、完整 M4/M5、DATA-03/04、两布尔之外的设置项或用户发布批准。新功能 V1-ACCEPTED-INTEGRATION 预算 3 单位：设计 1＋本次执行 1 已用，剩一次 GPT review；TRAIN/NOTE 历史 5/5 不变，不声称降本。
