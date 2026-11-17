# DEP-SEC-MINIMATCH-01 本地候选验证

2026-11-18，Windows x64，Node v24.15.0 / npm 11.12.1，基于 `2c66477`。原生命令、指纹、失败与重试见 [result.json](result.json) 和 [receipts](receipts/)。未推送、建 PR、合并、发布或关闭告警。

收据为可逆 `.raw.b64`，索引含编码/解码双 SHA 与字节数。[解码脚本](decode-receipts.cjs) 接收绝对输出目录，校验后还原原始 JSON/log；Git 空白检查保持启用。

## 范围

仅覆盖 `app-builder-lib@26.18.0 → minimatch@^10.2.5`、`@electron/universal@2.0.3 → minimatch@^9.0.3` 至 11.0.9，生产 glob 原 ^11.0.5 范围刷新至同版。锁仅改三条记录；legacy 3.1.5/5.1.9、shell-quote 与其他包不变。真实安装去重现代副本，升级父包须重新核对 override。

| 上游公告 | 影响范围 | 修复版 |
|---|---|---|
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | >=7.0.0, <11.0.1 | 11.0.1 |
| [GHSA-hqmv-qgp3-jx75](https://github.com/isaacs/minimatch/security/advisories/GHSA-hqmv-qgp3-jx75) | 11.0.3–11.0.7 | 头部11.0.8，正文仍含旧措辞 |

生产 audit 基线为0，未覆盖新公告，另按上游范围核验。依赖暴露已确认，产品可利用性未证明；未执行资源耗尽攻击。未引入 universal 3.x 迁移。

## 最终收据

| 检查 | 原生退出码 | 结果 |
|---|---:|---|
| 独立 npm ci / npm ls | 0 / 0 | 无联接、无 invalid |
| [installed guard](verify-minimatch.mjs) | 0 | 20 passed；版本、消费者模式/API、legacy |
| 额外解析 / 公开 import 控制 | 0 / 0 | legacy4项、Node/ESM3项通过 |
| full / production audit | 0 / 0 | 各0漏洞，另核上游公告 |
| npm test | 0 | server2654＋desktop369＝3023，无跳过 |
| npm run build | 0 | 类型与服务端/前端构建通过 |
| portable / NSIS x64 | 0 / 0 | app1.3.8、Electron44.10.2，publish never |
| [包清单及模块探针](verify-packaged.cjs) | 0 / 0 | 仅11.0.9；glob4文件、index/JS200、missing404、SQLite通过 |
| desktop-app strict | 3 | 31 covered / 10 planned / 0 RED，整表未闭合 |

包探针用 [等待驱动](run-package-runtime.cjs) 运行真实 Electron，隔离 profile/data/TDX，不开网络端口。迁移资源与本树构建产物 hash 一致；HTML 与 HEAD Git blob 仅换行不同，保存指纹后只恢复本树生成改写。NSIS 更新配置由 builder 生成，按 feed 与 cache 名严格校验，见收据。

## 失败与限制

保留基线 guard RED、冷缓存中止、自动 lock 更新漏改/误删、宽泛 selector 的 ELSPROBLEMS、初版测试0xC0000409及打包中止、两次 import 路径探索错误。最终从 base lock 仅替换三条官方元数据，收窄 selector 后重装重验。

另保留 NSIS 首跑下载 ETIMEDOUT（补齐现有脚本镜像后通过）、探针 Windows ASAR 路径与生成配置 hash 假设错误、PowerShell GUI 首次未等待（exit=null，不计通过）。修正准备后原断言目标均验证，产品代码未改。

未覆盖 macOS、安装向导、完整 UI 或用户验收。`build:desktop` 仍强制 portable，与 YAML 的 NSIS 目标分开验证。全局任务状态、ENG/work-items、生成 status 与矩阵台账由集成人对账。
