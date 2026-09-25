# ORCH-03 状态模块修复与验收

2026-09-25，Windows / Python 3.9。工作树 task/ORCH-03-controller，基础提交 2d1d5d9e7f27eddc9341a549cf7cbda5f68c4d08；本记录的源码字节散列如下。状态模块完成，不表示 ORCH-03 完整闭环完成。

## 批次及控制层接管

GLM 修复批次 ORCH-03-STATE-REPAIR1-20260924 在 25 分钟总时限退出，runner 的 failed 状态保留。实际已留下三个允许范围文件，未提交。原 worker/runner PID 现场查询均不存在。会话 sess_ae455581-bb41-497b-9c23-8c95625ec3fa；完整日志与压缩工具证据在仓库外。

工具记录显示：00:03:45 RED（36 tests，2 failures、3 errors），00:05:20 开始生产代码 Edit，00:08:15 GREEN（36 tests / OK）。最后可见工具在 00:10:25 结束，未返回完整交付答复；无证据将结束前停顿归因于服务商。另见插件启动 python3 不存在，以及两次 Mimosa 拦截，均保留原始失败，不能把工具阻断算作验收通过。没有原样延长或重派此修复。

主代理独立复跑交付残留：36 tests / OK，随后发现其增加“自动补齐残缺schema”的行为违反冻结合同。按持续判断任务临时转 GPT Direct，仅收紧这一边界：校验与建表共用一个写事务，拒绝已提交的残缺schema，不丢失主键约束检查。未改 TaskStore API、router、verifier 或产品逻辑。

## 独立验证

- 新增两个反例：残缺schema必须拒绝且不补表；相同列名但缺租约主键约束必须拒绝。先运行指定 unittest，退出1、2 failures（ValueError not raised）；修改实现后同命令退出0、2 tests / OK。
- `C:/Windows/py.exe -3.9 -B -m unittest discover -s scripts/agent-routing -p test_*.py -q`：退出0，145项，142通过、3平台/权限跳过，耗时108.505秒。含状态模块37项，保留既有108项。
- 原始独立探针另存为 `$CODEX_HOME/headroom-cache/ORCH-03-state-verified-probe.py` 后运行：退出0；并发打开者和创建者均成功；普通路径与扩展路径 samefile=true、归一相同，first_acquire=true、alias_acquire=false。探针保留旧标签 unexpected_success，含义是原反例现已不成立，非测试失败。
- `git diff --check` 退出0。测试仅用临时目录/Git/SQLite，未使用个人库或通达信数据。

## 交付边界

验收代码已提交至隔离分支 `3146524`（仅四个状态模块/测试/说明/入口文件），主工作区经基线字节比较后同步；未合并主分支或推送。后续批次 `ORCH-03-LOOP-20260925` 已派发GLM实现runner/verifier/CLI，不代表该闭环已交付。

修复日志中的两次Mimosa阻断后，worker仍继续执行，违反合同“拒绝即停”。原错误及后续工具对保留在仓库外 `orch03-state-independent-review/repair1-blocks-and-followups.*`；后续SQL改为字面量重新通过Edit门禁，探针改用受扫描Write，并无关闭门禁证据，但不豁免这次流程违约。下一批已明确任一次阻断就停止并返回交接，控制层不重复派发被拒动作。

GLM负责原始模块和路径/建表修复；主代理负责两项不变量回归和原子校验收紧。冻结API保持。所有权租约跨重启保留，无TTL或裸PID抢锁。下一段 runner/verifier/CLI 仍交GLM实现，需真实机械试点后才能验收整个ORCH-03。

| 文件 | 验收 SHA256 |
|---|---|
| controller_state.py | f3c2780a9692af75d4f0603eb4d30ce32670a2d5e9cb755dc7b29f67a7a56d2a |
| test_controller_state.py | b2a8f7bc29a5340840df1ca6467e83b298b0d743b4d5981b7c2c99d33fb96d5c |
| controller_state.md | f0f63a42fbea0ce340655d82dc6e6b491590873e176724ce77d553a338b2c142 |
