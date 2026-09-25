# 独立验证器 v1

状态：ORCH-02实施合同，2026-09-24。先独立执行和核验，再将状态提供给影子路由；不替换既有candidate-proof或自动合入。

## 信任与入口

控制器代码、contract、policy及收据store均在候选仓库之外。启动verify时传入已固定的contract/policy SHA256与expected_commit，不能从worker报告接受测试命令或通过结论。候选必须干净，base_commit须为HEAD祖先。输出为store下独占run目录及HMAC认证的receipt；密钥不给worker。

同一OS用户可以读取其他进程文件，本机制是工作流隔离，不声称抵抗任意读取密钥或越权写磁盘的同用户恶意进程。自动执行的OS沙盒在ORCH-03验证；只运行控制者批准的命令。

## Policy

schema_version=1、policy_id、revision，executables为名称到仓库外绝对可执行文件的映射。profiles按id登记非空checks，每项id/executable/args/timeout_seconds；始终参数数组shell=false，不执行报告里的命令。

protected_paths为基线测试/配置/验证脚本的glob；已存在文件修改或删除会blocked。新增测试仅在allow_added_tests匹配且不覆盖基线时允许；其余改动需approved_protected_files按实际文件SHA256批准。批准类别不等于批准任意测试降级。实际检查策略与profile均绑定hash，worker不能修改profile或自己传“跳过检查”。

## 执行与证明

1. 对全部Git跟踪文件计算相对路径、类型、字节SHA256；拒绝符号链接、联接、submodule和缺失文件。锁定HEAD/tree/source_digest，fixture在同一快照中；未跟踪未忽略文件使候选不干净。
2. 核对task allowed_paths及protected_paths。读取后再次检查版本，变化则阻断。清理后的独立环境显式指定TRAINER_DB、隔离运行目录、OPEN_BROWSER=0；不继承个人TDX_ROOT或模型凭据，不把用户库当夹具。
3. 顺序执行受控checks。stdout/stderr写完整日志；非零、启动失败、超时均保留。超时回收本次进程组/树，有界等待；无法确认回收则不通过。
4. 再次核对候选指纹及配置散列。报告记录每项命令/退出码/日志SHA256、失败类别与指纹；全部检查成功且未漂移才passed。任何机器结果都不能替代语义或UI审查。
5. receipt认证整个report。读取证明时重新核对task/contract/policy/profile、commit/tree/source_digest、verifier版本和日志文件SHA256；缺文件、篡改或重放拒绝。verify接口不发合入许可。

失败指纹按check身份、错误类别与归一化错误摘要生成；原始日志完整保留，环境失败不伪装为业务断言失败。后续持久重试控制由ORCH-03承担。

## 本轮文件所有权

GLM只写receipts.py/test_receipts.py；主代理负责verification.py、verify.py及路由接线、合同和报告。先失败回归再实现；各自临时仓库和store不共享，不碰个人库。GLM输出短事实/测试/风险报告，主代理只围绕diff和具体风险复核。

## 验收

真实临时Git仓库覆盖通过、检查非零、伪造passed、缺日志/篡改日志、旧commit/tree、脏候选、执行中源码变化、修改/删除既有测试、追加测试、policy或contract散列变化、命令超时、同run覆盖与链接逃逸。旧路由28项回归保留。现有Git合入闸门和产品测试不因本工具通过而被豁免。

