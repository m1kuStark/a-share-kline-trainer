# CN-FEED-01 验证记录：国内 feed 优先＋回退官方、更新源可配置、发布同步脚本

- 任务：CN-FEED-01（矩阵行 UPD-CN-FALLBACK-DESKTOP / UPD-CN-FALLBACK-HTTP / UPD-FEED-SETTING / RELEASE-CN-FEED-SYNC，均预登记 planned）
- 日期：2026-10-13；base：a319520（分支 cn-feed，worktree D:\tmp\cnfeed01）
- 行为 oracle：用户 2026-10-13 拍板原话「不能依赖 github 链接提供下载资源，应该提供纯国内网络也能正常更新的发布路径」＋「允许改进」＋GPU3060-E2E-01 wave-e 实证（GitHub 直连间歇失败、可行窗 820KB/s）
- 锚定备注：`docs/work-items/tasks/CN-FEED-01.md` 任务卡在 worktree 与主仓库均不存在（task-manifest.mjs 退出 1「任务卡不存在」）——以派发简报为锚定事实源（allowed paths/矩阵行/门禁命令均来自简报），此缺口已登记相邻问题，不阻断。

## 一、设计节（GREEN 前冻结）

### 1.1 镜像 URL 常量——单一事实源（设计要求 1）

- 常量唯一落点：`server/src/update/manifest.ts` 新增 `export const CN_MIRROR_BASE = ''`（空串＝镜像未上线，一切回退链安全退化为纯 GitHub）。**W4 填入真实 URL 只改这一处**（编译后 desktop 经 dist import 同源）。
- desktop 侧 `desktop/src/cn-feed.ts` `import { CN_MIRROR_BASE } from '../../server/dist/update/manifest.js'` 并 re-export——沿 `desktop-updates.ts` import `server/dist/update/version.js` 的既有先例（桌面主进程与 server 同仓同构建，server build:server 先行）。
- 派生 URL（尾斜杠归一）：
  - desktop electron-updater feed＝`joinUrl(CN_MIRROR_BASE, 'latest.yml')`（`cnMirrorLatestYmlUrl`，定义在 desktop/src/cn-feed.ts）；
  - zip HTTP 链 manifest＝`joinUrl(CN_MIRROR_BASE, 'manifest.json')`（`cnMirrorManifestUrl`，定义在 server/src/update/manifest.ts）。
  - 两个文件名与 sync 脚本产出物一一对应（§1.5）；同步义务＝sync 脚本测试锁死两个文件名，改名即测试红。

### 1.2 desktop electron-updater 链回退（UPD-CN-FALLBACK-DESKTOP，设计要求 2）

新文件 `desktop/src/cn-feed.ts`（纯决策＋适配器包装层，不 import electron）：

- `resolveDesktopFeedPlan(env, setting, mirrorBase = CN_MIRROR_BASE): FeedPlanEntry[]`（有序尝试计划）：
  1. env `TRAINER_DESKTOP_UPDATE_FEED` trim 非空 → `[{ provider:'generic', url:env, label:'env' }]`——**注入即不回退**（UPD-DESKTOP-FEED-INJECTABLE 冻结口径零破坏）；
  2. setting.source=`'official'` → `[GitHub 常量]`；
  3. setting.source=`'custom'` 且 customUrl 为 http(s) → `[generic customUrl]`（URL 非法→落入 4，fail-safe）；
  4. 其余（auto/未配置/非法）→ mirrorBase 非空串 ? `[镜像 latest.yml, GitHub]` : `[GitHub]`（镜像未上线＝纯 GitHub，行为安全）。
