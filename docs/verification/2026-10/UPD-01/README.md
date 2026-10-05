# UPD-01 在线版本更新·服务端核心 — 验证记录

- 基线：`cd06a71`（开工时 HEAD，工作树干净；M7-02 已合入）
- 契约与设计：[design.md](./design.md)（§2 API 契约＝UPD-02 消费面；§3 换装编排；§4 preserve 清单；§5 模块布局；§6 v1 范围裁剪）
- 矩阵：工作区 `.zcode/skills/ai-harness/matrix/updater.yaml`（11 行全部 covered）＋镜像 `ai-harness-lab/skill-v1/matrix/updater.yaml`
- 行为 oracle：用户 2026-10-06 原话（应用内在线更新＋历史训练数据保留本地）＋架构师 UPD-01 派发简报（proposed_default 清单见本页末尾，随收尾报告转呈用户确认）

## RED → GREEN 证据（阶段④）

- 测试文件（33 用例，全部零网络：manifestFetch/downloadFetch 全注入，零 api.github.com 访问）：
  - `server/test/updater-check.test.ts`（9）——check 三态＋清单源四级优先级＋版本暴露
  - `server/test/updater-verify.test.ts`（8）——真 zip 三态校验＋runtime 兼容＋解压安全
  - `server/test/updater-swap.test.ts`（9）——备份轮换/换装/回滚/preserve（临时目录迷你包）
  - `server/test/updater-apply.test.ts`（7）——apply 守卫与端到端全流程（launchUpdater 内联跑 runFromPlan，真实文件系统换装）
  - 夹具：`server/test/helpers/updater-fixtures.ts`（迷你发布包构造＋PowerShell Compress-Archive 真 zip＋纯 JS stored-zip 写入器＋fetch 替身；zip 按 spec 缓存控制并行负载）
- **RED**：`npx vitest run --config server/vitest.config.ts server/test/updater-*.test.ts` → **4 文件全部 `Cannot find module '../src/update/...'`**（功能缺失的正确失败，非语法/环境错）。
- **GREEN**：实现 `server/src/update/{version,manifest,zip,status,api,updater-core,updater}.ts`＋index.ts 挂接后 → **33/33 通过**（3.7s）。期间修正三处测试自身缺陷（manifestFetch 误返回对象、夹具 await 遗漏、artifactName 缺 .zip 后缀）与两处实现缺陷（TDZ 引用序、TS null 收窄），均未改断言语义。

## 门禁（第 4 步，命令＋退出码）

| 门禁 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 绑定检查（strict＋未跟踪） | `node <skill>/scripts/check-binding.mjs --repo <repo> --matrix <skill>/matrix/updater.yaml --strict --include-untracked` | 11 行 covered=11 / open=0 / RED=0；索引 1561 用例＋333 describe | **0** |
| 定向测试（新矩阵行） | `npx vitest run --config server/vitest.config.ts server/test/updater-{check,verify,swap,apply}.test.ts` | 33/33 ✓ | 0 |
| 全量（本树第三轮） | `npm test` | **118 文件 / 1501 测试全绿**（292.7s） | **0** |
| 构建 | `npm run build`（typecheck:web＋build:server＋build:web） | 全绿（chunk>500kB 警告为存量提示） | 0 |
| 发布构建（产物不提交） | `npm run release:windows -- --node-archive .runs/node-archive-cache/node-v24.15.0-win-x64.zip --node-checksums .runs/node-archive-cache/SHASUMS256.txt --out <临时目录>` | 见下节收据 | — |

### 全量套件负载型偶发的定位与登记（known/expected，非本任务引入）

前两轮全量各 1 失败，均在 `history-report.test.ts`（纯内存 Fastify+SQLite，与本改动零关联；两轮失败的是不同用例，均为 5s 超时）。三重复核：
1. 单独重跑 `npx vitest run ... history-report.test.ts` → **25/25 ✓（4.6s）**；
2. **基线提交对照**：`git stash push -u` 回到 `cd06a71` 后全量 → **1 failed / 1467 passed**（同类超时偶发，先于本任务存在）；
3. 本树第三轮全量（夹具 zip 缓存降低并行负载后）→ **1501/1501 全绿，exit 0**。
结论：Windows 高负载下的既有 5s 超时偶发，登记为 known；本任务不引入新失败。

## 语义锁定变异抽检（P4，executed 级，变异后跑杀手、恢复后复绿）

