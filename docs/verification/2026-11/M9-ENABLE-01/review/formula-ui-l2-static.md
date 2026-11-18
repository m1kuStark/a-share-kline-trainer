# M9 formula-ui 四行 L2 静态审查

日期：2026-11-18（Asia/Shanghai）。仅只读源码审查；审查者没有运行测试、变异、构建、浏览器或产品，没有修改仓库、矩阵、control、ledger 或已有缓存脚本。本文件是唯一新增输出。矩阵只由 root 写入。

## 锚点与审查边界

- Worktree：`C:/Users/Stark_Du666/.codex/worktrees/m9-enable-01/a-share-kline-trainer`。
- HEAD：`3ec3d730a477ca305566eda28a6b1ddc190e2262`。
- manifest：`M9-ENABLE-01`，native exit 0。
- A1 allowed_paths 第30项原文：`docs/verification/2026-11/M9-EMA-WARMUP-01/**`。
- A2 base：`58ba0ffc13458fb136c7d885b62ee0c898d4bab8`；祖先检查 native exit 0；HEAD 领先14提交。
- A3 docs_impact.update 共10项：`docs/specs/formulas.md`、`docs/specs/README.md`、`docs/proposals/M9-04-formula-product-ui.md`、`docs/work-items/tasks/M9-04B.md`、`docs/work-items/tasks/M9-04C.md`、`docs/work-items/tasks/M9-04D.md`、`docs/work-items/milestones/M9.md`、`docs/work-items/README.md`、`docs/status.md`、`e2e/README.md`。
- 审查初始 strict binding native exit 3：8 rows / covered 4 / open 4 / RED 0。四行均 `test_ids: []`、`status: planned`。该观测不是测试执行失败，也未由本审查提升状态。
- 原 HEAD 的 `e2e/formula-enable.spec.ts` 为191行，Git blob `2ebfc576da8ed7af7d7b44c2d305ef92699636d9`。审查期间 root 已扩充到212行：SHA256 `a1970bc9113aee90b8837f92cb0376a22d4ddfa84f6d5d1da6712b56ebcc38a9`，以下最终断言位置均按此未提交版本记录。新增 main 与失败刷新路径仅静态审阅，等待 root 实跑及重新冻结候选。
- 观察到 root 正在更新验证文档与控制恢复证据，不能把本轮 worktree 称为 clean；不得从 HEAD 单独推断当前文件字节。

## 独立 oracle

1. `docs/verification/2026-11/ENG-PLAN-01/approval.md:9` 用户批准首批范围与内置处理；`:13` 三个内置默认停用，逐个开启自动显示到预设主/副图；`:17` 无第二次挂载步骤。`:23-28` 明确开发授权不构成整批验收、回放限制接受或发布许可。
2. `docs/specs/formulas.md:9-13` 独立产品契约：创建/修改保存启停，重开/刷新保持；新 seed 默认停用且升级不重置；MA 主图，WEEK/QINIU 副图；内置名称/源码只读、不可删除，保存不夹带受保护字段；失败显示错误、清旧成功，不冒充持久化。
3. `docs/work-items/tasks/M9-ENABLE-01.md:76-80` 对应用户批准和整批路径；`:90-96` 当前已获独立 EMA 修复授权并集成 PR54。`:86` blocked 为历史，不可误读为当前阻断。

## 四行绑定建议

### FORMULA-UI-CUSTOM-ENABLE

建议完整 test_ids（叶子标题，不加 describe 前缀）：

```text
e2e/formula-enable.spec.ts::公式启停：自定义创建停用、开启与停用保存后刷新仍保持
e2e/formula-enable.spec.ts::公式启停：自定义主图创建停用、开启与停用保存后刷新仍保持
```

