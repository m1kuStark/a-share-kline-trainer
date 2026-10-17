# UIUX-REFINE-01-L2 逐断言静态复核

复核人：`/root/skill_scenarios`；时间：2026-10-17 21:25 +08:00。此任务只读产品与测试，仅写本文件；产品 RED、浏览器、构建和变异执行不适用。替代收据是当前源码逐断言复核、strict 绑定检查、文件指纹与 git diff。root 代办第五步共享记录，本 worker 不写矩阵、台账、工作流或提交。

## 锚点与结论

- repo：`D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/uiux-refine-20261017`；本次实际 `git rev-parse HEAD` 为 `6d557a12f400ce45b50418b8556f943d39fef754`，与书面 base 相同；工作树有他人未提交修改，本报告不将 HEAD 等同于候选内容。
- 已全文重读候选 Harness v1.12 `SKILL.md`、`references/oracle.md`、`references/supervised-delivery.md`，以及 UIUX core v0.4.1 `SKILL.md`；聚合输出截断处已单文件补读。候选路径为工作区 `ai-harness-lab/skill-candidates/2026-10-17-uiux-refine/ai-harness/`；UIUX 来源为 `D:/Superlinear_Academy/UI-UX-Design/skills/uiux-design-core/`。
- 独立预期：[任务卡](../../../work-items/tasks/UIUX-REFINE-01.md)「契约与独立预期」与工作区矩阵 `.zcode/skills/ai-harness/matrix/uiux-workbench.yaml` 的五条 EARS。本次矩阵 SHA256：`a57bb345cfe8810c89e530d1b7bab3cbc776ca1e78149b6111eb856e8a73ffb1`；oracle 文档 SHA256：`98b2046e5b236cfa171145227570f81efcf757c2c2d67d9d04c5fd5b94ef9354`。
- 五行当前全部 `planned`、`test_ids: []`。strict 原生退出 **3**，`covered=0 / open=5 / RED=0`。这不是引用闭合或产品通过；下文是供 root 回填的完整测试名与 L2 限定。
- 14 个新用例均有非空语义断言；没有发现 `skip/todo/only`。存在子句未覆盖与局部前置未建立，不能因此把整行升级。所有变异均为 **paper_only**，本轮没有执行变异体或重跑产品。
- `UIUX-TRAINING-GEOMETRY` 的 1008×641 修复仍在进行，只登记现有测试名和当前旧范围，**不评定最终覆盖**。

## 优先补齐的问题

