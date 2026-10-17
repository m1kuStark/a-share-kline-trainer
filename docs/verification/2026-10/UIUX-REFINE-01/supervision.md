# Harness 监督与 skill 修订

本轮按用户要求使用文档注入，不安装技能。正式Harness v1.11位于工作区`.zcode/skills/ai-harness`；候选v1.12是`ai-harness-lab/skill-candidates/2026-10-17-uiux-refine/ai-harness`内四份文档覆盖层，其他脚本/参考从正式源读取。UIUX源位于`D:/Superlinear_Academy/UI-UX-Design/skills/uiux-design-core`，修订为0.4.1。指定ZCode会话与UIUX聊天已作为历史来源阅读；当前源码和运行证据优先。

## 实际监督

| 交接点/偏差 | 纠正与独立核验 |
|---|---|
| 初期合并读取被截断，研究无正式任务卡 | 逐文件补读；研究采用书面manifest，进入实现后统一任务卡。记录哈希，不把给路径当完成注入。 |
| W1/W2实现交接 | [W1](W1.md)、[W2](W2.md)保留目标RED、范围、原生退出码；root集成运行并实际操作UI。 |
| 旧构建和外框尺寸可能误导 | 逐项核源码→build→HTTP→asar；实际Electron内容1008×641后补RED。原1024浏览器证据不外推。 |
| 默认设置滚轮未证明滚动 | 改查真正溢出的125%偏好页；原默认页仅证明锚点，不称真实滚动。 |
| min-window worker运行租约与压缩摘要冲突 | 查最后可见授权后，归因为交接歧义，不错误归责worker越权；root显式接回通道，保留被中断运行无有效native收据。 |
| 成绩单只验弹窗壳、导航只验最后终态 | 独立L2找到可幸存反例，补准确GET/身份/成功正文和中间排行被接受；不以用例名证明语义。 |
| 排行压力fixture及测量前提 | 审查发现胜率分母与交易笔数矛盾；root实测gutter、边缘wheel、小数盒边界和滚动owner，保留原失败并校正测量，详见[root验收](root-validation.md)。 |
| skill补充情境首次漏写重读要求 | worker记录遗漏，要求审查者补全文重读后重判，不抹除首轮偏差。 |

root单写任务卡、矩阵、共享状态、台账、构建与最终提交；worker只写各自许可文件并交收据。本轮后期浏览器/runner一直由root独占。报告中“静态复核通过”与“产品运行通过”分开，定向变异仅paper_only，未宣称执行击杀。

## 文档形成的改进

Harness候选明确研究任务适配、覆盖层资源解析、全文注入与截断补读、并行单写者、原生退出码、运行租约交接、源码/构建/加载/包身份、真实滚动起点与入口身份、producer字段联合可实现性。UIUX补充实际桌面内容预算、任务路径前后比较、长反馈首尾可达、稳定动作与事件化动效。没有改M6-05R数字滚动偏好，也没有用文档放宽交易语义。

文档差异、来源摘要、独立情境A/B/C/D与链接/格式验证保存在候选目录`review.md`、`scenario-review.md`、`delivery-followup.md`、`source-manifest.json`、`document-validation.json`。正式Harness四份源文档保持原hash；UIUX修改的是源工程文件，未复制安装。最终验证命令收据由root刷新，文档检查不冒充执行质量保证。

[最终L2](L2-final.md)逐行列22个测试的实际场景、断言与不能外推的范围。其七行覆盖的是已有可达性和交互合同，配色/比例/120与180ms等呈现参数仍待用户验收。

最终文档验证原生0：9份文档、38链接、0错误，source-manifest SHA256=`325bb2313b2161a7d109d42613439e8c52d90cc08df0227a0c75458c42af87b5`；minimal.diff=`be01f5ad9bcc1c722f1cbcbc519807d54d29890100bf58adb47ccff6bf9bd282`。旧验证快照存validation-history，最新命令收据为validation-fixture-final-command.json。root首次矩阵回填脚本用了Python3.9不支持的write_text(newline=)，未写入即失败；更正为write_bytes后strict0。首次workflow命令control-root漏`.control`导致ENOENT；修正后native0，随后docs生成被既有16项错误阻止。这些均为操作准备失败，不记产品RED。
