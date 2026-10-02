# V1.2.6 训练数据目录设置验证

候选工作树：`wt/integration/v1`。基线为 v1.2.5 候选 `c062971`。本记录描述工程自验，不代表用户验收或 GitHub 发布。

## 用户需求

设置中只有 TDX 安装路径设置，缺少历史模拟训练数据保存路径设置；默认应保存在安装文件夹下的目录，保证不同版本之间训练数据相互独立；该目录为排行功能与回放（成绩单复盘）提供数据文件。

## 实现

- 设置面板"数据目录"标签页新增"训练数据目录"子区块（在"数据目录（通达信）"之前）：当前生效目录＋数据库文件名、默认/自定义状态、原生文件夹选择器、保存（重启生效提示、切换目录后仅见新目录数据提示、旧主目录路径迁移提示）。
- 服务端 `GET/PUT /api/settings/data-dir`（server/src/settings/data-dir.ts）：PUT 校验绝对路径、预建目录、原子合并写回 trainer.config.json（保留 tdxRoot/port、清除 databasePath 覆盖）；独立运行 PUT 409。配置文件路径由 launcher 经 TRAINER_CONFIG_PATH 注入（launch 与受控重启两条链路），config.ts 新增 launcherConfigPath。
- launcher 默认 dataDir：用户主目录 `~/.a-share-kline-trainer` → 包根 `data`（版本独立）；相对路径仍按包根解析；env 覆盖优先级不变。
- 排行/历史/回放复盘读 config.databasePath 的 SQLite，自动跟随新目录，无代码改动。

## 验证

| 检查 | 结果 |
|---|---|
| settings-data-dir.test.ts（8 例：严格校验、GET 默认/自定义/独立运行、PUT 合并保留字段+清 databasePath+预建目录、无配置新建、独立运行 409、相对路径 400 零写） | 8/8 |
| release-launcher.test.ts（49 例，含默认目录断言更新为包根 data、受控重启链路） | 49/49 |
| m5-settings-frontend 契约（新区块/新文案断言）＋settings-tdx-path | 通过 |
| resolveConfig 冒烟（默认包内 data、相对路径按包根、db 派生、env 覆盖） | 通过 |
| `npm run build` | 通过（vue-tsc＋server 编译＋vite） |
| 全量 `npm test` | 1388/1398；10 项失败均为既有存量环境域（db-migration×2、recording 编解码×6、data-refresh×1、其余工具域×1，与 E2E-BASELINE-01 登记的抖动集合一致），本轮相关测试全绿 |

## 过程缺陷（已修）

- superviseLocked 内 env 注入误用 `options.configPath`（该函数收 context）导致受控重启用例 2 例失败（spawn 前抛 TypeError）；修正为 `context.configPath ?? join(root, 'trainer.config.json')` 后 49/49 通过。教训：CJS 巨型模块内跨函数加行时先核对作用域变量名，supervisor 测试是这次回归的兜底。

## 未决事项

- 用户对 v1.2.6 包的人工验收（含 V1.2.5 条件单触发语义一并验收）；GitHub 推送与发布继续暂停。
- 升级到 1.2.6 的老用户默认将看到空历史/排行（数据仍在旧主目录）——面板文案已给出旧路径提示，是否需要自动迁移向导待用户拍板。
