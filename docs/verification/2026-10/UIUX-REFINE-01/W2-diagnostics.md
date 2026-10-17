# W2-DIAG：全量 journey 第 54、61、63、67、70、71、73、75 项诊断

本轮是只读诊断，不改产品或测试，不运行浏览器、构建、runner、矩阵、台账或 workflow。产品 RED/GREEN、构建与新绑定不适用；替代收据是原失败 trace/error-context、完整相关用例、真实 producer 源码、`git show 6d557a12` 对照及资源身份。第五步共享记录由 root 代办。八项主失败均已定位；另发现一项不能由旧断言修正掩盖的保存缺陷。本文不宣称这些问题已经修复或回归通过。

## 范围、注入与候选身份

- 书面 manifest：`UIUX-REFINE-01-W2-DIAG`，工作树 `trainer-worktrees/uiux-refine-20261017`；base `6d557a12f400ce45b50418b8556f943d39fef754`；唯一写面为本报告。
- 开工全文注入候选 Harness v1.12 `SKILL.md`、`references/supervised-delivery.md`、`references/oracle.md`，以及 UIUX core v0.4.1 `SKILL.md`；未安装。相关用例和 producer 的大输出曾被工具截断，已分段补读本文涉及的完整函数/用例；不能把截断输出当完整注入。
- 原失败来自 `.runs/run-37ef9fff-d35f-482b-a2c7-b35e723bdd50`（下称 RUN），`manifest.json` 记录 commit=上述 base、URL=`http://127.0.0.1:11086`、createdAt=`2026-10-17T12:59:53.407Z`。该 commit 不包含脏工作树候选，资源身份另核。
- 八份 trace 均加载 `index-BsDAkYf6.js`（SHA256 `ac88dbabad80d8e8acaa4e9e25e36bd73cb26d3a3ebb5f4be4387cbf164e74fd`）与 `index-DUxQfQ46.css`（SHA256 `a28a1382cc5394ab6d2587fdc8507fe533a69aa9d7a62cd1f960a4f3840a5f6f`），与 RUN/web/assets 一致。
- 原失败留在 RUN/artifacts/journey.log:89,98,102,108,113,116,120,124；各目录中的 `trace.zip`、`error-context.md` 和 `test-failed-1.png` 未改动。最终全量运行退出码由 root 报告，此诊断不消费或中断 runner。

## 逐项结论

| 全量编号 / 测试绑定 | 首次失败与分类 | 可否仅修测试准备 |
|---|---|---|
| 54 — `e2e/m3-round3.spec.ts::诅咒线仅保留第二点起始的50%右向射线，编辑与刷新恢复` | :111 刷新后绘图对象缺整个 `styles.line`；**基线已有的真实产品缺陷** | **否**。保留相等断言，修复恢复样式链，再跑原用例。 |
| 61 — `e2e/m3-tools.spec.ts::M3 D26-D29 编辑移动撤销重做删除清空保留交易标记` | :308 重做后丢 `#ff4d4f / size=3 / solid` 等样式；**同一基线产品缺陷** | **否**。不能删除 styles 比较、改成只比点位。 |
| 63 — `e2e/m3-tools.spec.ts::M3 D23 文本多行样式编辑取消与输入热键隔离` | :420 用 `JSON.stringify` 结果包含真实换行作预期，actual 正确但换行已被 JSON 转义；**可证明基线测试失效** | **是**。直接断言 `extendData.text` 等于原多行文本，保留所有热键、样式、取消、undo/redo 后续断言。 |
| 67 — `e2e/m3-tools.spec.ts::M3 D30-D31 主副图保存刷新与跨周期恢复` | :530 切周后期望日线两图形，actual=[]；**可证明基线测试 oracle 已过期** | **不是普通准备修复**。按已记录的日/周/月隔离决定迁移 oracle：周/月不显示日线，回日线仍完整；保留保存、刷新、MACD窗格、平移与历史加载义务，不能只删跨周期断言。 |
| 70 — `e2e/m3-tools.spec.ts::M3 D31 已结算训练继续查看刷新保留画线并返回首页` | helper `e2e/training-flow.ts:34` 等旧按钮“继续查看图表”直至60秒；实际按钮“留在当前界面”；**可证明基线测试失效** | **是**。按既有用户决策改精确标签；继续真实点击并保留关闭弹窗、URL、禁买、刷新保线和返回首页断言。 |
| 71 — `e2e/m3-tools.spec.ts::M3 D31 快速切换周期时过期周线响应不覆盖月线` | :703 月线中期望日线图形，actual=[]；**主失败为基线 oracle 过期**。同时 trace 有重复 ID 保存400，属于**额外真实产品缺陷，触发来源仍需定向复现** | **否，不能仅修测试就关闭该项**。保留迟到周响应隔离；迁移画线预期后，还要独立锁住保存成功、唯一ID和回日线恢复。 |
| 73 — `e2e/m3-tools.spec.ts::M3 D31 最新日线锚点跨周月映射到当前聚合柱` | :756 geometry helper 找不到日线对象直接失败；现行契约要求不在周/月显示；**可证明基线 oracle 过期** | **不是普通准备修复**。重新绑定为各周期独立锚点/保存恢复；原跨周期“映射到聚合柱”目标已被替代，不能以延长 poll 掩盖。 |
| 75 — `e2e/m3-tools.spec.ts::M3 D28 文本线段混选编辑文本颜色内容并刷新恢复` | :819 刷新后两对象 styles 均丢；随后真实 PUT 把缺样式状态写回；**同一基线产品缺陷** | **否**。恢复样式后原断言应通过，不改已有业务预期。 |

