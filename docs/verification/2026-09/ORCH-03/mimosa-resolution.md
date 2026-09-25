# ORCH-03 Mimosa拦截与用户授权处置

2026-09-25，用户明确要求关闭Mimosa并继续验收。

真实试点首轮job-f7eedb6481ad4e4dba4e75a287812efc已完成执行，但未提交。Mimosa在Z code PreToolUse阶段拦下含git add/commit的调用，报告14个高危、2个中危；候选仓库没有独立pre-commit钩子。worker交接列出扫描涉及允许范围外的现有测试/工具代码，这里只记录扫描器结论，不把它当作已确认漏洞或已修复。控制器正确停在waiting_control，没有签发通过收据。

独立核对：候选只改示例JSON的_readme，HEAD仍是固定基线。拦截后没有重试提交或修改候选工作树；交接报告及两份Zcode项目memory仍被写入。工具调用对和原始拒绝保存在控制层orch03-pilot1-log-review，未删除历史。

按用户授权，将Z code CLI用户配置的plugins.enabledPlugins["mimosa@zcode-plugins-official"]从true改为false，写前备份、写后重读，确认其他设置未变。原件及审计在控制层mimosa-disabled-20260925。未使用git --no-verify、未更改独立verifier/policy、未修改产品数据库。后续新CLI会话仍需核对未加载Mimosa。

为继续同一逻辑任务，新增显式resume入口：需要allow、核实HEAD、处置原因；无活跃租约，上一轮job/attempt/outcome对应且cleanup_confirmed=true；重新验证固定输入、干净提交与scope后追加replan检查点。保留首次execution_started及全部预算，向worker传达已核实处置。不能用它抢占未知进程、跳过脏工作区或重置次数。

新增3项测试先因无resume方法失败，再通过；补充处置事实必须进入下一轮prompt的断言先失败再通过。完整206项回归进行中，结果以后续实际记录为准。计划保存首轮未提交候选字节/差异，恢复精确基线后通过resume继续第2次尝试；由GLM正常提交，再由控制器自动验收。尚未宣称真实试点成功。
