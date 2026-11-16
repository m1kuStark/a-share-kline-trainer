# M9-04B 验证记录（2026-11-17）

任务：[M9-04B](../../../work-items/tasks/M9-04B.md)；提案：[M9-04 公式系统产品化](../../../proposals/M9-04-formula-product-ui.md)。

## 结论

设置面板「公式指标」分栏已实现并可真实浏览器操作：列表/新建/编辑/保存、通达信多行与单行粘贴、校验中文错误与未来函数标记、全角告警、只读预览曲线、关闭重开持久化、二次确认删除；深浅主题与 1024×680/1366×705/1440×900 桌面尺寸无横向溢出（截图见下）。定向 Journey 3/3 通过；全量门禁收据见下。

## 实现摘要

| 文件 | 内容 |
|---|---|
| web/src/components/FormulaSettings.vue | 自包含组件：公式列表（主图/副图、内置/停用徽标、未来函数标记）、编辑表单、校验/保存/删除（二次确认）、预览（SVG 多输出线 + 数据来源说明）、加载/错误/告警状态；主题 token 与既有设置分栏一致 |
| web/src/components/TrainingSettings.vue | 新增「公式指标」分栏导航、activeSection 值与组件挂载；不改既有分栏行为 |
| web/src/api.ts | 公式库 API 客户端镜像（列表/CRUD/validate/evaluate，类型与 M9-04A 契约一致） |
| e2e/formula-manager.spec.ts | 3 个真实浏览器用例：主流程（新建/校验/预览/持久化/删除）、错误与告警（中文错误/未来函数/全角/单行粘贴/中文名）、视觉尺寸与主题（无横向溢出 + 截图） |
| scripts/build/formula-engine-bundle.mjs、scripts/runtime/run.ts | 集成修复：Journey 运行器用 tsc 直接编译到 run.serverDir，不经 build:server——bundle 脚本支持 --outdir，journey 构建步骤显式生成同源引擎 bundle（否则公式接口在 Journey 内 500） |

## RED 说明（诚实边界）

新增 E2E 与实现同轮落地，未保留先失败 RED run（流程偏差，按开发原则 #1 披露）。定向 Journey 首跑暴露真实问题并作为回归证据：① 保存后提示误显示「已保存修改」（新建应为「已保存新公式」）；② 预览/保存后状态区出现多个 role=status 导致断言歧义；③ 深浅主题下组件使用不存在的 CSS token（深色列表浅底白字不可读）。均已修复并复跑。

## GREEN（定向）

| 检查 | 命令 | 退出码 | 收据 |
|---|---|---|---|
| 前端类型检查 | npm run typecheck:web | **0** | vue-tsc 无错误 |
| 定向 Journey | TDX_ROOT=… npm run journey -- e2e/formula-manager.spec.ts --retries=0 | **0** | run run-ec5ba9e3-a1af-4f23-97d9-ffdbdb0ed629；3 passed（主流程/告警/视觉），服务隔离、构建独立 |
| 引擎 bundle 集成 | 同上 Journey 构建 | 0 | build-server.log 无错误；公式 validate/evaluate 在隔离服务内可用（e2e 校验/预览通过） |
| 矩阵绑定 | node .zcode/skills/ai-harness/scripts/check-binding.mjs --repo <worktree> --matrix formula-ui.yaml --strict | **0** | 4 行 covered=4 RED=0 |

## 全量与构建门禁

| 检查 | 命令 | 结果 | 收据 |
|---|---|---|---|
| 全量单测（首跑） | npm test | 1 | 3 文件/44 tests 失败：scripts/runtime/run.ts 新增 bundle 步骤在测试项目夹具（无 scripts、无 web/src）下失败——集成缺陷，已修（缺 web/src 时跳过 bundle） |
| 全量单测（修后复跑） | npm test | 1（2640/2641） | 唯一失败＝runtime-isolation「cancels an owned child command and preserves its failure log」15s 超时（隔离复跑同失败）；**main 基线干净检出（53b516f）同用例同失败** → 本机环境退化（进程树 taskkill 超时），非本卡代码 |
| 生产构建 | npm run build | **0** | web build 6.90s；server tsc + engine bundle 构建通过 |
| 全量 Journey（2 shards） | npm run journey:parallel -- --shards 2 | 1 | shard2：123/124 通过，唯一失败 recording-long（隔离复跑失败；**main 基线同 spec 同失败** → 环境 flake）；shard1：启动期 tdx-snapshot rename EPERM（无日志），隔离重跑见下 |
| shard1 隔离重跑 | TDX_ROOT=… npm run journey -- --shard=1/2 --retries=0 | **0** | run-8ae9ff0a-a698-4bff-81af-95e0822f54e4：125 passed / 0 failed / 1 skipped；启动期 EPERM 为环境 flake（重跑通过） |
| 定向 Journey（本卡） | TDX_ROOT=… npm run journey -- e2e/formula-manager.spec.ts --retries=0 | **0** | run-ec5ba9e3-a1af-4f23-97d9-ffdbdb0ed629；3 passed |
| 矩阵绑定 | check-binding.mjs --repo … --matrix formula-ui.yaml --strict | **0** | 4 行 covered=4 RED=0 |
| 文档门禁 | docs:check / docs:status -- --check / docs:impact | **0** | 0 errors（171 存量 warnings） |

## 视觉检查（UI-VISUAL-ACCEPTANCE）

- 证据（本目录 screenshots/）：formula-settings-1024x680-light.png、formula-settings-1366x705-light.png、formula-settings-1440x900-light.png、formula-settings-1440x900-dark.png、formula-settings-preview.png。
- 观察：浅色与深色下列表/表单/告警对比度可读（深色修正 token 后复验）；三尺寸均无横向滚动（E2E 断言 scrollWidth≤clientWidth）；列表以横向卡片换行排布，窄窗不压缩表单；源码 textarea 纵向滚动，保存/校验按钮在分栏内需滚动后可见（设置内容区既有滚动语义，接受）。
- 预览：SVG 曲线与图例可见，数据来源（不复权 TDX 日线/训练上下文）与时间范围明示；深浅主题曲线可辨。

## 边界

- 训练上下文预览（有进行中训练时用 trainingId）由 M9-04A 契约支持，本卡 E2E 覆盖独立证券代码路径；训练上下文 UI 路径留 M9-04C 图表挂载轮以真实训练用例覆盖。
- 不做选股扫描、条件单联动（提案边界）。

## 环境

- 独立 Journey run（动态端口/临时 SQLite/独立构建，serve 后即销毁）；TDX_ROOT 只读（D:\MySoftWares\TDX）。
- 已知环境 flake：tdx-snapshot 目录 rename 偶发 EPERM（隔离重跑通过，非代码路径）。