本组没有证据支持把主失败归为启动/环境超时，也未发现能归因于本轮 UIUX 改动的主失败。此结论来自具体差异/旧决定与调用链，不是仅凭“文件没改”。对 71 额外竞态，没有同环境基线重放，不能声称其出现频率或触发时机与本轮布局无关。

## 54 / 61 / 75：恢复时覆盖已保存样式

真实链路：`applyEdit`（KlineChart.vue:1156 起）写 `styles.line` → `recordDrawings` → `serializeDrawings` 深拷贝 → Training 的 outbox/1200ms saver → drawings API 原样保存；刷新经 `loadDrawings`，undo/redo 经 DrawingHistory，最后都走 `restoreDrawings`。

`KlineChart.vue:363–392` 的恢复逻辑先展开 `...item`，又强制写 `styles: fixedArrowStyle`。非涨跌箭头时该值来自 `configuredOverlayStyle(item.name)`，没有全局偏好便返回 undefined（:126–131）。这覆盖了已经保存的 `item.styles`。`drawingState.ts:26–39` 只序列化实际存在的 styles，故恢复后字段消失。基线 `git show 6d557a12:web/src/components/KlineChart.vue` 有同样代码；样式默认偏好应作用于新建工具，不能覆盖既有对象，见反馈计划编号8及 `drawing-persistence.md` 的样式深拷贝/历史恢复契约。

- **54，training=41**：诅咒线几何、50%射线、1800编辑、已保存及 GET 点位检查先通过。PUT 200（trace time=602302.388ms）和刷新 GET 200（605529.899ms）均含 `#f5c343 / size=1 / dashed / [4,4]`；最后只缺 styles，点位、priceBasis、timeframe 保持。初期 poll 出现 undefined 是页面重挂载过程，最终失败已经是确定的 styles 差异，不是纯 readiness。
- **61，training=48**：交易标记、costLine、创建、撤销重做初始图形、取消编辑、确认编辑及初次颜色/粗细/点位检查先通过；再次 redo 到 edited 状态时只丢 styles。PUT 200 保存对象仍带 `#ff4d4f / 3 / solid`。后续拖动、删除、清空与引擎标记保留尚未执行，不能报通过。
- **75，training=62**：混选数量2、文本颜色/内容修改、服务端 GET 等于 saved 均先通过。刷新 GET 200（988594.242ms）仍带两个 styles；UI恢复后两者消失。随后 PUT 200（990223.992ms）确实发送并保存无 styles 的两对象，影响已越过只读诊断钩子。文本的 extendData 内容/颜色仍在，不等于线样式已保全。

建议 root 独立派发最小产品修复：恢复已有对象优先使用该对象 styles，保留涨跌箭头现有固定色例外，不让偏好替换历史用户编辑；用上述原测试锁住刷新及undo/redo，另检查“全局偏好与既存样式冲突”的明确回归。不要绕过真实恢复函数，也不要把三个失败改为 partial match。

## 63：JSON 字符串断言必然失真

源用例的多行输入与 `confirmTextPanel` 都使用真实换行；该函数通过 `extendData` 保存。trace 的 PUT `/api/trainings/50/drawings` 200 已返回 `extendData.text="已复核\n保留观察"`（JSON形式），颜色绿、字号20、粗体/斜体均保留。失败打印的 JSON 字符串中为转义的 `\\n`，expected 是真实换行，因此原 `.toContain('已复核\n保留观察')` 对 JSON.stringify 输出必败。此断言与源码在基线即相同。修复应读取字段、直接精确比文本，不改变字符串内容或改成弱包含。

## 67 / 71 / 73：旧跨周期 oracle 与现行决定冲突

来源：`docs/superpowers/plans/2026-10-01-v1-1-acceptance-feedback.md:24`，用户反馈编号6：日/周/月画线独立，旧无 timeframe 按日线，刷新/重开隔离，旧数据不丢。该记录在基线已有，不能继续套用9月的跨周期共图预期。

消费链：Training `loadDrawings` :133–137 归一后按当前tf过滤；`onDrawingsChange` :149–160 合并其他周期存档；tf watcher :854–860 立即选择目标周期集合并请求行情；KlineChart savedDrawings watcher :1090–1092 和 mounted :1531 再按tf过滤。上述逻辑在基线相同。