- `createFeedFallbackAdapter({ inner, getPlan, logger })`：实现既有 `DesktopUpdaterAdapter` 同一面（controller/IPC/渲染端零改动）：
  - `checkForUpdates()`：每次检查先重取计划（异步，检查期读取最新用户设置），逐源 `inner.setFeedURL(feed)` → `inner.checkForUpdates()`；成功即返回（此后不再 setFeedURL——**下载沿用最终 check 成功的源**，electron-updater feed 同源语义）；失败记录 attempt 后继续；全部失败抛**最后一次**的错误对象（由 controller 的 normalizeUpdaterError 人话化，错误取最终源）。镜像 404/超时/拒连一律算失败（不做内容嗅探——checkForUpdates 拒绝即失败）。
  - `setFeedURL(feed)`（外部直设＝显式单源覆盖，兼容既有接线形态，覆盖后计划＝该单源）；
  - `downloadUpdate/quitAndInstall/onDownloadProgress` 纯委托 inner；
  - `lastAttempts(): FeedAttemptRecord[]`——观测缝数据源（§1.6）。
- main.ts NSIS 分支粘合：`adapter = createFeedFallbackAdapter({ inner: adaptElectronUpdater(updater), getPlan: async () => resolveDesktopFeedPlan(process.env, await readUpdateSourceSetting(portableUpdateDataDir)), logger: console })`；`portableUpdateDataDir` 惰性取值（bootServerAndOpen 回填 config.dataDir；沿用 archiveDataDir 同款惰性先例）。
  - **已知时序限制（proposed_default）**：setupUpdateChannel 先于 bootServerAndOpen（UPD-BOOT-AUTO-CHECK「注册即检查」冻结语义不可动）→ boot 自动检查时数据目录尚未回填，读到 auto 默认计划；boot 之后的手动检查/下载按用户设置走。影响＝非 auto 用户仅 boot 检查多一次镜像尝试后回退（结果同源），非正确性破损。
- 便携分支（PORTABLE_EXECUTABLE_DIR）与 dev 通道零触碰（INSTALL-01 后便携已退役，`resolveUpdateFeed` 原接线保留）。

### 1.3 zip HTTP 链回退（UPD-CN-FALLBACK-HTTP，设计要求 3）

`server/src/update/manifest.ts`：

- 新增 `resolveManifestPlan({ env, launcherConfigPath, releasePublicURL, setting, mirrorBase = CN_MIRROR_BASE }): Promise<ManifestPlanEntry[]>`（既有 `resolveManifestUrl` 函数原样保留——UPD-MANIFEST-INJECTABLE 四级优先级测试零改动）：
  1. env `TRAINER_UPDATE_MANIFEST_URL` → `[env]`（不回退）；
  2. trainer.config.json `update.manifest_url` → `[config]`（不回退，冻结口径）；
  3. setting.source=`custom`（URL 合法）→ `[custom]`；`official` → `[GitHub 默认]`；
  4. auto/未配置 → mirrorBase 非空 ? `[镜像 manifest.json, GitHub 默认]` : `[GitHub 黜]`（GitHub 默认＝既有 release publicURL 推导→repo 常量）。
- `server/src/update/api.ts`：check/apply 的清单获取从「单 URL fetch」改为「计划逐源 fetch，首个 ok 即用；全败取最后一次错误」；响应 `manifestUrl` 字段＝**实际成功（或最后尝试）的源 URL**（既有语义「本次实际使用的清单源」的自然延伸）。既有注入（options.manifestUrl override / manifestFetch）零破坏。

### 1.4 更新源三态设置（UPD-FEED-SETTING，设计要求 4）

- **共享形状与读写器**：新文件 `server/src/update/update-source.ts`——`update-source.json`（落 `<dataDir>/`，原子写 tmp+rename，沿 data-dir.ts writeLauncherConfig 先例）：
  ```json
  { "source": "auto | official | custom", "customUrl": "https://… | null" }
  ```
  `parseUpdateSourceSetting`（严格：source 三态枚举＋custom 时 customUrl 必须 http(s)，非法一律 null＝按 auto 下落，fail-open 到安全默认）；`readUpdateSourceSetting(dataDir)`（缺/坏/非法→null）；`writeUpdateSourceSetting`。desktop 经 `server/dist` import 同一实现（单一事实源）。
