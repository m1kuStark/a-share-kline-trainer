# M9-ENABLE-01 公式启停与整批候选证据

批准范围见[首批批准记录](../ENG-PLAN-01/approval.md)，产品口径见[公式规格](../../../specs/formulas.md)。本页记录工程检查，不代替 M9 用户整批验收或发布许可。

当前接续：用户已批准的独立EMA修复经PR54合入main58ba0ff，并集成到M9提交3ec3d730。统一候选首次公式启停专项5/5通过；补充自定义主图与保存失败后刷新后，新一轮6/6通过，两轮原生exit0。f701首次完整候选失败，当前准备修复后重新冻结；详见文末。下文blocked与待拍板描述是批准前保留的验证快照，不代表当前仍待同一许可。

本轮另发现并精确清理共享控制台账中的测试夹具投影，保留全部真实记录，见[恢复记录](control-recovery/README.md)。恢复未触及个人训练数据；后续单测与控制目录隔离。

## 首轮 RED

对象为 `main@2c66477f0c4875ac3a100338fdbc42b4878dadd8` 的未修改产品代码，加新建真实事件测试 `e2e/formula-enable.spec.ts`。Windows / Node 24，独立 run 数据库、端口和浏览器存储，真实 TDX 只读。命令为 `npm run journey -- e2e/formula-enable.spec.ts --retries=0`，原生退出码 **1**，5 failed。

- 自定义公式勾选停用后创建，响应实际 `enabled=true`，与预期 false 不符。
- 三个内置示例分别开启并保存，均实际收到 403，与预期 200 不符；请求夹带受保护 name/source。
- 保存故障回归显示错误后，之前的成功提示仍存在。

run 为 `run-59e8bc10-9892-412f-9a5c-4fda6828f7d4`；完整错误和原生日志存于本目录 `red/`。五个失败都落在目标语义断言，未将构建或数据准备错误当成 RED。随后仅将内置测试的参数化注册改成三个字面测试名，便于严格绑定解析；相同交互与断言保留，最终版本须重新运行。

## 接续边界

本卡在前置维护落地后修复保存请求并保留服务端保护，执行本机语料、全量候选与主代理视觉检查，再从同一提交构建 Windows 验收包。当前记录不声明这些后续检查已通过。回放采用当前公式库、公式副图高度未录入、公式副图画线回放回落主图的限制仍待用户整批验收。

## 保存修复与保留的失败

候选新增enabled请求，内置只发送description/placement/enabled，保留name/source保护；保存前清除旧成功提示。seed默认值与示例源码未改，增加“用户启用后再次seed不重置”保护。

| 运行 | 结果与原因 |
|---|---|
| 字面测试名RED run-f01a14db | exit1，5项按目标语义失败；red/literal-journey.raw.b64 |
| run-f2622749 | exit1，4失败/1通过；刷新后读probe过早，原件green-attempt1保留 |
| run-d825f54e | exit1，4通过/1失败；仅补真实probe就绪，QINIU结果无效，原件green-attempt2保留 |
| run-6698a681 | exit1，4通过/1失败；等待完整计算后DEA仍为空，hasResult实际[true,false,true]，final-attempt保留 |
| 既有公式旅程 run-6eb1ecab | exit0，formula-manager与formula-chart共8项；不能与新增5项拼接整批绿 |
| 新依赖树后端专项 | 原生exit0，3文件/12项，post-maintenance专门收据 |
| 新依赖树npm ci及npm run build | 原生exit0；构建保留大chunk提示，未放宽检查 |

历史native退出码来自主代理当时原生工具结果；归档代理只独立核对日志与browser-results，未把manifest或日志绿字当退出收据。维护后build/后端另有[专门退出收据](post-maintenance/post-maintenance-receipts.json)。日志以raw.b64保存原始字节，解码即可读取全部错误。

本轮最后失败只有error-context，没有QINIU失败截图。两张final-attempt截图分别属于MA/WEEK成功阶段，不能充当QINIU视觉通过证据。新增等待保留长度、有效值、pane、刷新、停用全部断言；未用skip或降低hasResult。

## 批准前的阻断与待审范围快照

[保存修复五维审查](review/saving-fix-review.md)未发现新增C/I/M，完整交付仍有EMA I1。公共EMA在绝对period-1处对含前导NaN的窗口播种，导致DEA永久NaN、B1漏信号；独立数值诊断和可审阅最小候选见[诊断报告](review/ema-diagnosis.md)。候选补丁仅归档，未应用。

拟议独立M9-EMA-WARMUP-01只跳过前导NaN，沿用SMA种子和原递推，保持连续有效输入逐项一致；不改变CROSS、公式源码、内部空洞/Infinity处理或内置MACD初始化。需要用户批准独立范围；批准后另建任务、矩阵、RED→GREEN、完整实盘语料与M9五旅程，之后才组织完整候选和同提交Windows包。

公式UI绑定检查8行、covered4/open4/RED0、strict原生exit3；没有提升未闭合行。M9为blocked/draft，未产生完整候选proof、未构建M9验收包、未获人工验收或发布许可。包验收脚本仅准备和语法检查，preparation-only不代表产品运行。

## 前置与反馈归档

PR50合入b1ff3e9；PR51合入f4bbc6a，首轮设置用例超时与同head第二轮完整通过见runtime-ci；PR52合入df6cedd，首轮required checks全成功，告警48自动fixed。最终独立依赖审查及[远端收据](prerequisites/pr52/followup-summary.md)已保存。云端9条语料缺失提前return与本机真实语料3023项分别报告；GitHub新公告API404也保留，零告警不证明公告已收录。

PR43评审C0/I2/M0，待当前main集成和Electron44.11.3真实包验证；保持开放，未评论。Issue8的[现场视觉补记](issue8/live-review.md)、安装器技术草案和涨停起点待审方案仅归档，未实施新功能或回复外部人员。

本轮源码身份见[source-identity.json](source-identity.json)，归档逐份解码/字节/SHA核对见[archive-index.json](archive-index.json)。缓存源清单可能列出额外原件；只有archive-index列出的复制文件算已入库，不声称完整run数据库和TDX样本已归档。


## 2026-11-18 完整候选失败与准备修复

f701371完整候选原生退出1：docs、impact、server2664、类型、构建、M2 24/24通过；Journey229通过、18失败、1跳过、13因serial前置失败未运行，无候选proof。全部首次失败见[归档](failed-candidate-f701371/failure-summary.md)，原始CI、ASAR和审查见[此前证据](final-prior/README.md)。

formula-chart留下启用的CHART_SUB，使15个后继断言出现第5窗格。仅补严格用例后清理，原4个测试正文及窗格期望不变；新增后置断言RED正确发现CHART_MAIN/SUB，GREEN运行917219e4共8通过，另d0722af9共4通过。D28原超时直接原因未证实，定向通过不能代替完整候选。独立准备修复审查C0/I0/M0。

旧ZIP真实CMD运行原生1，Windows PowerShell5.1误读无BOM源码中的中文exe名；仅增加UTF-8 BOM，脚本其余2525字节不变。PS5原版失败/BOM成功、PS7两版成功；新包CMD尚待实跑。生产验收脚本原nativeHome预期错误已分开保留，v3仍待实际执行，未声称包验收通过。

RED/GREEN、原CMD失败、编码正反例、home oracle和五维审查原件见[准备修复归档](preparation-repair/M9-freeze-preparation-evidence.manifest.json)及其ZIP；128份源字节、131条目校验一致，未含运行态profile。官方v1.2.7迁移ZIP已匹配官方SHA清单和GitHub digest，将用于消除下一轮可避免跳过。个人库未作夹具。