- **67，training=54**：日线主图与MACD各一条、远端保存、刷新恢复、MACD几何所属窗格都通过。周线 bars200（807826.149ms，25.264ms）与日线辅助200均成功；周tab selected，空图正符合隔离要求。未运行月/日切回及后续平移/历史加载。
- **71，training=58**：迟到周线被门闩保留；月线301根、最后日期2026-09，周线1040根、最后2026-08-31。原测试在月线首次完成及释放周线之后两次验证月线数据一致，月tab selected亦通过；失败仅在期待日线图形还显示于月线的末尾断言。但它未断言保存状态，下面的400必须独立处理。
- **73，training=60**：两次推进到2026-09-03、日线末柱锚点timestamp相等均通过。切周数据200、周tab selected之后，用日线ID找周线geometry为undefined，正是隔离表现。后续月线循环未执行。不得删ID检查后宣称旧“映射”需求通过。

建议由 root 记录 oracle 替代关系并迁移用例，保留每条原失败与已有义务。71行情迟到响应断言仍有效；67可以保留日线全部后续操作，在周/月验证不串线且回日线完整；73应改为各周期分别创建/持久化/重开验证的现行契约，测试ID/矩阵L2须重新复核。

## 71 的额外保存竞态：已观测缺陷，具体触发链为待证假说

同一 trace：PUT `/api/trainings/58/drawings` at **931515.095ms**，HTTP **400**，响应原文：`drawing ids must be unique nonempty strings of at most 128 characters`。请求有两条 `overlay_1792242930024_1`，相同点位和priceBasis，分别 `timeframe:1D` 与 `timeframe:1W`。error-context 同时显示“保存失败”及此错误。服务端 `server/src/drawings.ts:51–58` 正确拒绝重复ID，不能放宽该校验。

原始请求 resource：trace.zip 内 `resources/1a7d3eeac097179110f8c667024dc26c17c02c0f.json`；响应 `resources/f5a987af5ffbd7510106d18284f90159a3e85630.json`。

可疑链路：图表 `drawings()`（:328–330）使用当前 props.timeframe 为仍在图上的对象盖印；全局 pointerup（:1518）不区分图内外便排队 recordDrawings；tf watcher 先改props而行情尚未返回，savedDrawings watcher只在 `!restoredDrawings` 时重建。期间旧日图仍可存在，且 `recordDrawings` 未显式禁止目标tf已变/当前数据尚未切换；Training 合并时保留日线再追加盖印周线对象，恰好可产生观测到的重复ID。相关函数均在基线已有。

这条机制与payload吻合，但本轮没有事件级插桩或独立重放，**不能把具体哪个 pointerup 的时序写成已证明根因**。建议新增受控迟到周线的回归：锁住所有写请求ID唯一、day对象归属不变、无保存400、月图不显示日线、回日图完整；按实际渲染数据所属周期阻止异步切换窗口把旧对象盖成新周期。禁止用删重复ID或放宽后端校验掩盖潜在数据错配。原业务迟到响应测试与新的保存回归分开绑定。

## 70：已批准按钮文案未同步 helper

反馈计划编号7明确改为“留在当前界面”；Training.vue:1151 的处理只有 `settledView = null`，关闭结果弹窗继续看图，未换训练。`settle` :544起先设snapshot、settledView和training URL；`confirmEnd` :618起正常等待画线flush与录像结束。

trace training57 settle POST200（872726.03ms）状态settled，之后 bars200同状态；结果弹窗和保留checkbox已通过，快照列出正确按钮“留在当前界面”。helper `after='chart'` 仍找旧标签，等到整个60秒超时。基线两侧亦不一致；修改helper精确名称可修准备缺口，但后续结束训练刷新保线/禁买/URL尚未在该失败运行执行，需完整重跑。不要把结算API成功扩大为整条结算恢复路径通过。

## 来源指纹与收据

以下当前文件与 `git show 6d557a12:<path>` 在统一CRLF为LF后相同（不是只比文件是否出现在diff）：

| 文件 | SHA256（归一化文本） |
|---|---|
| web/src/components/KlineChart.vue | 316c0986a3be1f382cf69cc0739012de395d1067ffa92e63986b0c0604c9209c |
| web/src/drawingState.ts | 8f508f3550b6d28646045a720af3154a3301c62007070f82d45fab4667135a57 |
| web/src/toolFavorites.ts | 37ded7e4848052f0bc7ab96b8c7df63ad0b7ffdc4b11338867adfc3af05233a3 |
| server/src/drawings.ts | a6611b0192cd00be2d5e22968b8b3fcc5854c8d15c3dce9bf483c4abb08b5dbd |
| e2e/m3-round3.spec.ts | 981f0220dd5fb48aacfa1ec9ef0c26b7671eb787a6fad5b574e327b0944705a7 |
| e2e/m3-tools.spec.ts | 871a07b26cf24785925e300bfd4979889cf875ccf260dfb3458577dc7d656a19 |
| e2e/training-flow.ts | cb21935428223b60a6df6d9840a199d7dc090f5c7764f64740884af1ea824054 |
| docs/superpowers/plans/2026-10-01-v1-1-acceptance-feedback.md | 02365e8121394130ec5c5d194e2f9adc295573a6ab605c8703763d86033afeb4 |

Training.vue 当前 diff 仅 scoped CSS；涉及保存/周期/结算的函数逐段与基线相同。未运行基线browser，不能用静态相同推导具体时序必相同。

原artifact目录均相对于 RUN/artifacts/test-results，每项含 trace.zip/error-context.md/test-failed-1.png：

