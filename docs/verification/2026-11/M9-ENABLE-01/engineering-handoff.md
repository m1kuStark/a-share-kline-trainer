# M9整批工程交接（2026-11-18）

公式启停、公共EMA暖机及整批准备修复已完成工程交付。C2完整候选、同提交Windows ZIP/CMD/实包及主代理UI检查通过，PR55已合并。当前为review，用户整批验收与发布许可均未记录。精确原件从[C2最终证据](c2-final/README.md)进入；此前失败继续沿[历史索引](README.md)追溯。

## 来源与证据边界

| 对象 | 当前事实 |
|---|---|
| 被测提交C2 | `35729e4ac28696fc174a12e6cef6d1e9b0944f2b` |
| C2 tree | `b669e42987324fe527b2b48677ac66a78ad8c252` |
| 对比基线 | `58ba0ffc13458fb136c7d885b62ee0c898d4bab8` |
| PR55集成I | `2e3704f2b3ddae6c5774b27ab085aea7467fe1b2`；现场核对origin/main=I，I tree与C2相同 |
| 本次报告E | 仅补证据/任务元信息，继承C2工程结果；文档门禁独立记录，不声称原proof测试过E；最终SHA/PR单独记仓外交付回执，不自引用或amend倒填 |
| 用户决定 | `acceptance_ref=null`；未发布、未tag/Release/上传或更新feed |

[精确proof](c2-final/tested-candidate-proof.json)保持原字节，schemaVersion2、profile=full、passed=true，cleanBefore/After均true；SHA256为`a8c1e40aceb993926e988fabfc3624797e3fd41c69ad48132701d88ce9f25090`，与同轮verification一致。它绑定C2/tree/base，不改绑到I或E。[root绑定核对](c2-final/root-binding-check.json)只补结构核验，不代表用户接受。

## 最终完整运行与保留的失败

最终本机run为`run-f3c3ca72-e6e3-424d-bc0f-3665c11ff253`。外层原生退出0，docs、impact、unit、types、build、snapshot、m2、journey八项均退出0。unit直接执行Vitest的`run --config server/vitest.config.ts --allowOnly=false`，189文件/2670项通过，本机公式语料实际执行且没有缺失warning；M2 24/24；Journey262/262，零skipped、unexpected或flaky。38.4分钟仅为Journey耗时，不是整批总耗时。本机此轮没有运行desktop369，不能与远端CI合称同轮。

| 历史对象 | 保留结论 |
|---|---|
| f701371 | Journey229通过、18失败、1跳过、13未运行，无成功proof；公式夹具残留及其他原因分别记录 |
| f945候选 | Journey259通过、2失败、零跳过，无成功proof；旧包主K高度为0，不能作为视觉通过 |
| 4fce44d / run-f33b580e | 原生1，Journey261通过/1失败；首次右括号后仍日K，无成功proof。受控hold证明准备窗口机制，另五次无hold通过；未自然复现f33，也未证明其精确按键时序 |
| C2 / run-e1e47169 | 原生1；server2669/2670，慢健康夹具第一次启动20秒readiness超时，last probe为`fetch failed`；未进入stop/第二次launch或后续types/build等检查。与并行生产构建时间重叠已证，CPU因果未证 |

原失败、准备修复、变异和复跑各自保留；后继完整绿色不抹掉失败，也不把定向8项、44项等拼成整批。快捷键机制的限度见[诊断](shortcut-readiness.md)。

## 同C2远端CI（独立运行）

GitHub Actions run`44245346043`的docs、verify、pr-policy均为SUCCESS，CI记录server2670项、desktop369项通过。实际checkout为synthetic提交`513f61075b518e5e8b0d9d531ca1bda3df113f47`，tree与C2一致；这组CI结果独立于上述本机f3运行。

CI有7个依赖外部语料的用例因缺文件而提前return，虽被测试框架计为passed，不能据此宣称语料覆盖。本机C2语料已实际执行；远端通过与本机语料证据分别保留。

## Windows验收包与主代理检查

稳定交付目录为：

```text
D:/Superlinear_Academy/Stock_WorkSpace/a-share-kline-trainer/output/acceptance/M9-ENABLE-01-20261118-35729e4
```

包名`kline-trainer-M9-ENABLE-01-v1.3.8-35729e4a-windows-x64.zip`，177,793,959字节，SHA256为`a4858eab49ef603aa3e636c0790d591b29e1dc7f8ca40e7ff66c2a66b538c5a0`。87个payload文件经全新解压回读一致，包内manifest为86项；目录旁的`assembly-result.json`、SHA文件与`用户验收指南.md`共同交付。

同C2 ZIP已全新解压实际运行`Start-Acceptance.cmd`，CMD与应用退出0，关闭后进程消失、端口释放；独立DB/profile与包内行情样本用于验收。另一个独立新解压目录完成公式启停、训练、真实gzip导出导入回放和两次启动持久化检查，零pageErrors、零意外对话框。导出gzip为8事件/11检查点，本地结算录像为10事件/13检查点，两者分别核验；三次只读IndexedDB全文比较仅排除导入sessionId。[主代理UI记录](c2-final/manual-ui.json)确认本人查看20张原始截图、outcome=passed；原v7收据的visualAcceptance=pending保持原样，后继UI证明单列。

实包收据中的`sourcePackageSha256`指源码`package.json`，不是ZIP SHA。录制头的版本/提交可能为`unknown`或继承上层Git信息，保持原值，不能用于证明包身份。

## 用户仍需确认的限制

- 回放使用当前公式库；修改公式可能改变旧录像显示。公式副图高度不录入，副图画线在回放落回主图。
- 密集布局保留100px主K，1008×641最小内容窗口仍需实际体验；账户数字动画的中间截图不证明动画质量。
- Issue #8的浅色MACD DIF/KDJ K低对比未修复。NSIS实际安装与覆盖升级未验证，本轮按ZIP验收。

请按[ZIP验收入口](../../../release/M9-ENABLE-01.md)及稳定ZIP旁指南进行用户整批验收，再单独记录接受范围及后续决定。工程通过不代替用户验收或发布许可。

## 正式留存

[正式archive结果](c2-final/retained-archive/result.json)与[完整文件清单](c2-final/retained-archive/file-manifest.json)保留在本仓库；ZIP原件保留仓外：

```text
C:/Users/Stark_Du666/.codex/headroom-cache/M9-35729e4-retained-archive/evidence.zip
```

archiveVerified=true，518条目、10,749,387字节，SHA256为`de777837c746e80cecfd8a55d3c5a7b9e595ba9aa27e33d7a7d4aa331948395f`；含原生日志、实包收据与20张原图。归档时`integration_ref`和`evidence_commit`为null，原件保持不变；本报告单独记录后核实的I，本次报告E的最终SHA/PR另记仓外交付回执。
