# GAP4-DOCS 验证记录：troubleshooting 补 SmartScreen 与杀软拦截用户指引

- 任务卡：[GAP4-DOCS](../../../work-items/tasks/GAP4-DOCS.md)（复盘缺口 G4，用户 2026-10-19 拍板；纯文档、零代码改动）
- 改动文件：[docs/user/troubleshooting.md](../../../user/troubleshooting.md)（新增三节＋开头限定语微调）
- 分支：`task/GAP4-DOCS`（worktree `D:\tmp\gap4-docs`，base=main@6533196）

## 一、内容要素自查清单

### 场景一：SmartScreen"Windows 已保护你的电脑"

| 要素 | 状态 | 落点 |
|---|---|---|
| 解释这是未签名 exe 的预期提示、不是病毒 | 有 | 节首段（"默认提醒，不是查出病毒"） |
| 「更多信息→仍要运行」逐步路径 | 有 | 编号步骤 1、2 |
| 为何不签名（个人开源项目、签名证书成本档位） | 有 | 节首段（按年收费、成本较高、暂不购买；对齐复盘"不做代码签名"拍板） |
| 仅放行官方 Releases 来源的提醒 | 有 | 节尾段 |

### 场景二：杀毒软件/Windows Defender 拦截更新或安装

| 要素 | 状态 | 落点 |
|---|---|---|
| 典型症状（下载停滞/失败、装后被删/隔离、更新后仍旧版） | 有 | 节首三条 |
| 安装目录典型位置（`%LocalAppData%\Programs\a-share-kline-trainer`） | 有 | 步骤 1 |
| 数据目录典型位置（`C:\Users\<用户名>\.a-share-kline-trainer`，zip 升级沿用者除外） | 有 | 步骤 1 |
| 白名单/排除项添加路径（Windows 安全中心逐步＋第三方杀软提示） | 有 | 步骤 1 |
| 从隔离区/保护历史记录恢复文件（含"先加白再还原"次序） | 有 | 步骤 2 |
| `.old` 已回滚场景（更新中断后应用仍能启动旧版本）→ 去 Releases 下载最新全量安装包覆盖安装 | 有 | 步骤 3（含 Releases 地址与安装包文件名形态、原位覆盖升级、数据不受影响） |
| 国内镜像更新源已内置自动回退、无需手动配置 | 有 | 步骤 4 |

### 场景三：报障信息清单

| 要素 | 状态 | 落点 |
|---|---|---|
| 应用版本号（设置→「关于与更新」可见） | 有 | 清单第 1 条 |
| Windows 版本（winver / 设置→系统→关于） | 有 | 清单第 2 条 |
| 数据目录路径（设置→「数据目录」分栏 / 默认位置） | 有 | 清单第 3 条 |
| 做了什么操作 | 有 | 清单第 4 条 |
| 看到了什么（报错原文/截图） | 有 | 清单第 5 条 |
| 明确不需要提供训练数据（不索要、不应上传公开页面） | 有 | 清单末段（与既有"仍有问题"节隐私口径一致） |

### 无前向引用自查

- 全文未提及"复制诊断信息"按钮等 GAP1-DIAG / v1.3.2 计划中的未发布功能。
- 提及的全部功能均已存在于已发布版本：设置「关于与更新」分栏（UPD-02，v1.3.x）、更新源镜像优先自动回退（CN-FEED-01 落地、MIRROR-URL-FIX v1.3.3 修复后生效）、更新中断 `.old` 回滚保护（PORT-UPD-01）、全量安装包覆盖升级（INSTALL-UPGRADE-01 机制实证）、设置「数据目录」分栏（V1.2.6 起）。

## 二、提法核对（对照既有文档与实测证据）

| 本文提法 | 依据 |
|---|---|
| 安装目录默认 `%LocalAppData%\Programs\a-share-kline-trainer` | UIUX-RELEASE-FIX T1 真机实测（静默安装落该目录；订正了 PACK-05 README 中 productName 口径），per-user 免管理员 |
| 数据目录默认 `C:\Users\<用户名>\.a-share-kline-trainer`；zip 升级沿用原位置 | desktop-release-manual.md（INSTALL-01 唯一默认）＋desktop-upgrade-guide.md §二表格 |
| 版本号在设置→「关于与更新」 | UPD-02 验收记录＋desktop-upgrade-guide.md §四 |
| 安装包名 `kline-trainer-desktop-setup-v<版本>-windows-x64.exe`、覆盖安装原位升级 | desktop-release-manual.md 产物表＋INSTALLER-UPGRADE-01 §1.2（重复安装检测旧位置同路径安装、数据不删） |
| 镜像优先＋失败回退 GitHub、无需手动配置 | desktop-release-manual.md 发布分节（用户拍板"纯国内网络也能正常更新"）＋CN-FEED-01/MIRROR-URL-FIX |
| Releases 地址 | 与既有 troubleshooting/install.md 全部一致 |

## 三、docs:check 收据

- 基线（改动前，main@6533196）：`20 errors, 110 warnings`，exit 0。
- 改动后：`20 errors, 111 warnings`，exit 0。20 条错误逐条比对与基线相同（INSTALLER-UPGRADE-01 等 8 卡 state 非法、R5/R6 里程碑引用、UIUX-REFINE-01 断链——均为存量、与本任务无关）。**新增错误＝0**；新增 1 条 WARN＝troubleshooting.md 长度 6262 超建议 5000（长度建议类，"按主题审查，不自动截断"，不属错误）。
- 命令：`npm run docs:check`（worktree `D:\tmp\gap4-docs`）。

## 四、纪律适配（root 预声明）

纯文档任务：零代码改动，矩阵/TDD 步骤不适用；替代收据＝上表内容要素自查＋docs:check 新增错误为零。呈现类措辞（如 SmartScreen 节的"为什么"说明详略、杀软 UI 路径的通用化写法）按 proposed_default 处理，提验清单见收尾报告。
