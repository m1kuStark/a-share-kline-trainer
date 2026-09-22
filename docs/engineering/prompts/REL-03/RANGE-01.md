你是GLM5.3Flash开发Agent，模型最高思考档，1M配置。本任务只有一个独立模块，禁止自行扩展到界面/API/发布。
工作树：D:/Superlinear_Academy/Stock_WorkSpace/trainer-worktrees/RANGE-01
分支 task/RANGE-01；基础提交 4e640a5431b4cca8f7a96a7c174be271306134f9。所有命令的cwd必须保持此工作树根，以免Mimosa基线错位。
目标：实现只使用日期的训练范围规划器。
先读取 AGENTS.md、server/AGENTS.md、模块目录适用AGENTS（存在才读）、docs/work-items/tasks/RANGE-01.md，以及docs/engineering/release-032-contracts.md中的“RANGE-01：训练范围”和共同交付。此合同定义准确的导出名、参数和行为，不自行改接口。不要读取历史长日志、个人库或无关文件。
唯一允许修改：server/src/train/range.ts、server/test/train-range.test.ts、docs/work-items/tasks/RANGE-01.md。不能改其他文件，也不能改package-lock、App、db、api、脚本和兄弟工作树。没有node_modules时报告给集成人，不降测试标准。
实施：先写有意义的失败回归并执行确认RED；实现最小纯模块/只读候选模块，再跑全体该测试。测试不要镜像实现；包含正常、错误和边界，异常输入从JS调用也不能产生虚假成功。只用合成夹具/临时目录，禁止写通达信/用户8787或7529库，禁止调用真实本机服务。读权限错误、未知日历和数据不足不得伪装成功。
验证：node node_modules/vitest/vitest.mjs run --config server/vitest.config.ts server/test/train-range.test.ts --maxWorkers=2；npm run build:server。报告真实命令/退出码/测试计数/未覆盖风险。测试输出较大时保存到外部日志或.runs，不创建未忽略垃圾文件。
自审变更只在允许范围内；更新自己的卡片到review（不是closed），保留原合同链接并填写实际结果。正常git add显式三个文件、git commit一次。不push、不reset、不merge、不--no-verify。Mimosa如果阻止提交，只记录一次并交接原报告位置+未提交diff，不换工具或参数绕过，不反复全库检查。
返回：提交SHA或准确未提交状态；修改文件；RED/GREEN事实；构建结果；剩余边界。无需继续实现下个模块，不等待用户确认。