| 编号 | 目录 | trace.zip SHA256 |
|---|---|---|
| 54 | m3-round3-诅咒线仅保留第二点起始的50-右向射线，编辑与刷新恢复 | 2a16d87aa2246f6c1ba849d1392b925df497da62286a27f093416f1dbf79eb0b |
| 61 | m3-tools-M3-D26-D29-编辑移动撤销重做删除清空保留交易标记 | e1ea7d4e6eaaf0112aa5d4462079810fcabaa94145bc3d324f6b1bd4b229179a |
| 63 | m3-tools-M3-D23-文本多行样式编辑取消与输入热键隔离 | 2b901ab6c4d290ba899a01d6a19c669d3fd15cc0960f9a45646e1dc05f3afe17 |
| 67 | m3-tools-M3-D30-D31-主副图保存刷新与跨周期恢复 | f507a3fd8c26d539fe40878b9ae57b10b37b669a8f1ee9ccc2e845968080e41d |
| 70 | m3-tools-M3-D31-已结算训练继续查看刷新保留画线并返回首页 | 4810ac486dd9f1e198a05691b102fb6d79c6cfa34ed3d6e4384eb6073e1f313b |
| 71 | m3-tools-M3-D31-快速切换周期时过期周线响应不覆盖月线 | 4295480a97a17413f75d9aff6bd20bb1d32b8d46ac06510e84c2fcc56424b278 |
| 73 | m3-tools-M3-D31-最新日线锚点跨周月映射到当前聚合柱 | 959ed20be1595d2d8b57647c120b88f45d20fee9c992218c69c7ea4b23fbf410 |
| 75 | m3-tools-M3-D28-文本线段混选编辑文本颜色内容并刷新恢复 | 69894b1ffc205270eebacc267ad7eb3daf469ed5187ca486573bef7322dc7d68 |

静态取证命令：Python zipfile 解析 `*.trace/*.network` 与 `git show` 指纹比对，原生退出码0；只读检索一度使用不存在的 SettlementPanel.vue/web/test，保留原错误后改查实际 Training.vue 内联弹窗，无结论依赖不存在路径。报告格式验证仅 `git diff --check`；无新产品测试、无变异运行、无完成状态提升。

对 Harness 的可复用观察：测试主断言是旧oracle，并不意味着同trace没有产品缺陷。诊断除了定位最终throw，还须扫一遍受影响写请求的非2xx与用户错误状态；71若只修最后的画线数量预期，会遗漏保存400。此为观察建议，由root决定是否修改skill。

## 补充：102 / 103 port-fallback，以及 104 的假通过风险

root 在原诊断中途追加只读范围：检查 `e2e/port-fallback.spec.ts` 两个失败。没有开放产品或测试修改权限。

| 编号 | 失败位置 / 现象 | 诊断 |
|---|---|---|
| 102 — `a) 发生回退：常驻提示实际端口、原因与固定端口方法` | :50 等 `.port-fallback-note` 可见，5秒后 element(s) not found | **基线已有测试 fixture 缺必填字段**，不是端口提示渲染的产品回归。 |
| 103 — `b) 发生回退（被占用原因）：文案区分"被其他程序占用"` | :63 同样失败 | 同一 fixture 缺口。 |
| 104 — `c) 未发生回退：不出现端口提示条` | 原日志显示通过，只断言 count=0 | **现有通过不足以证明无回退状态正确**：同一坏 fixture 可使 env 永远不赋值，提示条自然不存在。需在恢复有效 fixture 后先证明初始化成功，再保留负断言。104 没有失败 trace，未声称观察到其完整运行状态。 |

两份失败 trace 的 route.fulfill 请求体均为 status=200，却均缺 `recordingNamespace`；a 的 launcher 为 `8789 / 8787 / reserved`，b 为 `8790 / 8787 / occupied`。两份 error-context 页面都直接显示 `TDX 未连接 Cannot read properties of undefined (reading 'trim')` 和“正在连接本地服务…”。所有已捕获 API 请求均200，未发现额外非2xx写请求；失败发生在前端接收 mock 后。

实际路径：`EnvView` 在 `web/src/api.ts:245` 要求 `recordingNamespace: string`；`App.vue:288–295` 先 `configureRecordingNamespace(next.recordingNamespace)`，再写 `env.value = next`。`recordingRepository.ts:22–23` 对传入值执行 `.trim()`，fixture 漏字段使该行抛错，env 保持空；`App.vue:280–286` 没有 launcher 就返回空提示。`App.vue` 当前改动未触及该初始化/端口提示逻辑。`e2e/port-fallback.spec.ts` 与 namespace guard 的完整文件均与 base 相同：

| 文件 | SHA256（归一化LF，与 base 相同） |
|---|---|
| e2e/port-fallback.spec.ts | 7d3a93ddb944edb409bad7c2fc84f844ae615343bcfc8261bfcc8119672a2509 |
| web/src/recording/recordingRepository.ts | a2de3e402ce367f7f3caef52b72a2f263bee3ab4868e00e900b64b5f9c0e0d8c |

