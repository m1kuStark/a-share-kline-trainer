# E2E-BASELINE-01 全套 Journey 存量失败三桶分类（只分类，不清偿）

日期：2026-10-19。任务卡：[E2E-BASELINE-01](../../../work-items/tasks/E2E-BASELINE-01.md)。基础提交：`6533196`（main，docs 提交，工作树干净）。本报告只做分类与归因，不含任何修复；产品码、测试码、矩阵均零改动。

## 一、运行元信息与收据

| 项 | 值 |
|---|---|
| 命令 | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- --retries=0`（主仓根） |
| 退出码 | **1**（存在失败；gate 值语义 0=通过） |
| run 目录 | `.runs/run-9db67e72-e321-4f51-ad75-314a4f972113`（证据：artifacts/journey.log、browser-results.json、html/、test-results/） |
| 服务 | 运行器自管隔离服务 `http://127.0.0.1:9702`，结束自动关闭；不覆盖生产 dist |
| 耗时 | 34.0m |
| 总项数 | **191** |
| 通过 | **171** |
| 失败 | **18**（14 failed + 4 timedOut） |
| 跳过 | **2**（1 skipped + 1 did not run，逐例见下） |

环境说明（按任务卡预授权注明）：首轮无 TDX_ROOT 启动即失败（运行器拒绝缺样本源，退出码 1，"Journey needs a readable TDX sample source; set TDX_ROOT. No download was attempted."）；随后按授权设 `TDX_ROOT=D:\MySoftWares\TDX`（只读数据源，运行器复制冻结快照到 run 目录）完成全量。套件冻结样本日期与文件哈希由运行器管理，本轮未联网下载。

## 二、总数对账（vs 历史基线，如实报告差异，不迁就旧数字）

| 基线 | 总数 | 通过 | 失败 | 未运行 | 与本轮关系 |
|---|---|---|---|---|---|
| 2026-10-02 run-5522d19a（V1.2.3-feedback，stash 复跑同清单） | 108 | 89 | 19 | — | 历史事实；其后新增大量 spec，项数不可直接比 |
| 2026-10-04 GITHUB-HEALTH-01（CI 提交 `0715a0a`，双轮一致） | 125 | 93 | 29 | 3 | 本轮对账主基线 |
| **本轮 2026-10-19（`6533196`）** | **191** | **171** | **18** | **2** | 套件净增 66 项（random-mode/random-mask-axis/replay-period/recording 系/uiux 系/trade-marker-details/exit-flow/kdj/ma-settings 等） |

对 CI 29 项失败的逐项去向：

- **已修复（12 项，本轮通过）**：acceptance-feedback ×3（spec 文案已改为「还没有保存的本机训练录像」，与产品一致）；data-update a/b/c/d/e/g ×6（顶栏数据控件整族恢复，仅 f) 仍败）；m4-history「结算→按本局id定位历史行」（连同 CI 因 serial 级联未运行的 2 项一并无罪）；port-fallback a/b。
- **仍在败（17 项）**：CI 29 − 12 = 17，逐例见第三节。
- **CI 3 项未运行**：journey Act6（本轮仍因同文件 Act4d 失败而级联未运行）；m4-history ×2（本轮实际运行且通过）。
- **本轮新出现的失败（1 项）**：random-mask-axis「mask axis: hidden while running…」（该 spec 族 2026-10-09 RF2-02-03 验证时 3/3 通过；本轮为窗口相关失败，见逐例表）。
- 未运行项变化：本轮另有 migration-v127（设计内跳过：`MIG_V127_PACKAGE` 环境变量未注入真实旧包则 skip，属预期门控，非缺陷）。

## 三、逐例分类表（18 失败 + 2 跳过）

桶定义：**A 真bug**（产品行为违背 spec 意图，附复现）；**B spec过时**（断言锁定旧口径，附旧口径出处与当前产品行为依据）；**C 环境依赖**（本机/CI 特定环境，双方无错）；拿不准标**待复核**。

