GLM5.3Flash max 开发Agent。本次只修TDX-CHECK-01的三个审查缺口，不接UI/API。

工作树 D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/TDX-CHECK-01，分支task/TDX-CHECK-01，HEAD4e640a5。旧job已completed，保留现有未提交实现。先读AGENTS、server/AGENTS、任务卡与release-032-contracts候选诊断合同。

唯一写范围：server/src/tdx/inspect.ts、server/test/tdx-inspect.test.ts、docs/work-items/tasks/TDX-CHECK-01.md。

1. 代码称逐段不跟随junction，但只lstat末段。根路径祖先、T0002、vipdoc/sh(sz/bj)中间层未检查，可以穿过junction读取外部目录。访问前校验全段；补真实临时junction回归（根、根祖先、T0002、vipdoc/sh），证明不读取/统计外部目标中的合成有效日线、权息、名称。不要跟随目标再称它可用。
2. readable始终true、scan.sawFileError未使用；hasNames只看lstat非空，未证明能读取。对EACCES/EPERM等失败明确problems与readable=false；名称用固定少量实际只读验证。缺失与权限错误分开，保留已成功检测的字段。补受控EACCES回归。
3. .day文件名前缀必须匹配所在市场目录，sh目录中的sz600000.day不得计数。补反例。

先加失败回归再修最小实现。保留原21测试；运行node node_modules/vitest/vitest.mjs run --config server/vitest.config.ts server/test/tdx-inspect.test.ts --maxWorkers=2，以及npm run build:server。仅合成临时目录，不读个人库/TDX，不调用8787/7529。

Mimosa旧security-scans报告不是本次18告警原文，勿猜路径。当前.mimosa/reports/task-review会话报告是complete/2files/0findings差异扫描，非运行验收。本次提交动作由集成人负责，不再重复尝试同一commit门禁；不绕过。卡片保持review，verification_refs只放真实相对路径，不填命令文字。

返回修改文件、真实RED/GREEN/构建结果、剩余TOCTOU或权限边界即可，不扩大范围。
