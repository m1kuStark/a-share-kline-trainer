# V1-INTEGRATE-01 I1 测试隔离限定返修报告（repair-48）

状态：**返修实现完成，完整门禁提交后运行中**（reply_to=control-handoff-20260928-48；本文件在门禁前提交，门禁结果写外部证据目录，不宣称门禁后 HEAD 另有 proof）。base=原组合候选 `ceeccff47876b536d17e073a0bea71e4c97d7ad2`（干净开工）。

## 授权与范围

用户在 review47 停止裁决后明确批准"一次限定测试修复执行（含完整门禁）＋一次限定复核"（operator-authorization.json grant v1-integration-operator-grant-20260928-48；有效预算 4/5，余一次 GPT 限定复核）。允许 diff 仅 `e2e/data-update.spec.ts` 与本 V1 任务/状态/验证文档；生产代码、drawing-basis、门禁配置/超时/retries 均未改。

## 根因（承 review47 forensic，不再复述推理）

`data-update.spec.ts` 的测试级 `route => { createCalls++; void route.continue() }` 覆盖了 installBaseMocks 的创建 mock：`continue()` 直发真实隔离服务（Playwright 语义：立即入网、不链入其它 handler），且 `void` 丢弃 Promise、用例只等计数便结束——泄漏的真实创建晚于下一测试 drawing-basis 的开头 abandon 提交，单活动保护正确 409。错误模式源于 ffc5b549，本轮整合未引入。

## 修法与 RED→GREEN

- **修法**：g（:259）与 c（:155，同文件同模式泄漏，按"同文件内必要夹具整理"一并修复并在此披露）改为 `route => { createCalls++; return route.fallback() }`——fallback 链回 installBaseMocks 的既有创建夹具（响应即预期 mock，不触真实服务），并返回 Promise 由 Playwright 等待处理完成；用例内 `page.waitForResponse` 真实等待创建响应后才结束。g 保留全部原交互断言（绿色已最新、无确认框、创建恰一次）。
- **零真实副作用 oracle（有区分度，不靠 createCalls 或 sleep）**：
  1. 响应身份：创建响应体必须是 mock 夹具（`training.id === 77`）；旧实现 continue 时响应来自真实库（id≠77）即失败。
  2. 真实服务观察：`page.request`（APIRequestContext 不经 page.route）读取 `/api/trainings/active`，创建前后活动训练 id 不变——旧实现泄漏的真实创建会改变活动训练。
- **RED（首次失败保留）**：`evidence/red-i1-oracle.log`（run-af5e7c64，exit 1）——旧实现上 oracle 失败于响应身份：`Expected: 77, Received: 1`（响应确来自真实库），精确复现 review47 指认的泄漏。
- **GREEN**：fallback 修复后同用例 `evidence/green-i1-g.log`（run 后缀见 manifest，exit 0，1 passed/2.6s，零重试）——oracle 双条件通过：mock-only 响应＋真实服务零新增活动训练。

## 有序回归（I1-ordered-regression）

正常隔离 runtime、原相邻顺序 `data-update 全套(a–g) → drawing-basis`、单 worker、`--retries=0`：`evidence/ordered-regression.log`（run-6e97a22b，exit 0，**9 passed / 33.7s**）——含 drawing-basis 原 201 创建断言与全部图形正确性断言，无重试 409、无 sleep、未放宽单活动约束。

## 完整门禁

按合同仅一次 `npm run verify:candidate -- --base 3f8c61246d5c057743fc312b07ebdd704d23658a --task V1-INTEGRATE-01`（docs/impact/unit/types/build/snapshot/M2/Journey，Journey retries=0/forbid-only），在本提交后运行；结果（proof 或失败原件）写入 `C:/Users/Stark_Du666/.codex/headroom-cache/v1-integration-repair-20260928-48/evidence/`，不在本树追加跟踪文件。

## 防遗漏

测试结束覆盖自己认领的异步工作（handler 返回 Promise＋waitForResponse）；mock 新增 route 先核 continue/fallback/fulfill 语义；重放/单测通过只辅助分类，不拼作门禁通过；修根因前不优化产品以降低竞态概率。已知 unknown：catalog 扫描/I/O 偏慢的确切原因（本合同明确不修、不掩盖）。

## 限定返修 F1-F5（control-handoff-20260928-51）

GPT 集中审查（review51）以真实反例否决候选，五项缺陷一次限定返修；FM-014 已入账本。逐项先 RED 再 GREEN：

- **F1 按字段默认解析**：原 `commitTrainingCreation` 任一字段省略即聚合读取两字段默认并整体验证——坏 cash 阻断显式资金＋省略复权的合法创建（反向同理），RANGE 预览也被坏 cash 阻断。修复＝`readCreationDefaultsFields` 按字段粒度读取，只实际依赖的损坏字段 409；RED：`red-f1f2f3.log` 中"坏cash+raw显式资金应成功600000/raw"等 3 用例失败。原"坏 cash＋好 mode 预览 409"正断言与按字段合同冲突，按裁决纠正为成功正例，保留真实依赖坏 mode 的 409 断言。
- **F2 旧两布尔 PUT 不伪造新键**：原 lenient 视图以 fallback（1,000,000/forward）垫底，损坏新键时响应冒称有效。修复＝lenient 视图仅包含可如实表达的键，损坏字段整体缺席；坏字节保留、GET 仍 409。RED：F2 用例断言 `not.toHaveProperty('initialCash')` 失败（原响应含 1000000/forward）。
- **F3 十进制语义**：固定 1e-9 浮点容差误拒 10000000.03/.04/.05、放过 0.010000000001。修复＝前后端统一按 Number 最短字符串表示判定至多两位小数（科学记数法一律拒绝），不调 epsilon、不取整；UI `parseInitialCash` 与服务端 `isInitialCashInDomain` 同口径。RED：F3 用例合法值被拒/超精度被放行。
- **F4 读取/编辑/保存时序**：Launcher 设置保存成功即递增读取版本使在途/迟到 GET 作废；设置面板初次 GET 带 readVersion＋formDirty 守卫，成功保存同样作废挂起读取。真实 UI 序列（review51 指认）由 e2e 显式门闩（非 sleep）复现旧值回退/表单回退为 RED，修复后 GREEN；并补"保存默认→表单未手改采用→实际点击创建"真实路径（data/status mock current＋reload，绕过数据确认弹窗）。
- **F5 在途预览失效释放加载所有权**：`onRangeInputChanged` 失效在途预览时同步 `previewing=false`（原 finally 仅版本相同才清，保存失效后按钮永久"生成预览中"）。旧请求迟到被版本守卫丢弃、不清除较新请求加载态。归 existing_invariant_gap（本片保存通知触发的既有生命周期缺口）。
- e2e 过程修正：F5 范围起始日须落在冻结样本覆盖内（默认 06-28 起 3 个月超出 09-16 数据尾，服务端保守 409——用例数据错误非产品缺陷）；断言锚定实际区间 2026-04-15 起。
- 环境事实：全量 unit 三次中两次 exit 127（进程外部终止、无断言失败、第二次已推进到更后文件），第三次完整绿 1168/1168——根因保持 unknown，不归因负载；与 V1 旧 90/91 的 mock continue 泄漏、本片 .trim 类型边界均非同因（纠正旧归因）。