| # | 用例（spec:行） | 桶 | 证据（报错关键行＋断言＋源码） | 建议处置 |
|---|---|---|---|---|
| 1 | data-update f) 无可用来源 409 行内展示（data-update.spec.ts:243） | **B** | 报错：`toHaveText Expected "未检测到通达信数据" Received "连接通达信"`（14×locator resolved to `<button class="data-update-btn unavailable">连接通达信</button>`）。产品：web/src/App.vue:683 按钮文案为「连接通达信」、语义细节在 title（v1.0.3 起「右上角未检测到通达信数据时，按钮直接打开接入向导」，CHANGELOG 1.0.3）。同族 a/b/c/d/e/g 本轮已全过 | 更新断言到现行文案（或改断言 title/点击行为） |
| 2 | drawing-basis 跨除权日价位线跟随（drawing-basis.spec.ts:4） | **A** | 报错：撤销后 `Expected: 0 Received: 1`（spec:33 Ctrl+Z 后 drawings().length 应为 0）。**探针实证**（/tmp 独立复现，journey 构建）：画线后撤销正常（drawings→0）；但**任意推进一日后撤销按钮即 disabled、Ctrl+Z 无效**（600519 非除权推进同样复现）。根因：web/src/components/KlineChart.vue:460-470 `feedData()` 在每次 `props.bars` 变更（推进）时无条件 `drawingHistory.reset([])`，与 web/src/components/docs/drawing-persistence.md 成文契约「**推进不清撤销历史**」直接矛盾 | 立桶A卡修复：feedData 的历史重置应限定于周期切换，推进路径保历史 |
| 3 | journey Act4d 副图画线与多选框选（journey.spec.ts:399） | **B** | 报错：`overlayInfo(0).paneId Expected: not "candle_pane"`（spec:404）。两层过时：① `overlayInfo(0)` 取全量 overlay 第 0 个——自 v1.2.1（8791027）起 `phasePriceLine` 等引擎标记（candle_pane、lock）占据列表前部，第 0 个不再是用户画线；② 固定坐标 y790-830 按 3 窗格布局标定，2026-10-05（53b2371）KDJ 副图默认挂载后布局重排。**副图画线能力本身有通过用例背书**：kdj-indicator.spec.ts:87（动态窗格定位＋paneId='KDJ' 语义断言）本轮通过 | 更新断言：改用 `indicatorPanes`/`panes` 动态定位＋按 id/名称取 overlay，弃索引 0 与固定坐标 |
| 4 | journey Act6 主题切换持久化（journey.spec.ts:432，未运行） | **B（级联）** | browser-results 注记 `annotations:[{type:'serial'}]`：journey.spec.ts:6 `test.describe.configure({mode:'serial'})`，Act4d（#3）失败导致其后用例级联跳过，非独立缺陷 | 随 #3 修复后自动恢复；无需单独处理 |
| 5 | m3-feedback 自动保存（m3-feedback.spec.ts:78，60s 超时） | **B** | 超时点：`waiting for getByRole('dialog',{name:'训练结算'}).getByRole('button',{name:'继续查看图表'})`（e2e/training-flow.ts:34）。产品：Training.vue 训练结算弹窗按钮组现为「完成，返回首页／查看历史成绩单／重新训练／导出本场录制／**留在当前界面**」，`继续查看图表` 自 a71139a（2026-10-01 v1.1.1 反馈轮）起不存在（git log -S 实证） | 更新 training-flow.ts 的 after='chart' 分支为「留在当前界面」 |
| 6 | m3-round3 诅咒线编辑与刷新恢复（m3-round3.spec.ts:83） | **A** | 报错 diff：Expected 含 `styles{line{color…}}`、Received 无 styles（reload 后 toEqual(saved) 失败）。根因：编辑面板 `applyEdit()`（KlineChart.vue:1158-1168）把完整 line 样式写入 overlay 并随保存持久化到服务端；但 `restoreDrawings()`（KlineChart.vue:376-379）重建 overlay 时 `styles: configuredOverlayStyle(item.name)` **无条件覆盖 item.styles**——无工具级偏好（localStorage）时为 undefined，逐画线样式被丢弃。用户可见后果：改过的颜色/粗细/线型在刷新、撤销重做后回退默认。interaction.md 成文能力「颜色、粗细、线型、端点价格编辑」被破坏 | 立桶A卡修复：restore 保留 item.styles（`configuredOverlayStyle(name) ?? item.styles` 方向） |
| 7 | m3-tools D26-D29 编辑移动撤销重做（m3-tools.spec.ts:272） | **A** | 同 #6 根因：重做后 `toEqual([edited])` 失败，diff 显示编辑写入的 `styles{color:#ff4d4f,size:3,style:solid}` 在重做（经 restoreDrawings）后丢失 | 同 #6 一并修复（同根因合卡） |
| 8 | m3-tools D23 文本多行样式编辑（m3-tools.spec.ts:366） | **B（断言缺陷）** | 报错：`toContain Expected substring: "已复核\n保留观察"`，Received 为 `JSON.stringify` 输出（文本以 `\\n` 转义）。spec:420 对 JSON 序列化串断言**未转义换行**，数学上永不可能命中；同用例前段对 `extendData.text` 的 `toMatchObject({text:'关键区间\n等待确认'})` 通过，产品存储无缺陷。该断言自首次全量可运行（2026-10-02）即红，属天生红断言 | 更新断言：改为对 `extendData.text` 解析后断言，弃 JSON.stringify 包含检查 |
| 9 | m3-tools D30-D31 主副图保存刷新与跨周期恢复（m3-tools.spec.ts:506） | **A**（语义需用户确认方向，见 needs_user_decision） | 报错 diff：Expected 2 条画线、Received `Array []`（切周K 后 poll）。**探针实证**：600519 日K画线（序列化 `timeframe:"1D"`）→切周K→`drawings()=[]`。根因：a71139a 引入画线按周期归属（serializeDrawings 盖印＋restore 按 `(item.timeframe??'1D')===props.timeframe` 过滤，KlineChart.vue:1091/1531），spec 期望（interaction.md「动态补历史与周期切换后仍以时间定位」）为跨周期持续可见/锚点映射。未见任何任务卡/验证文档批准「按周期隐藏」为既定口径 | 立卡修复；修复方向（恢复跨周期可见 vs 承认按周期隔离并改 spec+文档）先呈报用户拍板 |
| 10 | m3-tools D31 已结算训练继续查看（m3-tools.spec.ts:638，60s 超时） | **B** | 同 #5：超时点 `继续查看图表`（settleThroughConfirmation(page,'chart')），按钮已被「留在当前界面」取代 | 同 #5 一并更新 training-flow.ts |
| 11 | m3-tools D31 快速切换周期过期响应不覆盖（m3-tools.spec.ts:661） | **A**（同 #9 根因） | 报错 diff：Expected 22 行数组、Received `Array []`——切月K后日K画线被周期过滤，跨周期恢复断言落空 | 随 #9 卡处置 |
| 12 | m3-tools D31 最新日线锚点跨周月映射（m3-tools.spec.ts:735） | **A**（同 #9 根因） | 报错：`geometry for overlay_… toBeTruthy Received: undefined`——周/月视图上该画线因周期过滤不在图上，几何自然取不到 | 随 #9 卡处置 |
| 13 | m3-tools D28 文本线段混选编辑刷新恢复（m3-tools.spec.ts:783） | **A** | 同 #6 根因：编辑后刷新，styles 丢失（diff Expected 含 styles、Received 无） | 同 #6 一并修复 |
| 14 | random-mask-axis mask axis 揭示换算（random-mask-axis.spec.ts:105） | **待复核** | 报错：`揭示态轴标签 2005-05-10 反推偏移空间后应命中图内 K 线日期`——`barDates` 不含 `2005-05-07`（该日为周六，处 2005 五一休市周）。两可：① spec 自算 oracle（spec:147-149 `shiftIsoDay(label,-offsetDays)`）假设「日历日平移与交易日过滤可交换」，节假日错位窗口下必失配＝断言缺陷（B 向）；② 产品揭示态标签锚点与 startDate 偏移不同源（A 向）。该用例 2026-10-09 RF2-02-03 验证 run-05c579b4 3/3 通过，随机窗口逐轮不同 ⇒ 窗口相关偶发。需定向复现（固定同一窗口二次运行）后定桶 | 复核：同窗口定向复现＋核对产品标签换算锚点；定桶前不动 |
| 15 | recording 默认录制离线回放（recording.spec.ts:57） | **A** | 报错：回放末日 `drawings() Expected >0 Received 0`（spec:137）。机制（静态链＋探针佐证）：用例在周K视图暂停/恢复录制，末日检查点经 `captureState()`（KlineChart.vue:511-517）捕获 `drawings: drawings()`——该序列化受当前视图周期过滤（探针实证周K下 `drawings()=[]`），日K所画画线未进检查点，回放还原为空。违背 REC-CHART 成文契约「图表必须还原该日最终画线」（SessionReplay.vue:269 注释同源）。该失败在 RF-03 README「未决事项」中已登记为存量 | 立桶A卡修复（与 #9 同域但独立立卡：即便确认按周期隔离口径，捕获也应取全量画线而非当前视图过滤集） |
| 16 | report-feedback 主题与覆盖层（report-feedback.spec.ts:5） | **B** | 报错：`toBe Expected "rgb(255,255,255)" Received "rgb(243,246,244)"`（spec:87 浅色成绩单底色）。产品：styles.css:416 `.report-modal-mask > .report-page { background: var(--surface-background, #fff) }`，`--surface-background:#f3f6f4`（styles.css:6）。变迁链：79bdec1（2026-10-01 历史成绩单模态化）引入 surface 变量→B3/B2 UIUX token 收敛（7d260e0/cd4fffd，2026-10-16）。该 spec 在 V1.1-feedback 验证轮曾 1/1 通过（早于 token 化） | 更新断言到 `--surface-background` 解析值 rgb(243,246,244)（或 CSS 变量断言） |
| 17 | training-defaults 设置保存失败反馈/键盘路径（training-defaults.spec.ts:110，120s 超时） | **B** | 超时点：`waiting for dialog '训练默认设置' button '取消'`（spec:133）。产品设置弹层现为「✕关闭（aria-label=关闭，TrainingSettings.vue:858）＋保存设置（:1102）」，无「取消」按钮；姊妹用例 training-rules.spec.ts:112 用 `{name:'关闭'}` 本轮通过 | 更新 spec 取消路径为「关闭」按钮 |
| 18 | training-defaults F5 在途预览失效（training-defaults.spec.ts:260） | **B** | 报错：`locator('input[type="date"]').fill strict mode violation: resolved to 2 elements`。产品：v1.0.3 起「自定义范围改为起始日＋结束日」（CHANGELOG 1.0.3；Launcher.vue rangeStart/rangeEnd 双输入），spec 仍按单输入框填写 | 更新定位器（`.first()` 或语义定位）对起始日输入 |
| 19 | training-rules F3 设置弹层键盘隔离（training-rules.spec.ts:159，120s 超时） | **B** | 同 #17：超时点 `dialog button '取消'`（spec:253），产品已无该按钮 | 同 #17 一并更新 |
| 20 | migration-v127 真实包全链路（未运行，设计内跳过） | **C（设计内门控）** | spec 以 `MIG_V127_PACKAGE` 环境变量门控：无真实旧包即 `test.skip`（e2e/migration-v127.spec.ts，仓库唯一显式 skip）。运行器不自动安装数据源，属预期行为 | 无需处置；如需纳入全量绿，另立任务注入真实包路径后运行 |