| 编号 | 具体证据与影响 | 最小补验或修正 |
|---|---|---|
| L2-01 / P2 | `uiux-records.spec.ts:124-162` 只门闩延迟 `/api/env` 后返回成功。没有失败响应、错误反馈或点击「重新连接」；末尾 `corrupt.json` 只验证文件解析失败。READY 行尾“失败沿既有错误重连路径恢复”未锁定。`App.vue:189-193,288-295,711` 静态存在对应路径，但源码存在不是测试证据。 | 加一个受控 env 失败→错误与导入禁用→允许后续 env 成功→真实点击「重新连接」→准备结束、重新进入库可导入的用例；记录失败请求和重试请求各自确实发生。重连可能按现有逻辑回创建页，应沿既有导航再开库，不擅改导航 oracle。 |
| L2-02 / P2 | History 首项 `:43-69` 的确执行两尺寸×两主题，但 `:53` 只取首行，`:54-59` 仅查 x 边界；未查行内重叠、裁切、列标签或实际命中。fixture 无关联录像，播放/导出可处于 disabled，几何存在不能证明这两个操作能用。删除只 `.focus()`，未触发。 | 紧凑尺寸用有录像的代表行，验证末行可滚到、播放/导出/删除目标命中与既有处理入口；可复用旧业务测试但须明确绑定。补两条真实标签断言（最终权益/收益率），以及右侧动作不与数据格相交。勿以“所有事实和操作”测试名代替这些断言。 |
| L2-03 / P2 | `uiux-records.spec.ts:91-122` 的排行/录像用例没有尺寸或主题循环，只有默认 1440×900、初始 dark；排行只有 tier/complete 单行→empty，录像只检查本机空态和导入 focus。未验证紧凑排行横向滚动、末列、录像有数据时的导出/删除，不能写“历史/排行/录像都已跨主题尺寸”。 | 针对 1024（并补实际最小内容区）两主题加入排行实际横向溢出→真实滚动→末列可见，以及录像非空长名/操作命中的轻量几何验证；如果不用全组合，逐项列明实际组合。排行/录像的这些语义目前没有完整对应矩阵行，应由 root 预登记补充行或明确行范围，不能塞进只说历史页的 HISTORY 行后称整体闭合。 |
| L2-04 / P2 | `uiux-settings.spec.ts:40-44` 与 `:113-115` 对默认页发 wheel，未证实 `scrollHeight > clientHeight` 或 scrollTop 改变。“滚动不能移动保存入口”的局部结论可在根本没滚动时通过。后续偏好页 `:122-144` 已有真实溢出、wheel、scrollTop>0、头部与导航稳定、末项命中，是有效的另一子场景。 | 默认页实际有溢出时补活性前置；若该默认页天然不滚，保留校验/保存反馈锚点结论，把滚动结论限定为已测试的偏好页。若要证明保存区在滚动时独立，需用支持的字号/内容条件让带保存区的默认页真实溢出。 |
| L2-05 / P2 | 新按钮 `History.vue:236`、`Rankings.vue:208,229,242,265,295` 的可见文字是股票代码/名称或 tier 成绩单，`aria-label` 却仅为“查看第 N 局成绩单”。它覆盖子节点文字，语音按可见股票名称定位有风险；`e2e/uiux-records.spec.ts:75,103` 用 `exact:true` 精确锁定该 aria-label，会让此缺陷持续存在。 | 保留可见股票代码/名称（股票排行保留 tier）在 accessible name 中，用原生内容或 `aria-labelledby` 加动作描述；加入 `toHaveAccessibleName` 包含可见主标签的断言。当前为可直接定位的标签不一致静态证据，未声称完成读屏验证。 |
| L2-06 / P2 | `uiux-shell.spec.ts:19-22` 先等进入动画完成，再切页；后续 Playwright click 也会等 actionability。测试锁终态与静态 rail 几何，未在运动中检查原坐标连续点击/中断反向切换。“即时操作”和“连续切换”不能由动画名称+终值 opacity 推导。 | 一个正常动效用例在动画进行时以固定坐标连续切换或开合，断言目标收到操作、最终页唯一且没有遗留遮罩；reduce 保留单独功能验证。若不补，L2 明确仅终态，不将过程流畅度或延迟保证标为已覆盖。 |

另外，`TrainingSettings.vue:1130` 新增固定 48px、`overflow-y:auto` 且 `justify-content:center` 的反馈区。现有测试仅检查短错误/成功文本，125% 用例没有断言整段反馈未裁切；这是长错误文本的待测风险，尚无运行证据证明缺陷。补一条足够长的真实错误反馈，检查首尾可读与键盘可达；不要把字体 token 放大称为浏览器缩放或完整无障碍验收。

## 五行绑定、真实轴与断言责任

下面的简写定位均从工作树根解析。默认配置为 `playwright.config.ts:13` 的 1440×900；`web/src/theme.ts:8-9` 无已存偏好时为 dark。只有代码明确设置的主题/尺寸组合计入覆盖，未设置的 motion 不算 reduce 测试。各用例是独立浏览器上下文，不从前一个测试继承主题。

### UIUX-CREATE-WORKSPACE

建议完整 `test_ids`：

```text
e2e/uiux-launcher.spec.ts::desktop creation separates rules from the training subject and keeps start in the first viewport
e2e/uiux-launcher.spec.ts::random dimension changes retain common control positions and the classic cash row
e2e/uiux-launcher.spec.ts::reorganized creation preserves selected options in the real create request
e2e/uiux-launcher.spec.ts::launcher keeps random fields and the start action usable with 125 percent text in both themes
```

输入/入口：先经真实 API 清理活动训练，真实创建页；只 stub `/api/data/status` 为 current 以隔离新鲜度提示。创建载荷用例真实 POST `/api/trainings`，不是 UI 桩回显。

