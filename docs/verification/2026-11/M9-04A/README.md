# M9-04A 验证记录（2026-11-16）

任务：[M9-04A](../../../work-items/tasks/M9-04A.md)；提案：[M9-04 公式系统产品化](../../../proposals/M9-04-formula-product-ui.md)。

## 结论

服务端公式库（SQLite）+ 通达信文本导入 + 只读 validate/evaluate API 已实现：引擎复用 `web/src/formula-engine`（构建期 esbuild bundle，唯一来源不复制），21 个新增测试通过、`build:server` 通过、编译后 loader 实测可加载 bundle 并求值。训练上下文求值复用既有 `trainingBars`（截断→复权→聚合）唯一链路；本卡 API 单测覆盖独立证券（TDX 只读）；训练上下文真实成功用例未覆盖（留 M9-04C），随机训练遮蔽以 mock trainingBars 覆盖。

## 实现摘要

| 文件 | 内容 |
|---|---|
| server/src/formulas/{types,engine,text,storage,data,evaluate,api}.ts | 稳定契约类型；引擎加载器（bundle 优先、dev 回退源码）；通达信文本规范化（BOM/CRLF/全角告警）；SQLite 仓储（名称大小写不敏感唯一、内置公式保护）；数据源（训练 trainingBars / TDX 日线只读＋StockContext 构造）；只读校验/求值；Fastify 路由 |
| server/src/db.ts | `formulas` 表兼容迁移 + 名称唯一索引（不重建既有表） |
| server/src/api.ts | `registerFormulaRoutes(app, config, database)` 接入统一注册（进入 drain 门闩） |
| scripts/build/formula-engine-bundle.mjs | 构建期把 web/src/formula-engine 打包为 server/dist/formulas/engine-bundle/index.mjs |
| package.json | `build:server` = tsc + bundle；显式 devDependency `esbuild` |
| server/README.md | 模块索引新增公式库入口 |

### API 契约（与任务卡一致）

- `GET /api/formulas`、`GET/POST/PUT/DELETE /api/formulas/:id`：仅读写公式库；名称重复 409、内置公式改名/删源码 403。
- `POST /api/formulas/validate`：200 固定形状 `{ok,futureFunctions,warnings}` / `{ok:false,error:{kind,message,line?,column?}}`；空源码 400。
- `POST /api/formulas/evaluate`：`source|formulaId` 二选一 + `trainingId|code` 二选一；返回输出线（NaN/Infinity→null）、bars 日期时间轴、futureFunctions、`dataSource:{kind,note}`；业务错误 400/404，运行时错误 200 `ok:false`。
- 只读性：evaluate/validate 不写训练/画线/录像/账户；测试断言调用前后 trainings/trades/drawings/formulas 计数不变。

## RED 说明（诚实边界）

本卡是**纯新增服务**（不改变既有行为），测试与实现同轮落盘，未保留“先失败”RED run；按开发原则 #1 属流程偏差，已如实披露。补强方式：对新增契约做定向测试覆盖＋纸面变异抽检（见下），B/C/D 卡将严格执行 RED 先行。

## GREEN（真实命令与退出码）

| 检查 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| 新增测试 | `npx vitest run server/test/formulas server/test/formula-library-api.test.ts --config server/vitest.config.ts` | **0** | 5 files / **21 passed**（storage 4、data 3、evaluate 6、validate 4、API 4） |
| 服务端类型检查 | `npx tsc -p server/tsconfig.json --noEmit` | **0** | 无错误 |
| 服务端构建＋引擎 bundle | `npm run build:server` | **0** | bundle 168,662 B（`server/dist/formulas/engine-bundle/index.mjs`） |
| 编译后 loader 实测 | `node .runs/loader-check.mjs` | **0** | `loaders-ok outputs=1 name=MA5 last=37`；未来函数 `["BACKSET"]`（bundle 动态加载＋求值＋扫描均通过） |

### 纸面变异抽检（P4）

