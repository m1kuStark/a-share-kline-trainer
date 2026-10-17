# UIUX-REFINE-01 RECORDS 补验与名称修复

owner：`/root/skill_scenarios`；2026-10-17；当前阶段：root 已确认名称 RED，授权最小修复；GREEN 与浏览器 lane 仍由 root 独占。前文准备收据保留原时点，最新交接见末节。

## 范围与锚点

本子任务只允许产品 `web/src/views/History.vue`、`web/src/views/Rankings.vue`；测试 `e2e/uiux-records.spec.ts`；报告本文件及 `L2-review.md`。root 唯一维护任务卡、矩阵、台账、状态、构建/预览与提交；worker 不运行 `gate-report`。每次 journey 需 root 放行，retries=0；名称先正确 RED，root 确认后才改产品。

当前正式 manifest 原生退出 0：任务 `UIUX-REFINE-01`，base `6d557a12`，实测 HEAD `6d557a12f400ce45b50418b8556f943d39fef754`；allowed_paths 第16项为 `server/test/uiux-*.test.ts`；docs_impact 为 `docs/work-items/tasks/UIUX-REFINE-01.md`，由 root 代办。子任务写面取上述较窄范围。

重新全文注入 candidate Harness v1.12 四文件：`SKILL.md`、`references/oracle.md`、`references/supervised-delivery.md`、`references/development-principles.md`；聚合输出中的 supervised 截断后已单独补读。未覆盖依赖使用工作区 `.zcode/skills/ai-harness`，已读其 `references/bug-loop.md`。UIUX core v0.4.1 已重读主文、patterns、platforms-accessibility；局部 AGENTS 已读。未安装 skill。

冻结 TDX：`D:/Superlinear_Academy/Stock_WorkSpace/a-share-kline-trainer/.runs/run-45d87c82-6bad-4b8e-800e-f36bd8940f64/tdx-snapshot`，只读。既有 junction/server dist 由 root 准备；本 worker 尚未运行产品命令。

## 独立预期与入口

预期来自[任务卡](../../../work-items/tasks/UIUX-REFINE-01.md)「契约与独立预期」、root 派发契约和 workspace `matrix/uiux-workbench.yaml` 已预登记的 ACCESS/LIBRARY 行。几何预算采用已有 1024×680 浏览器检查点及实测 Electron outer1024×680/content1008×641，断言直接记录 `innerWidth/innerHeight`；不声称是本轮原生窗口验证。名称采用 visible-label-in-name，未据当前 aria-label 生成预期。

| 行/场景 | 精确预期 | 入口与边界 |
|---|---|---|
| UIUX-RECORDS-ACCESS | 历史、固定周期排行的名字包含可见 `600519` 和 `贵州茅台长名称与训练记录比较样本`；单只股票排行包含可见 `1M 成绩单`；真实键盘打开成绩单。 | 列表/排行为冻结呈现响应，成绩单响应复用真实 API 创建→结算→report 的生产者形状。3处独立 `toHaveAccessibleName` 先 RED；不以精确错误 aria-label 定位。 |
| UIUX-RECORDING-READY | env 请求实际失败，错误可见且导入禁用；真实点击重连导致成功 env 请求，准备反馈消失，再经现有导航开库可导入，刷新后记录仍在。 | 503 故障注入与真实 env 成功对象；失败与恢复请求分别计数。真实文件 input→解析→IndexedDB，不用坏 JSON 代替 env 失败。现有 refresh 返回创建页的导航不改。 |
| UIUX-HISTORY-COMPACT | 6条长名记录真实纵向溢出；wheel 到首/末行均完整可见，子项无重叠，最终权益/收益率标签显示，启用动作中心命中自身，无页面横溢出。 | 1024×680、1008×641各 dark/light。首末两条录像经真实单文件导入建立关联；四组合真实 checkbox/replay，末组合实际导出并检查 gzip trainingKey、删除进入既有 DELETE 请求。历史响应/删除响应为呈现 stub，不证明服务端删除持久化。 |
| UIUX-LIBRARY-COMPACT / 排行 | 表格实际水平溢出；真实横向 wheel 从0移动到末端，最后一列「结算日」及值可见且中心不被遮挡，页面自身无横向溢出。 | 两紧凑内容尺寸各 dark/light，固定周期 complete 单行代表场景；不称所有排行模式/数据规模已覆盖。 |
| UIUX-LIBRARY-COMPACT / 录像 | 长文件名非空行的打开/删除目标不重叠且可命中；点击全部导出取得包含唯一 trainingKey 的真实合并包；点击删除和确认后条目消失，刷新仍为空。 | 两紧凑尺寸各 dark/light，每组合导入1份、导出、删除、刷新。真实浏览器存储；原生 OS 文件选择器未操作，使用 Playwright file input。 |

