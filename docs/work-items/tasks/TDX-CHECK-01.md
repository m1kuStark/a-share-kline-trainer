# TDX-CHECK-01 候选通达信目录诊断

```json
{
  "id": "TDX-CHECK-01",
  "title": "候选通达信目录诊断",
  "owner": "GLM-5.3-Flash",
  "state": "closed",
  "milestone": "M5",
  "summary": "为SETUP-01提供只读候选验证，区分未安装、空日线和缺配套数据。",
  "next_action": "工程验收已通过；SETUP-01 的发现、选择和保存接线另行实施，用户验收尚未记录。",
  "allowed_paths": [
    "server/src/tdx/inspect.ts",
    "server/test/tdx-inspect.test.ts",
    "docs/work-items/tasks/TDX-CHECK-01.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/TDX-CHECK-01.md"
    ],
    "reason": "模块首批按固定合同独立实现；运行行为接线、规格和公共文档由REL-03集成人负责。"
  },
  "verification_refs": [
    "server/test/tdx-inspect.test.ts",
    "docs/verification/2026-09/REL-03/module-acceptance.json"
  ],
  "integration_ref": "19bbdcb",
  "acceptance_ref": null
}
```

合同：[v0.3.2首批](../../engineering/release-032-contracts.md)。Prompt在派发前独立保存；仅改allowed_paths，不改共享文件。

## 实现结果（2026-09-23，基础提交 4e640a5）