| 用例定位 | 真实子场景 | 锁定断言及不能外推的部分 |
|---|---|---|
| `:35-51` | 经典初始表单；1024×680、1440×900；初始 dark、普通文字 | 规则区在标的右侧、顶部并列，开始按钮下界≤height−8且 y>0，表单有效宽度、页面无横溢出。无 hit test；这些尺寸不含实际1008×641。 |
| `:53-72` | 1024×680、dark；经典日期/资金同行，然后依次三个随机维度 | 日期/资金 y 差≤2；三个维度的周期、资金、提交 y 差≤2，提交底部≤672。测到的是切换后位置，未测运动帧和固定鼠标重复点。 |
| `:74-90` | 1440×900、dark；经典600519、3M、2025-01-02、资金200000、raw、open_close、orders=true | POST201、请求七个字段、训练日期可见。`toMatchObject` 未锁未列字段，也不证明随机维度的创建载荷全部保留。 |
| `:92-133` | 1024×680；light/dark × 三随机维度；七个字号 token×1.25 | 说明不溢出条件槽，周期/资金稳定、提交底部、页面无横溢出；滚至资金后 elementFromPoint=INPUT。`scrollTop=0` 是设置观察起点，不是滚动成功证据；最后仅当前全随机资金框做命中检查。不是系统DPI/浏览器zoom。 |

paper_only 杀手：恢复单列布局会触发首项“规则区在右侧”；恢复动态提示按各自自然高度排版会被第二/四项公共控件≤2px拦住（原17.59375px失败已由 W1 留存，但本轮未重跑）；把 open_close/条件单选择丢弃会被第三项请求字段断言拦住。只改随机请求载荷则第三项仍可通过，不能称整套创建载荷杀手。

L2 判断：分组/列明维度稳定/单一经典载荷有有效静态约束；实际最小内容区、未列载荷轴、呈现用户接受仍各有边界。不得把 viewport/theme/motion 三个全局数组理解为这些测试的完整乘积。

### UIUX-HISTORY-COMPACT

建议完整 `test_ids`：

```text
e2e/uiux-records.spec.ts::history keeps every fact and action within the desktop viewport at compact and wide sizes
e2e/uiux-records.spec.ts::history has an explicit keyboard report action and child keys never open a report
```

输入/入口：history API stub 三条长名称、权益1234567.89、收益23.456789%、123笔；首条 early-settled，另外两条 complete。report fixture 先真实 API 创建/结算/读取生产者响应，再用此真实形状 stub 9201 成绩单；只证明呈现与入口，不证明这些合成记录的持久化。

实际轴：首项明确 **1024×680、1440×900 × dark、light = 4组合**，普通字号、未模拟reduce；键盘项仅1440×900、初始dark。首项锁 history及document横溢出、首行9个元素x边界、三个格式化事实与删除focus（`:50-65`）；第二项锁容器非role=button、checkbox Space改变选中/Enter不误开report、显式报告Enter能打开、金额区域鼠标点击仍打开（`:74-88`）。标题的“child keys never”实际只测checkbox，不包括播放/导出/删除键盘。

paper_only 杀手：恢复旧单行过宽网格由横溢出/x上界断言识别；恢复行级 `keydown.enter` 会使checkbox Enter误开成绩单并在`:82`失败。删除紧凑标签 `::before` 或只破坏第二/三行布局，现有首项可能幸存；故列含义与所有行操作不能整句闭合，补验见L2-02。

补充用例（**不自动等于此历史行覆盖**）：

```text
e2e/uiux-records.spec.ts::rankings expose keyboard report entries while empty records explain the next action
```

实际仅默认1440×900/dark；rankings stub tier=1M、complete一条，Space开真实形状成绩单，改3个月后返回空数组，断言status和“切换周期”；随后录像本机空态说明、原生file input focus、父容器outlineStyle非none。没有range/sector/stock/earlySettled表、light/compact、录像非空，也无rankings横向溢出/实际滚动断言。outlineStyle非none不保证非零宽度或可辨识对比。paper_only：移除显式排行button会使Space/role定位失败；去掉空态status会在`:112`失败。删除排行横向滚动规则仍可能通过此用例。

