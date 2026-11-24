# 后端

Fastify 提供行情、训练和画线 API，SQLite 保存业务记录及数据缓存。当前仍由 `api.ts` 直接编排多个模块，尚未实施服务层拆分。

| 要做什么 | 入口 | 何时继续读 |
|---|---|---|
| 修改接口或错误响应 | [api.ts](./src/api.ts) | 涉及训练读 [train](./src/train/README.md)，刷新读 [data](./src/data/README.md) |
| 修改日线刷新、失败恢复或来源选择 | [data](./src/data/README.md) | 涉及文件格式、目录或权息缓存时读 [tdx](./src/tdx/README.md) |
| 修改推进、交易、结算或账户 | [train](./src/train/README.md) | 产品口径以 [训练规则](../docs/specs/training/rules.md) 为准 |
| 修改 TDX 解析、聚合或复权 | [tdx](./src/tdx/README.md) | 涉及训练可见区间时补读 train 生命周期 |
| 修改画线保存或旧库兼容 | [drawings.ts](./src/drawings.ts)、[db.ts](./src/db.ts) | 同时核对 [图表交互规格](../docs/specs/chart/interaction.md) 与前端保存调用 |
| 读取录制版本/规则/权息 | [recording-context.ts](./src/recording-context.ts) | 只读GET，权息截止训练可见日，禁止返回TDX路径；[合同](../docs/engineering/recording-contract.md)、[便携版元数据](../docs/engineering/public-source.md) |
| 修改启动或配置 | [index.ts](./src/index.ts)、[config.ts](./src/config.ts) | 环境变量为 `TDX_ROOT`、`TRAINER_DB`、`HOST`、`PORT`；启动可通过 `OPEN_BROWSER=0` 关闭自动打开浏览器 |
| 选择验证范围 | [验证协议](../docs/engineering/testing.md) | 真实数据验证命令见 [scripts](../scripts/README.md) |

所有 npm 命令在仓库根执行：开发 `npm run dev:server`，测试 `npm test`，编译 `npm run build:server`。`server/` 没有独立 package.json。

## 本机 HTTP 边界

[index.ts](src/index.ts) 在路由执行前检查 Host、Origin 和 Fetch Metadata：仅接受明确的回环 Host；存在 Origin 时必须与请求地址同源；存在 `Sec-Fetch-Site` 时仅接受 `same-origin` 或 `none`。外站读取、写入和预检返回 403，不授予 CORS 权限。无这些浏览器头的本地脚本仍可调用，setup/control 的令牌检查保留。

Vite 的普通 `/api` 同源代理保留原 Host/Origin，因此可用；受控重启等 setup/control 路径继续遵守其独立守卫，调试时从服务端同源页面操作。此边界不是用户登录，也不授权把服务部署到公网。真实服务回归见 [local-request-guard.test.ts](test/local-request-guard.test.ts)，浏览器证据见 [local-origin.spec.ts](../e2e/local-origin.spec.ts)。

跨模块依赖见 [架构入口](../docs/architecture/README.md)；任务与阶段进度统一查 [状态页](../docs/status.md)。
