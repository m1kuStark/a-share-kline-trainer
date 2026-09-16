# 任务与阶段

当前活动清单由[status](../status.md)生成。单任务路径稳定，状态变化不搬文件；先按ID查卡片，再读相关规格和证据。

- [DOC-01](tasks/DOC-01.md)：本轮文档治理及基线冻结。
- 数据保护：[DATA-01](tasks/DATA-01.md)、[DATA-02](tasks/DATA-02.md)、[DATA-03](tasks/DATA-03.md)、[DATA-04](tasks/DATA-04.md)。
- 后续：[TRAIN-01](tasks/TRAIN-01.md)、[DEV-01](tasks/DEV-01.md)、[UI-01](tasks/UI-01.md)、[M4-01](tasks/M4-01.md)、[M5-01](tasks/M5-01.md)、[R2-01](tasks/R2-01.md)。
- 阶段：[BASE](milestones/BASE.md)、[M3](milestones/M3.md)、[R1](milestones/R1.md)、[M4](milestones/M4.md)、[M5](milestones/M5.md)、[R2](milestones/R2.md)、[DOC](milestones/DOC.md)、[DEV](milestones/DEV.md)。

## 卡片格式

首个json代码块为结构化元信息，后面只写必要验收条件和接续信息。任务含id/title/owner/state/milestone/summary/next_action/allowed_paths/depends_on/docs_impact/verification_refs/integration_ref/acceptance_ref；阶段用task_ids关联任务。

state取planned、active、blocked、review、closed或cancelled，表示工作流位置，不等于用户验收。verification_refs记录事实来源，acceptance_ref单独指向用户决定，integration_ref记录提交。修改后运行docs:status，再docs:check。

复制相近任务卡后改ID、范围、基础和验收要求；不要复制他人的通过证据。无影响正文也要有docs_impact.reason；有影响时列确实要更新的现行正文。owner代表职责，不代表文件访问权限。