**最小准备修复建议（仅建议，未实施）**：在 `envBody` 加非空固定隔离标识（如 `e2e-port-fallback`），import `EnvView`，将参数约束为 `EnvView['launcher']` 并对完整对象使用 `satisfies EnvView`。现有三调用都传 launcher 对象，未用 null；去掉不必要的缺字段分支即可守住当前真实 producer 契约。三例进入页面后都先断言实际就绪状态（例如 `.connection-text` 包含 `TDX · 截止 2026-09-28`，且 `.env-error` 不存在），然后执行原提示条全文/原因/配置文件说明断言或缺席断言。不得通过改产品 namespace guard、延长 timeout 或直接插入提示 DOM 解决。

这三个用例是展示不同 launcher 信息的路由 mock，8789/8790/8787 是各场景的受测输入；保留这些端口差异，不应把 fixture 全部改成运行器的11086。隔离协议和真实端口回退本身仍由对应 server/release-launcher 测试负责。

原日志位置为 RUN/artifacts/journey.log:153,156,159。两份 trace 仍加载上述同一 JS/CSS 指纹，原件未改动：

| 编号 | RUN/artifacts/test-results 下目录 | trace.zip SHA256 |
|---|---|---|
| 102 | port-fallback-a-发生回退：常驻提示实际端口、原因与固定端口方法 | 4622d5a0949bc148a74e74c69815ba527535f6714a582a72317e64313cbff584 |
| 103 | port-fallback-b-发生回退（被占用原因）：文案区分-被其他程序占用- | 453bd22aaa6a0e52f118a29b84b8cc03c309b5211e70cda16c62c12a6dc03c76 |

附加 Harness 观察：与失败用例共享 fixture 的“元素不存在”通过项也要审查 readiness；缺席本身可能是初始化失败的副作用，不是目标行为证据。

## 本轮交接边界与静态核对

原八项与追加两项均仅诊断。54/61/75 的样式丢失是真实且静态证据明确的基线产品缺陷；71 的重复ID保存400是真实缺陷，但触发因果仍需定向复现。没有将旧 oracle 或基线归因当成忽略产品缺陷的理由，也没有在 UIUX 范围顺手修改 drawing 保存/恢复语义。

本报告核对：`git diff --check` 原生退出码0；Python 核对原八项编号、无行尾空格及 SHA256 长度，原生退出码0。追加部分完成后再次核对，`git diff --check` 原生退出码0；Python 核对全部11个编号、无行尾空格及22个合法SHA256，原生退出码0。本子任务没有启动浏览器、测试或构建，没有改矩阵、台账、状态或 commit，也没有消费全量 runner 的最终退出状态。

## 后续授权：PORT 测试夹具修复交接

此节属于 root 后续明确授权的新子任务，不追溯改变上文只读诊断边界。新轮只写 `e2e/port-fallback.spec.ts` 和本报告。产品 RED 不适用：本轮零产品代码修改，以 RUN 的102/103现存失败、完整消费者链和坏 fixture 为准备修复依据；所有原产品断言保留。浏览器、构建、journey、矩阵/台账/状态/commit 均仍由 root 独占。

开工完整重读候选 Harness v1.12 `SKILL.md`、`references/oracle.md`、`references/supervised-delivery.md`，UIUX v0.4.1 `SKILL.md` 与 `references/patterns.md`。聚合输出截断的 Harness/Supervised 内容已单文件补读，未安装。候选目录只有文档，第一次按候选路径调用 task-manifest 得 `MODULE_NOT_FOUND`、原生退出码1；改用工作区 `.zcode/skills/ai-harness/scripts/task-manifest.mjs --repo <worktree> --task UIUX-REFINE-01`，原生退出码0。2026-10-17T13:32:36.363Z 简报确认新增 port spec 写面：A1第16项 `server/test/uiux-*.test.ts`；A2 base=`6d557a12`，HEAD=`6d557a12f400ce45b50418b8556f943d39fef754`；A3 `docs/work-items/tasks/UIUX-REFINE-01.md` 的同步由 root 负责。

准确变更：

- `envBody` 参数改为 `EnvView['launcher']`，返回对象用 `satisfies EnvView`；加入固定非空 `recordingNamespace: 'e2e-port-fallback'`，完整保留 tdx、日期、能力、训练字段。
- 去掉原本从未调用的 `launcher === null` 缺字段分支；真实契约要求 launcher 对象，无回退用例保留对象内部 `fallbackFrom: null / fallbackReason: null`。三个场景端口8789/8790/8787不变。
- 三例 `page.goto` 后均调用 `expectLauncherReady`：先断言真实“创建训练”heading可见，再断言 `.data-status-ok` 的日期文本，最后确认 `.env-error` 不存在。上文最初建议 `.connection-text` 只是诊断期例子；静态重读确认正常首页 `freshness=current` 会换成 `.data-status-ok`，因此未使用错误选择器。
- 三个原测试名和全部10条原断言逐字保留，无 skip/only/fixme；没有改变产品端口文案或 namespace guard。

完整绑定 ID（文件名与用例全文，不拼 describe）：

