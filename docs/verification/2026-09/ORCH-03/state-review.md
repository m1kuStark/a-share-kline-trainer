# ORCH-03 状态模块独立审查

2026-09-24；Windows / Python 3.9；候选工作树 task/ORCH-03-controller，基础提交 2d1d5d9e7f27eddc9341a549cf7cbda5f68c4d08。GLM 交付批次 ORCH-03-STATE-20260924 已正常退出，尚未提交。以下结论针对修复前字节，不代表后续版本。

## 独立检查结果

- `C:/Windows/py.exe -3.9 -B -m unittest discover -s scripts/agent-routing -p test_controller_state.py -q`：退出码 0，29 项通过，无跳过。使用临时目录和 SQLite，不使用产品数据库。
- 定向探针：控制层运行 `deterministic_counterexamples.py`，退出码 0；该脚本输出观测事实，退出 0 不表示被测模块通过。审查者首次运行和主代理复跑均得到下述两项反例。
- 可变输入/返回值的普通嵌套修改未改变持久登记或事件。

## 未通过项

1. P1：同一目录普通路径和 Windows 扩展路径满足 `os.path.samefile=True`，却得到不同归一字符串。不同 task、不同 scopes 的 `acquire` 均为 true，允许同一工作树重复占用。
2. P2：首次创建 schema 不是一个原子事务。真实 SQLite trace callback 仅用于调度屏障：在第二条 CREATE 前暂停创建者，第二进程打开同一状态库，报 `TaskStoreError: ... lacks TaskStore schema (tables: ['registrations'])`；恢复后创建者正常完成。未修改生产代码或 SQLite 返回值。普通 12×12 进程压力探针未撞中，受控交错能稳定复现。

审查结论为 changes_requested；已有 29 项通过不能替代上述边界。修复批次 ORCH-03-STATE-REPAIR1-20260924 只获准修改状态模块、对应测试及说明，冻结 API 不变；先加入失败回归，再修复并独立复验。本模块通过后再继续 runner/verifier 闭环与真实机械试点，ORCH-03 仍为 active。

## 原件与指纹

探针及 JSON 输出：`$CODEX_HOME/headroom-cache/orch03-state-independent-review/`。修复前源码备份：`$CODEX_HOME/headroom-cache/ORCH-03-state-before-repair1/`。完整 GLM 日志及监视记录留在仓库外；原批次的 followupId 链接修复批次。

| 文件 | 修复前 SHA256 |
|---|---|
| controller_state.py | 172c0cf3f5b8b005c6ba626af87beecc55d9118882a6a7decf7dc49a2587dab8 |
| test_controller_state.py | 509c3709295bc1af2ad9c4dfdce61de0a6b4901621968bfe38a0fe15521ba4e0 |
| controller_state.md | f1537bdd23fbe2c6ccd7f895edaf3b3dcd01a6697678f3eac65f1e67fde4b90d |