## 绑定全文

ACCESS：

```text
e2e/uiux-records.spec.ts::history has an explicit keyboard report action and child keys never open a report
e2e/uiux-records.spec.ts::rankings expose keyboard report entries while empty records explain the next action
e2e/uiux-records.spec.ts::stock rankings keep the visible period in the accessible report name and open by keyboard
```

READY：旧延迟成功/部分导入场景保留，并加失败恢复。

```text
e2e/uiux-records.spec.ts::recording library waits for real namespace readiness before enabling imports
e2e/uiux-records.spec.ts::recording library recovers from environment failure through reconnect before a real import
```

HISTORY：原尺寸/首行检查保留，新增首末行与真实关联动作。

```text
e2e/uiux-records.spec.ts::history keeps every fact and action within the desktop viewport at compact and wide sizes
e2e/uiux-records.spec.ts::compact history exposes first and last row facts and linked actions in both themes at supported content sizes
```

LIBRARY：

```text
e2e/uiux-records.spec.ts::compact rankings scroll locally to the final column in both themes at supported content sizes
e2e/uiux-records.spec.ts::nonempty recording library exports and deletes real imported files at compact content sizes in both themes
```

## 准备收据

| 命令/检查 | 原生退出与证据 |
|---|---|
| `node D:/Superlinear_Academy/Stock_WorkSpace/.zcode/skills/ai-harness/scripts/task-manifest.mjs --repo D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/uiux-refine-20261017 --task UIUX-REFINE-01` | 0；锚点见前文。 |
| 同目录 `check-binding.mjs --repo D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/uiux-refine-20261017 --matrix D:/Superlinear_Academy/Stock_WorkSpace/.zcode/skills/ai-harness/matrix/uiux-workbench.yaml --strict --include-untracked` | 3；7行、covered0/open7/RED0；索引1766用例+386describe。发生于追加测试之前，不称新9条引用已解析。 |
| Node 调用 `typescript.transpileModule` 读取 `e2e/uiux-records.spec.ts` | 0；syntax diagnostics0，静态枚举9个完整test名，无重名。仅语法检查，不是类型检查、Playwright发现或产品执行。 |
| `git diff --check -- web/src/views/History.vue web/src/views/Rankings.vue` | 0；没有 whitespace error。产品指纹与上一轮相同，本 worker 未编辑。 |
| `npm.cmd run docs:check` | 1；17 errors、105 warnings。错误逐项与 [L2 原收据](L2-review.md) 中17项相同，均位于本 worker 写面外；本轮未做基线归因。两个报告各有长度建议，不是错误。 |
| Python 本轮两文件 UTF-8/BOM/行尾空格及报告相对链接检查 | 0；通过。 |

首次准备搜索误用了不存在的 `e2e/history-recording-link.spec.ts`，rg 原生1、os error2；另一次 Windows 路径参数 `e2e/rankings*.spec.ts` 原生1、os error123。已用文件清单与 `-g` 更正，未作为产品失败。

测试草案 SHA256：`5519388d2d0ea2fe7f7c9c1c1431a5449044562eec409065832c6560d40d1913`。冻结产品 History：`e4352c886f5a27ea315b26a660b3e1993d0a8f10cd1c1b013aeb83b3983de210`；Rankings：`dcaa26dd3ae8ac809c45867bb7b3adfbb5a53cce556ee4e5b11e6fcf76746e57`。

## 待运行与 paper_only 抽检

先仅运行3条 ACCESS 名称回归，正确 RED 应是 accessible name 缺少可见主标签；准备/定位/服务错误不能算产品 RED。root 确认后最小修改六处 aria-label，保留动作和其他属性，再由 root 安排同候选 GREEN 与其余补验。任何新增几何/恢复失败先归因，不擅自扩写面。

`paper_only`：把名称改回只含局号，应在三条名称断言失败；重连不调用 env 或成功后仍禁用导入，应分别在请求活性/可用性断言失败；删水平overflow或恢复数据遮挡，应在实际溢出/末列命中失败；删除仅移除DOM未落库，应在刷新后空库断言失败。这些尚未执行变异，不能写 killed/MSI。

机器运行尚待 lane；视觉质量/读屏/原生文件选择器/安装包仍由 root 或用户另验。没有新增语义拍板项。

## bounded GREEN 交接与预期修正

root 运行 `run-e922cd57-16e8-402c-854e-0ae84be38f46`，原生退出1（root 回执）。worker 已独立读取该 run 的 `artifacts/browser-results.json` 和 `manifest.json`，读取命令原生0；源 HEAD 为 `6d557a12f400ce45b50418b8556f943d39fef754`，独立DB/构建目录位于该 run，入口为当次 `http://127.0.0.1:8526`（只核对收据，未连接）。整run为12 passed/6 failed，不能当records单套统计。

