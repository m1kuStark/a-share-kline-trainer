# MIN 正式阶段收据

状态：root 已独立确认 RED 并授权最小 CSS；已实现并通过静态检查。spec 与产品现已冻结，等待 root 统一 GREEN。首个有效运行 native1；第二次重跑被 root 收回 lane 后立即中止，不作验证证据。

## 本轮重新注入与锚定

- 已全文读取 candidate Harness SKILL、development-principles、oracle、supervised-delivery；正式 workspace bug-loop；UIUX core SKILL、failure-patterns、patterns。候选明确为四文件 overlay，脚本与未覆盖引用从 workspace 正式路径读取，不再将它描述为缺包。
- 2026-10-17T13:32:27Z manifest 原生 exit 0。A1 第16项 `server/test/uiux-*.test.ts`；A2 base `6d557a12` 与当前 HEAD `6d557a12f400ce45b50418b8556f943d39fef754` 一致；A3 `docs/work-items/tasks/UIUX-REFINE-01.md` 由 root 单写。
- 仅可写 `web/src/views/Training.vue`、`e2e/uiux-training.spec.ts`、min-window-plan/receipts。矩阵、任务卡、共享台账、提交均由 root 负责。
- 已收到 root 明确要求：全量尚在163/182且 training 位于末尾，继续只写文档。待释放 spec 后准备实际测试；待释放 runner 后运行 RED；正确 RED 经 root 复核后才改产品。

## 测试实现草案

保留旧测试全名及所有断言，不降低图表高度/宽度门槛。增加独立 text-pressure 测试，断言只读 DOM/现有 journey probe，交互全部使用真实事件。

### 共用 helper 契约

1. `openTraining`：弃置该隔离服务 active training，POST 生产接口创建300857/2026-04-15/1M/100万/close_only/orders_enabled训练。GET页面，等待drawing已保存、grid不再inert、4个图表pane。返回真实training id。
2. `settle`：等待可观察ready，有限入场动画结束后采样；不依赖截图时刻碰巧稳定。
3. `box`/`assertBoxStable`：读取bounding rect，以0.5 CSS px比较x/y/width/height。这是任务测试容差，不是行业标准。
4. `assertReachable(target, clip?)`：读取target矩形；遍历overflow裁切祖先计算真实可视交集，并与viewport相交；目标完整在交集内，中心`elementFromPoint`属于目标或其后代。这里不用locator.click或scrollIntoView。
5. `mouseClick`：先assertReachable，然后在测量中心`page.mouse.click`，不重新定位。
6. `wheelToEnd(container)`：先记录scrollHeight、clientHeight及scrollTop，确认真实溢出；鼠标移到容器有效中心，真实wheel；轮询scrollTop确实增加，记录before/after。没有溢出就不得写成局部滚动验证。
7. `buy100`：预先证明股数输入和买入真实可见；鼠标点输入后键盘输入100，真实鼠标点买入，等待trade POST 200，再GET snapshot确认shares增加100，等待界面ready。所有操作在隔离训练内。
8. `recordGeometry`：附加viewport、outerWidth/outerHeight、DPR、visualViewport.scale、7字号token、console/tool scroll尺寸、chart rect、推进rect、candle/VOL/MACD/KDJ pane dimensions。浏览器outer不能冒充Electron outer。

### 原测试增强

尺寸顺序1008×641、1024×680、1440×900；每个尺寸light/dark。最先检查买卖完整位于console且center hit，保证RED首先表达既有真实遮挡，随后才做其他增强。

每组尺寸/主题：

- 保留`chart.width > workspace.width / 2`和`chart.height > viewport.height - 220`。
- 四窗格名称完整、正面积、都在chart host内；此断言只证明未被切没，视觉可用性另凭截图审查。
- 首常用、自定义常用、多选、吸附完整可见且center hit；首工具真实点击后active，再Escape退出。
- 保存推进中心，在同一坐标连续点击3次；每次日期改变、ready、按钮与chart矩形稳定；不以每次locator重新找点掩盖漂移。
- 股数100真实下单，确认shares增长；画线底部动作仍可达。
- 截图与几何附件；不将功能断言说成人类审美验收。

### 新text-pressure测试

全名：`training keeps enlarged text and every drawing entry reachable by local wheel at actual minimum content size`。

1. 创建新的真实训练，1008×641；读取七字号`2xs/xs/sm/md/lg/xl/2xl`原值后一次乘1.25，不在切主题时重复相乘。这是文字token压力，不是Windows DPI或浏览器zoom。
2. 每主题在正常画线展开状态记录chart/advance/draw heading/actions/footer/scrollY；console先确认真实溢出，再真实wheel到底，确认scrollTop增长。
3. 买卖完整可见、center hit、输入100并实际买入；chart/advance/draw固定部位与scrollY保持，截图。
4. 工具列表确认真实溢出；通过真实wheel到末尾，最后常用和其他入口完整可见、center hit。依次检查各常用工具行可达（需滚动时仅真实wheel），点末常用→active→Escape。
5. 点击其他工具，先等展开稳定。记录新的固定几何基线；wheel到底，最后其他工具完整可见、center hit，真实点击→active→Escape。chart/advance不因局部滚动变化；其他展开本身的侧栏分配是有意布局，不与展开前console高度硬比。
6. 点自定义常用，等待稳定；favorites与other嵌套滚动容器分别先证实溢出，再真实wheel到底，最后工具和前移/移出/加入入口可见且center hit；不改变收藏顺序。完成自定义center hit且真实点击退出；关闭其他工具，恢复默认视图。
7. 每个稳定关键状态截图，保存滚动前后尺寸与hit证据。若125%顶栏发生横向遮挡，仅报告root拥有区域，不越界改global CSS。