1. `e2e/port-fallback.spec.ts::a) 发生回退：常驻提示实际端口、原因与固定端口方法`
2. `e2e/port-fallback.spec.ts::b) 发生回退（被占用原因）：文案区分"被其他程序占用"`
3. `e2e/port-fallback.spec.ts::c) 未发生回退：不出现端口提示条`

静态检查收据：

- `npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --esModuleInterop --skipLibCheck e2e/port-fallback.spec.ts`，原生退出码0。没有用不覆盖 e2e 的 web typecheck 冒充该 spec 的检查。
- `git diff --check`，原生退出码0。
- Python 比较 HEAD 原断言与当前文本：第一次误把原断言条数写为9，输出 `AssertionError: 10`、原生退出码1；逐条确认实际为10后更正核对脚本，得到10条全保留、3个ready调用、3个原测试名不变、无skip/only/fixme，原生退出码0。没有修改产品预期以适配这个脚本错误。
- 修改后 spec 字节 SHA256=`067a7c47c5db31742870c6529f61a996e1c2f0b9d39ce775c6afab6a0dac7d30`。当前定向状态为 spec已修改、诊断报告未跟踪；属于共享工作区，未提交。

P4为 `paper_only`：若撤掉 namespace，类型检查先拦必填字段；若以断言绕过类型仍注入旧缺字段payload，初始化停在loading，三个heading前提失败，104不能再仅因提示缺席过关。若回退提示被隐藏或原因文本写错，a/b原有可见性与内容断言仍分别识别。未执行任何变异、浏览器或构建，尚无本候选GREEN运行证据；root后续统一复跑并维护矩阵/L2/第五步台账。M3八项诊断及71保存400继续原样保留，不受本夹具修复影响。

## 第二轮只读诊断：剩余8个unexpected与1个skipped

root追加范围仅本节。任务开始重新注入候选Harness v1.12入口、oracle/supervised-delivery，以及UIUX v0.4.1入口/patterns；候选未安装。仍只写本文件，不改产品、测试、runner，不运行浏览器或构建。`output/full-journey-failures.json`实际列出30个unexpected加1个skipped；本节覆盖其中8个unexpected，不能把Act6算作第9个失败。root汇总原全量151 pass/30 fail/1 skipped；该总计不是本子任务的新运行证据。

### 分类与最小正确修复

| 文件与完整测试名 | 原失败与分类 | 最小正确修复方向 |
|---|---|---|
| `e2e/drawing-basis.spec.ts::跨除权日后价位线跟随同一历史K线，缩放和刷新不漂移` | :39，Control+z后期望0实际1；基线已有真实产品缺陷，非旧undo oracle | 同周期推进行情应保留撤销栈并投影价格基准；首次装载/切换周期才重建对应历史。保留撤销、重做、价格和刷新断言。后面:48旧跨周期显示同一线另须按周期隔离合同迁移，不得与当前undo缺陷混为一谈。 |
| `e2e/journey.spec.ts::Act4d 副图画线与多选框选（主副图同权）` | :405，overlayInfo(0).paneId为candle_pane；测试读取错误对象，不是本次固定坐标失效 | 用drawings()/geometry()按刚画segment的ID取证，先确认正好一条用户线，再保留副图框选和主副图不缩放断言。不得修改产品落点来适配未过滤overlay索引。 |
| `e2e/m3-feedback.spec.ts::自动保存待保存进行中失败重试成功不改变工具区或账户区位置` | :107进入helper，training-flow.ts:34等“继续查看图表”超时60s；已批准文案与基线helper漂移 | 按10-01 item7使用“留在当前界面”；保留结算后继续画线和服务端2条线断言。原trace已执行待保存/保存中/500失败/重试200及尺寸不变，不能说整例未覆盖失败保存。 |
| `e2e/recording.spec.ts::默认录制交易拒单、周期和画线，暂停恢复后可导出并离线只读回放` | :137末日drawings=0；既有合同组合与旧测试预期冲突，存在体验缺口，不能直接说文件丢线或改0结案 | 若保留当前显示快照语义，拆分原空周K终态/此前日K线仍在文件证据，并另造末态有线的真实录制验证离线只读；若要求同日各周期画线均可回看，先明确合同，再改采集集合、周期过滤和回放选择。 |
| `e2e/report-feedback.spec.ts::report themes, independent overlays and date-aligned hover` | :87浅色期望255/255/255，实际243/246/244；基线视觉oracle漂移 | 报告容器基线即使用surface-background=#f3f6f4。按审核后主题token核对，保留切主题、独立指标、悬停日期和窄屏检查；token等价断言不替代视觉/对比度检查。 |
| `e2e/training-defaults.spec.ts::设置保存失败反馈/取消不保存/键盘路径；迟到读取不覆盖已编辑字段；1440深/840浅` | :133等“取消”超时120s；已批准关闭出口与测试漂移 | 走顶部精确“关闭”，保留默认未写、还焦点、键盘和迟到响应守卫；不得加回已要求移除的取消按钮。失败前400为有意注入且错误已显示。 |
| `e2e/training-defaults.spec.ts::返修F5 设置保存使在途预览失效：加载所有权释放可重新预览；旧响应不覆盖新请求` | :304，input[type=date]匹配2元素；基线准备与producer契约漂移 | 精确定位起止输入并填冻结样本合法区间；毒化旧响应按真实preset/startDate/endDate契约构造，保留旧响应丢弃、新响应出现、loading释放断言。不能仅.first()后保留随日期漂移的结束日及旧bars/count mock。 |
| `e2e/training-rules.spec.ts::返修F3 设置弹层键盘隔离：Tab/Shift+Tab不出弹层、Enter/Space不触发背景业务写、关闭还焦点、保存/失败/取消` | :253等“取消”超时120s；同一关闭出口漂移 | 走顶部精确“关闭”，保留浅色840、业务写0、成交数不变。此前焦点循环/Enter失败/Escape路径已执行；末尾关闭后断言未跑，不能报整例通过。 |