- **端点**（挂 `registerUpdateApi`，路径 `/api/update/source`，server/src/update/api.ts 内——全部 server 改动收敛在 update 模块）：
  - GET → `{ source, customUrl, origin: 'env'|'config'|'setting'|'default', mirrorConfigured: boolean }`（origin：env＝`TRAINER_UPDATE_MANIFEST_URL` 或 `TRAINER_DESKTOP_UPDATE_FEED` 任一注入——两链各自的 env 胜出面；config＝trainer.config.json manifest_url；setting＝设置文件已落盘；default＝其余）。
  - PUT `{source, customUrl?}`：source∈三态；custom 时 customUrl 必填 http(s)；auto/official 时 customUrl 必须缺省或 null（严格校验，沿 parseDataDirPut 先例）；`config.dataDir` null → 409（无处可写不伪装成功，沿 data-dir PUT 409 先例）；成功 200 回读视图。
- **优先级**（两链同构）：env 注入 > 既有 config 注入（zip 链 trainer.config.json manifest_url）> 用户三态设置 > 内置默认（auto）。设置即时生效（两链每次 check 重取计划，无需重启）。
- **UI**（web/src/components/TrainingSettings.vue「关于与更新」分栏，版本行下方）：
  - 三 radio（自动（推荐）＝镜像优先回退官方／官方 GitHub／自定义 URL）＋ custom 时 URL 输入框＋保存按钮；
  - origin=`env` 时提示「更新源已由环境变量注入，以下设置暂不生效」；mirrorConfigured=false 时自动项附注「国内镜像上线后将自动启用镜像优先」；
  - enterAboutSection 时 GET 加载，保存 PUT；呈现类文案为 proposed_default。既有三态/进度/守卫呈现面零改动（新增元素类名 .update-source-*，不占既有选择器）。

### 1.5 发布同步脚本（RELEASE-CN-FEED-SYNC，设计要求 5）

- `desktop/scripts/sync-feed-lib.mjs`（纯函数层，沿 release-desktop-lib.mjs 先例；复用其 `desktopArtifactNames/parseLatestYml`）＋ `desktop/scripts/sync-feed.mjs`（CLI 编排；无 shebang，repo 惯例经 node 调用）。
- CLI：`node desktop/scripts/sync-feed.mjs --release <产物目录> --mirror <镜像base> [--notes <发布说明>] [--out <输出目录>]`（out 缺省＝产物目录同级的 `dist-cn-feed/`）。
- 产出目录内容：
  1. `latest.yml`：解析源 latest.yml（版本即真相源，不另传版本参数）→ `path` 与 `files[].url` 改写为 `<base>/<文件名>` 绝对 URL，sha512/size/releaseDate 原样；
  2. `manifest.json`：GitHub Releases latest API 同形状字段子集 `{tag_name:'v<版本>', name, body:notes??'', assets:[{name, browser_download_url:'<base>/<name>', size}]}`（UPD-01 design §2.1 消费契约；assets 覆盖全部托管文件、按名排序确定性输出）；
  3. 复制：setup exe＋blockmap（存在即复制）＋zip（`kline-trainer-v<版本>-windows-x64.zip`）＋`SHA256SUMS`＋migrate-v127.zip（存在即复制）。
  - fail-closed 必备：latest.yml＋setup exe＋zip＋SHA256SUMS 缺一即 throw 不产出；blockmap/migrate 可选。
- 产出后自校验（fail-closed，任一不符 throw）：输出 latest.yml 可解析＋全部 URL/path 前缀＝`<base>/`＋sha512/size 与输出 setup exe 实际字节一致；manifest.json 可解析＋zip 资产按精确名在位＋URL 正确＋size 与实际字节一致；每个复制文件 sha256 与源文件一致（校验和与源一致）；资产文件全部在位。
- 零外部凭证依赖：脚本不触网、不上传（上传由 orchestrator 经托管控制台完成）；发布手册增补国内源发布段落（--release 指向含双形态产物的目录、W4 后 --mirror 填真实 base、上传 dist-cn-feed 全目录）。

