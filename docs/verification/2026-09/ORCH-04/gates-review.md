# ORCH-04 分类门禁首轮审查

2026-09-25，GATES批次35分钟总时限退出，原failed状态保留。实现和测试已留下，尚未提交。原始会话sess_69e46e3f-4e4f-485a-9a06-60de7ad4295e的工具记录：68调用中66正常结果、1读取不存在文件失败、1测试未结束；review-profile13项GREEN，worktree-tools最后完整结果24通过/1失败。日志里没有Mimosa或其他门禁拒绝；python3不可用是其他插件hook错误，不能当作提交阻断。

控制者独立运行 `npm test -- server/test/review-profile.test.ts server/test/worktree-tools.test.ts server/test/verification.test.ts --maxWorkers=2`：退出1，56项中55通过、1失败，耗时240.26秒。失败为既有精确绑定检查：坏proof意外promote了临时夹具。完整输出在控制层ORCH-04-gates-independent.log，未推进真实main。

## 已复现反例

1. assertProof拆分版本分支后遗漏原有runManifest归属检查。v1/v2两种证明引用不存在的.runs/missing.json或候选根外侧outside.json均被接受。外部最小探针4项结果均accepted=true，违反旧格式兼容和证据所有权。
2. Windows工作区docs目录被移到临时仓库外并以junction接回后，git status为空，但仍得到docs-only。提交mode不能证明运行时路径没有联接；存活变更文件及父链必须检查，删除路径继续按树验证。
3. v2应显式要求producer给出的cleanBefore/cleanAfter均true，并在签发前复核分类状态；新schema不应承接旧格式省略字段的兼容例外。

代码范围保持原切片。GATES-REPAIR1已获得针对上述反例、旧失败和真实producer覆盖的修复合同，25分钟、GLM max/1M不变。先跑小范围RED/GREEN，再完整定向套件一次；不原样加时重跑，不删除旧测试，不扩大到Python验证核心。旧源码快照和探针在控制层ORCH-04-gates-before-repair1及ORCH-04-proof-manifest-probe.mts。

METRICS-REPAIR1在另一个工作树独立运行；两个切片尚未集成或同步未验收代码到main。根代理文档改动保留为控制层所有。
