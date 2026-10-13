# MIRROR-URL-FIX（v1.3.3 P0 热修）验证记录

- 任务：修复 v1.3.2 默认国内镜像优先不工作的 URL 双拼缺陷并发布 v1.3.3。
- 分支/提交：worktree `D:\tmp\mirfix01`，branch `mirror-url-fix`（base=main@4f97074）；修复提交 a713df2，发布提交 de7878f（=tag v1.3.3）。main 已推 `4f97074..de7878f`。
- 矩阵影响：`UPD-CN-FALLBACK-DESKTOP` 行为语义不变（修复实现缺陷，EARS 零改动）；`RELEASE-CN-FEED-SYNC` 行为增强（latest.yml 追加 releaseNotes 字段，EARS 说"url/path 改写"未禁 notes 追加）。两处 binding_note 补记内容见 §7，由 orchestrator 录（矩阵文件本轮禁写）。

## 一、缺陷与根因（复现依据）

- 现象（W-D 真机，2026-10-13）：v1.3.2 boot-check 恒回退 GitHub；镜像侧 `…/feed/latest.yml/latest.yml` 404（双拼）。
- 根因：`desktop/src/cn-feed.ts` 的 `cnMirrorLatestYmlUrl` 返回 `<base>/latest.yml`（全文件 URL），而 electron-updater `GenericProvider` 把 `configuration.url` 作 baseUrl：`out/providers/GenericProvider.js:12` `baseUrl = newBaseUrl(url)`（pathname 无尾斜杠则补 `/`）→ `:25` `newUrlFromBase(getChannelFilename('latest'), baseUrl)` 再拼 `latest.yml` ⇒ `<base>/latest.yml/latest.yml` 404。
- W-D 真机实证（oracle 依据）：目录形态 `<base>/` 2.3s 成功发现 v1.3.2（三次稳定）；全 URL 404；117MB 下载＋校验＋安装＋重启 4.9s（CDN 热）。

## 二、RED（bug-loop ①：先写以正确原因失败的回归）

改造 `desktop/test/cn-feed.test.ts`＋`desktop/test/sync-feed-lib.test.ts`：

1. **oracle 升级（非删断言）**：旧断言是桩回显——mock `setFeedURL` 记录我方产出的 URL，再断言等于同一函数产出（实现自证，development-principles §4.2 反例）。升级为**真实库代码 oracle**：测试经 `createRequire('electron-updater/out/util.js')` 取运行时导出 `newBaseUrl`/`newUrlFromBase`/`getChannelFilename`（GenericProvider constructor 与 getLatestVersion 的同一拼装路径；`out/util.d.ts` 未声明 newBaseUrl 故走 require），对 `cnMirrorFeedUrl(base)` 产出执行真实 `new URL` 解析链，断言命中 `<base>/latest.yml`。**oracle 独立性论证**：期望值由 WHATWG URL 解析语义＋electron-updater 库源码行为决定，与被测实现的字符串拼接零同源；并用反例断言锁定旧缺陷形态（全 URL → `<base>/latest.yml/latest.yml`，即 W-D 真机 404 路径）。
2. 矩阵引用的 16 个既有测试标题原样保留（矩阵禁写），仅升级其内部 URL 期望（`…/latest.yml` → 目录形态 `…/`）。
3. releaseNotes 新用例：`rewriteLatestYmlForMirror` 注入/替换顶层 `releaseNotes:`（值=notes 参数；缺省空串；单引号转义；换行折叠；幂等恰一行）；`runCnFeedSync` 产物断言。

**RED 收据**（修复前运行）：

```
npx vitest run --config desktop/vitest.config.ts desktop/test/cn-feed.test.ts desktop/test/sync-feed-lib.test.ts
→ Tests 7 failed | 12 passed
失败原因全部正确：
- MIRROR-URL-FIX 用例：expected 'https://cn.example/pub/latest.yml' to be 'https://cn.example/pub/'（目录形态断言，旧实现全 URL）
- auto/空串/回退/单源用例：feed URL 期望 …/ vs 实际 …/latest.yml（同根因）
- releaseNotes 两用例：产物不含 releaseNotes 字段
```

## 三、GREEN（bug-loop ③：修复）

- `desktop/src/cn-feed.ts`：`cnMirrorLatestYmlUrl` 更名 `cnMirrorFeedUrl`，返回目录形态 `${base.replace(/\/+$/,'')}/`（更名理由：原名指称「latest.yml 文件 URL」正是双拼缺陷的心智模型根源；引用面=本文件＋测试＋sync 脚本注释，全数同步）。注释注明 GenericProvider 拼接依据＋W-D 真机实证。
- `desktop/scripts/sync-feed-lib.mjs`：`rewriteLatestYmlForMirror(text, base, notes='')` 注入/原位替换 `releaseNotes:`（YAML 单引号标量，`'` 加倍转义、换行折叠空格；无既有行插到 `version:` 后）；`runCnFeedSync` 透传 notes；`verifyCnFeedOutput` 增加 releaseNotes 存在性 fail-closed 检查；头部同步义务注释更新。