- 实际夹具：真实设置事件；源码 `MA5:MA(CLOSE,5);`；通过真实 POST/PUT 保存；GET 只读核验；真实600519训练、2025-01-02起始、1Y、100万初始资金。beforeEach 会清理同名自定义并强制停用内置（18-45），用例之间不依赖状态。
- axes：原191行版本仅 sub（原78）；主图 API 创建的 `formula-chart` 用例不能补足主图 UI 启停保存。root 扩充的124-129为两个独立字面 leaf，分别调用73-122 helper 的 sub/main，现静态覆盖 main|sub。
- 创建停用：83响应201；85 enabled=false；86 placement等于独立入参；87请求 enabled=false；88成功；90图表不存在；94重开仍未勾选。
- 开启保存：98真实GET enabled=true；100恰一条；101有效数值结果；103主图必须 candle_pane／104副图必须不是；106-110刷新后线仍在、重选checkbox仍勾选。
- 停用保存：113成功；115立即移除；116-118刷新后真实GET=false且无图表线；119-121重开checkbox仍未勾选。
- 独立预期：产品契约9-11行；placement来自用例固定输入，不从实现回读后自证；线数1由固定一输出源码决定。
- paper_only 变异建议：① save payload 丢 enabled/false，杀手87或98/117；②主图一律挂副图，杀手103；③停用不移除或刷新忽略持久值，杀手115/118/121。均未执行，不能写 killed。
- 结论：原基线 L2 有 main 缺口；当前 root 扩充版本静态可提出覆盖，两用例实际运行/完整候选仍待 root。

### FORMULA-UI-BUILTIN-ENABLE

建议完整 test_ids：

```text
e2e/formula-enable.spec.ts::公式启停：内置 MA_BULL_MAIN 按预设位置显示、刷新和停用
e2e/formula-enable.spec.ts::公式启停：内置 WEEK_MACD_SUB 按预设位置显示、刷新和停用
e2e/formula-enable.spec.ts::公式启停：内置 QINIU_B1_SUB 按预设位置显示、刷新和停用
server/test/formulas/formula-storage.test.ts::内置公式不可改名/改源码/删除（M9-04D 预留保护）
server/test/formula-seed.test.ts::内置公式不可删除/改源码（服务端 403），可禁用
```

- 177-184的三个字面测试经132-175 helper 执行：MA main/4线，WEEK sub/3线，QINIU sub/3线。预期来自批准预设及固定种子输出，不能用图表实际线数作预期。
- 136固定预设位置；139-140名称/源码DOM禁用；146真实PUT 200；148 enabled=true；149-150请求不得含 name/source。153精确线数；154-156每线至少一个有限数值；157同一公式同窗；158主/副图等价关系；161-165刷新后保留线和勾选。
- 170-174停用与刷新均移除，真实GET保留原名称、源码和预设位置且enabled=false。此处也防止为解锁启停而整体放开保护。
- storage 80-93：真实内存SQLite＋迁移；84创建，85置builtin；86连原名同值更新亦拒绝；87-88原源码/改源码都拒绝；89删除拒绝；90-93可独立关/开且原name/source/builtin保持。该层是存储契约，不冒称HTTP名字拒绝。
- seed 113-129：真实Fastify inject，DELETE403在124、改源码403在126、仅enabled=false返回200/false在128-129；此处不测试改名HTTP状态，故用storage测试补其核心保护。inject不是实际socket。
- paper_only：①内置UI保存夹带name/source，杀手149/150；②后端放开内置保护，杀手storage86-89及seed124/126；③WEEK/QINIU误挂主图或无数值，杀手154/158。
- 结论：多绑定分别覆盖真实UI保存与图表/持久状态、底层保护和路由保护；静态链条完整，实际通过由root当前候选运行收据证明。

### FORMULA-UI-BUILTIN-DEFAULT-OFF

建议完整 test_ids：

```text
server/test/formula-seed.test.ts::空库幂等写入 3 个内置示例，重复 seed 不重复
e2e/formula-enable.spec.ts::公式启停：内置 MA_BULL_MAIN 按预设位置显示、刷新和停用
e2e/formula-enable.spec.ts::公式启停：内置 WEEK_MACD_SUB 按预设位置显示、刷新和停用
e2e/formula-enable.spec.ts::公式启停：内置 QINIU_B1_SUB 按预设位置显示、刷新和停用
```