### UIUX-MOTION-ACCESS

建议完整 `test_ids`：

```text
e2e/uiux-shell.spec.ts::UIUX navigation identifies the current page and settles without moving repeated targets
e2e/uiux-shell.spec.ts::UIUX reduced motion preserves navigation and settings keyboard recovery
e2e/uiux-settings.spec.ts::settings keeps the default save action anchored outside scrolling content and feedback
e2e/uiux-settings.spec.ts::settings retains focus isolation and immediate preferences with reduced motion
e2e/uiux-settings.spec.ts::settings retains reachable actions and local scrolling with 125 percent text in both themes
```

输入/入口：真实壳层与设置，API清理活动训练；设置保存是真实按钮点击。没有模拟接口错误，偏好是原生控件与localStorage。

| 用例 | 真实轴 | 断言责任 |
|---|---|---|
| shell `:10-32` | 1440×900/dark/no-preference | 历史当前页aria、动画名称、结束opacity=1、rail目标box相同、往返后唯一current、录像动画名、回创建可见；过程限制见L2-06。 |
| shell `:34-48` | 1440×900/dark/reduce | 历史动画none；打开设置、Esc关闭、focus恢复、当前页仍历史。 |
| settings `:25-51` | 1024×680/dark，默认motion | 保存位于面板底部，cash=0错误与disabled、不移动；123456恢复enabled，原坐标命中+真实点击保存、status已保存、不移动。wheel活性缺口见L2-04；未查持久化后重开值。 |
| settings `:53-76` | 1024×680/dark/reduce | workspace inert；数字动效偏好0→1即时写localStorage；动效页无保存按钮；Esc/focus/Enter重开，Shift+Tab仍在dialog。没有实际数字变化或动效帧断言，不替代M6-05R。 |
| settings `:78-149` | 1024×680 × light/dark，七字号token×1.25；默认/偏好页 | 默认校验禁用、底部坐标/命中、无横溢出；偏好页先证溢出，再真实wheel、scrollTop>0，header/nav x/y稳定，末快捷键inViewport/enable/实际hit。没有将每个字号与reduce/宽屏交叉。 |

paper_only 杀手：移除reduce CSS门控会使shell reduce动画none断言失败；恢复可变文案推动保存按钮会使cash错误前后坐标断言失败；去掉inert/焦点返回由对应expect识别；让整个设置面板一起滚动，由125%偏好页头部/nav坐标断言识别。恢复应用数字动效的OS双重门控未必会被“localStorage=1”杀死，应保留既有M6-05R绑定与运行。

L2 判断：终态/焦点/限定偏好/真实偏好滚动有约束；即时操作、运动中反向切换、长反馈可读性未全部锁住。新设置测试本轮未执行，W1明确旧字号GREEN不覆盖后补强断言，不能继承旧通过结果。

### UIUX-TRAINING-GEOMETRY（暂不评定最终覆盖）

当前完整引用：

```text
e2e/uiux-training.spec.ts::training keeps trading and drawing available together without shifting chart or advance target
```

本次读取指纹的旧版本：真实API创建300857/1M/2026-04-15/资金1000000/blind=false/close_only/orders=true；两尺寸为1024×680与1440×900。检查买入底部在console内、自定义常用可见、chart占主区域、真实单击推进后日期改变，推进x/y≤0.5且chartbox相同；每尺寸只推进一次。主题切浅发生于每轮断言之后，因此不能将这两次几何检查称为每尺寸×双主题。没有实际1008×641、125%或买入hit断言；root正在修复，请在最终文件指纹上重新复核，本段不作降级/升级裁决。

paper_only 仅记录现有语义：让推进后重排移动按钮超过0.5px会被坐标断言识别；本轮不把它外推为连续多日/绘图拖动/交易执行/最小内容区已覆盖。

### UIUX-RECORDING-READY

建议完整 `test_ids`：

```text
e2e/uiux-records.spec.ts::recording library waits for real namespace readiness before enabling imports
```