### 1.6 观测缝（设计要求 6）

- boot-check.json（env `TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT` 既有缝）增加 `sources` 字段：`[{ label:'cn-mirror'|'github'|'env'|'custom'|'external', url, outcome:'ok'|'failed', error:string|null }]`——`registerUpdateIpc` 新增可选 dep `bootCheckSources?: () => unknown`，落盘 JSON 追加该字段（字段名与形状＝proposed_default，W5 真机判断走了哪个源用）。既有七字段不改动（updater-notice/boot-check 既有断言零破坏）。

### 1.7 YAGNI 边界（设计要求 7）

不做：多镜像列表、测速选源、electron-updater 库行为修改、boot 检查时序重构（UPD-BOOT-AUTO-CHECK 冻结「注册即检查」）。

## 二、测试计划（RED 先行；用例名避开全角冒号与引号）

| 新测试文件 | 锁定行 | 关键断言（oracle 独立：期望 URL/顺序/错误均为手写，非实现回显） |
|---|---|---|
| desktop/test/cn-feed.test.ts | UPD-CN-FALLBACK-DESKTOP（计划三态＋回退执行＋观测缝）；UPD-FEED-SETTING（desktop 侧计划映射） | auto+镜像 → [镜像, GitHub] 双源；镜像未配置 → 单 GitHub；env 注入 → 单源不回退；official/custom 单源；镜像 check 拒绝 → setFeedURL(镜像)后 setFeedURL(GitHub) 成功，结果取 GitHub，lastAttempts 两记录；全败抛最后一次错误；下载前无再次 setFeedURL（同源下载）；boot-check sources 落盘 |
| server/test/updater-feed-setting.test.ts | UPD-CN-FALLBACK-HTTP；UPD-FEED-SETTING（端点＋优先级＋web 接线） | 未注入时镜像 404 → GitHub 清单成功且 manifestUrl=GitHub URL；env 注入失败不回退（fetcher 恰被调 1 次且 URL=env）；resolveManifestPlan 四级优先级逐级断言；GET/PUT 端点真 fs 持久化＋校验 400/409；TrainingSettings.vue 源码契约（GET/PUT fetch 接线＋三 radio＋env 覆盖提示） |
| desktop/test/sync-feed-lib.test.ts | RELEASE-CN-FEED-SYNC | latest.yml 改写后 path/url 前缀＋sha512/size 原样；manifest.json 形状（tag_name/zip 精确名/SHA256SUMS/绝对 URL/size）；真实 fs 集成档：runCnFeedSync 产出＋自校验通过；缺必备产物 fail-closed throw；校验和与源一致（篡改即拒） |

## 三、RED 证据（先写测试，亲见正确原因失败）

| 测试文件 | 首跑结果 | 失败原因（正确性判据） |
|---|---|---|
| desktop/test/cn-feed.test.ts | 0 test，suite FAIL | `Cannot find module '../src/cn-feed.js'`——功能缺失（模块不存在），非语法/环境错 |
| server/test/updater-feed-setting.test.ts | 0 test，suite FAIL | `Cannot find module '../src/update/update-source.js'`——同上 |
| desktop/test/sync-feed-lib.test.ts | 0 test，suite FAIL | `Cannot find module '../scripts/sync-feed-lib.mjs'`——同上 |

