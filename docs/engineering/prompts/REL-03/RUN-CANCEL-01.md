GLM5.3Flash max。本次只处理通用命令取消的挂起路径；不做训练器退出UI，也不改发布启动器。

工作树 D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/RUN-CANCEL-01，分支task/RUN-CANCEL-01，基线9ed2e723c6796d48a376782e2ecb80d022e1fb34。读取AGENTS、任务RUN-CANCEL-01、scripts/runtime/run.ts、相关runtime测试。cwd保持此根。

允许：scripts/runtime/run.ts、可选scripts/runtime/process-stop.ts、server/test/runtime-cancel.test.ts、server/test/runtime-isolation.test.ts、server/test/runtime-shutdown.test.ts、自己的任务卡。其他文件均不改。临时夹具必须隔离，禁止操作个人库、通达信、8787/7529进程或无关进程。

事实：全量基线774/775，一个runNode取消用例15秒超时后EBUSY；单独15/15通过。原始日志未证明当时具体谁持有目录。确定代码缺口：stopChild通用路径无限等待Windows taskkill，runNode丢弃停止Promise，错误不传播，可能无限等close。带runId服务路径已单独覆盖，不能给通用命令随便塞runId以只杀根进程。

先建立最小可重复失败：受控tree-killer停滞/失败，真实启动的Node父子两层进程及无关哨兵，在finally可靠清自己的夹具。断言取消能有界返回、不会无声忽略失败、日志保留、哨兵存活；正常路径证明所属树退出后才能删除目录。

按小步骤修复：单一可等待的取消Promise；tree-killer和close有明确期限；错误和退出阶段写原日志；保留abort原因为cause。首选保持系统tree-kill，不用进程名/端口杀。遇无法证明整树回收，必须明确cleanup incomplete并保留证据，不能只强杀根后报告成功。若完整后备树回收需要新的Windows Job Object框架，停在已验证的有界失败语义并报告缺口，由集成人再拆下一任务；不要一个任务建整套进程管理器。禁止增加Vitest时限、删断言、吞EBUSY、跳过Windows/Linux。

原测试若用固定300ms导致启动竞态，可改为明确收到child alive后触发abort，但须保留15秒上限和真实运行证据。先RED后GREEN，运行三个runtime文件和npm run build:server；报告真实未通过项，不把有界失败冒充树完全回收。若无法安全实现，提供可重复回归和精确阻碍，不用不安全兜底。

自己的卡片状态review，verification_refs写路径；Mimosa提交若拦截一次即保留现场交接，禁止换参数/工具绕过。不得push/merge/reset或写其他worktree。
