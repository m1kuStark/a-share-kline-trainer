# A股K线训练器

基于通达信本地日线和权息的离线逐日训练工具。Node24＋TypeScript＋Fastify＋SQLite；Vue3＋Vite＋klinecharts10.0.3。

当前阶段版本已完成工程验收，等待用户最终验收；[验收说明](docs/verification/2026-09/REC-01-stage-release/acceptance.md)。M4/M5将在用户明确通过后再开发。

## 从哪里开始

- [当前开发状态](docs/status.md)：阶段、任务及验收证据。
- [Agent入口](AGENTS.md)：按任务渐进读取。
- [产品规格](docs/specs/README.md)、[架构](docs/architecture/README.md)、[完整文档入口](docs/README.md)。
- [后端](server/README.md)、[前端](web/README.md)、[浏览器测试](e2e/README.md)、[脚本](scripts/README.md)。

已具备训练、账户、23种画线及本地更新入口；完整排行/复盘/设置、真实在线来源待开发，保护缺口以任务卡为准。“更新日线”只读取通达信已下载文件，不负责联网下载。

操作录制默认开启，训练中可暂停/恢复；导出紧凑gzip文件，首页/侧栏训练录像库可导入或查看历史。回放按交易日，可独立切周期和缩放；分享包含当时已见行情与实际结果，不依赖发送者TDX路径。旧JSON仍可导入。结束时默认保留，可选择只丢弃本轮录像。规则见[录制说明](docs/specs/recording.md)。

## 安装与运行

Windows、Node24+，通达信目录默认发现 `D:\MySoftWares\TDX`。

```powershell
npm ci
npm run dev
```

开发页面5173、API8787。启动开发实例时显式使用独立数据库：

```powershell
$env:TRAINER_DB = Join-Path $PWD '.data\development.sqlite'
$env:TDX_ROOT = 'D:\MySoftWares\TDX'
$env:OPEN_BROWSER = '0'
npm run dev
```

日常生产使用 `npm run build` 后 `npm start`，8787同时托管前端/API。不设TRAINER_DB时默认用户目录 `.a-share-kline-trainer/trainer.sqlite`；这不是测试库。

## 验证

```powershell
npm run docs:check
npm run docs:status -- --check
npm test
npm run build
```

完整交付门禁见[测试协议](docs/engineering/testing.md)，统一命令为 `npm run verify:baseline`；实源M1和任务文档影响核对另行执行。Agent用 `npm run agent:dev` 启动隔离预览；Journey自动隔离端口、数据库、构建与证据。Git并行开发见[操作协议](docs/engineering/parallel-development.md)。

文档治理现行机制见[更新协议](docs/engineering/documentation.md)。旧长计划与过程已归档，后续开发从新提交基线接续，停止向旧入口追加进度。
