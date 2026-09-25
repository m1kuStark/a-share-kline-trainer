# Git并行开发

模型职责按[四路协作](model-delegation.md)分配；[ORCH-04](../work-items/tasks/ORCH-04.md)已提供v2分类候选门禁。旧v1证明保留原验证与visual要求，影子建议或worker自评不能豁免。

使用短期 `task/<ID>` 分支和独立worktree。主干为main；每个任务从已提交基线出发，交付提交SHA和证据，不在共享目录切分支。工具入口为 `npm run task -- <命令>`。

## 任务与工作副本

```powershell
npm run task -- create --id DATA-01
npm run task -- list
```

create默认从main读取任务卡，创建旁边的trainer-worktrees目录；可显式指定已提交 `--base` 与 `--path`。基础工作树须干净，任务必须存在；依赖需closed且integration_ref已进入基线。进入新目录后 `npm ci` 安装自己的依赖。

任务卡规定allowed_paths；共享合约、迁移、锁文件和图表入口先分配owner。准备候选时用目标基线的范围检查，worker不能自行扩大权限。任务卡/文档也在范围检查内。

## 独立运行

```powershell
npm run agent:dev
npm run journey -- --retries=0
```

agent:dev是独立生产预览，输出本次URL，Ctrl+C关闭；不是热更新开发服务器。每次生成 `.runs/run-<uuid>/manifest.json`，内含commit、实际端口、独立SQLite、前后端构建目录和artifacts。系统PORT=0绑定后才确定端口；健康检查同时核对runId/PID，不连接未知服务。原有npm run dev留给普通手动开发，不是多Agent安全入口。

Journey在同一run内保持workers=1；不同worktree可同时跑。浏览器用例读取三份真实日线样本（600519、300857、sh000300，截至2026-09-16）及名称/权息的稳定复制，SHA256写入snapshot.json；不下载、不改TDX，不代表全市场数据验收。自定义TDX_ROOT可指向已有样本库。

## 串行集成候选

```powershell
npm run task -- prepare --id DATA-01 --branch task/DATA-01
npm run task -- verify --candidate <候选ID>
npm run task -- promote --candidate <候选ID> --visual <视觉审查JSON>
npm run task -- cleanup --candidate <候选ID>
```

prepare从当前main建立临时候选并合并任务；冲突保留现场，不推进main。verify安装候选自己的依赖并执行控制层分类门禁（普通文档docs-only检查docs/impact/status，其余full保留完整流程），结果写入候选 `.runs/candidate-proof.json`。未提交或测试中发生变化不发通过证明。

promote检查候选提交/tree、任务、基础SHA、全套检查、来源分支和目标未变化、工作树干净及主代理视觉记录后，才将main推进到实际测过的提交。main变化必须重建候选。Git公共目录内互斥锁保证工具操作一次一个；不自动抢占未知遗留锁，先查归属再人工处理。

视觉记录格式：`kind: manual-ui`、`testedCommit`、`outcome: passed`、`reviewer`、`artifacts: [候选内截图相对路径]`。它证明主代理检查，不是用户产品验收。完成一次命令或编辑JSON本身不保证文字真实，审查责任仍在主代理。只有v2证明经promote重算为docs-only且visual=not_applicable时可省略--visual；旧v1及full仍必填。运行清单必须存在且真实位置属于该候选.runs。

cleanup只清理已推进且干净的注册候选，失败候选保留。证据先复制进正式verification记录或外部安全存档，再清理候选。任务工作副本在成果进入main并确认无未提交/未推送的独立成果后，用 `git worktree remove <路径>`、`git branch -d <分支>`逐个清理。

本地工具不能阻止其他进程绕过命令直接改Git；当前未配置远端保护或自动push。主干回归用revert，数据库采用兼容迁移和受控备份恢复，禁止reset共享历史。需要真实来源M1核验的变更仍按[测试协议](testing.md)额外验证。
