# M9-04D 验证记录（2026-11-17）

任务：[M9-04D](../../../work-items/tasks/M9-04D.md)。

## 结论

M9-04D 已实现：启动幂等 seed 3 个内置示例（builtin=1、默认停用）、本地只读 agent CLI（list/validate/evaluate，JSON 输出、失败非 0）、agent 接口文档与 e2e 内置示例断言；定向 6 个单测与 4 个 formula-manager e2e 用例通过，矩阵/文档门禁见下。

## 实现摘要

| 文件 | 内容 |
|---|---|
| server/src/formulas/seed.ts | 内置示例定义（WEEK_MACD_SUB/MA_BULL_MAIN/QINIU_B1_SUB）＋seedBuiltinFormulas 幂等写入（name NOCASE 已存在则跳过；builtin=1、enabled=0） |
| server/src/index.ts | migrateDatabase 之后 seed（try/catch：失败记录日志不阻断启动；journey/desktop 同源） |
| scripts/formula-agent.mjs | 只读 CLI：list/validate/evaluate；默认 base 8787；JSON 输出；ok:false/请求失败非 0＋stderr 人话；参数互斥与范围校验 |
| docs/engineering/formula-agent-api.md | 接口契约（list/validate/evaluate、错误码/形状）、随机训练遮蔽、只读边界、curl 与 CLI 示例、内置示例说明 |
| docs/engineering/README.md、CHANGELOG.md、e2e/README.md | 文档索引、1.3.8 M9-04 A-D 增补、套件覆盖更新 |
| e2e/formula-manager.spec.ts | 新增「内置示例可见且不可删除」（内置徽标/名称可见；选中内置无删除按钮） |
| server/test/formula-seed.test.ts | 4 tests：幂等/不覆盖/403/真实引擎校验求值 |
| server/test/formula-agent-cli.test.ts | 2 tests：真实 HTTP 子进程 list/validate/evaluate + 只读计数；服务不可达人话非 0 |

## RED / GREEN

- RED：新增 2 个单测文件在实现前实跑 2 failed（seed 模块缺失/CLI 缺失；run 06:31）。
- GREEN：定向 vitest 2 文件 6 passed（seed 4 + CLI 2）；seed 三源码经真实引擎 validate/evaluate 通过（见 seed 测试「内置示例源码可通过引擎校验与求值」）。
- 定向 Journey：e2e/formula-manager.spec.ts（4 用例，含内置示例断言）— 收据见下表。

## 门禁

| 检查 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| 前端类型检查 | npm run typecheck:web | **0** | vue-tsc 无错误 |
| 生产构建 | npm run build | **0** | web 8.25s；server+bundle 构建通过 |
| 定向单测（新 2 + 邻接 2） | npx vitest run server/test/formula-seed.test.ts server/test/formula-agent-cli.test.ts server/test/formula-library-api.test.ts server/test/formula-random-guard.test.ts --config server/vitest.config.ts | **0** | 4 files / **12 passed**（seed 4、CLI 2、library-api 4、random-guard 2） |
| 定向 Journey | TDX_ROOT=… npm run journey -- e2e/formula-manager.spec.ts --retries=0 | **0** | run **run-50a98b29-de7e-4286-807e-b30b87163c7b**；**4 passed**（新建/校验/预览/持久化/删除、告警与导入、视觉、内置示例可见且不可删除） |
| 矩阵绑定 | node .zcode/skills/ai-harness/scripts/check-binding.mjs --repo <worktree> --matrix formula-agent.yaml --strict | **0** | 3 行 covered=3 RED=0；2743 用例/641 describe 组（新测试文件已 git add 索引） |
| 文档门禁 | docs:check / docs:status -- --check / docs:impact -- --base fef6293 --task M9-04D | **0** | 0 errors（check 176 存量 warnings）；impact 17 路径 0 error |
| CLI 真实 HTTP | 由 formula-agent-cli.test.ts 覆盖（真实 Fastify 127.0.0.1 动态端口 + 子进程 + 临时 TDX 日线） | **0** | list 空库/写库后列表、validate 成功与失败非 0、evaluate code/formulaId、dataSource 透传、训练/成交/画线计数不变、服务不可达人话非 0 |

- 环境 flake（如实记录）：定向 Journey 前两次在 tdx-snapshot rename 处 EPERM（run-ad50063a、run-78e49ce3，构建前失败，无产品路径）；原样重试第三次通过（run-50a98b29）。
- 设计决策偏差（需 Lead 知悉）：3 个内置示例 **默认 enabled=0**。原因：启用会让所有训练/回放图默认多出主图线/副图窗格，扰动既有图表布局与录像 paneHeights 语义及 formula-chart e2e 窗格断言；当前 UI 无启停开关（B 卡未做）。示例在设置中可见、可预览；启用需 PUT /api/formulas/:id {enabled:true}，UI 开关留后继卡。若产品要求开箱即渲染，需扩 UI 开关并同步调整 formula-chart e2e。


## 环境

- 独立 Journey run（动态端口/临时 SQLite/独立构建）；TDX_ROOT 只读（D:\MySoftWares\TDX）。
- CLI 测试用真实 Fastify 监听 127.0.0.1:0 + 临时 TDX 日线；子进程真实 HTTP，无 mock。
## CLI 手工实测收据（2026-11-17）

- node scripts/formula-agent.mjs --help → exit 0，打印子命令用法（list/validate/evaluate、--base、只读说明）。
- node scripts/formula-agent.mjs list --base http://127.0.0.1:1 → exit 1，stderr「无法连接训练器（http://127.0.0.1:1）：bad port」+「请先启动训练器，并用 --base 指定实际地址。」（人话、非 0）。
- 真实成功路径（list/validate/evaluate/公式库写入后 list/formulaId 求值/只读计数）由 server/test/formula-agent-cli.test.ts 用真实 Fastify 127.0.0.1 动态端口 + 子进程覆盖（定向 vitest 0，2 passed）。