注：跳过计数的呈报口径——journey Act6 为 serial 级联（归 #3 桶B根因），migration-v127 为环境门控（桶C）。两者都计入"未运行"但对账时单列。

## 四、桶小计与根因分组

- **桶A（真bug）8 项**：#2 撤销历史（独立根因）；#6/#7/#13 画线样式丢失（同一根因：restoreDrawings 丢弃 item.styles）；#9/#11/#12 跨周期画线不可见（同一根因：按周期过滤）；#15 录制回放丢画线（周期过滤渗入捕获链）。实际 **4 个根因 → 建议 4 张修复卡**。
- **桶B（spec过时/断言缺陷）9 项**：#1/#3/#5/#8/#10/#16/#17/#18/#19（其中 #5/#10 同为 training-flow 按钮文案、#17/#19 同为设置弹层取消按钮、#18 为 v1.0.3 范围双输入，多为 v1.0.3~v1.1.1 用户反馈轮 UI 演进未回写 spec）。
- **待复核 1 项**：#14 random-mask-axis（窗口相关，需定向复现定桶）。
- **桶C（设计内门控）1 项**：#20 migration-v127（非缺陷）。

## 五、桶B逐条呈报清单（用户拍板：逐条更新断言或删除用例）

依据用户 2026-10-19 拍板 5（桶B逐条呈报更新/删除，每条给建议与理由）。以下 9 条全部建议**更新断言**、不建议删除——每条仍锁定有价值的用户可见语义，仅交互面/文案/样式令牌演进：