分阶段 RED（实现 cn-feed.ts 后、改 update-ipc.ts 前）：11 用例 10 绿 1 红——唯一红＝`boot-check.json 落盘 sources 尝试记录`（written.sources undefined，update-ipc 观测缝未实现）＝该缝以正确原因失败。另：server 侧 `PUT {source=official, customUrl}` 首跑得 200（期望 400）——实现静默丢弃了非法 customUrl，修 parseUpdateSourceSetting 后转绿（RED 拦住了一个真实校验漏洞）。测试期望中一处 source 标签细化（official 分支 'default'→'official'，URL oracle 不变、断言更具体，设计节未冻结该标签）。

## 四、GREEN＋门禁全表（2026-10-13，worktree D:\tmp\cnfeed01@cn-feed）

| 门禁 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| desktop 全量 | `npm run test:desktop` | **0** | 25 文件 250 用例全绿（含真实 NsisUpdater fixture 慢档） |
| server 定向 updater | `npx vitest run --config server/vitest.config.ts updater` | **0** | 8 文件 80 用例全绿（updater-check/-verify/-swap/-apply/-network/-notice/-ui/-feed-setting） |
| 全量构建 | `npm run build`（typecheck:web＋build:server＋build:web） | **0** | vue-tsc 零错；server tsc 零错（含新 update-source.ts） |
| 桌面主进程编译 | `npm run build:desktop:main` | **0** | main.ts/cn-feed.ts 编译零错（server/dist import 解析正常） |
| 绑定检查 | `check-binding.mjs --repo <abs> --matrix updater.yaml --strict` | 3 | 40 行：covered=34（既有绑定零悬空零破坏）＋open=6（＝本任务 4 行 planned 待 orchestrator 绑定＋2 行既有 superseded 退役行）；RED=0。**模拟绑定验证**：以临时矩阵副本（4 行填入本文档 §5 的 test IDs＋covered）重跑 strict → covered=38、open=2（仅存量 superseded）、29 个 test ID 全部逐字命中索引零悬空——绑定集可直接誊入 |

全量 server 套件补充事实（超出本任务门禁清单的额外巡检）：我的树 1686 用例 1683 绿 3 红（api.test PORT-GHOST / release-launcher 二写者 / review-profile raw-file 三例，全部与 update 域零 import 关系，隔离重跑 110/110 绿）；**基线（干净 a319520）全量同样 exit 1 且失败集不同**（history-report 分页一例）——实证为既有并行负载抖动（端口/时序敏感用例），非本任务回归。逐名报告如上，未隐瞒。

## 五、4 行 test ID 绑定（vitest list＋check-binding 索引双重核对过，逐字可誊）

**UPD-CN-FALLBACK-DESKTOP**（desktop/test/cn-feed.test.ts）：
- `UPD-CN-FALLBACK-DESKTOP: auto 加镜像已配置 → 镜像 latest.yml 优先 GitHub 兜底（有序双源，尾斜杠归一）`
- `UPD-CN-FALLBACK-DESKTOP: 镜像未配置（空串）→ auto 计划退化为纯 GitHub 单源（镜像未上线行为安全）`
- `UPD-CN-FALLBACK-DESKTOP: env 注入时不回退——计划仅含 env 单源，空串 env 视为未设置`
- `UPD-CN-FALLBACK-DESKTOP: 镜像失败回退 GitHub 成功——逐源 setFeedURL、结果取 GitHub、attempts 如实记录`
- `UPD-CN-FALLBACK-DESKTOP: 镜像可用时不触碰 GitHub——单源尝试即成功`
- `UPD-CN-FALLBACK-DESKTOP: 全部源失败 → 抛最后一次尝试的错误（错误取最终源），attempts 全 failed`
- `UPD-CN-FALLBACK-DESKTOP: check 成功后下载沿用成功源——downloadUpdate 前无再次 setFeedURL`
- `UPD-CN-FALLBACK-DESKTOP: 外部 setFeedURL 直设＝显式单源（注入即不回退）`
- `UPD-CN-FALLBACK-DESKTOP: boot-check.json 落盘 sources 尝试记录（label/url/outcome/error 形状）`

