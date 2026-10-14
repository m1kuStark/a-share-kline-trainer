# MIG-ONECLICK-02 验证记录：启动器报错中文化＋自诊断增强

任务：一键迁移.cmd 启动器英文报错统一为中文（经 PowerShell 通道）＋检测失败自诊断。
worktree：D:/tmp/mig02（分支 mig-oneclick-02，base=7227d64）。本文为收尾交付物之一。

## 1. 定位复核（对 orchestrator 简报的独立验证）

| 简报结论 | 复核结果 |
| --- | --- |
| 唯一英文输出面=oneclick-launcher 的 static/一键迁移.cmd（及 dist 副本） | **确认**。grep 逐文件核对：`static/一键迁移.cmd` 旧版含两处英文报错面（位置不对 5 行 echo＋运行失败尾句 `Migration did not complete`）；cjs 层（oneclick.cjs/export-v127.cjs 源与 dist）全部用户可见输出已中文 |
| 用户两侧差异机制=v1.3.x 侧进入 cjs（中文）、v1.2.7 侧停在 .cmd 层只见英文 | **确认**。旧 .cmd 报错仅在「三特征检测全部失败」时触发；v1.3.x 侧 K*.exe 命中即进入 cjs，报错面是 cjs 的中文输出 |
| 导出侧入口兜底：导出训练录像.cmd 如也有英文一并处理 | **确认有**。旧版含 `Incomplete installation`（3 行）＋`Migration export failed` 两处英文面，已一并重构 |
| v1.2.7 包真实结构（根含 Start.cmd、runtime\node.exe、server/、web/ 等） | 采纳简报实证（zip 解压）；本任务未触碰真实包，测试用构造目录 |
| .cmd 必须 ASCII-only（W3 实证 cmd 内中文解析损坏） | **采纳**。新 .cmd 与新 launcher-print.ps1 均做字节校验（见 §4 测试） |

## 2. 中文输出方案论证（修复设计第 1 条的方案选型）

约束冲突：.cmd 必须 ASCII-only，但报错要中文。三个候选：

- **(a) base64＋`powershell -EncodedCommand`**：.cmd 保持 ASCII，但报错文案变成不可人审的编码串，改文案需编码工具链；两个 .cmd 各自冗余编码；`-EncodedCommand`（UTF-16LE base64）是恶意软件常用手法，用户桌面安全软件误报风险不对称。否决。
- **(b) 中文下沉独立 UTF-8 资源文件，.cmd 调 PS 读文件打印**：采纳（扩展形态，见下）。
- (c) 内联 `powershell -Command "…中文…"`：直接违反 ASCII-only 约束（简报已排除）。

**采纳方案 (b) 的具体形态＝三文件分工**：

1. `static/launcher-messages.txt`（UTF-8 中文文案）：`[节名]` 分节；`{TOOL_DIR}` 占位符。工具包已有中文 UTF-8 文本资产先例（迁移说明.md、迁移兜底-浏览器控制台脚本.txt），build 管线本就复制 static 全部用户文件。
2. `static/launcher-print.ps1`（ASCII-only 打印器）：读文案、按场景参数（oneclick-place / oneclick-incomplete / oneclick-runfail / export-place / export-runfail）与特征环境变量拼装、`Write-Host` 输出、exit 1。选独立 .ps1 而非 .cmd 内联 `-Command` 的理由：拼装逻辑（读文件＋分节＋按 env 选择特征行＋占位符替换）内联单行不可审，独立文件可多行注释、可整文件 ASCII 字节校验、可被冒烟端到端执行。
3. 两个 `.cmd`：检测特征后设置环境变量（MIG_TOOL_DIR / MIG_MSG_FILE / MIG_RT_FOUND / MIG_EXE_FOUND / MIG_CJS_FOUND / MIG_EXPORTCJS_FOUND），调 `powershell -NoProfile -ExecutionPolicy Bypass -File launcher-print.ps1 <scene>`。**动态值（工具文件夹路径——用户路径可能含中文/空格/括号）一律走环境变量，绝不内插进命令串**，规避 cmd/PS 双层转义与注入面。

相对 (a) 的优势：文案可直改可人审；两 .cmd 共用一份文案；测试可直接断言资源存在/UTF-8/关键中文要素（不必解码实现细节）；无安全软件误报面。代价：分发多 2 个文件（build.mjs 已加入复制清单；工具本按整文件夹分发）＋资源缺失时 PS 输出 ASCII 兜底短句（`cannot read launcher-messages.txt`，异常场景可接受，不做 .cmd 层预检——见 §7 偏差 2）。

**报错信息三要素**（任务要求）：工具文件夹当前位置（{TOOL_DIR} 替换）＋具体缺了什么（特征行：runtime\node.exe / K*.exe / oneclick.cjs / export-v127.cjs 各自「找到/未找到」）＋下一步指引（放哪、再双击哪个文件）。

## 3. 触发链未定论披露（如实处理）

