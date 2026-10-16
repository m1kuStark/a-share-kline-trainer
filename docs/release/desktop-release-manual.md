# 桌面版发布手册（维护者向）

> 适用：K线训练器 Windows 桌面版（NSIS 安装器；便携 exe 已退役）。本手册面向维护者（发布执行人）。
> 用户侧的下载安装/升级指引见同目录 `desktop-upgrade-guide.md`。
> 版本基线：PACK-05（2026-10-06）起生效；INSTALL-01（2026-10-11 用户拍板）起发布形态仅 NSIS
> 向导式安装包（one-click=false 可自选目录、zh-CN 安装语言），便携产物退役，数据目录唯一默认
> `%USERPROFILE%\.a-share-kline-trainer`（v1.2.7 旧数据迁移入口已随 2026-10-16 拍板退役——v1.2.7 弃用，migrate-v127.zip 不再发布）。

## 一、一次完整发布做什么

```
① 版本号拍板          package.json version 改为正式三段号（如 1.3.0）
② 构建全量验证        npm test ＋ npm run build（全绿才继续）
③ 桌面发布流水线      npm run release:desktop     ← 全自动：打包→核验→校验和→打印产物清单
④（可选）zip 兜底形态  npm run release:windows      ← 既有 zip 流水线，零改动
⑤ 人工上传 GitHub Release（本手册 §三，唯一人工环节）
⑥ 真机验收安装版更新   安装旧版→检查更新→下载→安装→数据仍在（PACK-04/05 交付的更新链路）
```

## 二、`npm run release:desktop` 产物集与核验链

产物全部落在 `desktop/release/`（git 忽略）：

| 产物 | 命名 | 说明 |
|---|---|---|
| NSIS 安装器 | `kline-trainer-desktop-setup-v<版本>-windows-x64.exe` | 正式发布形态；向导式安装、per-user 免管理员、可自选目录、zh-CN 安装语言 |
| 更新元数据 | `latest.yml` | electron-updater 的更新源描述（**上传 Release 时必须用这个原文件名**；仅含 setup 条目，不再追加便携条目） |
| 差分下载表 | `…setup….exe.blockmap` | electron-updater 差分下载用（存在即上传） |
| 校验和 | `SHA256SUMS-desktop.txt` | 覆盖上述全部 desktop 产物；行格式 `<sha256>  <文件名>` |

脚本内置 fail-closed 核验链（任一失败即非零退出、不产出不完整资产集）：构建输入齐备→包内 `resources/app-update.yml` 存在（electron-updater 硬依赖）→setup exe 按命名契约存在→latest.yml 的 version/sha512/size 与 setup exe 实际字节一致（electron-builder 产出则核验，未产出则按同形状生成）→输出目录无同名陈旧便携产物（INSTALL-01 反向门：便携 exe 已退役，残留即失败）→校验和写入。

**注意**：
- 脚本绝不触碰 GitHub（`--publish never` 固定）；上传永远是人工动作。
- NSIS 工具链首次构建需联网下载（已固化 npmmirror 镜像，无需代理）。
- 想在打包后本地演练安装/卸载，跑打包冒烟：`node desktop/scripts/smoke-desktop.mjs --target nsis --installer desktop/release/kline-trainer-desktop-setup-v<版本>-windows-x64.exe`（便携冒烟入口已随 INSTALL-01 退役）。

## 三、GitHub Release 上传步骤（唯一人工环节）

仓库：`m1kuStark/a-share-kline-trainer`。对每个正式版本：

1. **建 Release**：tag `v<版本>`（与 package.json version 一致），标题同 tag。
2. **上传资产（缺一不可的顺序无关，名字必须原样）**：
   - `kline-trainer-desktop-setup-v<版本>-windows-x64.exe`（安装器——**桌面版用户的更新目标**）
   - `latest.yml`（**文件名不可改**；electron-updater 按 GitHub provider 约定到 Release 资产里精确找它）
   - `kline-trainer-desktop-setup-v<版本>-windows-x64.exe.blockmap`
   - `SHA256SUMS-desktop.txt`（desktop 校验和）
   - zip 兜底形态（若同批发布）：`kline-trainer-v<版本>-windows-x64.zip`＋其 `SHA256SUMS`（来自 `npm run release:windows`，**与 desktop 的校验和是两个文件**）
   - **不要**再上传任何 `kline-trainer-desktop-v<版本>-windows-x64.exe`（便携 exe 已随 INSTALL-01 退役；release 脚本对输出目录残留的同名产物 fail-closed 拒跑）
3. **核对（发布后自查）**：Release 资产页应能数出上列文件；`latest.yml` 资产点开 version 应等于本版本、url 指向本版本 setup exe。
4. **不要**把 desktop 校验和文件重命名成 `SHA256SUMS`——zip 在线更新器按精确名取 `SHA256SUMS` 资产校验 zip；两个清单并存时异名是双形态共存的前提（有测试锁定该约束）。

