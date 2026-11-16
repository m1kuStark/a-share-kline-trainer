# M9-04A 验证记录（2026-11-16）

任务：[M9-04A](../../../work-items/tasks/M9-04A.md)；提案：[M9-04 公式系统产品化](../../../proposals/M9-04-formula-product-ui.md)。

## 结论

服务端公式库（SQLite）+ 通达信文本导入 + 只读 validate/evaluate API 已实现：引擎复用 `web/src/formula-engine`（构建期 esbuild bundle，唯一来源不复制），21 个新增测试通过、`build:server` 通过、编译后 loader 实测可加载 bundle 并求值。训练上下文求值复用既有 `trainingBars`（截断→复权→聚合）唯一链路；本卡 API 单测覆盖独立证券（TDX 只读）与训练上下文的数据解析路径。

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