**UPD-CN-FALLBACK-HTTP**（server/test/updater-feed-setting.test.ts）：
- `UPD-CN-FALLBACK-HTTP: 未注入且镜像已配置 → 镜像 manifest.json 优先 GitHub 兜底（尾斜杠归一）`
- `UPD-CN-FALLBACK-HTTP: 镜像未配置（空串）→ 计划退化为纯 GitHub 默认（镜像未上线行为安全）`
- `UPD-CN-FALLBACK-HTTP: cnMirrorManifestUrl 拼接（与 sync 脚本产出文件名一致）＋内置常量当前为空串`
- `UPD-CN-FALLBACK-HTTP: 镜像清单失败回退 GitHub——结果取 GitHub，manifestUrl=实际成功源`
- `UPD-CN-FALLBACK-HTTP: env 注入失败不回退——fetcher 恰一次且 URL=env 源`

**UPD-FEED-SETTING**（desktop/test/cn-feed.test.ts＋server/test/updater-feed-setting.test.ts）：
- `UPD-FEED-SETTING: 三态映射——official 单源 GitHub、custom 单源 generic、custom URL 非法按 auto 下落`（desktop/test/cn-feed.test.ts）
- `UPD-FEED-SETTING: 优先级 env > trainer.config manifest_url > 三态设置 > 内置默认（逐级断言）`（server/test/updater-feed-setting.test.ts）
- `UPD-FEED-SETTING: PUT 校验与原子持久化＋GET 回读（origin=setting、mirrorConfigured 如实）`（server/test/updater-feed-setting.test.ts）
- `UPD-FEED-SETTING: env 注入（两链任一）→ GET origin=env；无 dataDir → PUT 409 不伪装成功`（server/test/updater-feed-setting.test.ts）
- `UPD-FEED-SETTING: 未设置时 GET 默认视图（source=auto、origin=default）`（server/test/updater-feed-setting.test.ts）
- `UPD-FEED-SETTING: 缺失/损坏/非法内容一律 null；合法 custom 回读`（server/test/updater-feed-setting.test.ts）
- `UPD-FEED-SETTING: 更新源三态接线——GET/PUT /api/update/source＋三选项＋custom URL 输入`（server/test/updater-feed-setting.test.ts，web 源码契约）
- `UPD-FEED-SETTING: env 覆盖与镜像未上线提示文案（origin=env 时不伪装可配置）`（server/test/updater-feed-setting.test.ts，web 源码契约）

**RELEASE-CN-FEED-SYNC**（desktop/test/sync-feed-lib.test.ts）：
- `assertMirrorBase 只收 http(s) 无查询无锚点 URL，尾斜杠归一`
- `path 与 files url 改写为镜像绝对 URL，sha512/size/releaseDate 原样`
- `tag_name 带版本、zip 资产按精确名、SHA256SUMS 资产在位、绝对 URL、按名排序`
- `产出齐备的国内发布目录——latest.yml/manifest.json 改写正确、复制文件字节一致、自校验通过`
- `fail-closed——缺必备产物（SHA256SUMS）即 throw 并点名缺失，不产出`
- `自校验拒绝被篡改的产物——setup exe 字节被改后 sha512 与 latest.yml 不符`
- `输出目录已存在且非本脚本产物（无 latest.yml）→ 拒绝执行不覆盖`

（每个 ID 前缀文件路径 `desktop/test/…::`／`server/test/…::`；本文档 Markdown 渲染下全角字符与原文逐字一致。）

## 六、变异抽检（executed，2026-10-13）

| 变异 | 改动 | 杀手测试 | 结果 |
|---|---|---|---|
| M1 回退行 | cn-feed.ts 回退循环 catch 后直接 `throw lastError`（删回退） | `镜像失败回退 GitHub 成功——逐源 setFeedURL、结果取 GitHub、attempts 如实记录` | killed：exit 1，该用例死（版本取不到 9.9.9） |
| M2 sync 改写行 | rewriteLatestYmlForMirror 原样返回不改写 | `path 与 files url 改写为镜像绝对 URL…` 等 | killed：exit 1，3 用例死（改写单元＋runCnFeedSync 产检＋幂等档） |

