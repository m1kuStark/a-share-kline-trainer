# 脚本入口

| 命令 | 用途/副作用 |
|---|---|
| task -- create/list/prepare/verify/promote/cleanup | [工作副本与候选集成](../docs/engineering/parallel-development.md)，不push、不reset |
| agent:dev | 独立构建预览、数据库和动态端口；Ctrl+C结束服务 |
| journey -- 参数 | 冻结真实样本、独立构建/服务、浏览器与独立证据 |
| build:journey | 仅生成独立journey构建及manifest，不启动服务 |
| verify:baseline | 文档、单测、类型、隔离生产构建、样本M2、完整Journey；不写个人库/生产dist |
| verify:candidate -- --base SHA --task ID | 增加范围影响检查，干净精确提交通过才生成候选证明 |
| docs:check / docs:impact | 链接/任务结构与基础SHA差异检查 |
| docs:status / -- --check | 生成或验证派生状态，禁止手改生成区 |
| verify:m1 / verify:m2 | 既有全量实源核验；可设TRAINER_VERIFY_DIR指定输出目录，默认保留原路径兼容 |

运行结果在`.runs/run-*/artifacts`，manifest记录版本/路径，snapshot.json记录实际样本内容。工具退出后保留诊断；正式证据复制到verification再清理该run。不要盲删运行中的目录，不按端口杀未知进程。完整候选命令保留单测、构建、M2和全量浏览器闸门，M1另按数据变更范围运行。

源码入口：[运行层](runtime.ts)、[Git层](worktree.ts)、[候选验证](verify-candidate.ts)、[文档工具](docs.ts)。配置不覆盖用户全局设置、真实TDX或个人训练数据库。

Z code小任务委派遵循[模型协作规则](../docs/engineering/model-delegation.md)；通过[GLM任务看板与后台派发](agent-monitor/README.md)查看Prompt、最近活动、完成答复和独立复核状态。