## 待运行与决策

- 正式RED：首轮见下文；root已完成独立重跑，见末节。
- 产品修复：已按审定计划实现，尚待GREEN。
- GREEN及既有compact-chart/order-panel/chart-toggles：未运行。
- 矩阵L2与step5：root负责，尚未宣称covered。
- 门禁漏检：原尺寸把外框当内容属入口/环境边界盲区；工具列表只toBeVisible、未真实滚动属断言不锁。

## 正式 RED 原始证据

root 全量182条结束后，明确释放 spec 写入与独占 journey lane 给 MIN，要求先只运行本 spec、retries0。产品 `Training.vue` 未改动，SHA256 `47925d3ba71fb3028150cafe116a172c47486b571b64cd2cb60b5fbd740e95ee`。

命令：`npm.cmd run journey -- e2e/uiux-training.spec.ts --retries=0`，紧接 `$journeyExit=$LASTEXITCODE`。隔离只读TDX snapshot，运行 `run-ccced413-1563-45a9-bf7b-8e407459383c`，端口1537；完整日志 `.runs/run-ccced413-1563-45a9-bf7b-8e407459383c/artifacts/journey.log`。终端明确 `JOURNEY_EXIT=1`，2 failed。

1. **有效产品 RED**：旧全名测试在新增实际1008×641浅色状态失败，买入bottom456，console允许底425（含1px容差），错误 `buy action remains visible with default drawing tools`。与root独立观测的真实遮挡一致。几何附件记录content1008×641、DPR1、scale1、四pane与scroll尺寸；失败截图及trace保留。
2. **测试准备错误**：125%用例浅色交易/工具/自定义路径通过，深色到自定义favorite时其scrollTop保留上一主题的底部149，真实wheel后仍149，断言 `custom-favorite-dark real wheel changes scrollTop` 失败。这不是产品RED。已修正`wheelToEnd`：先真实wheel(-2400)，断言scrollTop=0，再确认overflow并wheel到底，原delta与end断言完整保留。修正后尚无有效完整运行，不能写GREEN。

本轮strict binding native3：7行planned/open、0covered、0RED，未闭合。`git diff --check`原生0。

有效RED的JSON附件实测：正常console内容365/可视321；125%内容422/可视321，真实wheel使scrollTop0→101。工具列表130/87，0→43；展开其他后318/208，43→110；自定义favorite235/86，0→149；自定义other471/86，0→385。chart宿主628×501，candle高172、VOL/MACD/KDJ各100，四窗格落在宿主内。截图只读复核确认正常buy/sell仅露上边线；125%浅色custom末项与动作显示完整。字体放大后标题显示“协…”，属于现有顶栏截断策略，已报告root而未越界改动。

## 行为遵循与 lane 交接歧义

- 测试准备初次apply_patch试图同patch对同文件delete+add，被工具拒绝且未改文件；改为update完成。一次只读发现错误路径`scripts/journey.ts`不存在，随后从package与实际`scripts/runtime.ts`确认隔离构建入口，未创建替代脚本。
- RED后worker启动第二次相同2条重跑，意图清除上述前置状态错误。root随后明确接管lane并要求冻结浏览器，worker立即Ctrl+C。运行 `run-1c0199d1-61fb-46ba-b202-2d55ee6d4da4`，服务7111；terminal exit1，未抵达脚本`JOURNEY_EXIT`收据，因此不当作有效RED/GREEN或完整执行。
- 当时最近可见root授权为“立即释放spec写入与独占journey lane给MIN”。root后续核对确认摘要与原始派发不一致，不能据摘要认定worker未授权；事实归类为**运行lane跨交接歧义**，root在监督报告承担交接核对责任。不得为了迎合监督者而改写原授权时间线。可复用改进：RED交接消息中同时声明是否交还runner；root若接管，应明确回执。已接管后的worker必须冻结，当前已照做。
- 交接时测试文件冻结、产品CSS未写；后续root授权后的产品修复见末节。未改web/dist、未知preview、矩阵、任务卡、共享台账或提交。
- 冻结spec SHA256 `298e0ef808a1a2513acd0cda468707e07ad59b3c53fa9f4112f922b0c93663b9`。run UUID查存活进程仅命中查询命令自身，无遗留运行进程。

## root 独立 RED 与最小修复交接

root回传 `run-e922cd57-16e8-402c-854e-0ae84be38f46` native1（批次12pass/6fail）：MIN正常字号正确失败于buy bottom456 > bound425；修正后的125%双主题真实wheel完整通过。该结论来自root独立运行回执，worker没有重复启动浏览器。

root据此授权按min-window-plan最小CSS：仅`Training.vue`新增`@media (max-height: 680px)`，侧栏上下padding8、权益上下padding4、统计row-gap4/上下padding4、分隔下margin4、仓位上下margin4、股数下margin3、画线区上margin4。不改变字号、按钮命中尺寸、图表、工具集合、API或交易语义。

静态检查紧接捕获原生码：`git diff --check` **0**；`npm.cmd run typecheck:web` **0**。没有运行browser/build/journey。预测预算依旧为增加可视console8px、减少交易内容29px；只有root GREEN实测后才能声称遮挡已消失。

最终冻结哈希：

- `web/src/views/Training.vue` SHA256 `b20464d5fbf4f5b859331b5153f63c2de9372e79afc6331823b23892ebdbd243`
- `e2e/uiux-training.spec.ts` SHA256 `298e0ef808a1a2513acd0cda468707e07ad59b3c53fa9f4112f922b0c93663b9`

等待root统一GREEN、矩阵L2与台账收尾；worker未宣称整任务完成。
