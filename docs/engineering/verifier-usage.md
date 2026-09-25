# 独立验证器的调用

控制者先固定contract与policy的SHA256，把它们放在候选仓库外；验证工具本身也从控制目录运行。store独立于候选，保存密钥、完整日志、来源清单和认证收据。不要将store提交或导出。首版只供本机受信用户使用，不替代OS沙盒。

## Policy形状

schema_version=1，policy_id/revision标识策略版本。executables把python/node等名称映射到控制者确认的绝对可执行文件路径；profiles按合同verification_profile选择checks，每个check有id、executable、args数组、timeout_seconds。既有npm命令在Windows通过node与npm-cli.js参数数组调用，不使用shell拼接。

protected_paths覆盖基线测试、测试配置、package scripts与验证脚本。allow_added_tests仅允许新测试路径；旧文件修改/删除默认阻断。已审查的旧文件变化必须逐文件提供approved_protected_files字节SHA256；任何批准都进入policy新散列。引擎不自动批准测试降级。

## 执行与复核

~~~powershell
py -3.9 -B <控制目录>/verify.py run --repo <干净候选> --contract <外部合同> --contract-sha256 <预先固定值> --policy <外部策略> --policy-sha256 <预先固定值> --store <控制层目录> --expected-commit <完整提交>
py -3.9 -B <控制目录>/verify.py inspect --repo <候选> --contract <外部合同> --contract-sha256 <固定值> --policy <外部策略> --policy-sha256 <固定值> --store <相同目录> --receipt <上一命令收据>
~~~

run返回receipt路径、status与failure_fingerprint；passed退出0、failed退出2、blocked退出3、输入错误退出1。inspect核对签名、当前代码及日志，不能只读report.status。HMAC覆盖整个报告，依赖控制key保密；即便通过，can_promote仍为false。

## 结果边界

- 命令非零保留完整stdout/stderr和归一化失败指纹；超时有界回收，只针对本次派生进程。无法确认回收不通过。
- 当前读取全部跟踪文件及实际字节，要求执行前后commit/tree/source_digest一致；fixtures也在快照中。忽略目录不构成可信fixture，验收输入应纳入跟踪或受控配置。
- 检查环境不继承个人TDX_ROOT和模型凭据；TRAINER_DB、PORT及运行目录显式隔离。要跑真实行情门禁，后续profile须另外绑定只读来源，不把缺失来源记成通过。
- 新报告使用independent-verification类别，不冒充现有candidate-proof；当前TS候选合入格式和完整门禁保持兼容。
- 验证成功说明既定检查通过；不能证明任务语义完整、同OS用户绝对隔离或已获得用户功能验收。

内部工具测试用临时Git仓库和短Python命令，不需要npm安装，不写个人训练数据库。设计：[验证器合同](independent-verifier.md)；任务：[ORCH-02](../work-items/tasks/ORCH-02.md)。

## 路由消费

route.py仍是影子决策。附加--receipt、--receipt-store、--policy、--policy-sha256、--contract-sha256后，会调用inspect同一套核验，不能直接读worker的passed。有效失败提供repair_contract和失败指纹；有效通过进入review_by_risk。已触发范围重规划、预算耗尽或GPT Direct的判断不被通过结果覆盖。结果仍can_dispatch=false/can_promote=false，持久重试和自动派发留给ORCH-03。

Git隐去修改的assume-unchanged/skip-worktree会被拒绝，工作文件还须与提交blob逐字节一致；仅允许Git普通LF→CRLF检出转换。Windows检查先挂入Job Object再执行，正常退出也等待计数排空并回收残留；POSIX使用独立进程组。后续检查改写先前日志时，签发前总复核会阻断通过。

