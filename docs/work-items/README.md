# 任务与阶段

协作工具入口：[ORCH阶段](milestones/ORCH.md) → [影子路由](tasks/ORCH-01.md)、[独立验证](tasks/ORCH-02.md)、[动态派发](tasks/ORCH-03.md)、[分类审查](tasks/ORCH-04.md)。

v0.3.2执行入口：[REL-03](tasks/REL-03.md)，首批[FRESH-01](tasks/FRESH-01.md)、[TDX-CHECK-01](tasks/TDX-CHECK-01.md)、[RANGE-01](tasks/RANGE-01.md)；基线取消问题见[RUN-CANCEL-01](tasks/RUN-CANCEL-01.md)。

后续训练时钟执行入口：[V4-01](tasks/V4-01.md)，阶段时钟、条件单、成交理由和 B/S 笔记按[V4阶段](milestones/V4.md)的依赖顺序推进；“v0.4”保留历史提案名称，实际后续版本号未定。通达信用户确认式接入由[SETUP-01](tasks/SETUP-01.md)接续。

当前活动清单见[status](../status.md)，由工作空间 `.control/trainer-state.json` 的统一当前状态与任务卡生成。卡片保留静态契约和证据索引，不独立维护另一套结论；单任务路径稳定，状态变化不搬文件。先按 ID 查卡片，再读相关规格和证据。

- [DOC-01](tasks/DOC-01.md)：本轮文档治理及基线冻结。
- [DOC-02](tasks/DOC-02.md)：GLM文档清理复核与Mimosa基线诊断。
- [DIAG-01](tasks/DIAG-01.md)：诊断工具原件收录、使用边界及启动生命周期分析；朋友具体故障仍待实际报告。
- [SETUP-01](tasks/SETUP-01.md)：用户确认式原生目录选择、校验、保存和受控重启已进入 V1 候选；自动发现与扫描关闭，Windows 真实体验及最终包仍待验收。
- [REC-01](tasks/REC-01.md)／[REC阶段](milestones/REC.md)：默认紧凑录制、可暂停、压缩分享和离线回放，验收状态以卡片为准。
- [START-01](tasks/START-01.md)：历史诊断规划已完成；[原批次计划](../proposals/first-use-batch.md)的纯模块与运行接线均已有候选实现，接续以当前任务、源码提交和对应证据为准，不重复派发旧清单。
- 数据保护：[DATA-01](tasks/DATA-01.md)、[DATA-02](tasks/DATA-02.md)、[DATA-03](tasks/DATA-03.md)、[DATA-04](tasks/DATA-04.md)。
- 后续：[TRAIN-01](tasks/TRAIN-01.md)、[DEV-01](tasks/DEV-01.md)、[UI-01](tasks/UI-01.md)、[REL-LAUNCH-UX-01](tasks/REL-LAUNCH-UX-01.md)、[M4-01](tasks/M4-01.md)、[M5-01](tasks/M5-01.md)、[R2-01](tasks/R2-01.md)。
- [M4-HISTORY-01](tasks/M4-HISTORY-01.md)：结算历史与事实成绩单已进入 V1 集成候选；后续浮窗、记录删除与共享指数比较图按[历史规格](../specs/training/history.md)说明，用户验收单独记录。
- 阶段：[BASE](milestones/BASE.md)、[M3](milestones/M3.md)、[R1](milestones/R1.md)、[M4](milestones/M4.md)、[M5](milestones/M5.md)、[R2](milestones/R2.md)、[DOC](milestones/DOC.md)、[DEV](milestones/DEV.md)。
- v0.4任务：[TRAIN-03](tasks/TRAIN-03.md)、[REC-04](tasks/REC-04.md)、[ORDER-00](tasks/ORDER-00.md)、[ORDER-01](tasks/ORDER-01.md)、[NOTE-01](tasks/NOTE-01.md)、[V4-01](tasks/V4-01.md)；阶段：[V4](milestones/V4.md)。

本轮用户返修：[ACCEPT-01](tasks/ACCEPT-01.md)、[DRAW-02](tasks/DRAW-02.md)、[REC-02](tasks/REC-02.md)、[REC-03](tasks/REC-03.md)。

## 卡片格式

首个json代码块为结构化元信息，后面只写必要验收条件和接续信息。任务含id/title/owner/state/milestone/summary/next_action/allowed_paths/depends_on/docs_impact/verification_refs/integration_ref/acceptance_ref；阶段用task_ids关联任务。

state 取 planned、active、blocked、review、closed 或 cancelled，表示工作流位置，不等于用户验收。当前结论由统一状态文件持有，卡片兼容字段须与其对账；verification_refs 记录证据来源，acceptance_ref 指向用户决定，integration_ref 记录已核实提交。对账后运行 docs:status，再 docs:check。

复制相近任务卡后改ID、范围、基础和验收要求；不要复制他人的通过证据。无影响正文也要有docs_impact.reason；有影响时列确实要更新的现行正文。owner代表职责，不代表文件访问权限。

- [ACCEPT-E2E](tasks/ACCEPT-E2E.md)：本轮交互变化的既有浏览器回归适配。

- [MON-02](tasks/MON-02.md): current versus superseded dashboard attempts.
- [GLM-MONITOR-02](tasks/GLM-MONITOR-02.md)：原生用量、官方额度与会话信息，已安装并完成工程验收；ORCH保持关闭。
