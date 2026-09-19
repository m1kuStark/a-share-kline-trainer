只修recorder.ts两个已定位问题及相关测试，允许docs/engineering/recording-core.md同步，不动storage/validator/页面。无需重复分析整个设计，不git提交。
1 restore时间公式现在重复减anchorWall。设restore时elapsedOffset=maxElapsed，anchorWall=Date.now()，currentElapsed=Math.max(lastElapsed,elapsedOffset+Date.now()-anchorWall)；start offset0。新增mock Date.now恢复后+100ms事件elapsed严格+100，不能只>=。
2 当前restore创建新segment但capture没有该segment事件，违反validator。restore先validateRecording(storagefile)，对悬空op补interrupted保持原segment，然后保留最后一个checkpoint或event的segmentId续录（首次无事件用初始checkpointsegment），不必新建segment。真正resume才新segment。这样restore后的capture合法。加export→validateRecording交叉：初始enabled=false、pause/resume、restore再capture、损坏load拒绝。validator现已合入最新版允许初始gap0，无需改它。
仅这些问题。运行npm test -- server/test/recording-core.test.ts server/test/recording-validation.test.ts和typecheck。完成后立即停止，不做额外扩展。