`e2e/journey.spec.ts::Act6 主题切换持久化`为skipped、无trace。文件:6声明serial，位于失败Act4d之后；应独立重跑或修好此前串行失败后执行，不能归因主题产品缺陷或算通过。

### 关键证据链

**撤销历史。** KlineChart.vue:460–468的feedData无条件drawingHistory.reset([])；:1583 bars watcher先feedData再:1593 rebase。:1089–1091 post watcher再restoreDrawings(...,true)，:389把历史重置为当前状态。drawingState.ts:44–60的reset令index=0/canUndo=false，rebase不能恢复清空的旧栈。原error-context的撤销/重做均disabled，与Control+z后数量1一致。完整KlineChart文件与`git show 6d557a12:web/src/components/KlineChart.vue`归一化相同。权威要求来自stage-feedback-20260919.md:7的保存/刷新/撤销重做一致，以及ACCEPT-01-review/report.md:23此前保留历史索引、跨权息undo/redo通过的记录；不能把reset当作新产品口径。本轮未跑6d557a12。

**Act4d对象错位。** 当前和base的journey.spec.ts:76–94已用screenPoint将旧坐标映射实时pane。trace call@2035/2037实际点击(341.426724,699)，call@2041/2043实际(756.943966,739)，间隔650ms；失败PNG中新增线及端点清楚位于MACD。call@2049却从overlayInfo(0)读到ID overlay_1792242457922_2、pane=candle_pane；该probe在KlineChart.vue:1012直接索引未过滤getOverlays()。refreshMarks:658–670即使无交易也创建主图phasePriceLine；drawings()/geometry()才过滤engineMarkNames。trace初始GET drawings为空、bars trades为空，不是旧用户线。可以确定断言没有识别新增segment；probe没返回name，不冒称trace直接读到第0项名称。KlineChart和spec均与base相同。

**录像资源仍在。** 原导出`RUN/artifacts/screenshots/recorded-session.json.gz`，SHA256=`550b4c3e7877d820b6c8959e05651de67fec6ceb1a88487c4e5b3536a4b4c96f`，12事件/12检查点。dw1为空，dw2基于dw1 upsert日K segment overlay_1792243515453_1。seq8 drawing.create与seq10暂停前检查点引用dw2；gap={afterSeq:10,resumedAtSeq:11}；切周K恢复后的seq12三份检查点均引用dw1。末日“新增画线”标签与drawings=0是当日末态覆盖此前同日可见快照的结果，并非整个文件丢失日线。

Training.vue:106–116将当前capture的bars/timeframe改同期1D，drawings仍取当前视图，:137按tf过滤；dailyReplay.ts:469–497从effectiveSafe取drawings，SessionReplay.vue:409–410使用该数组。权威stage-feedback-20260919.md:18,20分别要求“同期1D行情和当前显示画线”与“只解码当天最后安全检查点”；10-01反馈item6要求各周期独立。因此隔离前“切周K后末日仍有日线”的预期不能直接沿用，也不能声称已支持同日全部周期画线恢复。root应显式保留该体验边界，此诊断未替用户批准新行为。

历史独立证据：base包含RF-03/README.md:25–26,41，记录干净f28fd9d同一:137失败；baseline-recording-spec-journey.txt:11–26保留>0/实际0原日志。这是较早commit历史复跑，不是本轮6d557a12基线运行。当前Training script、useRecording、SessionReplay、dailyReplay、compactCodec与6d557a12相同。

**关闭、颜色、日期。** `git show 6d557a12:web/src/components/TrainingSettings.vue`:30已注明仅标题栏关闭，:858已有aria-label=关闭，footer仅保存；本轮diff没有删取消。10-01反馈item8明确只保留右上角关闭，是oracle迁移批准依据。TrainingSettings script完全相同，改动在模板容器/CSS。基线styles.css:6为surface-background=#f3f6f4，:415报告page使用该token；当前同值，与trace实际243/246/244一致。基线Launcher:165–166已有rangeStart/rangeEnd，:717–728已有两date；:245–248请求为preset/startDate/months:1/endDate。当前script唯一差异是随机提示文案提为数组复用，不改日期逻辑。F5 mock却仍构造bars/count且只填一date，准备修复须同时恢复真实producer形状和固定合法日期。

### 同trace非2xx、来源身份及边界