- seed夹具18-21为独立 `DatabaseSync(':memory:')`＋真实迁移；不是E2E手动停用后的数据库。
- 原断言：69首轮seed写3；71数量3；72精确三名；73全builtin；75全enabled=0；76-78分别固定WEEK=sub、MA=main、QINIU=sub；79源码非空。
- 用户选择不被重置：81直接SQL打开MA；82再次seed返回0；84仍3条；85 MA保持enabled=1；86另外两条保持0。这覆盖一个已开内置的幂等保留，不声称遍历三个内置所有升级组合。
- 三个E2E helper的153-158证明逐个UI开启即按固定预设挂载且有数值，调用路径没有额外挂载动作；161-174证明刷新/停用。
- 重要边界：E2E beforeEach 21主动PUT false，故141的未勾选绝不是默认seed证据。默认值必须绑定seed75。seed证明首次建库；E2E证明真实UI操作，二者职责不能混写。
- paper_only：①任一种子enabled改true，杀手75；②再次seed重置已有enabled，杀手85；③开启后要求额外挂载，杀手E2E153（无该动作即超时）。均未执行。
- 结论：fresh seed＋三条真实UI用例的联合静态L2充分；不能只绑定E2E。

### FORMULA-UI-SAVE-FAILURE

建议完整 test_id：

```text
e2e/formula-enable.spec.ts::公式启停：保存失败显示错误并清除上次成功提示
```

- 固定状态：187-194通过真实UI先成功新建，默认enabled=true（当前产品仅内置默认关）；193刻意制造旧成功提示，随后195取消勾选。
- 拒绝入口：196-199只拦该id的PUT，以HTTP503＋固定中文原因响应，GET继续真实后端。不是实际服务器故障注入，也不能宣称真实SQLite拒写已被运行。
- 失败诚实：201 alert包含原因；202成功提示完全不存在；203真实GET仍enabled=true。
- 原191行版本到上述GET结束，缺少oracle“重新加载持久值”的UI闭环。root现新增204撤销路由、205刷新、206图表仍一线、208重选同公式、209checkbox仍勾选、210没有旧成功、211真实GET仍true，静态补足。
- 独立预期来自失败之前已提交的true以及服务拒绝不写入的契约，不以草稿checkbox值或实现缓存作oracle。失败当时草稿可保持未勾选；这本身不等于已经持久化。
- paper_only：①删除save开头清saveMessage，杀手202；②catch错误被吞或假报成功，杀手201/202；③失败后以草稿false覆盖本地加载/恢复状态，杀手209及206；如只改客户端而服务器未写，203本身杀不掉，故必须保留刷新UI断言。
- 结论：当前root扩充版本静态可绑定；仍是HTTP拒绝呈现与真实读取恢复测试，不扩大为实际服务端故障/数据库回滚测试。等待root实跑。

## 最终包脚本与当前 DOM/版本漂移

当前读取：`package.json:4` 版本1.3.8；`m9-packaged-acceptance.cjs` 与 `m9-zip-smoke.ps1` 位于本缓存目录，审查者未修改。

