# controller_state 使用说明

`controller_state.TaskStore` 是 ORCH-03 控制器的持久状态模块：任务合同注册、append-only 事件历史、跨进程执行租约，全部保存在调用方提供的控制目录下的 `controller_state.sqlite3`（SQLite，WAL + synchronous=FULL）。schema 由本模块独有；校验和首次建表在同一个写事务内完成，并发打开者等待完整提交。已提交的残缺 schema、外来表、列定义或主键约束不符、非 SQLite 文件及损坏库均拒绝，不自动补表或接管。

## 冻结接口

```python
from pathlib import Path
from controller_state import TaskStore

store = TaskStore(Path("control-dir"))   # 目录不存在则创建；损坏库/外来库抛 TaskStoreError
store.register("TASK-1", registration)   # dict -> dict；完全相同幂等返回原件，不同注册抛 ConflictError
store.get("TASK-1")                      # -> {"registration", "events", "lease"}；未知任务抛 UnknownTaskError
store.append_event("TASK-1", event)      # 新事件 True；同ID同内容 False；同ID异内容抛 ConflictError
store.acquire("TASK-1", owner_token)     # 拿到/已持有 True；被拒 False；原子
store.release("TASK-1", owner_token)     # 错误 token 抛 ConflictError；无租约时幂等
store.close()
```

所有错误类型都是 `ValueError` 子类（`TaskStoreError` / `UnknownTaskError` / `ConflictError`）。

## 语义约定

- **registration**：必须含 `repo`（绝对路径）、`semantic_scopes`（非空字符串数组）、`contract_sha256`、`policy_sha256`（64 hex）、`base_commit`（40–64 hex）；额外字段允许但参与相等比较。按排序键的紧凑 JSON 规范化保存，键序不影响幂等。
- **event**：`event_id` 非空、`kind` 取 `routing.EVENTS`；`failure` / `repair_failed` 必须带非空 `failure_fingerprint`。无删除、无改写接口；计数一律由事件行推导，不存在可被布尔污染的存储计数。
- **lease**：永久记录，无 TTL、不按时间/PID 自动抢占，进程崩溃后重开仍在，只有持正确 token 的调用方能 `release` 或幂等重入。`acquire` 在 `BEGIN IMMEDIATE` 事务内拒绝：同 task 其他 token、同 repo 的其他任务、`semantic_scopes` 精确字符串相交的其他任务。repo 归一：已存在的路径由文件系统 final path 解析（`\\?\` 扩展前缀、大小写、8.3 短名、junction 等重解析点全部折叠），物理同目录的任何别名都视为同一 worktree，只能有一个 owner；不存在的路径保持文本归一（normpath + 长名 + normcase）。
- **token**：调用方随机生成（如 `secrets.token_hex(16)`）；非空、≤256 字符、纯数字视为裸 PID 拒绝。
- **task_id**：`[A-Za-z0-9][A-Za-z0-9._-]{0,127}`，杜绝路径遍历形态。

## 边界

- 本模块不含控制器主循环、CLI、runner、验证或收据逻辑；租约处置（含崩溃后遗留租约）是控制层的显式动作。
- 多进程安全依赖 SQLite 文件锁（busy timeout 30s）；同目录同时打开请勿跨主机共享网络盘。
- 测试：`test_controller_state.py`，真实 SQLite + 真实子进程竞争（含物理别名占用与并发首启回归），无 mock。运行：
  `C:/Windows/py.exe -3.9 -B -m unittest discover -s scripts/agent-routing -p test_controller_state.py -q`
