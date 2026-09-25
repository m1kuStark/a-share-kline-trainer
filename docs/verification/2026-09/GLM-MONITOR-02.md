# GLM-MONITOR-02 工程验收

2026-09-25，基线`af0efafc48ce24e247f3c273b1ee4926be8765c5`，Windows、Python 3.9、Zcode CLI 0.16.9、Desktop 3.14.3、Edge。源文件留在本地工作树，未提交、未push。ORCH阶段保持关闭；本项属于工具维护。用户验收尚待确认。

交付：CLI原生会话统计、当前委派通道的官方Coding Plan额度、独立桌面活动套餐快照、新建/续接与附件信息。数据不做本地费用或余额估算；原生token为Zcode去重口径，续接会话不重复相加；桌面快照明确不是实时查询。详见[用量口径](../../../scripts/agent-monitor/usage.md)。

## 验证

| 验证 | 结果 |
|---|---|
| `py -3.9 -B -m unittest discover -s scripts/agent-monitor -p test_*.py -q` | 78项通过，exit 0 |
| `node scripts/agent-monitor/test_monitor_ui.cjs` | 13项通过，exit 0；错误/缺失/零值、续接、选中和展开状态、注入文本、窄屏 |
| 真实CLI与官方额度 | 登记会话查询成功；页面token与CLI响应逐值对照；Coding两个窗口使用远端remaining原值 |
| 真实UI | Edge 1440×1000深浅主题、390×844，无横向溢出；任务切换、刷新保留状态、桌面旧快照显式过期 |
| 安装后复验 | 6个运行文件安装并备份，仅重启身份核对通过的看板进程；原地址复用，真实UI复验通过 |
| 文档与任务范围 | docs:check零错误（10条长度建议），docs:status --check通过；隔离工作树docs:impact通过。主工作区全局impact包含先前未提交改动，130项越界，未扩大本任务范围掩盖 |

外部证据保存在本机`$CODEX_HOME/headroom-cache/GLM-MONITOR-02-evidence/`：`integrator-python-final.log`、`integrator-ui/log.txt`、`live-verification.json`、截图、安装文件SHA256清单`install.json`。账户余额和本机路径不提交仓库。未重跑训练器产品构建，改动限定Python/HTML监控工具及文档。

## 失败与修正

- 两路GLM分别实现原生统计/会话元数据和界面。UI首轮夹具回归失败，修复后13项通过。
- Backend首轮20分钟总时限终止，保留代码与未完成验证。后续使用原会话定向修复，没有原样新开重派；原始失败与所有日志保留。
- 修复测试使用真实环境字典作为断言值，失败输出意外带入敏感环境变量。集成人主动停止worker，改为隔离环境及不输出字典的断言，清理本轮文件日志后接管收尾；未改Zcode会话数据库，原会话记录可能保留该输出。禁止把这类原始日志提交Git。
- 原生批量查询首次不可用。对照定位为缺少个人provider路径环境变量，补齐后真实查询通过；首次只有页面布局通过的结果不算token验收。
- 修复各来源独立失败、缓存过期状态、到期与重置区分、长输出上限、进程与文件句柄释放、Windows短路径比较及旧调用参数兼容。

当前限制：Desktop账户余额服务没有已确认的CLI外部读取桥，故采用其官方响应快照。看板不切换账户/套餐；没有实现controller自动续接策略或新浏览器调度层，底层显式`--resume`和`--attach`保持可用。
