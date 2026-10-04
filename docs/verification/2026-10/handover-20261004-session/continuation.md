# 用户现场与接续待办

返回[交接入口](README.md)；修复、验收、公开发布及 GitHub 检查见[实现与发布记录](implementation-release.md)。

## 1. 用户当前录像存储现场

用户最近报告桌面安装中有“两条先导基电模拟训练录像”，但在 `data` 找不到录像文件。录像正文保存于浏览器 IndexedDB；SQLite 存训练、成交、画线、成绩及命名空间，**两者是不同数据来源**。

本次只读核查：桌面 `data\trainer.sqlite` 有 6 条训练记录、无录像表；`cache_meta.recording_namespace` 为 `28da8dc4-2f94-483f-aae7-d1fd3acd4a4f`。训练条数不能当作录像条数；“两条先导基电录像”保留为用户描述，本次未重新枚举浏览器当前录像。

| 数据 | 存储位置 |
|---|---|
| 训练历史等 | `C:\Users\Stark_Du666\Desktop\kline-trainer-v1.2.7-windows-x64\data\trainer.sqlite` |
| 本机录像逻辑库 | `trainer-recordings.28da8dc4-2f94-483f-aae7-d1fd3acd4a4f`；`compactSessions` 与 `compactRecords` |
| 导入录像逻辑库 | 上述库名加 `.imports`；`summaries` 与 `recordings`，不创建训练历史 |
| Edge Default 物理存储 | `C:\Users\Stark_Du666\AppData\Local\Microsoft\Edge\User Data\Default\IndexedDB\http_127.0.0.1_8787.indexeddb.leveldb` |

Edge LevelDB 日志存在对应库名及写入痕迹，但不是独立录像文件，也不能据其历史日志断言当前数量。浏览器配置文件、origin（协议/主机/端口）和数据库 namespace 共同决定可见录像：`localhost` 与 `127.0.0.1` 不同，端口变化也不同。

复制原 SQLite 会保留 namespace，在同一浏览器配置与访问地址可继续读原录像；换成另一训练数据库会选择另一录像库。旧交接中“录像不受数据目录设置影响”不够准确：**存储正文仍在浏览器，显示哪一库会受数据库切换影响**。

现有导出入口在训练页及结束弹窗（`web/src/views/Training.vue` / `web/src/recording/useRecording.ts`），默认 `.trainer-session.json.gz`；录像库和只读回放页目前没有历史录像再次导出按钮。复制 `data` 不能称为完整录像备份；不要直接移动或修改 Edge LevelDB。

## 2. 下一会话待办

1. **E2E-BASELINE-01：优先清偿浏览器回归。** 从 [GITHUB-HEALTH 最新证据](../GITHUB-HEALTH-01/report.md)的两轮 125 项运行开始，区分旧定位器、缺 namespace 的 mock、夹具/环境问题与真实画线恢复等产品缺陷。旧卡仍写 2026-10-02 的 19/108 失败，应补最新记录而保留旧事实；不能删除断言、加跳过或把 19 项当作当前 29 项。
2. **录像备份与再次导出。** 用户已关心录像位置；当前历史录像无法从库中再次导出，`data` 也不含正文。可先明确是否增加录像库逐条/批量导出，或将持久化放入用户 data；本会话仅记录现状，未实施，也未决定自动迁移旧库。
3. **REC-04 / V4-01。** 紧凑录像的非空条件单事件、完整订单状态与理由回放仍有缺口。不得将范围条件单开关修复或用户验收扩展为完整订单事件回放已完成。
4. **状态卡对账。** `SETUP-01` 仍 active、写待最终包/验收及旧 V1.1.1 integration_ref；`REC-01` next_action 仍指向旧 REL-01 发布；`E2E-BASELINE-01` 与旧交接的 Vitest 失败描述滞后。依据[实现与发布记录](implementation-release.md)链接的发布/验收/CI 证据对账，再用状态 API 与生成器更新，勿重做已验收首配或重新发布同一包。
5. **退出失败提示。** 旧标签页在服务已停止后仍能显示，退出请求可能 `Failed to fetch`；当前“服务仍在运行”的固定文案会误导用户。后续核对后端健康状态并完善提示，保留已验收的深浅主题与排空流程。
6. **其余产品任务。** DATA-03/04 历史版本保护与统一读取、M4/M5 剩余、旧用户目录迁移向导仍按各自卡片核实。账号资料字段尚未修改；原用户授权处理 GitHub 账号，继续该范围前核对接口能力，无须把已有授权视为失效。旧交接提及的归档分支/空壳目录仅是历史线索，先检查存在性再行动。

## 3. 继续开发的约束与检查

- 通达信目录只读；开发/测试显式使用独立 `TRAINER_DB`、测试浏览器上下文和端口。用户桌面 SQLite、Edge Default 录像均不可作写入夹具或清理目标。
- 保持 T+1、100 股整手、规则快照及防未来数据披露。撮合修订须同步合同与回归；条件单已有开盘/收盘阶段语义，以当前源码及 V1.2.5/V4 文档核对，不能套旧 close-only 规则。
- 尊重用户数据和其他未提交改动。停止进程须核对本任务的 PID/runId；不要强占 8787、删除个人库或凭“页面还显示”判断服务状态。
- 任务和阶段、源码自测、用户验收、公开资产分开记录；正式包以 `release.json`、manifest、标签解引用及 SHA256 关联来源。新包仍需先交用户验收，授权后再发布。
- 文档沿当前分层维护，不往旧长日志追加。Headroom 缓存用全局 `.codex/headroom-cache`，临时运行产物用 `.runs`；不要把临时输出混入工作树或 `D:\MySoftWares`。

```powershell
git status --short --branch
git log -5 --oneline
git worktree list
git rev-parse 'v1.2.7^{commit}'
npm run docs:check
npm run docs:status -- --check
```

本次交接只编辑文档、核对现场，没有重新启动服务、改写训练库、运行产品全套测试或再次发布。产品测试数字继承各自原始验证记录，不代表本次文档工作重新执行了这些测试。
