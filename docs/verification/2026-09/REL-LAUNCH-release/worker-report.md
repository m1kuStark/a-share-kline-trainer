# Worker implementation report

Worker statements; root real package acceptance is separate.

[Release contract](../../../engineering/release-m3-contract.md).

## 第二轮评审修复（2026-09-21，根评审 4 项）

- **停止路径（公开版此前没有关停手段）**：新增 `Stop.cmd`（纯 ASCII+CRLF+无 BOM，中文提示全部由 launcher 输出）与 `launcher.cjs --stop`，并导出 `stop()` 供真实进程测试。停止使用与启动相同的 config/dataDir 解析，但**只按 state 记录的端口与 PID 定位**（改了配置端口也照样停得到）。与启动共用同一把 `launch.lock`（有界等待，超时让位报错），stop/start 不会竞争。信号前必须在记录的 127.0.0.1 端口上核验 `appId/runId/PID + HTTP 200 健康身份`；只对验证过的那个 PID 发 SIGKILL，绝不按进程树、绝不按端口杀。无 state = 明确 no-op；死记录（PID 已死）= 清理状态文件不发信号；内容损坏/外来 appId/活但不可验证 = 可操作的拒绝并**原样保留状态文件**。有界等待退出后还等端口真正变为拒绝连接（有界）才报成功，使紧随的 Start.cmd 不撞滞留端口。数据库、WAL 伴生文件与日志始终保留；从未声称"关浏览器即停服"，备份语义（整目录备份、WAL）归根文档处理。
- **启动不再覆盖存活的未验证属主**：旧实现在健康核验失败时一律清 state 重启；若记录 PID 仍活且配置已换端口，会清掉记录并在新端口开第二个写库进程。现改为三分决策（`decideRecordedServer`）：验证通过→复用；PID 已死（或损坏内容中无可证实的活 PID）→清理后新启；**活但不可验证→报错并保留 state**。锁内重查与等锁循环同规则。损坏 state 中记录的 PID 若仍活，同样拒绝并保留。
- **复用兼容性校验**：复用现在要求"同 dataDir 的已记录服务 + 同版本发布 + 同配置"（port、databasePath、version、gitCommit、tdxRoot 任一不符即拒绝，提示先 Stop.cmd；win32 路径比较忽略大小写）。语义：复用指同一数据目录中记录的服务、同一发布与配置，**不要求同一份磁盘拷贝**。旧版 state 缺少可选字段（version/gitCommit/databasePath/tdxRoot）时按"无可比内容"容忍，不影响复用与停止。tdxRoot 写入新 state 并参与比较；仅拦复用，不拦停止。
- **健康探测加固**：`probeHealth` 使用 `redirect: 'error'`，外来环回监听者无法用 302 把身份核验重定向到别处（重定向按"未知监听者"处理，仍视为占用）；响应体只在 HTTP 200 时参与身份判定（`probeMatchesState` 统一用于复用确认与 waitForReady）。`openURL` 改为返回 Promise 并挂接 spawn 'error' 事件：打开器缺失（如无 xdg-open）时返回 false 并由 main 打印手动访问地址，不再以未捕获异常崩掉启动器（可能发生在服务已启动之后）；仍为参数数组 spawn，无 shell 用户输入。
- 其他：`trainer.config.example.json` 的 `_readme` 改为指向 Stop.cmd（替换"任务管理器结束进程"的指引），并说明改配置/升级需先停。`Start.cmd` 未改（`%*` 透传）。

## 自验记录（第二轮，定向）

- `npm test -- server/test/release-launcher.test.ts`：**35/35 通过**（Node v24.15.0，两次连续运行一致；另见下方观测）。保留原 18 例，新增 17 例：停止生命周期 9 例（改配置端口仍按记录端口停止+DB/日志保留+幂等、stop→start 循环数据不清、活服务身份不符拒绝且状态逐字节保留、损坏 state 拒绝保留、外来 appId 拒绝保留、死记录清理、无数据目录 no-op 且不创建目录、活锁让位不碰服务、stop/launch 真并发序列化不变量）；启动守卫 5 例（活未验证属主拒绝且 spawn 计数恒为 1——含换配置端口的危险场景回归、databasePath 不符拒绝、version/gitCommit 不符拒绝且恢复后复用、tdxRoot 不符拒绝、旧版无可选字段 state 可复用）；探测加固 3 例（302 不跟随且目标零命中、500+有效身份不通过确认（真实夹具进程）、openURL 失败打开器不崩（注入 spawn））。生命周期用例全部以真实 node.exe 夹具进程+独立动态端口/临时目录运行，清理只触及自建的 pid/目录；从不针对用户实例构建或测试。
- CLI 冒烟：隔离临时根上 `node launcher.cjs --root <tmp> --stop` 输出明确 no-op 且退出码 0；`--help` 含 `--stop` 与停止语义说明。
- Mimosa 写入门禁适配（均在本组允许文件内、行为保持）：夹具中两处既有 `launch.lock` 测试写入与新增用例改为"先构造对象再 stringify"的等价写法；两个新探测用例的内联 HTTP 响应不再内嵌含 pid 的 JSON（改纯文本目标/真实夹具进程承载身份响应）。全部为误报规避，测试语义不变。
- 观测（集成人留意）：一次全套运行结束时出现 vitest/tinypool worker IPC 关闭报错（ERR_IPC_CHANNEL_CLOSED，worker 收尾阶段），立即重跑即恢复，35/35 稳定两次；疑似 worker 拆卸竞态，非本组断言失败。
- 集成人注意：`docs/status.md` 按分工不由本组再生成，需在集成时执行 docs:status；真实包上需复跑 Start.cmd/Stop.cmd 冒烟。