| 变异 | 应失败的杀手测试 |
|---|---|
| 去掉 evaluate 的 `limit` 裁剪 | `formula-evaluate.test.ts::limit 截取最近 N 根（输出线与 bars 同步裁剪）` |
| 去掉名称唯一索引 | `formula-storage.test.ts::输入校验…重复名 409`、API CRUD 用例 |
| 去掉 NaN/Infinity→null | `formula-evaluate.test.ts::NaN/Infinity 输出归一为 null（JSON 安全）` |
| 去掉未来函数扫描 | validate 两套用例 |

## 边界与后续

- 训练上下文的 API 级集成（创建训练→evaluate 截断/复权后再求值）留待 M9-04C 图表挂载轮以真实训练用例覆盖；本卡数据层已复用既有 `trainingBars`（既有训练测试覆盖其语义）。
- 参数精灵/公式管理器导出格式、选股扫描、条件单联动不在本批（见提案边界）。
- 未发布：M9-04 整批完成并用户验收前不打包/不发布。

## 环境

- 临时 TRAINER_DB（`:memory:`）与临时 TDX 目录夹具；TDX 只读；未使用个人训练库。

## 全量门禁与 flake 归因（2026-11-16/17）

| 检查 | 命令 | 结果 | 收据 |
|---|---|---|---|
| 生产构建（web+server+bundle） | `npm run build` | **0** | web 构建 11.15s（`dist/assets` 产物正常）；build:server 含引擎 bundle |
| 全量单测（本地） | `npm test` | 1（2/2640 失败） | 745.63s；失败仅 `server/test/runtime-isolation.test.ts` 的临时目录 `EBUSY ... rmdir`（重启清理残留），隔离复跑第 1 次 1/15 失败、第 2 次 **15/15 通过** → 环境 flake，非代码回归 |
| 全量 Journey（本地，2 shards） | `npm run journey:parallel -- --shards 2` | 1（239 通过/7 失败/1 跳过） | 失败集中在录像库“导入录制”按钮持续禁用与 30s 超时；该 flake 集群已于 [CHART-ANALYSIS-01](../../2026-10/CHART-ANALYSIS-01/README.md) 记录为环境性问题（新临时目录/满载时复现）。本卡 `git diff` 无 `web/**`/`e2e/**` 改动，录像 UI 路径未触达；隔离复跑 6 个失败 spec：15 通过/4 仍环境失败 |
| CI verify（干净环境，权威） | GitHub Actions run 43908808980 job 133444795937 | **pass（4m1s）** | 全量单测+构建在干净 CI 通过；docs/pr-policy pass |

归因结论：本地全量 flake 与 M9-04A 改动无因果关系（该卡仅新增服务端模块、路由注册、迁移与测试；无前端/录像/运行时脚本改动）。全量 Journey 绿灯留待 M9-04C 图表挂载（有前端改动）与整批集成轮在空闲机器执行，并在该卡证据中记录。

## 评审修复（2026-11-17，REQUEST_CHANGES → 修复后复验）

只读审查代理（五维清单）裁决 REQUEST_CHANGES，提出 3 Critical + 11 Important；已修 C1/C2/C3 与 I1-I8、I10-I11 主要项，I9（StockContext 双实现统一）延后到 M9-04C（图表挂载使用同一上下文时统一，避免本卡扩大范围）。

