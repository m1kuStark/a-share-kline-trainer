# M3快捷键回归的准备条件

对象：M9候选 `4fce44d7fd6409c79389e3913a5d2ab6b7145991`，tree `bafc7f80eb66f3a5f0c5bf3f20884e785cd219c3`。2026-11-18，Windows / Node24.15 / Edge，独立run、端口、SQLite和浏览器存储，只读冻结TDX六文件；不是个人训练库。

完整运行 `run-f33b580e-faf8-4aee-af42-04845d127d13` 原生exit1，Journey 261通过、1失败、0跳过。失败为m3-round3首次右括号后期望周K、实际日K，15秒超时。官方v1.2.7真迁移和两年录制均通过，但不能抵消此失败；没有成功候选proof。该失败仅有error-context，缺少按键时的inert/焦点/recording.ready记录。

## 机制与证据边界

原open只等画线已保存、无loading、有bars并blur。Training.vue在录制初始化时给grid/topbar设inert，onKeydown按preparingRecording保护直接返回。其他现有套件已等待grid解除inert。图表就绪和录制就绪是两个异步条件。

仓外诊断脚本复用createRun、prepareJourneySnapshot、buildRun和startServer。独立运行 `run-60e9df35-f068-4fd3-9184-71d5009a6915`、端口10727，以15秒上界hold recording-context（实际未到期）：原open完成时1040bars、已保存、无loading、BODY焦点，但grid/topbar inert=true；真实BracketRight（isTrusted=true）后仍日K。release并等inert解除后，同样真实按键切周K。另五次无hold、原open与原15秒断言均通过，按键时inert=false；全部pageErrors=0。此实验证实准备窗口机制，未自然复现f33，也未证明原失败按键恰好落在窗口内。

最终诊断native0、stderr空，browser关闭，自有server PID73720已退出、ready/lock已清除，源码head/tree/clean及冻结数据SHA前后一致。首次准备run-375dea22在snapshot目录rename遇Windows EPERM，native1，未build/启动App；原失败单独保留，同脚本原字节、新run重试后成功。f701另一用例的pointer interception超时没有共同根因证据。

诊断六次各有一次lifecycle/session资源403，trace响应为HOST_MISMATCH：自有runtime动态端口已分配10727，生命周期校验仍使用配置端口0；不是recording-context请求。此既有隔离运行限制未在本卡修改，pageErrors=0不表示console没有资源错误。

原件位于 `C:/Users/Stark_Du666/.codex/headroom-cache/M9-shortcut-diagnosis/agent-dynamic/`，包括完整脚本、观测、请求/按键时间、trace、两阶段截图及首次失败。关键SHA256：

| 原件 | SHA256 |
|---|---|
| shortcut-readiness.agent.cjs | 789fd22f5c57a19077d8f2fe69ac24573d21273c8cd7ab329e420e99cb7bb6d0 |
| dynamic.receipt.json | ae8926be4e7cceb3493b4647560793e544c11ee854b5e86be00f4a6992735fe2 |
| execution.receipt.json | 09f7b32fd03fe30f38347eebbc988e8dc618e96b4c70afc3d7156ac1bd313e9a |
| receipt-index.agent.json | 1316b43533845cd55a5efff3c5fe03c452e277f55e600201f5c9b4233748550b |

## 最小修正与后续

仅在m3-round3的open原等待后、blur前补 `expect(training-grid).not.toHaveAttribute('inert', '')`。不改生产逻辑、原周期/隔离断言、超时、用例集合，不加skip。定向结果随后归档；测试变化必须新提交重新完整验证，不按报告E继承旧候选结果。完整候选、同提交包、主代理视觉和用户验收分别记录。

修正工作树定向运行 `npm run journey -- e2e/m3-round3.spec.ts e2e/recording.spec.ts --retries=0`，run-db5bb7fd-c995-4173-a711-e934566e72ad，原生exit0；8通过、0失败/跳过/重试波动，包含完整m3-round3和既有录制准备保护用例。基础HEAD为4fce44d，唯一测试差异为上述等待；文件SHA256为 `46621c864d1f0e102685c47a5f81da96a725777651d3e13a975a7f1f584ccc5d`。原始退出收据位于同一仓外诊断根的targeted-fixed，完整run结果保留在本工作树.runs。该定向结果不代表新提交的完整候选已通过。