- 导出与合同一致：`TdxCandidateCheck`、`inspectTdxCandidate`、`inspectTdxCandidates`；未改动 discover/launcher/API。
- 路径治理：空/空白、相对路径、UNC（`\\`或`//`开头）、设备命名空间（`\\.\`、`\\?\`）、Windows保留设备名逐段拒绝，均以可行动problems返回不抛出；候选先resolve规范化再去重，Windows大小写不敏感、其他平台保留区分，保持首次出现顺序。
- symlink/junction：候选根的全部祖先段、根末段、vipdoc、vipdoc/各市场、T0002、T0002/hq_cache及逐文件均lstat判定，符号链接不跟随并单独报告；候选根进入前逐段确认（lstat会穿过中间段junction解析末段，只查末段不够），中间目录段在进入前同样逐段校验。
- 结构证据：`vipdoc` 或 `T0002/hq_cache` 为真实目录即recognized，不凭目录名；可访问但无结构、根不存在、无权限、根为文件、根为符号链接分别报告；readable仅在根级不可达或检查中出现EACCES/EPERM类访问错误时为false，缺失与按策略拒绝junction保持true并单独注明。
- 日线：只查sh/sz/bj的lday，文件名按现有`isAShareCode`口径＋`^(sh|sz|bj)\d{6}\.day$`且市场前缀必须与所在市场目录一致（sh目录里的sz600000.day不计入并注明）；仅统计32字节倍数且首/末记录日期有效、首<=末的文件（复用`parseDayBuffer`）；空文件不计入并注明；只读首/末32字节不读全文；单文件失败不中断整体，problems注明检查不完整；latestDate仅取成功检查数据的最大值。单市场目录损坏只影响该市场。
- 并发/更新：市场间串行、市场内文件池并发8（句柄有界）；读前lstat与读后fstat的size+mtime比对，不一致有限重试3次（间隔25ms），仍变化报“正在更新”。
- 配套：gbbq存在且可读、头部记录数与长度一致才true（只读4字节头，不冒充解码成功；空/过小/不一致分别报告）；名称查`T0002/hq_cache/{sh,sz,bj}s.tnf`与`base.dbf`（loadStockNames同源实际文件名，非空且固定64字节实际只读成功才算可用；存在但拒绝读取与缺失分开报告）；基准沿用产品实际基准源`vipdoc/sh/lday/sh000300.day`并做同样的格式校验。problems去重且上限200条，超出给出省略计数。
- 测试26条（全部合成临时夹具）：完整候选、只读快照对比、空目录/空安装/根缺失/根为文件/空与相对路径、UNC与设备与保留名（win32）、junction根不跟随、junction根祖先不跟随、T0002 junction不读取外部权息与名称、vipdoc/sh junction不统计外部日线、受控EACCES（icacls拒绝读数据，日线与名称两场景）、市场前缀反例、坏长度/坏日期/降序/空日线、非A股不统计不告警、单市场损坏、配套缺失分别报告、gbbq空与不一致、空tnf、大小写文件名、候选去重与保序。

## 验证记录

- RED：`node node_modules/vitest/vitest.mjs run --config server/vitest.config.ts server/test/tdx-inspect.test.ts --maxWorkers=2`，退出码1，`Cannot find module '../src/tdx/inspect.js'`（模块未实现）。
- GREEN：同一命令，退出码0，`Tests 21 passed (21)`。
- 相邻无干扰：dayfile/discover/names/symbol/catalog 5文件15条测试全部通过。
- `npm run build:server`：退出码0。

## 审查缺口修复（2026-09-23，第二轮，基础提交 4e640a5）

REL-03审查提出三个缺口，均先补失败回归再最小修复；只改 allowed_paths 三个文件，不接UI/API，提交仍由集成人执行。

1. junction全段校验：原实现只lstat末段，候选根祖先段、T0002、vipdoc/各市场中间段可能穿过junction读到外部目录。修复：新增`findSymlinkAncestor`对候选根逐段lstat（盘符根特殊处理），祖先含symlink即整体拒绝（readable=false、recognized=false）；新增`describeMarketDirectory`在进入lday前校验`vipdoc/<market>`，基准检查复用同一入口；主流程先校验T0002段再认定hq_cache可用。回归用真实临时junction证明外部目标中的合成有效日线、权息、名称均不被读取或统计（根、根祖先、T0002、vipdoc/sh四场景），不跟随目标再宣称可用。
2. readable与访问错误分离：原实现readable恒true、`scan.sawFileError`未使用、hasNames只看lstat非空。修复：移除sawFileError，改用贯穿日线/权息/名称/目录各检查的访问错误跟踪（EACCES/EPERM），命中即readable=false且problems单独报告；缺失与权限拒绝分开两条消息；hasNames对首个非空候选固定只读64字节验证后才true；检查中途读取异常就地分类，不再逃逸为“未预期错误”。回归用`icacls /deny *S-1-1-0:(RD)`受控拒绝读数据（保留属性使lstat仍可用），日线拒绝时保留已成功字段（count=2、latestDate、hasAdjustment不变、readable=false），名称拒绝时hasNames=false、readable=false、count=3。
3. 市场前缀一致性：原正则`^(sh|sz|bj)(\d{6})\.day$`未比对所在市场目录，sh目录中的sz600000.day被误计（`isAShareCode('sh','600000')`为true）。修复：前缀（小写化）必须等于所在市场，不一致不计入并注明已跳过；反例测试断言count=1、latestDate不受影响。

## 第二轮验证记录

- RED：`node node_modules/vitest/vitest.mjs run --config server/vitest.config.ts server/test/tdx-inspect.test.ts --maxWorkers=2`，退出码1，`Tests 5 failed | 21 passed (26)`——5条新回归恰好对应三个缺口（祖先junction仍计入3文件、T0002 junction仍报hasAdjustment=true、vipdoc/sh junction仍计入外部日线、EACCES下readable仍true、前缀反例count=2）。
- GREEN：同一命令，退出码0，`Tests 26 passed (26)`；原21条用例未改动、全部保留。
- `npm run build:server`：首轮修复后报8条TS错误（noteAccessError参数可空、checkBenchmark漏传access），修正后退出码0。

## 决策与边界

- 北交所口径沿用现有`isAShareCode`：仅`920xxx`计入（夹具曾误用430047暴露此口径，按合同不改既有口径）。
- readable语义：中间段junction按策略拒绝与数据缺失保持readable=true（能检查的部分照常报告），只有根级不可达或EACCES/EPERM类访问错误才置false；与既有vipdoc junction口径一致。
- 已知未覆盖风险：逐段lstat之后、实际读取之前目录段被外部替换的TOCTOU竞态无法用真实时序稳定复现，文件级仅靠stat比对缓解；受控EACCES依赖宿主ACL（Windows用icacls拒绝读数据，POSIX去权限位），以当前用户身份运行时有效，特权或域策略异常环境可能表现不同。problems上限200为诊断可读性取舍。
- 测试为行为断言（计数/标志/problems类别），未镜像内部函数；未读写任何真实通达信目录或用户库，未调用本地服务端口。

## 交接：提交被 Mimosa 拦截（2026-09-23）

- `git add`＋`git commit` 一并在 PreToolUse 钩子处被拒，工作区未产生提交；按派发指令只记录一次，不换参数绕过，不修复范围外文件。
- 拦截输出（原报告，即本次钩子 stdout，无新增扫描目录）：16 高危＋2 中危，全部位于本任务范围外的既有文件——`scripts/verify-candidate.ts:34-45`、`scripts/runtime.ts:28`（command-injection 入口）、`server/test/recording-context.test.ts:236`（不可信解释器输入）、`server/test/runtime-isolation.test.ts:128`（XSS）；与本模块三个文件无关。历史密封基线扫描在 `~/.mimosa/security-scans/project-80265fd7bb737f1ad4735b57/scan-2026-09-19T16-32-54.883Z-f16a8db291b6/report.md`。第二轮审查修复后未再尝试提交，沿用同一处置。
- 未提交内容（集成人可直接 `git add` 三个文件后提交，含两轮全部改动）：
  - `server/src/tdx/inspect.ts`（新增，含审查缺口修复）
  - `server/test/tdx-inspect.test.ts`（新增，26条用例）
  - `docs/work-items/tasks/TDX-CHECK-01.md`（本卡，state=review）
  - diff 获取：`git diff -- docs/work-items/tasks/TDX-CHECK-01.md`；两个新文件为完整新增内容。

## 工程验收（2026-09-23）

- 上述 Mimosa 拦截是 GLM 工作树的历史交接；集成提交 `19bbdcb661856f9a299cda55eb2df7eb08e08d37` 已由根代理审查并纳入当前主分支。
- 聚焦测试 26/26，全量单测 858/858，`npm run build` 通过；junction、权限和市场前缀回归均实际执行。
- 用户验收仍未记录；SETUP-01 的产品接线不属于本模块。
