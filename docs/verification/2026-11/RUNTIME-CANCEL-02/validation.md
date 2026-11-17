# RUNTIME-CANCEL-02 Windows 真实进程树测试修正

本片修正测试预算和夹具生命周期，生产实现保持原字节。原实现的诊断和修正后的真实测试都观察到父孙进程退出、日志保留、目录释放以及树外哨兵存活；现有证据没有证明生产进程泄漏。正式首轮完整`npm test` exit0，server2654/2654、desktop369/369；独立只读审查Critical/Important均为0，全局文档门禁仍由主代理收尾。本记录不构成产品验收、候选证明或发布授权。

## 对象与环境

- 任务基线：`3b5fb110e506eb2e139f754c966cee3a64f55ea1`，是工作树 HEAD 的祖先。
- 测试对象：HEAD `2c66477f0c4875ac3a100338fdbc42b4878dadd8` 加本片两份测试修改；最终文件 SHA256 见 `result.json`。
- 独立工作树：`C:\Users\Stark_Du666\.codex\worktrees\runtime-cancel-02\a-share-kline-trainer`，分支 `task/RUNTIME-CANCEL-02`。独立 `npm ci`，没有共享主仓依赖目录。
- Windows / Node `v24.15.0` / npm `11.12.1`；`npm run build:server` exit 0，满足真实启动器测试的构建前置。
- 完整测试显式指定临时 `TRAINER_DB`、`TRAINER_DATA_DIR` 与 `OPEN_BROWSER=0`；公式语料经 `TRAINER_TDX_FORMULA_DIR`、`TRAINER_FORMULA_CORPUS_DIR` 指向工作区只读目录。未使用个人训练库，未启动产品界面。
- 完整原始日志缓存：`C:\Users\Stark_Du666\.codex\headroom-cache\runtime-cancel-02-20261118`。历史健康检查缓存为同级 `trainer-health-20261117-local`。`result.json` 保存日志路径、大小与SHA256，短日志与原始收据同步收录于本目录。

## 根因与最小修正

两条旧用例都显式指定15s，覆盖了 server 文件级90s和desktop配置级30s。runtime 通用命令的 taskkill 本身允许20s，之后还有两段至多5s的关闭确认；desktop 的 taskkill guard 为30s，真实边界另有15s注入退出等待及3s孙进程等待。15s用例超时会先中止测试等待，却不会取消正在执行的 Promise；旧 runtime 的目录回收因而可能先于命令结束，产生 EBUSY。

真实诊断先验证旧生产代码：runtime 取消返回10.959s、desktop返回12.281s，均确认受管父孙退出、树外哨兵存活、目录可删。当前原样测试也通过，说明失败具有负载敏感性；这不撤销 ENG-HEALTH-02 的首次和隔离失败记录。

修正保留所有原断言，增加原始取消理由对象、真实父孙退出、目录即时删除及树外哨兵存活断言。按所有权登记夹具，`finally` 与 `afterEach` 复用幂等清理，在删目录前排空命令并等待哨兵/父进程 close。最后回收夹具允许有界 EBUSY 重试，成功路径的目录释放断言没有重试。单例预算按上述流程设为runtime45s、desktop60s；生产等待常量、终止参数和返回行为均未修改。

孙进程采用 detached 并断开 stdio。首个附着孙进程变异幸存，证明它不能锁住 `/T`；改用 detached 后，撤去 `/T` 必须在“孙仍存活”语义断言处失败。清理仅使用该测试持有的PID，不按进程名终止其他Node进程。

## 运行顺序与保留的失败

| 轮次 | 命令或对象 | 原生退出码 | 事实 |
|---|---|---:|---|
| 历史首轮 | `npm test`，旧15s用例 | 1 | server 2652/2654；runtime超时/EBUSY，updater超时；desktop尚未被该命令执行 |
| 历史隔离 | runtime完整spec | 1 | 14/15，15s超时与EBUSY仍复现 |
| 历史desktop | 完整desktop套件、隔离tree spec | 各1 | 分别368/369、6/7，真实树用例15s超时 |
| 当前原样 | runtime选例、desktop完整spec | 各0 | 10.91s、14.11s；日志名仍保留`red-original-*`，实际结果为通过 |
| 生命周期首试 | runtime完整spec | 1 | 14/15；新增哨兵PID消失后close尚未结束，afterEach删目录EBUSY |
| 等待close后 | runtime完整spec、desktop完整spec | 各0 | 15/15、7/7；当时孙进程仍附着 |
| 首个变异 | runtime撤去`/T`，附着孙进程 | 0 | 变异幸存，不能算锁住树终止语义 |
| detached正向 | runtime选例、desktop完整spec | 各0 | 1个选例通过（其余被命令过滤）、desktop7/7 |
| detached变异 | runtime撤去`/T` | 1 | 孙存活断言收到true，非超时；最终清理正常 |
| desktop变异首试 | desktop撤去`/T` | 1 | finally回收夹具EBUSY掩盖原断言；不算语义杀死 |
| desktop变异复试 | 同上，仅夹具最终回收加有界重试 | 1 | 孙存活断言收到true，非超时；最终清理正常 |
| 精确还原后 | runtime完整spec、desktop完整spec | 各0 | 15/15（38.01s）、7/7（9.10s） |
| 正式首轮全量 | `npm test` | 0 | server188文件、2654/2654；desktop34文件、369/369；命令总耗时381.366s，未出现语料缺失或跳过消息 |