输入/入口与轴：真实读取 `/api/env` 生产者响应，再拦截页面同endpoint并用Promise闸门保留；真实鼠标打开录像库。默认1440×900/dark，初始化延迟>3500ms，随后成功。输入一份schemaVersion2有效录像与一份坏JSON，经file input批量导入，真实浏览器存储；没有运行系统原生文件选择器。

断言定位：`:142` intercepted>0证明观测活性；`:145-146` 未就绪input disabled、准备status可见；finally释放闸门后`:148-149` enabled且准备提示消失；`:161-162` 部分成功alert与导入记录恰好1。禁写只直接锁导入入口，clear/remove的无条目禁用不能作为busy语义杀手；本用例没有非空列表初始化场景。

paper_only 杀手：恢复App旧`:busy="recordingBusy"`会在延迟后的disabled断言失败；去掉initializing提示会失败；永不置ready会在enabled断言超时。让初始化失败后不显示错误/不重试，当前用例不进失败分支，变异可幸存。故READY成功路径可提L2，**整行仍缺失败恢复**，见L2-01；不允许删行尾来换绿。

## 指纹与命令收据

下列为审查时原文件SHA256；root后续修改时应据此判定哪些结论需要重审。

| 文件 | SHA256 |
|---|---|
| `e2e/uiux-launcher.spec.ts` | `dacd12261ee34f095a66c4704ddd702140780caf181c4a16c5319da8b69ffbea` |
| `e2e/uiux-settings.spec.ts` | `9c1401a58fe26716a4e6730ca2dd9aa6f48cf6b5132c088fb30e9961224b780d` |
| `e2e/uiux-records.spec.ts` | `f1ba983f124f9ebb767bdc2de0ba7da6f8de1a0659878b49a197d73515a2386c` |
| `e2e/uiux-shell.spec.ts` | `d5b3d99b854aac7ad0ce5fc6dfe60d6c56b497a9d89bb139aa82f39cdaf287e6` |
| `e2e/uiux-training.spec.ts` | `7ba72a4bc4f94acf2ad384ef258f34309cb502266cf4e271a419a070273d0d31` |
| `web/src/views/History.vue` | `e4352c886f5a27ea315b26a660b3e1993d0a8f10cd1c1b013aeb83b3983de210` |
| `web/src/views/Rankings.vue` | `dcaa26dd3ae8ac809c45867bb7b3adfbb5a53cce556ee4e5b11e6fcf76746e57` |
| `web/src/components/TrainingSettings.vue` | `db22e20d6e3202b7799e3ce8a2b9fa3340c2c5f6db49dc0959f5e7b6563b55ad` |
| `web/src/components/RecordingLibrary.vue` | `6c423337aca10835b240f46cbfee75441d5c2e9be32970df672693806cf4a9c3` |
| `web/src/App.vue` | `553fa2307d5640f6a7cd181912ed3dc040899ebd4199ba5bd45e1d6e79450805` |
| 任务卡 | `00229c10449f68d99396b586777d94c0400c2b1f8c559bea2200e7a415cc80bb` |
| `playwright.config.ts` | `1d2c38c846165cfd5781edd0e4903d6bc6e02e7fe5d2ad87d569edec0e5f772e` |

原生退出均在压缩日志之前读取 `$LASTEXITCODE`；wrapper成功不替代内部非零。

| 命令 | 原生退出与结果 |
|---|---|
| `git rev-parse HEAD` | 0；完整SHA见开头 |
| `node D:/Superlinear_Academy/Stock_WorkSpace/.zcode/skills/ai-harness/scripts/check-binding.mjs --repo D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/uiux-refine-20261017 --matrix D:/Superlinear_Academy/Stock_WorkSpace/.zcode/skills/ai-harness/matrix/uiux-workbench.yaml --strict --include-untracked` | 3；5行、covered0/open5/RED0；测试索引1766用例+386describe；五行尚未填test_ids，所以不能称“14 refs已由checker解析”。 |
| Python静态枚举五份`uiux-*.spec.ts`顶层完整test名并取SHA256 | 0；14名称、每文件无重复；这不是Playwright发现/执行证明。 |
| `git diff --stat`；`git diff -- web/src/App.vue web/src/components/RecordingLibrary.vue web/src/components/TrainingSettings.vue web/src/views/History.vue web/src/views/Rankings.vue web/src/styles.css web/src/tokens.css` | 0；读取当前共享工作面。stat当时14 tracked文件，290新增/66删除；不含新测试与本报告。宽diff曾截断，对发现相关段按文件/行段补读，不据截断作全源码审计。 |

