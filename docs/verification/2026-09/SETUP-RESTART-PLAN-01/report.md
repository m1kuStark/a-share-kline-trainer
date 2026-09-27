# SETUP-RESTART-PLAN-01 控制层验收（2026-09-27）

结论：采纳纯计划模块，工作流关闭；尚未交付真实重启、首次接入界面或用户阶段验收。源候选 `c639507157c3f90e9785cefd5e78a3ccd9a2887e` 已接入隔离候选 `05b063d4c3cc3d34b8d9e14529c370eda02729fc`。main产品代码未合入、未push。

## 证据

- GLM独立复核事件 `setup-restart-plan-01-independent-review-complete-20260927-29`，回复 `control-handoff-20260927-28`；提交、四文件diff、源码SHA256及Git blob已由GPT重新核对。
- GPT复跑GLM自写14场景探针：14/14，exit0，源码SHA256 `d7a6354278d21c9bc7107f6183c7547b2db9f7b7421bad403cc69a6f0c61502c`（源工作树准确字节）。场景覆盖保存认领、跨轮目标/期限、时间倒流/溢出、退出未知、spawn归属、单次回执、独立健康预算、恢复与终态。
- 隔离集成候选复跑6个定向测试文件123/123，exit0；build:server exit0。测试与源分支代码Git blob相同；工作树换行差异不混称相同原始字节。命令/范围/当前指纹见[result.json](result.json)。
- 集成后的报告/任务状态更新仅属文档，单独通过docs门禁；不把后续文档提交冒称为先前被测SHA。

完整证据在本机全局缓存 `accept-20260927/restart-direct-28/`（含RED、中途失败、123项GREEN及元数据）、其下`glm-independent-28/`（独立六门禁＋14探针），以及`restart-accept-30/`（本次探针、集成单测与构建）。旧首次全量失败仍unknown、两次未保存全量日志不恢复数字。

## 根因与收敛

两次GLM返修仍未固定跨轮身份/期限、遗漏部分等待和迟到结果，按FM-008预算转GPT Direct。13项新回归均先观察到RED；context固定计划、six-stage时限、save/spawn认领、spawn runId/PID回执绑定和独立health阶段后通过。GLM随后独立复核，无阻断。失败账本保留完整历史，未以最终GREEN覆盖。

## 后续边界

Windows跨进程SIGTERM不是Node优雅退出入口；本模块的信号动作是抽象计划，后续执行器必须做平台适配。选择受保护HTTP prepare/cancel/shutdown通道与一次性启动器助手，保留现有detached服务模式。正常切源不自动强杀；应急强制退出仍属独立显式操作。

spawn回执的独立PID来源是启动器持有的ChildProcess.pid；ready.json和health都是服务自报，应与该PID/预定runId交叉验证，不能互相自证。准备退出还需跟踪在途API及脱离HTTP的后台刷新，不能用app.close或请求计数替代真实无写入证明。下一片SETUP-DRAIN-01落实服务端通道，完整重启/UI及主干合入留待后续验收。
