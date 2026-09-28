# TRAIN-02 训练范围预览、创建复核与兼容接线合同

本任务从`af0efafc48ce24e247f3c273b1ee4926be8765c5`开始。主工作区已有未提交改动，当前只在`task/TRAIN-02-integration`隔离工作树工作；不push、不合入main、不改个人训练库/TDX。RANGE-01纯规划器已是权威实现，禁止重写或采用另一个未合入候选模块。

## 产品结果

用户选择股票和范围后，服务端先给出日期元信息预览；创建时重新读取同一日线快照并复核预览版本，数据发生变化就要求重新预览。预览只返回请求/实际起止日、根数、模式、数据版本和notes，不返回未来OHLC、收益或账户结果。旧tier请求、旧训练和v1/v2录像保持兼容；新范围必须通过明确版本/模式字段，不能伪装成3M/五档tier。

## 冻结接口（实现前不得自行改变）

新增`POST /api/training-ranges/preview`，请求：

```json
{"code":"600519","market":"sh","range":{"mode":"preset|latest|bars","startDate":"YYYY-MM-DD","months":1|3|6|12|24,"count":1},"adjustMode":"forward|raw"}
```

服务器以Asia/Shanghai当前完整数据日期作为today；读取目标股票日线与权息基准一次，生成`sourceFingerprint`（同一稳定字节快照派生的指纹）和`previewId`。响应成功：`{preview:{version:1,code,market,request,requestedStart,requestedEnd,startDate,endDate,barCount,notes,sourceFingerprint,expiresAt}}`；失败复用RANGE-01错误码及中文原因，HTTP业务错误沿现有约定返回。不得把请求终点偷偷向后移动；unknown覆盖返回UNCONFIRMED_COVERAGE。

现有`POST /api/trainings`保留旧body `{tier,code,start_date,...}`语义。新body另用`range:{mode,...}`和`previewId`，不能同时传tier；服务端重新读取/计算并要求previewId、sourceFingerprint、请求、adjustMode完全匹配，过期/版本或字节指纹变化返回409 `RANGE_PREVIEW_STALE`，提示重新预览。创建成功把范围元数据冻结到训练记录：`range_version=1`、`range_mode`、`requested_start`、`requested_end`、`range_start`、`range_end`、`range_bar_count`、`range_source_fingerprint`、`range_notes`；旧记录迁移默认`range_version=0`,`range_mode='tier'`，旧API响应继续返回tier字段。

训练查询响应增加可选`range`对象；旧客户端忽略它。引擎创建时新模式按已复核的实际`range_start/range_end`冻结计划终点和初始日，不再套用`TIER_MONTHS`；旧tier路径完全保留。`advanceTraining`、T+1、权息、未来数据截断和结算规则不改。

录制合同：旧v1/v2文件继续按旧tier校验；新训练录制`training.range`的version/mode/requested/actual/preview fingerprint。旧阅读器遇到不支持version给可理解“不支持此训练范围版本”，不得把它解析成3M。`Training.vue`训练区间标签读取range实际值，不能只显示旧tier。

## 责任与文件

第一片只做服务端预览/创建复核及兼容迁移：独占`server/src/api.ts`、`server/src/db.ts`、`server/src/train/engine.ts`、`server/src/train/range.ts`仅允许补导出适配（不得重写）、`server/test/**`。共享`web/src/api.ts`暂由后续集成人串行接线；禁止本片改`web/src/recording/**`、Launcher或Training UI，以免和DATA-05/API冲突。第二片再做前端表单、预览版本守卫和录制schema，需拿到第一片稳定响应后单独派发。

数据库迁移必须沿`db.ts`兼容增列，不重建表、不清理旧训练。数据读取需用同一快照字节产生元信息和指纹；禁止分别读文件后声称一致。测试只用临时TRAINER_DB/合成day文件，不读取个人库或TDX目录。

## 验收与升级条件

先写红测：预览返回元信息且不泄露OHLC；创建复核同一指纹成功；字节/请求/adjustMode/过期不匹配均409；旧tier创建/查询/推进回归；RANGE错误码不变；DB迁移保留旧行。随后运行`npm test -- server/test/train-range.test.ts server/test/train-engine.test.ts <new tests> --maxWorkers=2`、`npm run build:server`。

出现公共API、schema、录制版本、并发/文件快照语义或旧客户端兼容的新事实，停止扩大实现并请求强模型重规划。返回短JSON：commit、changed_files、facts、tests/exit_codes、unexpected_findings、needs_replan。不要返回长思考或完整源码。