八份trace均有POST /api/lifecycle/session→403 `{"error":"HOST_MISMATCH"}`。这是独立生命周期/环境缺口，不能因最终断言漂移而隐藏。control-guard.ts:36–38严格校验Host；api.ts:799–802会话注册先走守卫。本轮未检查运行时expectedHost，未改runner，不无依据归因UI回归。后续应校正隔离server的expectedHost/URL并复核注册，不放松身份守卫。

其他非2xx逐项核对：m3-feedback PUT drawings500为“模拟保存错误”注入，之后相同绘图PUT200成功；defaults settings400为initialCash注入；F3 settings400为feesEnabled/tPlusOne布尔值注入；recording trade400“当前没有可卖持仓”为预期拒单。m3-feedback另有GET env status=-1、report另有GET equity-comparison status=-1，无HTTP响应体，不能记作200，也未观察到另一个可见产品错误。本节未发现额外drawing写400，上文71重复ID保存400继续独立保留。

八份trace的CSS body均可读，index-DUxQfQ46.css的SHA256均为`a28a1382cc5394ab6d2587fdc8507fe533a69aa9d7a62cd1f960a4f3840a5f6f`。JS均请求index-BsDAkYf6.js/200，但本批trace content缺_file且size=-1；JS hash来自RUN/web/assets实件，不得说逐trace读取JS body算出hash。共享工作树后续仍在变动，本trace不证明后来修改已验收。

| 用例简称 | trace.zip SHA256 |
|---|---|
| drawing-basis | c3628baf52aeb390f4e003ad08c9e5a1e29456920a1cca5c5ddfc81d8ab482fa |
| Act4d | 70c6b4676e9f4e1cacc10df9fca6ccf9f33f02db531931b99d5dbc45631b1247 |
| m3-feedback | ce8a33de95653a1d6ae341c09c10bebfa8034c9f3a0a4d8d93d0b9f435ef43f5 |
| recording | c9f2c5b1ecdd642d7bebec059fbff893d12dfd769e67a56f16ef9e1ead0d3c4c |
| report-feedback | 278adbd6f55b780e45135bd94724b673fcdc38cee1c3746f115d3e35020fbf96 |
| defaults取消 | 600915f925624fee2f694ecb9bfc961b714af0eaae9e1c98bf8363d1bca8b813 |
| defaults F5 | 7198e3cd9bb15314e34933718945adcc58575dbb5f6e5743efacb79b035dc712 |
| rules F3 | 0b230560d77b9084c075485c378f01bab7a1e076332b227edcac1fc34b180ff3 |

原目录均在RUN/artifacts/test-results，按full-journey-failures.json的attachment路径定位，每项含trace.zip/error-context.md/test-failed-1.png。逐文件git show比较：上述7个spec完整内容全同base（journey覆盖失败与skip两条）；useRecording同源SHA256=`16fb6b4015852c41c2049181e2712e79d3485cbc139e8f4b0aec1e09278b1a02`，SessionReplay=`c8250bd9e99f36bfc14af285617ed4f5d0b4d35197132d43abddb074ea955701`，dailyReplay=`8bb6c816cbe3d7fe91268053ebc41add585a8ea5b228247e634113758f88119b`，compactCodec=`159d76f12dcc5f807fde8d57d196ecae3e300a8da705125a8549c5aa14b3b1cf`。Training script完整相同，SHA256=`c5c8b2946d6351f7660e4a93f05e580195162109748e4c0429e09be6821e2dd4`。统一CRLF为LF；静态相同不等于动态基线运行通过。

Harness建议：先验证probe对象身份，不从看似固定坐标猜故障；首错后仍检查未执行路径的合同（undo后还有跨周期旧预期，双date后还有旧mock）；把合同组合产生的体验缺口显式记录，不用改数量掩盖；serial跳过、历史基线和本轮证据分别记账；资源URL相同与trace取得body是不同证据等级。

本轮仅静态读源、zip/gzip解析、git show和已存在截图查看。宽输出截断后已定向补读；不存在Replay.vue/RecordingReplay.vue/TrainingReport.vue/uiux-refactor-lab和Windows字面glob检索错误留在原工具收据，之后用rg --files确认真实路径。首次尝试PowerShell管道写中文报告遇到Python `SyntaxError: Non-UTF-8 code starting with '\\xe7'`，未写文件；后续git diff --check返回0只证明diff检查，不能覆盖前序Python失败。改用apply_patch写本节，保留失败事实。未修改矩阵、台账、状态或commit，root负责第五步和实际复跑。

写入后独立收据：git diff --check原生退出码0；Python核对无行尾空格、8项trace首末指纹唯一及全文38个SHA256，原生退出码0。报告228行（本收据追加前），只属于文档静态核对，不是产品GREEN。

最终freeze：root决定本UIUX轮不扩大图表语义。已证实的样式恢复/撤销历史/重复ID保存列为基线产品债，其中重复ID触发时序未做本轮baseline重放，保留该因果边界；71保存400不得被旧oracle迁移掩盖。录像多周期末态语义明确列“产品口径待定”，保留原完整失败与候选限制，不以改0宣布修复。此后本worker不再扩展诊断或修改本文件，等待root另派独立L2只读复核。