records 9条中5 passed/4 failed：名称三条均在 `toHaveAccessibleName` 失败（原`:186,215,296`），实际均为 `查看第 9201 局成绩单`；预期分别为含可见 code/name 或 `1M 成绩单`。这是 root 确认的正确产品 RED；之后才授权修改 History/Rankings 六处 label。旧历史呈现、READY 延迟成功、READY失败重连、历史首末行与真实录像导出删除在该run通过；不把这些旧候选收据外推到修复后候选。

排行横滚原`:414`失败为 `scrollWidth - clientWidth = 0`，不是内容不可达缺陷。root 已查看失败截图确认默认表完整可达。原草案错误地把“窄表必须溢出”作为无条件预期；独立任务契约实际是“内容全可达，溢出时允许局部滚动”，并未要求默认布局强造滚动。此次修正先记录依据，不修改产品布局：保留默认字号/两尺寸双主题的表头、每个数据格、报告按钮可达和页面无横溢出检查；再按既有125%文字压力范围放大字体token，并证明表头/数据字体实际为基线1.25倍。在该压力场景仍强制真实 `scrollWidth > clientWidth`、真实 wheel 后 `scrollLeft > 0`、末列完整可见且命中自身，不删滚动断言、不加skip、不用赋值scrollLeft冒充操作。

125%仍可能不足以触发溢出；本 worker 没有浏览器授权，不能预称该夹具已进入分支。测试先证明既有1行10格、长名/日期/数字实际到达DOM，随后将默认/放大后的字体、scroll/client宽度、viewport/outer/DPR写入测试附件，再进行强前置断言。若仍为0，保留失败交root，先选经授权的真实长日期/数字案例，不随手放宽。

本轮重新全文读取的实际文件与指纹（根路径各与前节所列一致）：candidate `SKILL.md`=`adc7a33a663a06971cf49c61e639b67e7e29cb6a115bf24ec23eb5f630e9201b`、candidate `references/oracle.md`=`98b2046e5b236cfa171145227570f81efcf757c2c2d67d9d04c5fd5b94ef9354`、candidate `references/supervised-delivery.md`=`0d3c7d1d6da517561d13fbc80857af88337f26efa0863bf01f41d74bd8ae5b0d`；UIUX `SKILL.md`=`d6210510e736b55628a9d9aa33526f129d0dff8053c768e83805a5852e3f08ae`、UIUX `references/patterns.md`=`0922a14e31167110824bfa483577db9ea055990f20d15d209a27d50c8fb04c07`。当前 manifest与HEAD命令均0；strict3，7 open/0 RED，测试索引1774+386。root仍唯一维护共享记录、构建和浏览器运行；本轮 worker 只交静态文件差异。

修复已落盘并冻结：History 的一个及 Rankings 的四个股票名称按钮，label 为 `${item.code} ${item.name}，查看第 ${item.id} 局成绩单`；单只股票排行按钮为 `${item.tier} 成绩单，查看第 ${item.id} 局`。保留原生button、键盘行为、`@click.stop`和整行点击；无样式或逻辑修改。Python将新label仅在内存逆替换后，完整文件SHA与上一轮指纹相同，原生0，证明产品差异仅这六处。

| 最终待运行文件 | SHA256 |
|---|---|
| `web/src/views/History.vue` | `3930c5c1ebfbcc8dc0f28012fd34045c4c05c48c4e768b3f52f1e2afea7b8012` |
| `web/src/views/Rankings.vue` | `4745f1fe8efee51a39d9d1927367799b0ecb1bf85f103c3cc1197125df29a17d` |
| `e2e/uiux-records.spec.ts` | `705a158b5ce593dad8745291b6a9c465a8fb9230be679d4bcb5e18ae751f81bb` |

静态检查：TS `transpileModule` 加两Vue `compiler-sfc.parse` 原生0，无语法错误；`git diff --check -- web/src/views/History.vue web/src/views/Rankings.vue` 原生0；spec UTF-8无BOM/行尾空白检查0。9条完整测试名不变，可复用前节绑定。排行新增DOM夹具确认`:418-425`，实际字体及metrics附件`:426-465`，125%溢出活性`:465`，真实wheel与末列检查后续保留。没有执行构建或浏览器，不能把静态0称为GREEN。

准备工具错误留存：首次 Python3.9 调用 `Path.write_text(..., newline='')` 返回 `TypeError: write_text() got an unexpected keyword argument 'newline'`，原生1，发生在任何文件写入前。改为原字节解码/替换/编码以保留行尾，后续退出0；上述逆替换hash再次确认没有附带格式变化。