用户截图报错（v1.2.7 侧 .cmd 层英文）的**完整触发链未复现**：orchestrator 现场探测（用户桌面实际路径下同构探测脚本）显示两个 `if exist` 条件均 FOUND，含 `chcp 65001`＋双条件＋`goto` 的完整同构也通过——结构复现失败。最可能解释＝用户首次运行时 migrate-v127 文件夹尚未就位（后按英文提示移动到位，探测时已 FOUND）。

处置：修复不依赖触发链定论——(1) .cmd 层报错全面中文化（无论何种原因触发，用户看到的都是中文）；(2) oneclick.cjs `detectOneClickMode` unknown 分支自诊断增强：报错自带「已检测特征清单（runtime\node.exe、K*.exe 各自找到/未找到）＋父目录内容摘要（前 10 项，超长截断并给总数）」，用户或支持方再遇到时信息自足，可直接判定现场实际缺什么。

## 4. RED→GREEN 收据

### RED（先于产品码）

- 测试文件：`server/test/migration-oneclick-launcher.test.ts`（10 用例：源形状 6＋cjs 自诊断 2＋真实链冒烟 2，Windows 门控）。
- 命令：`npx vitest run --config server/vitest.config.ts server/test/migration-oneclick-launcher.test.ts`
- 结果：**EXIT=1，9 failed | 1 passed**。9 个失败全部以正确原因（新行为缺失）：英文句式仍在（黑名单＋泛化命中旧 .cmd）、PS 通道特征缺失（旧 .cmd 无 powershell/launcher-print.ps1/MIG_TOOL_DIR）、launcher-messages.txt 与 launcher-print.ps1 不存在、cjs reason 无「已检测特征」无哨兵文件名、冒烟 copyFile ENOENT。唯一 passed＝ASCII-only 用例（旧 .cmd 本就 ASCII，恒真防回归守卫，非 RED 目标）。

### GREEN（最小实现）

产品码（全部在 RED 之后写入）：

- `tools/migrate-v127/static/一键迁移.cmd`：重构。检测行为结构与旧版逐分支等价（分支1 runtime+cjs→run；分支2 K*.exe+cjs→run；分支3 fallback *.exe+cjs→run；仅拆为特征变量判断＋新增 MIG_* 环境变量），失败输出改经 PS 打印器（incomplete/place 两场景），runfail 尾句同改。
- `tools/migrate-v127/static/导出训练录像.cmd`：同构重构。
- `tools/migrate-v127/static/launcher-messages.txt`：新增中文文案。
- `tools/migrate-v127/static/launcher-print.ps1`：新增 ASCII 打印器。
- `tools/migrate-v127/src/oneclick.cjs`：仅 `detectOneClickMode` unknown 分支 reason 增强三段（特征清单/父目录摘要/指引），返回形状不变。
- `tools/migrate-v127/build.mjs`：复制清单＋console 输出加两文件。

构建：`node tools/migrate-v127/build.mjs` → **BUILD_EXIT=0**（dist 内 .cmd/ps1/txt/oneclick.cjs 与源同步，由 dist 同步用例锁定）。

GREEN：同命令 → **EXIT=0，10 passed**。中途一次失败为测试夹具自身缺陷（oneclick.cjs 源在 src/ 不在 static/，copyFile ENOENT），修夹具后全绿；另修正截断用例的 readdir 顺序依赖（改为顺序无关的「恰好 10 项＋共 12 项」断言，语义不放松）。

### 回归

`npx vitest run --config server/vitest.config.ts server/test/migration-oneclick.test.ts server/test/migration-oneclick-settings.test.ts server/test/migration-tool.test.ts server/test/migration-tool-history.test.ts` → **EXIT=0，4 files / 44 tests passed**（14+1+18+11）。矩阵 15 行存量 covered 依赖未破坏。

## 5. 矩阵 test_ids 提案（MIG-ONECLICK-LAUNCHER-CN，现状 planned/test_ids 空——orchestrator 回填升 covered 用）

ref 格式＝`文件::it用例名全文`（check-binding 不支持 describe>it 组合）。EARS 前半（.cmd 中文＋PS 通道＋ASCII）建议绑定：

- `server/test/migration-oneclick-launcher.test.ts::两个启动器 cmd 不含用户可见英文报错句式（黑名单＋英文长句行泛化）`
- `server/test/migration-oneclick-launcher.test.ts::两个启动器 cmd 为 ASCII-only（cmd 内中文在部分 Windows 构建解析损坏）`
- `server/test/migration-oneclick-launcher.test.ts::启动器经 PowerShell 通道输出中文（调 launcher-print.ps1＋动态值走环境变量）`
- `server/test/migration-oneclick-launcher.test.ts::中文文案资源 launcher-messages.txt 为 UTF-8 且含报错要素（特征词＋指引＋路径占位）`
- `server/test/migration-oneclick-launcher.test.ts::打印器 launcher-print.ps1 为 ASCII-only 且从环境变量读动态值`
- `server/test/migration-oneclick-launcher.test.ts::dist 发布副本与 static 源逐字节同步（锁 build 忘跑）`
- `server/test/migration-oneclick-launcher.test.ts::非安装目录场景下 一键迁移.cmd 退出码 1 且输出中文报错（含位置与特征）`（Windows 门控）
- `server/test/migration-oneclick-launcher.test.ts::非 v1.2.7 目录场景下 导出训练录像.cmd 退出码 1 且输出中文报错`（Windows 门控）