1. **生产无Journey hook。** `web/src/components/KlineChart.vue:1995-2000` 仅在 `import.meta.env.MODE === 'journey'` 挂 `formulaIndicators`；E2E64-70的 `__trainerChart` 不能复制到生产验收脚本。缓存生产脚本55已承认canvas数量与截图不能自动证明公式数值正确；保留该边界，主代理须读实际截图/窗口。
2. **当前选择器。** 设置按钮/对话框accessible name为“训练默认设置”，区域“公式指标”；`.formula-list-pane`等待不再“读取中”（E2E60）；列表aria-label“公式列表”、条目`.formula-item`；checkbox精确“在图表启用”；新增/修改按钮分别“保存新公式/保存修改”；成功`.settings-saved`，错误`role=alert`。FormulaSettings224-290/303与TrainingSettings979-991均吻合。生产helper115-121只等区域可见，宜补当前读取屏障，避免异步load覆盖草稿。
3. **新建自定义默认开、内置默认关。** FormulaSettings31/102中自定义新建enabled=true；不可把内置默认关套给自定义。内置显示位置也disabled（264），按固定预设：MA4线main、WEEK3线sub、QINIU3线sub。main不会增加副图canvas，不能把canvas变少用作主图卸载oracle。
4. **缓存脚本覆盖范围。** `m9-packaged-acceptance.cjs:209-221`只查看/切MA_BULL_MAIN，且是在训练前开关后最终停用；不能据此宣称生产包已逐个挂载三个内置。223创建main/sub，242-248仅切自定义sub并比较canvas；283-296重启仅核验sub持久化。若生产整批要证明三内置实际绘制，应在训练中逐个开启、截图并核验读回预设；Journey的3内置数值断言仍单独保留。
5. **就绪与录像。** 当前训练就绪使用`.training-current-date`、按钮“刷新图表”可用、`.drawing-save-status`为“已保存”。生产脚本234-237与250/257已使用当前DOM。离线样本可能弹“建议先更新日线数据/仍要开始训练”，脚本231-233已有处理。回放实际按钮/页面不应从旧2026-10验收脚本直接移植。
6. **版本身份缺口。** 缓存生产boot91记录 `app.getVersion()`，但当前没有与源package.json的1.3.8等值断言；ZIP smoke也未核验版本。建议冻结候选后读取源码版本，与实际生产运行appVersion等值，并保留exe/asar/SHA/源commit/ZIP关联。版本号本身不足以区分多次M9候选，不能硬套旧1.3.x包。
7. **构建入口。** 当前`build:desktop`仍调用旧`desktop/scripts/package-desktop.mjs`；按已审查生产流程同步migration→build→build:desktop:main→release:desktop，`TRAINER_RELEASE_OUT_DIR`为新相对目录，避免复用历史验收路径。release脚本39-40/206/221跟随该输出目录；manifest296-300仅版本/资产/时间，不自带gitCommit，必须外部保留同提交身份收据。完整构建准备另见本缓存`windows-build-handoff.md`，本审查未再次构建。
8. **规格边界。** formulas29与任务80：回放使用当前公式库；公式pane高度不入录像；公式pane画线回放回落主图，仍须用户整批确认。不得把开发批准、Journey通过、包运行、主代理视觉或用户验收混成同一结论。
9. **文档收尾。** `e2e/README.md:49`仍写“等待独立EMA修复范围”，与任务90-96和formulas33“PR54已合入”冲突。应在本次真实结果完成后更新当前状态，同时保留原4/5与DEA失败历史；不要删失败或提前改成通过。`docs/release/M9-ENABLE-01.md`目前不存在，允许路径不等于已有交付说明。

## Root 收尾建议

- 用上述完整leaf IDs写矩阵；每行注明联合绑定各负责的分句。CUSTOM和FAILURE以root212行扩充后新冻结候选为准。
- 先完成定向/完整门禁和L2需要的实际变异；保留初始失败、修复及最终整轮执行收据。本文全部变异仅paper_only。
- 绑定L1 strict成功、L2语义充分、实际测试通过、主代理视觉、同提交Windows生产包/录像、用户整批验收分别记录。
- 当前静态未发现为启停而放开内置保护或改写产品行为的证据。原两处测试范围缺口已由root草稿扩充，运行结果待root。

审查辅助源码SHA256：seed `961221ca1586719d0742d20e9766ba0ad178ffb17ff97b50de6ff6c8c85ec5c0`；storage `65112792e16173e31991be15263a71d5c1eed0e03e7c50df52c7f0c22e6ba592`；FormulaSettings `a87b3c40e635e4a0f4bb4c180c0149b0d3e4335799b47ceaf47a028e84d5d714`；package `cf1cdf0504cda7145d4b449a82a500c093eeec2d46610ec043430e55d32643b7`。后续编辑应重新锚定行号与字节。