历史updater隔离复跑9/9、exit0只属于其原样复跑，不归因为本片修复。所有失败完整保留；没有删断言、增skip或过滤完整测试集合来取得通过。

本次全量开始于2026-11-18 00:49:38 +08:00。主代理另一个候选检查曾被保守分类为full而意外进入unit，发现后立即只终止其自有命令树，并保留中止收据；本次正式全量未中止或重跑。desktop仍输出`portable-updater-smoke.test.ts`既有重复`maxTries`键警告，本片没有修改该文件。

## 语义绑定与生产字节

- `server/test/runtime-isolation.test.ts::cancels an owned child command and preserves its failure log`
- `desktop/test/port-tree-kill.test.ts::PORT-COEXIST-V127-NODE: taskkill terminates a real two-level node process tree including the grandchild`

第一条同时锁定取消理由/日志、受管退出和目录释放；两条都锁定树外哨兵存活。实际撤去`/T`后，runtime报`owned grandchild must exit before cancellation returns`，desktop报`owned grandchild must exit after tree termination`，两者均是true对false的断言失败。变异不改变oracle，finally清理随后终止该夹具残留孙进程。

| 生产文件 | 变异前与最终还原后相同SHA256 |
|---|---|
| `scripts/runtime/run.ts` | `76458A4B5D9C85913D371D0255A1D4382B026FC56162FD0B62DB96F3DCD7A6CC` |
| `desktop/src/port-conflict.ts` | `B5A9996ADF6CAFC202DE7BC13167425794AE7B1D014732359D0638D5FC10E385` |

上述生产字节也与历史首轮失败时一致。每次真实变异使用原始字节备份和`try/finally`还原，收据逐次记录SHA256；生产文件最终diff必须为空。

## 边界与接续

主代理单写矩阵`runtime-cancellation.yaml`、全局状态、ENG里程碑和任务索引，本工作树不抢写。局部L2结论只覆盖上述真实行为，绑定检查、全量结果及只读审查按最终收据逐项对账。测试证明进程生命周期回归，不能代替产品Journey、视觉检查、用户验收或发布决定。

本片首次文档门禁：`docs:check`/`docs:status -- --check`各exit1，因卡摘要更新后派生状态过期；`docs:impact -- --base 2c66477… --task RUNTIME-CANCEL-02` exit1，只报主代理负责的ENG、work-items索引和status尚未同步。严格绑定检查的实际原生退出码为runtime-cancellation **3**（3行planned、open3、RED0），launcher-lifecycle **0**（10行covered、open0、RED0）。这些都是本片工作树检查结果，待主代理集成后同步全局文件并独立复核，不能当成已通过。

独立只读审查由`/root/docs_audit`完成，核对77项缓存的字节数与SHA256、正式全量退出码/总计、两条最终`/T`变异的语义断言和生产文件精确还原；Critical=0、Important=0。审查未运行测试或修改本工作树，主代理保管完整审查报告并负责全局门禁闭合。

最初完整`git diff --cached --check` exit2，仅指向原样归档日志的末尾空行及Vite警告代码摘录中的尾空格；第一次正常签名提交也被现行pre-commit钩子拒绝（exit1，未产生提交）。按主代理指令，只把被拒的12份证据副本换成`.raw.b64`表示，原缓存字节不动，未绕过任何钩子。`encoded-evidence.json`逐份区分原路径、encodedSha256、decodedSha256及大小，12份解码后均与原缓存SHA256一致。编码文件为无末尾换行的ASCII单行，避免Git换行转换影响encodedSha256。转换后对完整暂存区执行`git diff --cached --check`，exit0，没有排除项。

从仓库根目录解码示例（输出到临时目录，再按manifest核对SHA256）：

```powershell
$source = 'docs/verification/2026-11/RUNTIME-CANCEL-02/runs/npm-test-final.log.raw.b64'
$destination = Join-Path $env:TEMP 'RUNTIME-CANCEL-02-npm-test-final.log'
[IO.File]::WriteAllBytes($destination, [Convert]::FromBase64String([IO.File]::ReadAllText($source)))
Get-FileHash -LiteralPath $destination -Algorithm SHA256
```

额外卫生检查尝试递归删除两次失败遗留的临时夹具目录`trainer-runtime-H1KS7d`、`trainer-port-tree-UpFHFj`时，自动审批策略拒绝整条命令，仅返回`blocked by policy`。删除没有执行，没有换工具绕过；具体绝对路径及执行状态见`runs/owned-fixture-cleanup-rejected.json`，不属于仓库文件。