## 四、发布形态策略（INSTALL-01 后：NSIS 主形态＋zip 兜底）

- **主形态＝NSIS 安装器**：承担在线更新（electron-updater 下载 setup exe→排空→静默安装→重启）；向导式安装可自选目录，zh-CN 安装语言。
- **便携 exe**：已随 INSTALL-01（2026-10-11 用户拍板）退役——v1.3.0 起不再产出；存量便携用户（≤v1.2.7）检查更新将收到「更新源未提供便携版产物」fail-closed 提示，按引导改走安装器。
- **zip**：历史用户与离线环境兜底；zip 内置的 HTTP 在线更新（UPD-01/02）语义不变，同 Release 共存。
- **数据目录（INSTALL-01 收敛）**：唯一默认 `%USERPROFILE%\.a-share-kline-trainer`；不再扫描/吸收 exe 旁 `data/`（v1.2.7 目录混放旧库不迁走）。v1.2.7 历史数据迁移入口已随 2026-10-16 拍板退役。

## 四点五、国内镜像发布（CN-FEED-01，2026-10-13）

> 依据：用户拍板「不能依赖 github 链接提供下载资源，应该提供纯国内网络也能正常更新的发布路径」（GPU3060-E2E-01 wave-e 实证 GitHub 直连间歇失败）。客户端（桌面 electron-updater 链＋zip HTTP 链）默认「自动」源＝镜像优先、失败回退 GitHub，**无需随镜像上线发版**——镜像 URL 常量填入并重建后，存量版本的自动源仍走 GitHub，首个含镜像常量的版本起镜像优先生效。

1. **前置（一次性）**：镜像托管（CloudBase 静态托管，待用户授权后开通）就绪后，把真实 base URL 填入 `server/src/update/manifest.ts` 的 `CN_MIRROR_BASE` 常量（当前空串＝镜像未上线，两链自动退化为纯 GitHub——行为安全），跑 `npm run build:server`（desktop 链经编译产物 import 同一常量，一处填入两链生效），随下个版本发布。
2. **每次正式发布后**：在 GitHub Release 完成第三节上传后，把双形态产物合并到一个目录（desktop/release 的 setup exe＋blockmap＋latest.yml，加上 zip 发布物 `kline-trainer-v<版本>-windows-x64.zip`＋其 `SHA256SUMS`），执行：
   ```
   node desktop/scripts/sync-feed.mjs --release <产物目录> --mirror <镜像baseURL> --notes "<发布说明，可省>"
   ```
   产出 `<产物目录>/../dist-cn-feed/`：`latest.yml`（url/path 已改写为镜像绝对 URL）、`manifest.json`（zip HTTP 链清单，GitHub API 同形状）、setup exe/blockmap/zip/SHA256SUMS 原样复制。脚本自带 fail-closed 自校验（latest.yml/manifest 形状＋URL 前缀＋sha512/size 与实际字节一致＋复制文件与源逐字节一致），不触网、不需要任何凭证。
3. **上传**：把 `dist-cn-feed/` 内全部文件**原样文件名**上传到镜像托管的该 base 路径下（托管控制台手动/CLI 均可；本脚本不管上传）。上传后自查：`<base>/latest.yml` 与 `<base>/manifest.json` 可直接 GET 到、版本号等于本次发布版本。
4. **校验和资产名约束不变**：镜像目录里 zip 链的校验和文件必须叫 `SHA256SUMS`（与 desktop 的 `SHA256SUMS-desktop.txt` 异名共存，sync 脚本按原名复制，勿改名上传）。


## 五、常见问题

| 现象 | 处置 |
|---|---|
| `release:desktop` 报 missing build inputs | 先 `npm run build:desktop`（或至少 `npm run build`＋`npm run build:desktop:main`） |
| 构建慢/卡在 NSIS 下载 | 首次下载 NSIS 工具链（~分钟级）；镜像已固化，检查网络即可 |
| 冒烟 `--target nsis` 报窗口 0 | 已修复的已知坑：直启 Electron exe 的编排不能带 `windowsHide:true`（窗口不显示）；脚本已固定 false，若复刻编排请遵守 |
| 上传后桌面版检查更新 404 | 确认 `latest.yml` 是否按原名上传、Release 是否为 latest（非 prerelease/draft） |
| 无签名告警 | electron-updater v26 对无 publisherName 仅 warn 放行（v28 起将拒装）；签名决策留后续任务 |

## 六、版本与兼容注意

- 版本号必须三段号（X.Y.Z），发布脚本按此断言。
- appId（`io.github.m1kustark.a-share-kline-trainer`）与 GitHub owner/repo 是更新通道的身份锚——**变更它们等于断更**，需要专门任务评估。
- 升级链路对用户数据零动作：安装/更新不动 `%USERPROFILE%\.a-share-kline-trainer`（INSTALL-01 唯一默认，adopt-in-place 原地沿用）与任何既有 `data/` 目录（exe 旁旧库不被扫描、不被吸收，也不被删除）。
