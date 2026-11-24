# M9-DEFER-01 隔离说明

用户于 2026-11-24 明确表示目前无法人工验收，要求 M9 留分支、不进入主线。`task/M9-ACCEPT-HOLD` 已由远端 readback 核实指向 `fe0989736ebf7428deb6dafcf1dbba992c2b50dc`，包含原 C2 工程证据。原始 ZIP 及其 SHA 不变；未验收、未授权发布。

隔离 PR 从同一提交切出，移出引擎、产品 API/CLI、UI、图表挂载、三示例和专属测试。旧预览标签仍指向原始提交，本 PR 不改写历史。现有 SQLite 公式表不 DROP、不迁移、不写入；新数据库不创建该表。录像 gzip 排空、取消生命周期、来源隔离测试、Windows 验收启动脚本与 minimatch 修复均保留；训练、交易、内置 MA/MACD/KDJ、区间测量不是 M9。

验收返回时用原 C2 包；认可后，在届时的 `main` 上新开恢复 PR，反向应用本次撤出差异、适配其后维护，重新核对 DB、回放、完整候选和 Windows 包。由于候选本来就是主线祖先，直接 merge 留存分支不会恢复功能。

本轮 RED：在改产品前，真实 Fastify / SQLite 两例失败，GET /api/formulas 实际返回 200，首次 migrateDatabase 会创建 formulas。撤出后同样测试两例通过；已另行运行生产构建。全量测试与浏览器检查分别记账；旧候选的 262/262 不能复用于本次产品撤出。

独立审查补强：使用 Fastify onRoute 锁住整个公式前缀；真实 electron-builder matcher 的增量旧文件对照先红后绿，明确排除 server/dist/formulas 子树。保留桌面迁移页面直接使用的 esbuild 开发依赖。首次全量单测运行过程中待迁移的旧测试文件发生变化导致发现失败，该轮不计为通过。

286fc50 验证：新 [设置页实景](settings-ready.png) 为本轮独立 SHA 校验快照的真实 Edge 运行（1 passed，0 skipped/flaky/failed，原生 0）。Windows Electron unpacked 实包通过污染旧 bundle 夹具验证：ASAR 6200 项，server 入口存在，公式目录及旧文件为 0，SHA256 698d8af35b097eaa16003cff63b2133676455a6411ee3ccff0f1f34f69ea1455。普通下载打包遇 ETIMEDOUT，后以本机缓存的精确 Electron 44.10.2 复跑成功，未运行安装/升级。主线共享解压失败由独立 PR59 合入 6c56648；本分支仅合流，不重写共同历史。

## 最终工程验证与集成（2026-11-24）

| 对象 | 核对结果 |
|---|---|
| 被测候选 | `c0b14b90f1b2bd8aea6dc6a498d107388933f873`，干净、隔离的 Windows 工作树。`npm ci` 与 `npm run build` 后运行完整候选验证，使用隔离的 TDX 样本与 v1.2.7 迁移包。 |
| 单轮最终结果 | `docs`、`impact`、`unit`、`types`、`build`、`snapshot`、`m2`、`journey` 八项退出码均为 0。单测 152 个文件、1832/1832；M2 24/24；真实 Edge 248/248，零跳过、失败或 flaky。较早的准备失败与缺夹具轮次不计入。 |
| 合并身份 | [PR #60](https://github.com/m1kuStark/a-share-kline-trainer/pull/60) 合入 `0b7d5d027f7ed40aff8bab465c29693d613cb3a4`；双方 Git tree 同为 `7f03b116a78a080b924b7f92306cb3f81a42033b`。 |
| 原始证明 | `candidate-proof.json` 的 SHA256 为 `2ad7eea5a9ca913a5d68a865f709023702b3bed29fb073e347c1d7cad348f499`；原始收据已在维护者工作区另行归档，不公开含本机路径的日志。 |

本轮验证的是**主线撤出 M9 后的回归**。保留分支仍为 `fe09897`，原 C2 包 SHA256 为 `a4858eab49ef603aa3e636c0790d591b29e1dc7f8ca40e7ff66c2a66b538c5a0`；未写入用户验收，也没有发布。