| 呈报项 | 现状断言（旧口径） | 当前产品口径（依据） | 建议 | 理由 |
|---|---|---|---|---|
| B-1 data-update f) | 按钮文本 `未检测到通达信数据` | `连接通达信`（App.vue:683；CHANGELOG v1.0.3「直接打开接入向导」） | **更新**：断言新文案＋409 行内中文原因（用例核心价值在 409 展示与不弹 alert，这两点产品仍满足） | 文案是行动导向改版，核心断言（409 行内展示）不受影响 |
| B-2 journey Act4d | `overlayInfo(0).paneId != candle_pane`＋固定 y 坐标 | 引擎 overlay 前置（v1.2.1）＋KDJ 默认第 4 窗格（2026-10-05）；副图画线能力由 kdj-indicator:87 通过用例背书 | **更新**：动态窗格定位（`panes()`/`indicatorPanes()`）＋按 overlay id 取值 | 用例守护「主副图同权」核心语义，值得保留；仅取值方式过时 |
| B-3 m3-feedback 自动保存 | 结算后点 `继续查看图表` | `留在当前界面`（a71139a；Training.vue settle-actions） | **更新**：training-flow.ts after='chart' 分支改点新按钮 | 用例主体（保存状态机＋布局不变＋已结算续画）全部有效，仅结尾按钮名过时 |
| B-4 m3-tools D23 文本 | `JSON.stringify(drawing)` 含未转义换行 | JSON 序列化必然转义 `\n`；产品 extendData.text 存真实换行（同用例前段 toMatchObject 通过） | **更新**：对 `extendData.text` 断言 | 断言写法天生不可满足，属测试码缺陷，与产品无关 |
| B-5 m3-tools D31 已结算 | 同 B-3（继续查看图表） | 同 B-3 | **更新**：同 B-3 | 同 B-3 |
| B-6 report-feedback | 浅色成绩单底色 `rgb(255,255,255)` | `var(--surface-background)`=rgb(243,246,244)（styles.css:416/:6；79bdec1→UIUX B2/B3 token 化，用户驱动的视觉轮产物） | **更新**：断言 surface token 解析值 | 深浅主题/覆盖层/日期对齐等核心断言不受影响；纯白已被多轮 UIUX 验收取代 |
| B-7 training-defaults 设置保存失败反馈 | 弹层 `取消` 按钮 | `✕关闭`＋`保存设置`（TrainingSettings.vue:858/:1102；姊妹用例用「关闭」已通过） | **更新**：取消路径改「关闭」 | 保存失败反馈/键盘隔离/迟到读取等主链全部有效 |
| B-8 training-defaults F5 | 单 `input[type="date"]` | 自定义范围＝起始＋结束双输入（v1.0.3，CHANGELOG） | **更新**：定位到起始日输入 | F5 在途预览失效语义仍有效，仅定位器过时 |
| B-9 training-rules F3 | 弹层 `取消` 按钮 | 同 B-7 | **更新**：同 B-7 | 键盘隔离主链有效 |