| 项 | 修复 | 回归证据 |
|---|---|---|
| C1 dev 源码回退不可用（index.ts 把纯类型按值导出→tsx ESM 报错，所有公式接口 500） | `engine.ts` 回退改为加载纯值入口 `FormulaEngine.ts` + `futureFunctions.ts`；新增无缓存 `createEngineProvider()` | 新增 `formula-engine-loader.test.ts`（bundle 不存在时真实回退求值/扫描） |
| C2 随机训练信息隐藏被 evaluate 旁路 | `trainingFormulaData` 后接 `randomSessionOf`：`hideTime` 走 `transformRandomPayload` 偏移日期/时间戳，`hideStock` 不注入 StockContext，响应附遮蔽告警 | 新增 `formula-random-guard.test.ts` 2 用例（random_time 日期 +30 天；random_stock 的 NAMELIKE 人话错误） |
| C3 错误消息未中文 | `validationErrorOf` 统一中文前缀（词法/语法/运行错误＋第 X 行第 Y 列）＋常见引擎消息映射；保留细节便于排查 | validate/evaluate/API 测试断言消息含中文 |
| I1 训练上下文 500/覆盖声明不实 | `trainingBars` 异常映射 422 业务错误；训练不存在 404 用例；证据改为**明确未覆盖真实训练成功用例**（留 C 卡） | `formula-library-api.test.ts` 404 用例 |
| I2 契约 `bars` 与实现 `limit` 不一致/训练截断静默 | `limit` 与 `bars` 别名兼容（10~2000）；训练上下文请求超实际根数时返回 warnings | API 测试 bars 别名；data 层 warning |
| I3 `timeframe` 在 code 路径被静默忽略 | 独立证券非 1D 返回 400 中文原因（提示用 trainingId） | API 测试 weeklyCode 400 |
| I4 placement 必填但代码有默认不可达 | placement 可省略，默认 main；测试覆盖 | storage/API 用例 |
| I5 公式名仅 ASCII 阻断中文名 | 名称 1~64 字符、允许中文/字母/数字/下划线/短横线，禁空白/控制字符；跨公式引用仍需纯英文（注释与提案写明） | storage/API 中文名用例 |
| I6 “重启后仍在”假断言 | 改为临时文件库 close→reopen 断言；并断言删除公式后 trainings/trades/drawings 计数不变 | `formula-storage.test.ts` |
| I7 矩阵 test_ids 悬空 2 RED | 矩阵 7 行重绑（新增 FORMULA-ENGINE-LOADER / FORMULA-RANDOM-MASK），`check-binding --strict` → **RED=0，exit 0**（见下） | binding 收据 |
| I8 发布 ZIP 丢失 engine-bundle `.mjs` | `scripts/release/build.mjs` staging 过滤加入 `.mjs`；桌面 exe 不受影响 | 代码审查项；发布卡验证 |
| I10 保存响应丢全角告警 | POST/PUT 响应附 `warnings`；全角语法错时 400 响应含告警 | API 用例断言 |
| I11 CI 收据非 HEAD | 证据引用最新 HEAD 对应 run（见下方修订收据） | 见“修订后收据” |

### 修订后收据（2026-11-17）

| 检查 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| 定向测试（7 文件） | `npx vitest run server/test/formulas server/test/formula-library-api.test.ts server/test/formula-random-guard.test.ts --config server/vitest.config.ts` | **0** | 7 files / **22 passed** |
| 服务端类型检查 | `npx tsc -p server/tsconfig.json --noEmit` | **0** | 无错误 |
| 构建＋bundle | `npm run build:server` | **0** | bundle 重新生成 |
| 编译后 loader | `node .runs/loader-check.mjs` | **0** | loaders-ok outputs=1 name=MA5 last=37; future=["BACKSET"] |
| 矩阵绑定 | `node .zcode/skills/ai-harness/scripts/check-binding.mjs --repo <worktree> --matrix formula-library.yaml --strict` | **0** | 7 行 covered=7 RED=0；2722 用例/638 describe 组 |

### 覆盖边界（如实披露）

- 训练上下文（真实训练夹具→截断/复权→求值成功用例）仍未覆盖；数据层仅 mock trainingBars 覆盖随机遮蔽，训练数据解析留 M9-04C 以真实训练覆盖。
- 本地全量 `npm test`/Journey 的环境 flake 见上节；CI verify 在干净环境对 HEAD 重跑通过后以 CI 为权威收据（见最终 CI 行）。

### 最终 CI 收据（HEAD 5ae6a6a，评审修复后）

- GitHub Actions run **43919716831**：`verify` pass 4m39s、`docs` pass 47s、`pr-policy` pass 26s（干净环境全量单测＋构建）。
- 本地全量第二跑：服务端/桌面其余全绿；仅 `desktop/test/port-tree-kill.test.ts` 真实 taskkill 用例 15s 超时（隔离复跑 2 次仍超时）。该用例无桌面代码改动（diff 仅 server/scripts/docs），CI 干净环境通过 → 判定为本机当前负载下环境 flake，如实记录。
- harness 台账：`gate-report.mjs --task M9-04A` 已记录 binding/unit/build/docs/ci 收据（ai-harness-lab/harness-state.jsonl）。