两变异均已还原，还原后 cn-feed＋sync-feed-lib 18/18 绿（exit 0）。

## 七、proposed_default 清单（提验，验收确认后升级）

1. **镜像常量位置与 W4 填入方法**：`server/src/update/manifest.ts` 的 `CN_MIRROR_BASE`（当前空串）。W4 步骤：填入真实 base URL（形如 `https://<envId>.tcloudbaseapp.com/feed`，尾斜杠有无均可）→ `npm run build:server`（desktop 链经编译产物 import 自动同源）→ 随下个版本发布。同时需把 server/test/updater-feed-setting.test.ts 中 `expect(CN_MIRROR_BASE).toBe('')` 一处断言更新为真实值（测试内有注释指引）。
2. **boot-check sources 字段形状**：`sources: [{label:'cn-mirror'|'github'|'env'|'custom'|'external', url:string, outcome:'ok'|'failed', error:string|null}]`（url 对 github 源为 `github:<owner>/<repo>` 展示串）；仅在设置 `TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT` 时落盘。
3. **设置页文案**：更新源三选项文案（自动（推荐）／官方 GitHub／自定义 URL）、自动项镜像提示两句（mirrorConfigured 如实切换）、env 覆盖提示「更新源已由环境变量注入，以上设置暂不生效（环境变量优先）」、保存成功「更新源已保存，下次检查更新生效」。
4. **boot 检查时序限制**：setupUpdateChannel 先于数据目录回填（UPD-BOOT-AUTO-CHECK「注册即检查」冻结不可动）→ boot 自动检查读到 auto 默认计划；boot 后手动检查/下载按用户设置走。非 auto 用户的 boot 检查会多一次镜像尝试后回退（结果同源），非正确性破损。
5. **manifest.json 细节**：assets 覆盖镜像目录全部托管文件（含 setup exe/blockmap/migrate——zip 链只消费 zip＋SHA256SUMS，其余资产为发布目录完整性与人工下载便利）；body 默认空串（sync-feed.mjs --notes 可传）。
6. **zip 链三态的 config 注入层**：trainer.config.json `update.manifest_url`（既有）优先于三态设置——设置页 GET origin='config' 时 UI 未单独提示（当前仅 env 有提示；既有 config 注入是 power-user 场景，出现即 origin 显示 config）。

## 八、needs_user_decision

（无阻断项——本任务全部行为均已获用户拍板：镜像优先回退官方（原话见 oracle）＋「允许改进」。仅一项前置提醒：**国内托管（CloudBase 静态托管）上线仍待用户授权**——W4 填 URL 前两链自动退化为纯 GitHub，行为安全，不依赖本任务返工。）

## 九、相邻问题（登记不顺手修）

1. 任务卡 `docs/work-items/tasks/CN-FEED-01.md` 不存在（task-manifest.mjs 退出 1「任务卡不存在」）——orchestrator 预登记了矩阵行但未落任务卡文件；本次以派发简报为锚定事实源。
2. server 全量套件在本机并行负载下存在既有抖动（端口/时序敏感用例）：我的树 3 例红（隔离全绿）、干净基线 1 例红且集合不同（history-report 分页）——与本任务无关，建议后续登记为 flaky 清单单独治理。
3. release-desktop-lib.mjs 的 renderSha256SumsFile 用 localeCompare 排序——跨 ICU 环境输出顺序可能漂移（本任务 sync-feed-lib 已改用字节序排序规避同问题；既有函数未动）。
4. e2e/update-settings.spec.ts 未在本任务门禁内复跑（更新源 UI 为纯增量元素、既有选择器零触碰；类型检查 vue-tsc 绿）。建议发布验收轮一并复跑 3 用例。