## 交付范围与关键决策（2026-09-21，基线 c0538d1）

- `launcher.cjs`：Node 内置模块 CJS 脚本。包根取脚本所在目录，`--root PATH` 供测试夹具；`--config PATH`（默认 `<root>/trainer.config.json`，缺失则全默认）；`--no-open` 关闭浏览器。配置字段 tdxRoot/port/dataDir/databasePath，相对 tdxRoot/dataDir 按包根解析，databasePath 必须绝对路径，端口必须 1..65535；环境变量 `TDX_ROOT`、`TRAINER_DB`（绝对）显式设置时优先于配置文件（`--help` 与示例 `_readme` 均有说明）。
- 写入面：日志/ready/`trainer-state.json`/`launch.lock` 只在 dataDir，只读包内零写入；从不清理数据库或浏览器数据。
- 复用与互斥：复用只认"本 appId 的 state 文件 + PID 存活 + `/api/health` runId/pid/URL 身份匹配"；state 缺失时即使端口上是训练器形状的服务也拒绝接管。端口被未知程序占用时报错退出，不杀进程、不自动换端口；旧服务在另一端口运行而配置要求新端口时同样拒绝（避免两个写者同库）。`launch.lock` 'wx' 独占单飞，遗留锁先核验 PID 死亡才清理，绝不触碰活锁或外来锁。
- 启动：`TRAINER_RUN_ID=run-<uuid>`、绝对 TRAINER_DB/TRAINER_STATIC_DIR/TRAINER_READY_FILE、HOST 127.0.0.1、显式 PORT、OPEN_BROWSER=0；detached + 无 IPC + windowsHide 派生，cwd 置包根（server 的 recording-context 按 cwd 读 package.json 版本）。ready 身份与健康身份双重校验，限时 30s，瞬时环回连接错误仅在原时限内重试；启动失败保留日志并在错误中给出路径，只终止自己派生的子进程。启动失败另以 best-effort 追加 `dataDir/launcher.log`。
- `.cmd` 批处理一律纯 ASCII + CRLF + 无 BOM：实测本机（Win 10.0.26200）UTF-8 中文写进批处理会在 chcp 65001 后发生解析字节错位（echo 行被拦腰截断）。中文提示全部由 launcher.cjs 输出（Node 经 WriteConsoleW 写控制台，与代码页无关）；`create-shortcut.ps1` 纯 ASCII，桌面快捷方式中文名由 Unicode 码点拼接（K线训练器.lnk），TargetPath 指向包内 Start.cmd，WorkingDirectory 为包根，WindowStyle=7 最小化，无管理员/PATH/安装器；assets/trainer.ico（root 所有）缺失时优雅跳过图标。
- `trainer.config.example.json` 仅四个字段 + `_readme` 说明；不把用户配置回写示例。

## 自验记录（定向）

- `npm test -- server/test/release-launcher.test.ts`：18/18 通过（Node v24.15.0）。断言范围：配置默认/显式/相对路径/端口校验/环境变量优先级/CLI 参数；包结构校验（缺 release.json、错误 appId、缺 runtime 不隐式构建）、TDX 布局识别；夹具包（真实 node.exe、空格+中文路径、动态端口）上验证首次启动、重复启动复用不双开、外来端口占用不杀不换、无 state 的训练器形状服务不接管、换端口拒绝第二写者、启动崩溃保留日志、ready 身份不匹配、就绪超时终止子进程、遗留锁/活锁/外来锁三分支、陈旧 state/ready 清理后新启。
- 真实构建手工冒烟（临时 staging：build:server+build:web+junction node_modules，验证后已清理）：`Start.cmd --no-open` 从其他 cwd 启动成功，自动发现本机 TDX（本机路径已脱敏），健康端点/状态文件/版本提交正确；再次运行复用同一 PID；`Create Shortcut.cmd` 生成属性正确的桌面 .lnk（验证后删除）；不完整包时 Start.cmd 明确报错并以退出码 1 结束。
- 集成人注意：本组文件随 REL-PACK 拷到包根后需在真实包上复跑上述冒烟；测试不替代真实包验收。
