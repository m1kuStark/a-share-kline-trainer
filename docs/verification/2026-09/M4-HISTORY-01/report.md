# M4-HISTORY-01 执行报告（control-handoff-20260928-53）

- 执行者：GLM-5.3-Flash（Zcode 原协调会话，唯一写工作树 `trainer-worktrees/M4-HISTORY-01`，分支 `task/M4-HISTORY-01`）
- 基线：`888778cfc7a4b69e4446012a26618b93a8b05b20`（干净，含全部已接受 TRAIN/NOTE/V1/REC 结论）
- 代码提交：`385017b`（任务卡）→ `d747fc4`（服务端实现+测试，HEAD/tree=`cd4ce24f5682b0ae2ec8bf0bb3d5e51240b94593`）；本报告随最终 docs/UI 提交入库，门禁 proof 绑定最终 HEAD。
- 预算口径：本片执行为新 feature 预算内的登记执行（设计1+执行1已认领在案）；不重置、不新开名目。

## 交付范围（五 scope 全部）

1. **HISTORY-list**：`GET /api/trainings/history`——settled 过滤、complete/early-settled 分类（结算方式口径）、settle_date DESC+id DESC 稳定排序、limit(1..100 默认20)/offset(≥0 默认0) 校验 400、total/items/limit/offset、行级 integrity（finalEquity 只取结算日持久点；缺失/非有限/初始资金无效/坏规则/legacy-raw 行级不可认证+中文原因，不影响其他行）。
2. **HISTORY-report**：`GET /api/trainings/:id/report`——400/404/409 `HISTORY_NOT_SETTLED`、409 `TRAIN_RULES_UNREADABLE`、409 `LEGACY_RAW_ACCOUNTING_UNVERIFIED`（合法新 raw 与 legacy-migration 如实展示不否定）、409 `HISTORY_EQUITY_UNAVAILABLE`；事实元信息+冻结规则（origin/capturedAt）+逐笔成交（seq 升序）+持久权益曲线（date 升序），均限定 start_date..settle_date；drawings 坏 JSON → `drawingsStatus=unavailable` 不变空成功；画线只读标注清单（类型/窗格/锚点/原始价格基准），无行情 K 线、无编辑器。
3. **HISTORY-ui**：侧栏入口改可访问「历史训练」（原禁用"排行"位）；History.vue（列表/分页/守卫/空态/错误重试/行点击）+ HistoryReport.vue（只读成绩单）；Training.vue 结算面板新增「查看历史成绩单」最小入口（emit，不改账户/录制）；离开训练复用 `prepareForLibrary` 既有协议，无停录旁路；A→B 迟到响应版本守卫丢弃；金额无 NaN/undefined；录像库与离线导入不变。
4. **HISTORY-no-future**：任何 running 存在 → 两接口（含直接 ID 访问）先 409 `HISTORY_ACTIVE_TRAINING` 零内容；守卫与读取同一同步调用（模块全同步、无 await 间隙）；无 TDX 配置（`tdxRoot` 缺失）下列表/报告成功且库内容 dump 零变化（无写入/回填/行情读取）——oracle 在 `history-report.test.ts` 固化。
5. **HISTORY-compat**：既有 `/api/trainings/:id`、bars、drawings、recording-context、离线录像不动；`GET /api/rankings` 仍 404（full-acceptance 断言保留）；不重建表、不改账户/录像 schema/结算放弃语义；无新常驻服务/消息总线/排行表。

## 验证事实（命令均在仓库根执行，完整日志在 headroom 缓存 `m4-history-20260928-53/evidence/` 与 `docs/verification/2026-09/M4-HISTORY-01/`）

| 检查 | 结果 | 日志 |
|---|---|---|
| RED 服务测试（实现前） | exit 1（模块缺失，全部失败） | red-server-history-report.20260928T1/T2.log |
| GREEN `npm test -- server/test/history-report.test.ts` | exit 0，**23/23** | green-server-history-report.20260928T3.log |
| 相邻回归（full-acceptance/api/settings/drawings/train-engine） | exit 0，**48/48**（含 rankings 404 断言） | green-server-compat.20260928T1.log |
| `npm run build:server` | exit 0 | green-server-build.20260928T1.log |
| `vue-tsc --noEmit -p web/tsconfig.json` | exit 0（两次） | green-web-types.20260928T1/T2.log |
| 前端契约+journey-snapshot+docs-tooling 定向 | exit 0，**73/73** | green-frontend-contracts.20260928T1.log |
| Journey RED（web 实现前） | exit 1（历史入口缺失超时） | red-journey-m4-history.20260928T2.log |
| Journey 最终 `npm run journey -- e2e/m4-history.spec.ts --retries=0` | exit 0，**4/4 通过**，无 flaky | green-journey-m4-history.20260928T6.log |

- Journey 为真实隔离 run（独立 SQLite/动态端口/journey 构建，单 worker，retries=0）；TDX 冻结样本 6 文件 sha256 先核对一致，运行时复制为 run 内隔离副本；未用 API 替代"结算按钮/历史入口/买入/推进/画线"等关键用户动作；`__trainerChart` 仅只读定位。
- 截图深/浅 1440/840 共 6 张已归档并经主代理逐一实查（含 840 日期截断修复前后对比）；pageerror 全程 0。

## 源码/测试指纹（实现定稿时点，HEAD=d747fc4）

```
023f8cbb…64cd8 server/src/train/history-report.ts
2df7368e…c55d2 server/src/api.ts
d9159d48…e41d7 server/test/history-report.test.ts
9738a072…2c53b web/src/api.ts
3df90e48…8f65b web/src/views/History.vue
984966c3…773d8 web/src/components/HistoryReport.vue
1c7aeeca…6342a web/src/App.vue
a4b1006a…6f56e web/src/views/Training.vue
ce0e9cd7…d210a web/src/styles.css
ef952328…c856e e2e/m4-history.spec.ts
```
（完整 64 位 hash 见 headroom 证据清单 evidence-manifest.txt）

## 失败与复跑（首次失败原件全部保留，未覆盖）

1. 环境：worktree 无 node_modules → npm ci 后复跑（npm-ci.20260928T1.log）；journey 未设 TDX_ROOT 拒启（red-journey T1）。
2. GREEN 服务测试 T1/T2 共 3+1 次失败：2+1 次为测试夹具期望算错（total 8 vs 7、分页全序推算），1 次为实现 bug（tradeCount 取值）——修复与期望修正分项记录，断言强度未减弱。
3. Journey T1 strict-mode 定位歧义（¥1,000,000 两处匹配→`.first()`）；T3 rail 训练按钮可达名「⌁ 训练」exact 失败→文本过滤定位；T4 后视觉实查发现 840 日期截断（产品 CSS 修复）与画线区块截图不可见（测试补双容器滚底）；T5 内层滚动未到位；T6 全绿。
4. 未运行/不适用：`verify:m1`（本片不改数据解析/复权）；M2 由门禁统一执行。

## 残余与边界

- 本片不实现排行/回撤/胜率/盈亏比/基准超额/训练时钟/成交理由/条件单；不宣称 M4 整体完成（roadmap §2.7 已改为"部分交付"并保留未开发清单）。
- 空列表态仅 run 首局可覆盖；legacy-migration 合法展示、坏 drawings 行为由服务测试覆盖，UI 未逐一截图。
- 完整门禁（verify:candidate --base 888778c --task M4-HISTORY-01）按合同在本报告提交、树干净后**一次执行**，结果与 proof 单独记录；proof 不等于 GPT 语义接受。
