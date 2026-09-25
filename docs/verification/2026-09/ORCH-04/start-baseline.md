# ORCH-04 开工与基线

2026-09-25，用户已验收ORCH-03并要求继续。验收记录提交a3b140c；ORCH-04计划提交166664c8d2572dcba7d03cad246b7f2906168761。

GLM plan模式侦查ORCH-04-SCOUT-20260925已完成。17条事实中14条文件散列由控制者核对；另3条未绑定事实保留为线索，不冒充验证。侦查时“依赖未安装”的观察已由随后控制者npm ci更新；没有让它执行安装或源码改动。plan模式拒绝过一条复合shell命令，分开的只读命令成功；此模式不等于OS只读沙盒。

隔离工作树ORCH-04-review在Node24.15.0安装196个锁定依赖后，独立运行 `npm test -- server/test/worktree-tools.test.ts server/test/verification.test.ts --maxWorkers=2`：退出0，38/38通过，耗时160.54秒。原始输出在控制层ORCH-04-baseline-gates.log。此结果是改动前的候选门禁基线，不是ORCH-04新功能完成。

计划先固定质量约束及对照场景，见[分类审查计划](../../../engineering/classified-review.md)。两个GLM实现批次使用分开的工作树：GATES负责TS分类门禁及回归，METRICS负责Python离线计量；均保持max/1M目标，Mimosa按用户要求关闭。当前尚未收到实现交付。

[observed-run.json](observed-run.json)由已核验的ORCH-03实际记录生成：包含全部3次尝试和两次GLM provider计数；强模型及完整时长未知，没有匹配baseline。它只用于检查工具诚实报告缺失，不能作为成本节省结论。可比较的合成反例另由测试固定，不伪装成实际模型实验。