本轮定位错误保留：首次把矩阵当作worktree内文件读取，PowerShell报告Cannot find path，但组合命令最终退出0；随后定位到工作区根并使用绝对路径成功。另一次rg误用`web/src/pages`、`SettingsPanel.vue`和Windows通配参数，原生1且有os error3/2/123；已更正为`web/src/views`、`TrainingSettings.vue`和明确路径。这些是审查准备错误，不是产品失败。

最终静态检查收据：

| 命令 | 原生退出与结果 |
|---|---|
| `npm.cmd run docs:check` | 1；17 errors、104 warnings。17 个错误均定位于本报告以外的文件；本轮未修复，也未比较基线，不能称基线确认错误。完整错误保留如下。 |
| `git diff --no-index --check -- NUL docs/verification/2026-10/UIUX-REFINE-01/L2-review.md` | 1；本报告为 untracked 文件，no-index 对比发现差异；输出只有 LF→CRLF 提示，没有 whitespace error 输出。不能将原生退出写成 0。 |
| `git diff --no-index --numstat -- NUL docs/verification/2026-10/UIUX-REFINE-01/L2-review.md` | 1；检查时为 160 新增/0 删除，并有相同 LF→CRLF 提示。该数字先于本段收据追加，不代表最终行数。 |
| Python 本报告局部校验；再次 `git diff --no-index --check` | Python 0；UTF-8 无 BOM、无行尾空格、代码围栏成对、无占位语句，1 个相对链接目标存在。再次 diff 原生 1，仅同一 LF→CRLF 提示，无 whitespace error 输出。 |

```text
ERROR docs/work-items/tasks/INSTALLER-UPGRADE-01.md: state 非法：queued
ERROR docs/work-items/tasks/MIG-ONECLICK-01.md: state 非法：in_progress
ERROR docs/work-items/tasks/MIG-ONECLICK-02.md: state 非法：queued
ERROR docs/work-items/tasks/RELEASE-CLEANUP-01.md: state 非法：queued
ERROR docs/work-items/tasks/REPLAY-INIT-REANCHOR-01.md: state 非法：queued
ERROR docs/work-items/tasks/REPLAY-INIT-REANCHOR-01.md: allowed_paths 必须是非空仓库相对路径/glob数组，不允许越界
ERROR docs/work-items/tasks/REPLAY-VIEWPORT-01.md: state 非法：queued
ERROR docs/work-items/tasks/TDX-RECONNECT-01.md: state 非法：queued
ERROR docs/work-items/tasks/INSTALLER-UPGRADE-01.md: 引用未知 milestones ID：R5
ERROR docs/work-items/tasks/MIG-ONECLICK-01.md: 引用未知 tasks ID：MIG-MERGE-01
ERROR docs/work-items/tasks/MIG-ONECLICK-01.md: 引用未知 milestones ID：R5
ERROR docs/work-items/tasks/MIG-ONECLICK-02.md: 引用未知 milestones ID：R6
ERROR docs/work-items/tasks/RELEASE-CLEANUP-01.md: 引用未知 milestones ID：R5
ERROR docs/work-items/tasks/REPLAY-INIT-REANCHOR-01.md: 引用未知 milestones ID：R5
ERROR docs/work-items/tasks/REPLAY-VIEWPORT-01.md: 引用未知 milestones ID：R5
ERROR docs/work-items/tasks/TDX-RECONNECT-01.md: 引用未知 milestones ID：R5
ERROR e2e/README.md: 链接目标不存在：migration-v127.spec.ts
INFO check: 17 errors, 104 warnings；不更改任务/验收状态。
```

无产品运行、构建、安装、共享状态或 commit 写入；审美取舍与完整候选验收仍由 root 和用户分别处理。