| 变异 | 改动 | 击杀测试（矩阵行） | 结果 |
|---|---|---|---|
| M1 SHA 校验旁路 | `verifyZipArtifact` 的 `if (options.expectedSha256)` → `&& false`（跳过强制校验） | `updater-verify: rejects a sha mismatch and never falls back to lenient checks`＋`updater-apply: fails the attempt on a SHA256 mismatch without touching the package...`（UPD-DOWNLOAD-VERIFY） | 两测试红（2 failed/13 passed）→ **击杀**；恢复后 15/15 绿 |
| M2 preserve 文件被搬走 | `performSwap` 开头把 `trainer.config.json` rename 进 trash | `updater-swap: moves old-only files away, places new files, and leaves runtime + preserve untouched`＋`updater-apply: downloads, verifies, drains, swaps, preserves user data, relaunches and completes`（UPD-PRESERVE-DATA） | 两测试红（2 failed/14 passed）→ **击杀**；恢复后 16/16 绿 |

M2 首版变异（无 mkdir 直接 rename）为**无效变异**（trashDir 未创建→ENOENT 被 catch 吞→等价空操作，16/16 假绿）——补 mkdir 后真变异被击杀；该插曲如实登记：变异必须先确认真正进入目标分支。恢复后 `grep -rn MUTATION server/src` = 0，33/33 绿。

## 发布侧 SHA256SUMS 核实结论（任务第 6 项）

`scripts/release/build.mjs` **已存在** SHA256SUMS 资产生成（行 602-605：`${zipSha}  ${artifactName}.zip` 写入 `<out>/SHA256SUMS` 并与 zip 一起独占发布），与消费端 `parseSumsLine` 解析格式同源（`^([0-9a-fA-F]{64})[ \t]+\*?(.+)$`）。**本任务对 build.mjs 零改动**——"新增"实为架构师简报的核实请求而非缺口。发布操作口径（非代码）：发布时把 SHA256SUMS 一并上传为 GitHub Release 资产，更新器检测到该资产即强制 SHA 校验（UPD-DOWNLOAD-VERIFY 消费端已就位）。

## 改动清单（server/src/update/ 新模块 7＋index.ts 挂接）

| 文件 | 职责（矩阵行） |
|---|---|
| `version.ts` | 包根定位＋package.json 版本读取（缓存）＋三段比较/tag 归一（UPD-VERSION-EXPOSE） |
| `manifest.ts` | 清单源四级解析（env>config>release 推导>常量）＋清单拉取解析＋人话错误（UPD-CHECK-*/UPD-MANIFEST-INJECTABLE） |
| `zip.ts` | 最小 central directory 读取器（PS5.1 反斜杠条目归一＋遍历/绝对路径拒绝＋CRC）＋verifyZipArtifact 四态（UPD-DOWNLOAD-VERIFY/UPD-RUNTIME-COMPAT）＋extractZip |
| `status.ts` | update-status.json 原子读写＋restarting→completed 补全协调 |
| `updater-core.ts` | preserve 集备份/轮换(5)、manifest 驱动换装（旧移走→新就位，账本回滚）、preserve 快照/核验/恢复、UpdatePlan 类型 |
| `updater.ts` | runFromPlan 编排（control 排空→受控退出→等退出→备份→换装→核验→spawn launcher.cjs→健康版本核验→completed/failed）＋detached 进程入口 |
| `api.ts` | check/apply/status 三端点＋下载进度＋SHA256SUMS 强制校验＋更新器工作目录准备与 spawn |
| `index.ts` | /api/health 增 currentVersion（三身份字段不动）；registerUpdateApi 挂接 |

## 手动兜底（永久）

GitHub Releases 手动下载路径永久可用（全量包重装不碰 dataDir 与 trainer.config.json，历史训练数据天然保留——这正是默认 dataDir 包内布局下的换装安全性来源；在线更新失败也绝不影响手动路径）。

## 待用户拍板项（proposed_default，随收尾报告转呈）

1. **runtime 兼容口径收紧**：nodeVersion **完全一致**才在线换装（简报原文为"大版本不兼容才拒绝"）；次版本变更也走全量包。理由：可测性（运行中 exe 换装需真实进程实验）＋规避 Windows exe 文件锁＋YAGNI。
2. **preserve 清单定稿**：包根 `trainer.config.json`＋包内 `data/` 整目录原位不动；备份集为 trainer.config.json＋trainer.sqlite(+wal/shm)＋saved-tdx-choice.json＋trainer-state.json（排除日志/下载/工作目录）。
3. **备份数量 5**（简报冻结常量）、备份目录 `data/backups/update-<时间戳>/`。
4. **重启后自动开浏览器**（launcher Start 语义缺省，与 Start.cmd 对等）。
5. **v1 范围裁剪**：不做增量更新/强制更新/自动检查/签名校验/channel 选择。
6. **apply 需手动触发**：POST /api/update/apply 仅由用户在设置页点击触发（UPD-02 接线），服务端不做任何自动检查或自动应用。
7. **状态机新增 completed 终态**（契约枚举在简报基础上补 completed；restarting→completed 由更新器确认或新服务端点补全协调）。
8. **check 网络失败返回 200＋error 字段**（不 5xx；契约形状按简报 `{error?}` 字段存在推定，UPD-02 UI 按此消费）。