（附）journey Act6 未运行项随 B-2 修复自动恢复，不单独呈报。

## 六、结论：这些失败当前是否被任何门禁拦得住（供 G5 接线任务引用）

**事实：当前没有任何自动门禁会因这 18 项失败拦截发布或合流。**

- GitHub Actions（.github/workflows/check.yml）仅 `npm ci → npm run build → npm test`（单测），**无 journey/e2e 步骤**——本轮 18 项失败下 CI 照样绿灯。
- 发布构建链（scripts/release/build.mjs；docs/engineering/release-build.md 步骤 9）对 journey 的唯一检查是**生产资产不得残留 journey 测试钩子**（标记扫描），不运行 journey 本身。
- `npm run verify:candidate`（scripts/verify-candidate.ts 步骤序 docs→unit→types→build→snapshot→m2→journey→cleanup）**包含** journey，但它是集成阶段按需人工执行的候选门禁，不在 CI、不在发布脚本自动链上；且公开源码包（export-source.mjs）显式排除了该脚本。GITHUB-HEALTH-01 双轮 93/125 失败期间发布流程照常走过（v1.2.7 已发布）。
- 因此「e2e 纳入发布门禁必过链」（用户拍板 6）是接线缺口而非收紧：**前置＝桶A清零（4 张根因卡）＋桶C登记完成**；桶B在用户逐条拍板后清偿，否则接线后必过链将永久红灯。

## 七、纪律与边界声明

- 本轮零产品码/测试码/矩阵改动（运维分类任务，root 预声明的矩阵步骤不适用；替代收据＝全量运行命令＋退出码＋逐例状态表＋逐条证据摘录）。
- 归因证据源：run-9db67e72 artifacts（browser-results.json/journey.log/test-results/*/error-context.md/trace）、GITHUB-HEALTH-01 result.json 及其 run-c0343c4f 逐项 JSON、git 历史（-S 溯源）、产品源码行号、四组 /tmp 独立探针（drawing-undo×3＋timeframe-stamp，复用 run-9db67e72 的 journey 构建与隔离服务，探针后服务已停）。
- 已知局限：#14 random-mask-axis 未做定向复现（标待复核）；#9/#11/#12 的「按周期隔离是否既定口径」无文档批准记录，修复方向需用户拍板（见 needs_user_decision）。
