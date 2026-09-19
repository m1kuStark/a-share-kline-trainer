# REC-PLAYER 审查修正：真实暂停缺口

工作树 D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/REC-PLAYER，当前四个未提交文件是你上一轮产物，保留。只改web/src/recording/replay.ts、web/src/views/SessionReplay.vue、server/test/recording-replay.test.ts、web/src/views/recording-replay.md。读根/web/server局部规则，不改types/recorder/图表/App/Training，不Git提交、合并、推送，不外网、不浏览器、不个人库/TDX。

已验证18tests和typecheck通过，但审查发现确定的合同错误：Recorder暂停不产生丢失的seq编号，pause与resume永远可相邻。真实pause的afterSeq=N，resume的resumedAtSeq=N+1；当前gapCoveringSeq用开区间永远命中不到，describeGap甚至说“无缺失”，违背用户要求。首屏关闭时gap={afterSeq:0,resumedAtSeq:null}也必须在初始第0步提示；暂停未恢复末步也提示。

只修这个小单元：先用真实Recorder+MemoryRecordingStorage构造初始关闭、pause→resume(中间不记录操作)、末尾pause三种记录，validate后验证UI辅助逻辑并看到失败。明确gap是时间/未记录操作区间，不是缺失的事件序号；在暂停边界和恢复边界显示提示，恢复之后仍常驻“本录制含N段未记录区间”的摘要，不能在后续步隐藏全部历史缺口。complete=true仅表示尾段无悬空，不得显示“录制完整”暗示无缺口；可用“尾段已闭合/含未记录区间”。不发明遗漏操作数量。

顺手将最后按钮aria-label统一成已接线E2E的“最后一步”（当前跳到最后）。不拓展性能/容量功能，自动停录需求用户已撤回，与本任务无关。

npm test -- server/test/recording-replay.test.ts server/test/recording-core.test.ts；npm run typecheck:web。返回短测试结果和修改范围后停止。