**GREEN 收据**：

```
定向：cn-feed 11 + sync-feed-lib 8 → 19 passed（exit 0）
server 定向：updater-feed-setting 12 passed（exit 0）
desktop 全量：26 files 258 passed（exit 0；基线 257＋新增 1）
真实 node_modules 下复跑 desktop 全量：258 passed（exit 0）
npm run build → exit 0；npm run build:desktop:main → exit 0（bump 后重建各一次）
```

## 四、门禁（check-binding strict＋基线对照）

```
check-binding.mjs --repo D:\tmp\mirfix01 --matrix …/matrix/updater.yaml --strict
→ 43 行 | covered=41 open=2 RED=0，exit 3
--rev 4f97074 基线对照 → 43 行 | covered=41 open=2 RED=0（完全一致）
```

两 open 行均为 base 已存在的 `[superseded]` 存量（UPD-PORTABLE-DOWNLOAD-VERIFY、RELEASE-PORTABLE-YAML-VALID），本轮零新增 open、零 RED；测试索引 2022→2023（＋1 新用例）。**语义锁定抽检（executed mutation）**：RED 阶段＝旧实现（全 URL 形态）对新技术断言的实弹变异，5 用例击杀；杀手测试＝「MIRROR-URL-FIX: cnMirrorFeedUrl＝目录形态 feed URL，经 electron-updater 真实解析命中 <base>/latest.yml 而非双拼」。releaseNotes 同理（缺字段即红）。

**npm test 全量**：1684 passed＋2 failed（release-launcher 启动 10s 就绪超时、review-profile symlink 用例）；单独重跑两文件 68/68 全过 ⇒ 判定环境抖动（非回归，与改动域无关，沿抖动基线对照纪律登记）。

## 五、发布（v1.3.3）与事故披露

### 5.1 事故：worktree junction 导致 asar 依赖缺失（冒烟拦截，已根治）

- 首次 `release:desktop`（junction node_modules 环境下）EXIT=0 但 electron-builder 日志含 `cannot find path for dependency`（fs-extra@undefined 等一大批）；**NSIS 冒烟第一轮 FAIL**：安装后 exe 90s 未 healthy，stderr=`Cannot find module 'fs-extra'`（asar 内 electron-updater 依赖链断裂）。
- 根因：worktree 的 root/desktop `node_modules` 均为指向主仓的 junction，electron-builder 依赖收集按真实路径解析，目标在工程根外被剔除 → asar 依赖不完整（109.2MB 坏包 vs 正确 111.8MB）。
- 处置：`cmd rmdir` 仅摘除两个 junction 链接（主仓 node_modules 实证完好）→ worktree 内真实 `npm ci`（exit 0，441 包）→ 重跑 `release:desktop`（exit 0，无 cannot find 告警，asar 5969 条 node_modules 条目、fs-extra 在位、asar package.json `"version": "1.3.3"`）→ 冒烟第二轮 PASS。**坏包从未上传**（Release 用的重打包产物）。
- 期间操作事故（零影响，如实披露）：`npx asar extract-file` 将 package.json 抽到仓库根并覆盖、`rm -f` 误删仓库 package.json（v1.3.2 报告警告过的 cwd 坑）→ `git checkout -- package.json` 秒级恢复（版本 1.3.3、scripts 完整），工作树干净。

### 5.2 发布收据

