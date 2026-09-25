# 任务与阶段

协作工具入口：[ORCH阶段](milestones/ORCH.md) → [影子路由](tasks/ORCH-01.md)、[独立验证](tasks/ORCH-02.md)、[动态派发](tasks/ORCH-03.md)、[分类审查](tasks/ORCH-04.md)。

v0.3.2执行入口：[REL-03](tasks/REL-03.md)，首批[FRESH-01](tasks/FRESH-01.md)、[TDX-CHECK-01](tasks/TDX-CHECK-01.md)、[RANGE-01](tasks/RANGE-01.md)；基线取消问题见[RUN-CANCEL-01](tasks/RUN-CANCEL-01.md)。

v0.4执行入口：[V4-01](tasks/V4-01.md)，阶段时钟、条件单、成交理由和 B/S 笔记按[V4阶段](milestones/V4.md)的依赖顺序推进；通达信路径隐私与引导接入由[SETUP-01](tasks/SETUP-01.md)接续。

当前活动清单由[status](../status.md)生成。单任务路径稳定，状态变化不搬文件；先按ID查卡片，再读相关规格和证据。

- [DOC-01](tasks/DOC-01.md)：本轮文档治理及基线冻结。
- [DOC-02](tasks/DOC-02.md)：GLM文档清理复核与Mimosa基线诊断。
- [DIAG-01](tasks/DIAG-01.md)：诊断工具原件收录、使用边界及启动生命周期分析；朋友具体故障仍待实际报告。
- [SETUP-01](tasks/SETUP-01.md)：首次接入与通达信自动发现，设计已接受，尚未开发。
- [REC-01](tasks/REC-01.md)／[REC阶段](milestones/REC.md)：默认紧凑录制、可暂停、压缩分享和离线回放，验收状态以卡片为准。
- [START-01](tasks/START-01.md)：本轮诊断规划已完成；[下一批计划](../proposals/first-use-batch.md)中的FRESH-01/TDX-CHECK-01/RANGE-01底层模块与UI-02入口修订已完成，DATA-05/SETUP-01/TRAIN-02/REL-LAUNCH-UX-01运行接线仍待开发。
- 数据保护：[DATA-01](tasks/DATA-01.md)、[DATA-02](tasks/DATA-02.md)、[DATA-03](tasks/DATA-03.md)、[DATA-04](tasks/DATA-04.md)。
- 后续：[TRAIN-01](tasks/TRAIN-01.md)、[DEV-01](tasks/DEV-01.md)、[UI-01](tasks/UI-01.md)、[REL-LAUNCH-UX-01](tasks/REL-LAUNCH-UX-01.md)、[M4-01](tasks/M4-01.md)、[M5-01](tasks/M5-01.md)、[R2-01](tasks/R2-01.md)。
- 阶段：[BASE](milestones/BASE.md)、[M3](milestones/M3.md)、[R1](milestones/R1.md)、[M4](milestones/M4.md)、[M5](milestones/M5.md)、[R2](milestones/R2.md)、[DOC](milestones/DOC.md)、[DEV](milestones/DEV.md)。
- v0.4任务：[TRAIN-03](tasks/TRAIN-03.md)、[REC-04](tasks/REC-04.md)、[ORDER-00](tasks/ORDER-00.md)、[ORDER-01](tasks/ORDER-01.md)、[NOTE-01](tasks/NOTE-01.md)、[V4-01](tasks/V4-01.md)；阶段：[V4](milestones/V4.md)。

本轮用户返修：[ACCEPT-01](tasks/ACCEPT-01.md)、[DRAW-02](tasks/DRAW-02.md)、[REC-02](tasks/REC-02.md)、[REC-03](tasks/REC-03.md)。

## 卡片格式

首个json代码块为结构化元信息，后面只写必要验收条件和接续信息。任务含id/title/owner/state/milestone/summary/next_action/allowed_paths/depends_on/docs_impact/verification_refs/integration_ref/acceptance_ref；阶段用task_ids关联任务。

state取planned、active、blocked、review、closed或cancelled，表示工作流位置，不等于用户验收。verification_refs记录事实来源，acceptance_ref单独指向用户决定，integration_ref记录提交。修改后运行docs:status，再docs:check。

复制相近任务卡后改ID、范围、基础和验收要求；不要复制他人的通过证据。无影响正文也要有docs_impact.reason；有影响时列确实要更新的现行正文。owner代表职责，不代表文件访问权限。

- [ACCEPT-E2E](tasks/ACCEPT-E2E.md)：本轮交互变化的既有浏览器回归适配。

- [MON-02](tasks/MON-02.md): current versus superseded dashboard attempts.
- [GLM-MONITOR-02](tasks/GLM-MONITOR-02.md)：原生用量、官方额度与会话信息，已安装并完成工程验收；ORCH保持关闭。
