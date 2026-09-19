# GLM任务 REC-CONTEXT

仅在当前独立worktree修改 server/src/recording-context.ts、server/test/recording-context.test.ts、server/src/docs/recording-context.md。先读根AGENTS、server/AGENTS、server/src/train/AGENTS及训练账户文档。不要提交、merge、push，不启动服务或浏览器，不操作个人DB/真实TDX。不修改api.ts/db.ts，集成Agent接线。

实现 export async function registerRecordingContextRoutes(app:FastifyInstance, config:AppConfig, database:DatabaseSync):Promise<void>。注册 GET /api/trainings/:id/recording-context。用于录制文件保存实际观察到的规则、版本和已发生权息。

返回 {app:{version:string,gitCommit:string,dirty:boolean,chartLibrary:'10.0.3'},rules:{feesEnabled:boolean,tPlusOne:boolean,lotSize:100,commissionRate:0.00025,minimumCommission:5,stampDutyRate:0.0005,execution:'same-day-raw-close',weightBasis:'total-equity',adjustMode:string,observedAt:string},positionEvents:Array<...>}。version读package.json、git SHA及dirty可在注册时一次读取（execFileSync参数数组、安全、无用户输入，失败unknown），不要把本机路径/环境/密钥返回。训练id必须正整数，不存在404；遵循已存在错误响应及中文。读取trainings记录的current_date??start_date为截止，position_events限定training_id及date<=截止，稳定date/seq排序。rules从settings当前实际值读取，具体键值对照engine.ts读取函数；不要假称冻结创建时规则。不访问任何TDX文件、/api/kline，不返回未来数据，不更改任何数据库行。

写真实临时SQLite/Fastify.inject测试：错误ID、不存在、实际设置、截止过滤（人为种未来事件）、响应无绝对路径、读前后数据库行未变化。先失败再实现。运行 npm test -- server/test/recording-context.test.ts 和 npm run build:server。记录运行结果在模块文档，说明只读观察规则非冻结规则。

工作很小，不做额外重构，不加依赖。返回文件清单、测试退出码、接线方式和剩余边界。终端Git Bash，路径用/。无需询问权限，用户已授权本范围。
