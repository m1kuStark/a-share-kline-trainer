# REC-V2-VALIDATION 精确审查修正

GLM5.3Flash最高档。工作树REC-VALIDATE-V2，基础e4858c6。只改compactValidation.ts、对应测试和compact-validation.md。不要改codec/types/validation.ts共享helper（文件Agent依赖）、包/页面/Git/其他工作树/个人数据。读局部规则。

现83/83测试绿但独立探针4项都错误接受（探针全局cache/rec-v2-validator-probes.ts可读，只作理解，正式回归归你测试）：
1. base.firstCheckpoint=1，derived.firstCheckpoint=0，checkpoint0引用derived，asOf=null → validator通过并读取未来基础。检查base.firstCheckpoint<=derived.firstCheckpoint，恢复/盲状态都不能绕过。
2. chart.timeframe=1D指向series.timeframe=1M，bar date=2026-03 → 当前通过。检查checkpoint周期与series一致。
3. drawings base500+delta新增1个=501，当前只检查单upsert500。按还原ID集合检查总数<=500；替换/删除不可误算新增。
4. series base20000+delta新增1=20001，当前通过。按还原后的数组检查每版本<=20000，保留唯一版本累计500万和存储100万预算。

先新增4失败用例再最小修正，增加replace/remove保持边界通过。不要扩大任务、不要重构整validator或改变公开接口。不把第3项当压缩策略，恢复集合资源预算属于合同。
npm test -- server/test/recording-compact-validation.test.ts server/test/recording-validation.test.ts --maxWorkers=2；typecheck:web。返回实际结果即停。
