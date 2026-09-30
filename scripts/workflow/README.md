# 统一工作状态

工作空间级状态文件位于仓库外的 `.control/trainer-state.json`。它是任务、候选、作业、运行、产物和验收的唯一当前状态源；任务卡只保留任务定义和验收契约，GLM job、Git candidate 和 zcode DWF 只提供 telemetry 或证据。

```powershell
npm run workflow:state -- init --control-root D:\Superlinear_Academy\Stock_Workspace\.control
npm run workflow:state -- read --control-root D:\Superlinear_Academy\Stock_Workspace\.control
npm run workflow:state -- task --control-root D:\Superlinear_Academy\Stock_Workspace\.control --id ORCH-STATE-01 --status active --owner integrator --next-action "接入 candidate、GLM job 和 DWF 状态适配器"
npm run workflow:state -- event --control-root D:\Superlinear_Academy\Stock_Workspace\.control --json '{"event_id":"example-1","kind":"task.created","timestamp":"2026-10-01T00:00:00.000Z","task_id":"ORCH-STATE-01"}'
```

写入通过文件锁、版本递增、schema 校验和临时文件替换完成。个人绝对路径、凭据、完整模型对话和原始行情不写入状态文件；工作树与产物使用相对别名。

