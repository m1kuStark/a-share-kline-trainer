# 参与贡献

欢迎通过 Issue 和 Pull Request 参与改进。本文是独立的公共贡献指南：按这里准备环境、了解项目约束、提交改动即可，无需其他内部资料。

## 项目概览

A股K线训练器是本机离线运行的逐日行情训练工具，读取使用者自己的通达信日线数据。技术栈：

- 前端：Vue 3 + Vite + Pinia，图表基于 klinecharts（版本钉定 10.0.3，升级需单独评审）
- 后端：Fastify + TypeScript，运行于 Node 24，使用 Node 内置 SQLite
- 测试：Vitest 产品测试；Playwright 浏览器测试

## 准备环境

需要 Node.js 24 与 npm 10 以上版本（Windows/Linux/macOS 均可，发布包仅提供 Windows 版）。

```powershell
npm ci
npm run build
npm start   # 127.0.0.1:8787 同时托管页面与接口
```

日常开发用 `npm run dev`（页面5173、接口8787，代码热更新）。启动开发实例前**显式指定独立数据库**，不要指向自己的真实训练库：

```powershell
$env:TRAINER_DB = Join-Path $PWD '.data\development.sqlite'
$env:TDX_ROOT = 'D:\path\to\tdx'   # 你本机合法获得的通达信目录
$env:OPEN_BROWSER = '0'
npm run dev
```

## 产品硬约束

改动涉及以下行为时必须保持约束，例外需先在 Issue 中讨论：

- 通达信目录只读；训练行情统一按"截断至推进日 → 前复权 → 日/周/月聚合"处理，禁止绕过训练接口直接读原始行情。
- 交易规则：普通单按当前阶段价成交（开盘/收盘），条件单按冻结的触发方向与限价/止损规则撮合；默认 T+1，买入按总权益向下取整到100股整手。
- 显示约定：红涨绿跌、阳线空心阴线实心；klinecharts 钉定 10.0.3。
- 已结算的训练不自动重开、不重算；产品规格目标与当前实现缺口分开陈述，不得把未实现能力描述成已实现。

## 测试与门禁

- `npm test`：产品测试（Vitest），行为改动须附带有效回归。提交前至少运行 `npm test` 和 `npm run build`。
- 浏览器（Playwright）测试依赖本地合法获得的通达信数据夹具和 Microsoft Edge，不能假设在任意机器或CI环境都能直接运行；提交说明里请写明你实际运行了哪些检查。
- **本地 hooks**：`npm ci` 后 `prepare` 会执行 `npm run hooks:install`（设置 `core.hooksPath=.githooks`）；hooks 只做快速拦截，main 保护由 GitHub Ruleset 与 CI required checks 强制。
- **严禁提交**：真实行情数据、个人训练数据库、会话录像、凭据、含个人信息的截图或私有路径。

## 提交流程

1. 先开 Issue 描述问题或提议，确认方向后再动手。
2. 从 `main` 拉出分支：维护者用 `task/<任务ID>`（先立任务卡）；外部贡献用 `feat/<slug>` 或 `fix/<slug>`。小步提交，提交信息使用 Conventional Commits（`feat(scope): 摘要`、`fix(scope): 摘要`、`docs:`、`test:`、`chore:` 等），可用中文描述。维护者在任务分支提交时需带 `Task: <任务ID>` trailer，详见 [提交规范](docs/engineering/commit-convention.md)。
3. 推送分支并开 PR；PR 标题同样使用 Conventional Commits，正文按模板填写改动、影响面、门禁命令与结果。main 禁止直接 push，必须经 PR。
4. PR 需通过 `docs`、`verify`、`pr-policy` 三个必需检查；行为改动需在同一 PR 中同步更新受影响的文档（面向使用者的改动更新 `docs/user/`，代码内部约定写在代码附近的模块文档），避免文档与实现脱节。
5. 等待维护者评审合并；合并后由维护者回填任务卡与验证记录。

## 文档约定

- 面向使用者的文档在 `docs/user/`；文档使用中文，链接使用仓库内相对路径。
- 改动行为时在同一 PR 中更新受影响的文档，描述以当前实现为准，不把未实现能力写成已实现。

## 许可证

本项目以 MIT 许可证发布（见 [LICENSE](LICENSE)）；你提交的贡献默认以同一许可证授权。安全问题不要走 Issue，见 [SECURITY.md](SECURITY.md)。
