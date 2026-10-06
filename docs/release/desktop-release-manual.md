# 桌面版发布手册（维护者向）

> 适用：K线训练器 Windows 桌面版（NSIS 安装器＋便携 exe 双形态）。本手册面向维护者（发布执行人）。
> 用户侧的下载安装/升级指引见同目录 `desktop-upgrade-guide.md`。
> 版本基线：PACK-05（2026-10-06）起生效。

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
| NSIS 安装器 | `kline-trainer-desktop-setup-v<版本>-windows-x64.exe` | 正式发布形态；向导式安装、per-user 免管理员、可自选目录 |
| 便携 exe | `kline-trainer-desktop-v<版本>-windows-x64.exe` | 免安装形态，命名与历史版本一致 |
| 更新元数据 | `latest.yml` | electron-updater 的更新源描述（**上传 Release 时必须用这个原文件名**） |
| 差分下载表 | `…setup….exe.blockmap` | electron-updater 差分下载用（存在即上传） |
| 校验和 | `SHA256SUMS-desktop.txt` | 覆盖上述全部 desktop 产物；行格式 `<sha256>  <文件名>` |

脚本内置 fail-closed 核验链（任一失败即非零退出、不产出不完整资产集）：构建输入齐备→包内 `resources/app-update.yml` 存在（electron-updater 硬依赖）→双 exe 按命名契约存在→latest.yml 的 version/sha512/size 与 setup exe 实际字节一致（electron-builder 产出则核验，未产出则按同形状生成）→校验和写入。

**注意**：
- 脚本绝不触碰 GitHub（`--publish never` 固定）；上传永远是人工动作。
- NSIS 工具链首次构建需联网下载（已固化 npmmirror 镜像，无需代理）。
- 想在打包后本地演练安装/卸载，跑打包冒烟：`node desktop/scripts/smoke-desktop.mjs --target nsis --installer desktop/release/kline-trainer-desktop-setup-v<版本>-windows-x64.exe`（便携版：`--exe` 参数，A-H 全阶段）。

## 三、GitHub Release 上传步骤（唯一人工环节）

仓库：`m1kuStark/a-share-kline-trainer`。对每个正式版本：

1. **建 Release**：tag `v<版本>`（与 package.json version 一致），标题同 tag。
2. **上传资产（缺一不可的顺序无关，名字必须原样）**：
   - `kline-trainer-desktop-setup-v<版本>-windows-x64.exe`（安装器——**桌面版用户的更新目标**）
   - `latest.yml`（**文件名不可改**；electron-updater 按 GitHub provider 约定到 Release 资产里精确找它）
   - `kline-trainer-desktop-setup-v<版本>-windows-x64.exe.blockmap`
   - `kline-trainer-desktop-v<版本>-windows-x64.exe`（便携版）
   - `SHA256SUMS-desktop.txt`（desktop 校验和）
   - zip 兜底形态（若同批发布）：`kline-trainer-v<版本>-windows-x64.zip`＋其 `SHA256SUMS`（来自 `npm run release:windows`，**与 desktop 的校验和是两个文件**）
3. **核对（发布后自查）**：Release 资产页应能数出上列文件；`latest.yml` 资产点开 version 应等于本版本、url 指向本版本 setup exe。
4. **不要**把 desktop 校验和文件重命名成 `SHA256SUMS`——zip 在线更新器按精确名取 `SHA256SUMS` 资产校验 zip；两个清单并存时异名是双形态共存的前提（有测试锁定该约束）。

## 四、双形态策略（zip 兜底保留）

- **主形态＝NSIS 安装器**：承担在线更新（electron-updater 下载 setup exe→排空→静默安装→重启）。
- **便携 exe**：免安装场景；注意便携版不做原地自更新（检查到新版后按引导走安装器）。
- **zip**：历史用户与离线环境兜底；zip 内置的 HTTP 在线更新（UPD-01/02）语义不变，双形态同 Release 共存。

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
- 升级链路对用户数据零动作：安装/更新不动 `%USERPROFILE%\.a-share-kline-trainer` 与任何 data/ 目录（PACK-03 adopt-in-place 语义）。