本次收尾 `npm.cmd run docs:check` 原生1，17 errors/106 warnings；17项错误与前节和L2报告清单一致，均非本轮写面；本报告只有长度建议。报告局部 UTF-8/无BOM/空白/围栏/链接检查原生0。代码与测试已冻结，等待root同候选统一GREEN；未向共享台账或状态写入。

## 第二次浏览器收据后的测试补强依据

root 释放测试写面后，worker 仅编辑本报告和 `e2e/uiux-records.spec.ts`；产品六处 label 保持冻结。root 报告 `run-e0919130-fbd5-4d1e-94b3-c98012d9afe1` 为43 passed/2 failed，本 worker 不代报尚未独立捕获的 runner 原生退出。排行失败附件显示1024×680、dark下默认字体12/11、125%后15/13.75，scrollWidth/clientWidth均为877；因此字号注入已生效，失败是压力样本没有实际溢出，不能归因产品。旧 data-update f 另为既有入口预期漂移，由root记录，本worker不改该文件。

ACCESS 当前三入口仅断言成绩单外壳可见，可能放过错误局号或加载失败。补强前先冻结独立预期：History 首行、固定周期榜首、单股周期入口均指向列表记录9201；每次键盘或历史金额单元点击必须收到 `GET /api/trainings/9201/report` 的200响应，并看见600519及指定长名称、成功正文中的最终权益/交易笔数。fixture复用真实后端创建、结算、读取所得完整report，只将training.id/code/name映射至展示记录；经济值、规则和交易明细保持producer返回。正文经济值检查是consumer一致性，不声称独立验证收益算法。不给路由调用计数充当成功证明。

数值压力独立依据先于测试修改：`docs/specs/training/rules.md:52` 允许默认初始资金0.01..1e9；`docs/specs/training/rankings.md:18-27` 规定结算权益收益率、摊薄成本盈亏比、交易笔数，未规定收益或盈亏比上限；`server/src/train/history-report.ts:78-88,146` 对应有限结算值公式与交易COUNT。仅本横滚测试使用正常2Y日期2024-05-15..2026-05-15、初始资金1e9、最终权益13,345,678,900、收益率12.3456789（显示+1234.57%）、盈亏比1234.56和1234笔的支持域展示样本；不是市场收益预测，也未声称此行经端到端交易产生。资金本身不在排行列，不将提高资金等同扩大列宽；实际可见宽度来源为收益/盈亏比/交易笔数。其他测试的经济数据不变。

root要求固定文字压力范围：默认与125%分别检查全部内容可达，若溢出则真实wheel至末列，若不溢出则全部格完整可见，并记录实际metrics；固定200%附加场景无条件要求真实横向溢出、wheel位移与末列命中，禁止条件skip或按当前溢出自适应选择压力。200%来源为已读UIUX `references/platforms-accessibility.md:15,26` 的文字放大与内容功能保留原则，仅是本控件字体token压力，不外推浏览器缩放、完整WCAG或读屏合规。不修改表宽、overflow、white-space或产品CSS。

补强完成后的静态收据：测试SHA256为 `aae3da0f4c135a3457e4cf63b45a4f19b18fadfce989a47c42c6d1db48e6ae1e`。目标report helper位于`:144`，四次真实激活调用`:215,217,236,316`；排行数值fixture`:420`，固定三个倍率`:457`，200%溢出硬前置`:472`。9个完整测试名称不变。Node TypeScript compiler API `transpileModule` 语法0、`createProgram` strict/noEmit（含依赖）diagnostics0，命令原生0；UTF-8/BOM/行尾空白检查0；产品diff空白检查0。History/Rankings指纹仍为前节所列 `3930c5c1…` / `4745f1fe…`，没有追加产品修改。已通知root与独立审查者测试冻结，GREEN仍待root，worker没有启动浏览器、构建或runner。

本次 `docs:check` 原生1，17 errors/107 warnings；17项完整错误仍为L2原收据所列工作项状态/引用和e2e缺失链接，均不在本worker写面。本报告仅长度建议；新增L2-final文档也有长度建议。日志按Headroom LogCompressor规则保留全部错误、相关报告和末行，原件保存在 `C:/Users/Stark_Du666/.codex/headroom-cache/019d3978edb2374ced65a26456a4ae764a3392f8379e23effa4795954c44d49a.txt`。缓存首试因shell中`CODEX_HOME`环境变量为空而触发 `Cannot bind argument to parameter 'Path' because it is null.`，附带Get-Content空LiteralPath错误，工具退出1；该次不作为有效docs收据。改用已知绝对Codex目录后才得到上述有效结果。源码查找曾误写不存在的`web/src/styles`目录，rg报`IO error ... os error 2`、工具1；随后读取实际`web/src/styles.css`与组件样式完成核查，不作为产品失败。
