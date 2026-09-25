# ORCH-03 LOOP 超时与范围修正

2026-09-25，控制器基础提交3146524。批次ORCH-03-LOOP-20260925在40分钟总时限退出，五个Python实现/测试文件留在工作树，未提交。runner failed及原日志保留；没有原样加时重跑。

## 原始证据

会话sess_00436df0-e54a-48cb-9c8d-2aebd2b30549。工具日志52调用：49正常结果、1 Edit失败、1 Mimosa阻断、1全套测试未完成。01:02:28 loop20项GREEN；01:02:38启动全套，最后01:02:55仍运行，不能据此声称全套通过。Mimosa拒绝sed写源码后worker改用Edit，仍违反任务“拒绝即停”，完整调用/结果对在仓库外orch03-loop-log-review，未传递模型推理。

控制者独立执行 `C:/Windows/py.exe -3.9 -B -m unittest discover -s scripts/agent-routing -p test_controller*.py -q`：退出0，66项通过（状态37、loop20、runner9）。独立审查随后复现关键缺口，说明原测试覆盖不足。

## 反例及接管

- 第二CLI读取磁盘owner_token，能取得第一进程尚未派发前的同一租约，执行并释放它。
- assessment=continuous_judgment仍被验收为verified；完成报告未完整进入事实与风险路由。
- 已验证后改变runner配置，status/run仍输出verified；runner本体字节也未固定。
- 登记后出现未提交工作仍会派发worker，并可被覆盖后验收。
- 丢失progress但execution_started存在时继续派发；无法确认子进程回收时仍释放租约；recover接口没有进程身份核实就释放锁。
- 签名异常错误地计入环境重试；修复中变换原因后，相同新原因的两次repair未按语义累计。
- worker报告提示缺schema_version、真实base_commit和合法枚举；没有产出controller_usage说明。

控制循环转GPT Direct。主代理在controller.py/controller_loop.py/test_controller_loop.py范围补RED回归再修复；已记录5项RED→5项GREEN，4项RED→4项GREEN，3项RED→3项GREEN，设计任务空事实反例及attempt原件各1项RED→GREEN。新增登记显式批准散列、runner文件pin，禁止复用持久token及自动recover，未决事件保守交接，证据完整后才能验收。仍需与修复后的runner一起跑整体回归，当前不是最终通过报告。

可独立的runner适配器交GLM：ORCH-03-RUNNER-REPAIR1-20260925，仅controller_runner.py/test_controller_runner.py两个文件；复用已验证进程组回收、报告合同和实际CLI参数。其余文件归主代理，避免互相覆盖。任何Mimosa阻断都必须立即交接。未完成前不试跑真实模型任务。

## 下一步

验收runner修复；运行完整controller测试与既有验证/路由测试；审查崩溃/幂等/pin/认证反例；再运行已准备的真实机械试点，核对认证收据及重复run不增加job/attempt。试点policy原始散列仍为af1ae66525d911c6d001dfaca384b5f8cb7be591c151a83318e24512345f1aa6，重跑oracle为退出1、AssertionError: unimplemented setup guide still advertised（有效RED）。不合并主分支、不推送，不改个人训练库。
