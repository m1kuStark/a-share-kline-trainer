# 统一候选专项

2026-11-18，HEAD为3ec3d730；产品文件与该提交一致，第二轮新增测试源码SHA256为a1970bc9113aee90b8837f92cb0376a22d4ddfa84f6d5d1da6712b56ebcc38a9。以下原生日志和收据同时保存，不拼接为完整候选通过。

| 命令 | 原生退出码 | 结果 |
|---|---|---|
| npm ci | 0 | 按当前lock安装 |
| npm run build | 0 | 类型、server、生产web构建 |
| npm run journey -- e2e/formula-enable.spec.ts --retries=0 | 0 | run-72f9e20f，原五项全部通过 |
| 同命令，补自定义主图及失败刷新覆盖 | 0 | run-277d3278，新一轮六项全部通过 |
| npx --no-install vitest run --config server/vitest.config.ts server/test/formula-seed.test.ts server/test/formulas/formula-storage.test.ts server/test/formula-library-api.test.ts | 0 | 3文件13项通过 |
| check-binding.mjs --repo 绝对M9路径 --matrix formula-ui.yaml --strict --include-untracked | 0 | 8 covered、0 open、0 RED |

具体参数、数据源、日志SHA256与即时LASTEXITCODE见对应receipt.json；日志raw.b64保留原字节。单测移除真实TRAINER_CONTROL_ROOT，产品旅程使用独立数据库、端口及浏览器存储；冻结样本来自此前run-6698a681的只读快照，真实公式语料路径显式保留。

主代理读取实际断言并结合[独立静态L2复核](../review/formula-ui-l2-static.md)：自定义main/sub均由真实设置保存，启用、刷新及停用与真实GET及图表位置一致；三内置分别4/3/3输出且有有效数值；seed空库断言默认关闭并保留用户开启后的重复初始化；HTTP拒绝后错误可见、旧成功提示消失、刷新恢复实际已保存的开启状态。失败用例只模拟HTTP拒绝，不声称数据库事务故障已覆盖。

语义变异抽检为纸面推演：撤回enabled请求将使自定义用例的POST false／后续GET断言失败；恢复内置name/source字段将触发服务403并使200及payload禁字段断言失败；撤去清旧成功提示将使失败用例的成功节点计数0断言失败。原始首轮RED已实际出现这些失败；本轮没有另执行UI源码变异。独立EMA修复的实际数值变异仍见其专属证据，不混为本轮运行。

矩阵状态由root单写者提升，仅代表上述专项L1/L2及运行事实。完整候选、主代理视觉、生产包和用户验收分别记录。