| 项 | 收据 |
|---|---|
| 版本/changelog | package.json 1.3.3＋CHANGELOG v1.3.3 段（proposed_default 文案），提交 de7878f |
| release:desktop | exit 0；setup exe 117,244,458B＋blockmap 122,382B＋latest.yml 397B＋migrate-v127.zip 250,499B＋SHA256SUMS-desktop.txt |
| zip 兜底 | `release:windows --node-archive … --out D:/tmp/wf133-zip-out` exit 0；zip 55,644,594B（sha256 9ca8c0ec…）＋SHA256SUMS；commit=de7878f=HEAD（隔离 npm ci，不受 junction 影响） |
| NSIS 冒烟（等价 /currentuser） | 第二轮 `SMOKE_PASS failures=0`：静默安装 exit0＋app-update.yml 在位＋health 200 `currentVersion:"1.3.3"`＋首页 html＋优雅退出 0＋无孤儿＋真实数据目录 INTACT（mtime 前后一致）＋沙箱库落沙箱＋卸载净（仅卸载器自身残留，人工清毕）＋**用户 per-machine 安装 D:\K-line-trainer\a-share-kline-trainer INTACT**（指纹逐条目一致）；脚本 `D:\tmp\wf133-smoke-lifecycle.mjs` |
| push/tag | `4f97074..de7878f main` exit 0；tag `v1.3.3`（指向 de7878f）exit 0 |
| GitHub Release | id=411654331，https://github.com/m1kuStark/a-share-kline-trainer/releases/tag/v1.3.3；7 资产逐个 201（小→大）；自查：releases/latest→v1.3.3、draft=false、prerelease=false、7 资产名×大小×state=uploaded 全对照 `ASSETS_ALL_MATCH`；latest.yml 资产原文 version: 1.3.3、url/path 指向本版 setup exe |
| token | `git credential fill` 提取、curl stdin `--config -` 注入（不进 argv、不落盘、不入报告） |

### 5.3 镜像目录（上传由架构师执行）

```
node desktop/scripts/sync-feed.mjs --release D:/tmp/wf133-cnfeed-stage \
  --mirror https://k-line-trainer-d9gbbg6il6bf8c320-1505768275.tcloudbaseapp.com/feed \
  --out D:/tmp/dist-cn-feed-133 --notes "v1.3.3 热修：修复默认国内镜像源不生效的 URL 缺陷…"
→ EXIT=0，自校验通过（含新增 releaseNotes 存在性检查）
```

产物 `D:\tmp\dist-cn-feed-133`（7 文件）：latest.yml（version 1.3.3＋**releaseNotes 字段**＋path/files url 已改写镜像绝对 URL）、manifest.json（tag v1.3.3＋body=notes＋5 资产）、setup exe、blockmap、zip、SHA256SUMS、migrate-v127.zip。

## 六、待用户拍板 / 相邻问题

### 6.1 proposed_default（呈现类）

1. v1.3.3 发布说明文案（CHANGELOG＋Release body＋镜像 notes 三处同源）：双条目（镜像优先生效修复＋更新内容展示），待真机验收追认。
2. releaseNotes 换行折叠为空格（YAML 单引号标量约束；当前 notes 均单行长文案，无实际损失）。

### 6.2 相邻问题（只登记不顺手修）

1. **custom 更新源全 URL 同样会双拼**：用户在设置页自填 `…/latest.yml` 形态的自定义 URL 会命中同一 electron-updater 语义（`UPD-FEED-SETTING` 冻结口径=custom URL 原样透传单源）。改 custom URL 归一属行为变更需用户拍板；建议后续在设置页 custom 输入提示目录形态。
2. worktree 打包纪律：**junction node_modules 只可用于测试/构建，electron-builder 打包必须真实 node_modules**（本轮实证 asar 依赖剔除）；建议后续发布简报前置此项检查。
3. sync-feed 输出目录名缺省 `dist-cn-feed` 与版本无关，多版本并存建议显式 `--out`（本轮已显式 `dist-cn-feed-133`）。

## 七、binding_note 补记（orchestrator 录入，本轮矩阵禁写）

- `UPD-CN-FALLBACK-DESKTOP`：v1.3.3（MIRROR-URL-FIX）修复镜像 feed URL 形态——`cnMirrorLatestYmlUrl`（全 URL）→ `cnMirrorFeedUrl`（目录 `<base>/`），根因=GenericProvider newBaseUrl 拼接语义（库源码＋W-D 真机实证）；EARS 零改动（实现缺陷修复），测试标题零改动、断言 oracle 升级为真实库解析（RED 收据见本记录 §二）。
- `RELEASE-CN-FEED-SYNC`：v1.3.3 起改写器给镜像 latest.yml 追加顶层 `releaseNotes`（值=--notes；EARS「url/path 改写」未禁 notes 追加，行为增强）；verifyCnFeedOutput 增 releaseNotes 存在性检查；新增用例 1（sync-feed-lib.test.ts「MIRROR-URL-FIX: latest.yml releaseNotes 注入…」）。

## 八、收尾状态

- worktree `git status` 干净（package.json 误删已恢复，desktop/release 与 .runs 均 gitignore）。
- 发布产物/镜像目录/冒烟脚本留存：`D:\tmp\wf133-zip-out`、`D:\tmp\dist-cn-feed-133`、`D:\tmp\wf133-smoke-lifecycle.mjs`、`D:\tmp\wf133-cnfeed-stage`。
- gate 台账：`wf-hotfix=0`（0=通过；strict exit3=2 存量 superseded 基线一致，零新增）。