EARS 后半（cjs 自诊断）建议绑定：

- `server/test/migration-oneclick-launcher.test.ts::unknown 分支 reason 含已检测特征清单与父目录内容摘要（哨兵文件名可查）`
- `server/test/migration-oneclick-launcher.test.ts::unknown 分支父目录超过 10 项时摘要截断并给出总项数`

L2 佐证：英文黑名单取用户截图原文；中文哨兵含临时目录随机名（实现措辞无法预知）；冒烟走真实 cmd→powershell→文案→stdout 链（§4.2 真实边界原则——形状断言拦不住 PS 语法错/节缺失/引号错位，冒烟拦截）。

## 6. 变异抽检（executed，收据见 §9）

1. 变异 A（改回英文报错）：static/一键迁移.cmd 的 place 场景 powershell 行替换回旧英文 echo（含 `must sit INSIDE`）→ 杀手测试「两个启动器 cmd 不含用户可见英文报错句式（黑名单＋英文长句行泛化）」失败；冒烟用例同因失败（输出无中文）。还原。
2. 变异 B（删自诊断）：dist/migrate-v127/oneclick.cjs unknown 分支 reason 改回旧文案（无特征清单/摘要）→ 杀手测试「unknown 分支 reason 含已检测特征清单与父目录内容摘要（哨兵文件名可查）」失败（'已检测特征' 缺失＋哨兵名缺失）。还原（git checkout 至 GREEN 提交，非未提交工作面整文件还原——supervised-delivery v1.9 规程）。

## 7. 偏差登记

1. **.cmd 检测行为微重构**：旧版三段独立 `if exist X if exist Y`，新版拆为特征变量（先探测置 flag 再判断）。逐分支等价推演（分支顺序、goto 目标、RUN_AS_NODE 置位、fallback 语义均保持）；此为输出通道改造的必要结构性改动，非行为变更。EXE fallback 会匹配 `Uninstall *.exe` 的既有特性原样保留（改动它=行为变更，需另拍板，本任务不顺手修）。
2. **资源缺失不做 .cmd 层预检**：launcher-print.ps1/messages.txt 缺失时由 ps1 的 catch 输出 ASCII 短句后 exit 3（.cmd 不检查该 errorlevel，继续 pause/exit 1）。理由：预检分支本身只能输出英文（资源缺失=无中文可打），徒增一个英文输出面；该场景=工具文件夹严重残缺，冒烟+dist 同步已覆盖正常链路。登记为已知取舍。
3. **冒烟未覆盖成功链**（v1.2.7 侧真实起 node 跑 oneclick.cjs）：会执行真实导出逻辑，属 MIG-ONECLICK-EXPORT-SIDE 既有绑定域（migration-oneclick.test.ts 14 用例），本任务不重复造夹具。

## 8. proposed_default 清单（呈现类，先实现提验）

1. 中文报错文案措辞与排版（节名、分隔、全角标点、「找到/未找到」用词）——用户原话只约束「统一为中文」与「解决报错」，具体措辞为保守默认，待用户过目。
2. 特征行报法：`K*.exe（及其他非卸载程序 .exe）`合并为一行；runtime 与 exe 两特征各一行＋入口文件一行——清单粒度为默认选择。
3. runfail 尾句样式（单行中文提示「查看上方提示」）——cjs 层已有详细错误，.cmd 层不重复展开。
4. ps1 exit 1（与 .cmd exit /b 1 对齐）；文案资源缺失时 ps1 exit 3（区别于场景性失败）——退出码语义为默认约定。

## 9. 机器收据汇总

| 命令 | 退出码 |
| --- | --- |
| RED `npx vitest run --config server/vitest.config.ts server/test/migration-oneclick-launcher.test.ts`（实现前） | 1（9 failed 正确原因） |
| `node tools/migrate-v127/build.mjs` | 0 |
| GREEN 同 RED 命令（实现+修夹具后） | 0（10 passed） |
| 回归 4 文件（oneclick/settings/tool/tool-history） | 0（44 passed） |
| check-binding --strict --include-untracked | 3（15 covered 不变；2 open=既有 MIG-CONSOLE-FALLBACK＋本任务预登记行待回填，与基线同因） |
| 变异 A 后形状+冒烟 | 预期失败（杀手测试击杀） |
| 变异 B 后自诊断用例 | 预期失败（杀手测试击杀） |

## 10. 范围合规

全部写入路径 ∈ allowed_paths：tools/migrate-v127/（static×4、src/oneclick.cjs、build.mjs、dist×5）、server/test/migration-oneclick-launcher.test.ts、docs/verification/2026-10/MIG-ONECLICK-02/README.md。矩阵文件零改动（MIG-ONECLICK-LAUNCHER-CN 行维持 orchestrator 预登记原样）。未跑真实迁移；未触碰用户桌面现场（部署同步归 orchestrator）。
