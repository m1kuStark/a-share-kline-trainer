# 统一工作状态

工作空间级状态文件位于仓库外的 `.control/trainer-state.json`。它是任务、候选、作业、运行、产物和验收的唯一当前状态源；任务卡只保留任务定义和验收契约，GLM job、Git candidate 和 zcode DWF 只提供 telemetry 或证据。

```powershell
npm run workflow:state -- init --control-root D:\Superlinear_Academy\Stock_Workspace\.control
npm run workflow:state -- read --control-root D:\Superlinear_Academy\Stock_Workspace\.control
npm run workflow:state -- task --control-root D:\Superlinear_Academy\Stock_Workspace\.control --id ORCH-STATE-01 --status active --owner integrator --next-action "接入 candidate、GLM job 和 DWF 状态适配器"
npm run workflow:state -- event --control-root D:\Superlinear_Academy\Stock_Workspace\.control --json '{"event_id":"example-1","kind":"task.created","timestamp":"2026-10-01T00:00:00.000Z","task_id":"ORCH-STATE-01"}'
```

写入通过文件锁、版本递增、schema 校验和临时文件替换完成。个人绝对路径、凭据、完整模型对话和原始行情不写入状态文件；工作树与产物使用相对别名。

## 适配器边界

- `scripts/worktree/state.ts` 在候选 `prepared/failed/verified/promoted/cleaned` 每次落盘后投影 `candidates[id]`，并保留真实 commit/tree 绑定；同一候选的状态推进允许变更，绑定字段变化报告漂移。
- `scripts/agent-monitor/run_glm.py --control-root <工作区>/.control` 将 GLM `starting/running/completed/failed` 作为 `runs["glm:<batch>"]` 事件写入；`jobs/<batch>.json` 仍是 telemetry。GLM 退出 `completed` 不代表工程验证或用户验收。
- Zcode DWF 应调用 `scripts/workflow/state-cli.ts event` 或由编排器调用 `mirrorRunState(..., source: 'dwf')`；DWF 看板只能投影事件，不能自行把失败门禁改成完成。
- `docs:status` 读取祖先 `.control/trainer-state.json`。任务卡仍是静态契约；统一快照与任务卡状态不一致时返回 `ERROR state-drift`，不自动猜测。生成区只在对账后更新。

控制目录不是仓库内容，建议由工作空间启动器显式传 `TRAINER_CONTROL_ROOT`，避免不同 worktree 各自创建状态文件。状态文件锁忙、schema 不兼容或真实引用缺失时，调用方应保留 telemetry 并转 `waiting_control`。

