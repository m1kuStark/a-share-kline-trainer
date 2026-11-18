# M9 密集公式布局：定向证据

本包只整理已结束的布局运行、相关单测/类型检查和静态审查。最终定向用例为 `run-99cc271f-0f3a-4213-8fdc-858236eb85d8`：原生退出 0，1 通过、0 失败、0 跳过。它不是整轮候选证明；不得将相关套件的 18 项通过与此定向结果拼成整轮通过。本包不包含主控视觉判断、新的录像诊断或用户验收结论。

各 run 的 HEAD 均记录为 `f9454fec92017eba74de2904abf9982deb685ab4`，同时含未提交修复。HEAD 不能代替实际工作树身份。原始 wrapper 的命令、diff、原生退出码、run manifest、完整日志和 browser-results 均保留；固定源快照与变异恢复哈希另行绑定。

## 各次结果

| label / run 前缀 | 原生退出与结果 | 准确含义 |
|---|---|---|
| `layout-red-f945` / `9620a16d` | 1；0 通过、1 失败 | 原密集布局主图高度收到 68px，未满足 `>=99.9`。 |
| `layout-main-zero-red-f945` / `b84f02c3` | 1；0 通过、1 失败 | 在 1366×768 直接断言主图高度 `>0`，实际为 0；这是原产品语义 RED。 |
| `layout-green-first` / `bb22a898` | 1；0 通过、1 失败 | 新主边界测试要求移动 20px，实际 18px；钉定库的仅前沿节流会丢末步。原失败保留，不把断言改成 18px。 |
| `layout-green-endpoint-v2` / `250bd1e5` | 0；1 通过 | 超过库严格 `>20ms` 窗口后，用真实鼠标重送相同终点；严格位移及松手不回弹断言保留。 |
| `layout-related-green-v3` / `841877c0` | 1；18 通过、1 失败 | 相关布局、开关、分隔条、公式和来源用例通过；长录像在导入后等待“跳到最后一天”达到 1800000ms 超时。error-context 同时记录 JSON 解析失败：`Unterminated string in JSON at position 3924624 (line 1 column 3924625)`。这里只保留症状和原始失败，不纳入后续诊断或归因。 |
| `layout-mutant-A-no-main-reserve-v1` / `1935a082` | 1；0 通过、1 失败 | 取消主图预留后再次命中主图高度不足的语义断言，见下文。 |
| `layout-mutant-B-no-inverse-v1` / `51acf228` | 1；0 通过、1 失败 | 取消压缩反算后命中松手回弹断言，见下文。 |
| `layout-green-final-v4` / `cc3ce6c6` | 1；0 通过、1 失败 | held-resize 的供高窗格前置不足：原先让 MACD 向下拖动捐出 15px，但它仅剩 6.9333px 可捐；实际变化未达原 `>10` 断言。 |
| `layout-green-held-donor-v5` / `99cc271f` | 0；1 通过 | 仅改 held-resize 的供高方向为 VOL 向上捐 15px，并新增供高余量断言；原有强断言全部保留。 |

所有 browser-results 的完整错误、stack 和附件均以原字节 gzip 保存；失败没有截图的 run 不补造截图。截图只作为待主控阅读的原始画面，不附加视觉通过结论。

## 变异与恢复

两个实际变异均独立执行默认 dense 用例，未修改 e2e 断言，runner 原生退出与 Journey 原生收据均为 1。

- A 唯一替换 `const mainFloor = 100` → `const mainFloor = 0`。具体 killer：主图 `>=99.9`，实际 68。变异源码 SHA256：`e771ce511fd83c295f04a3bc97759c6f8e2a1e6dafcb460a7841c1b7b40262c9`。
- B 唯一替换 `delta / gesture.fraction` → `delta`。具体 killer：`compressed settled pointerup pane 1`，按住时预期 `86.53333333333333`，松手稳定后实际 `76.69333333333333`，差 `9.840000000000003`，原允许误差 `<0.05`。变异源码 SHA256：`7fa6c17eb44c3f225af92b0cae7f3e9537de826a329c9183b074b0c256df9acc`。

两次 `source-before.bin` 均为 `99afbf345f0f7eae54e2304b47b0961247d1bfd31cf72ad5d1e240bfd0a1c2b7`，恢复后 SHA256 相同且 `restoredByteForByte=true`；e2e 前后均为 `907d952b5b77a67b12d5dafd9baf54909a2ce257c87d4763ad2188a4771b73f6`。`unexpectedConcurrentSourceWrite=false`，e2e/HEAD 未变。保留 runner 原始 `journey_failed_untriaged` 字段；本说明根据实际语义错误记录具体 killer，不把任意非零自动算作杀死变异。

## held-resize 前置修正

v4 的 compressed 拖动附件记录 MACD 高度 `36.93333333333334`，原生最小高度 30，余量只有 `6.933333333333337`。随后向下拖动让 MACD 继续供高，最多只能变化该余量，因此不能满足原 `>10` 断言。

v5 改为 `interruptedDelta=-15`，由 VOL 供高，并在手势开始前新增 `VOL.height-30 >15` 断言。实际变化 `>10`、保持按下时 resize 不提交布局、往返恢复及其后的所有断言均保留。`derived/fixture-donor-delta.json.gz` 对固定新旧测试做可逆比较：撤掉新增前置并还原两处方向表达式后，文本与旧快照相同（仅标准化 CRLF/LF 以比较）。

v5 固定 e2e SHA256：`081f33d8e6e1b15f81dd91dac44416254161c02d9add1ce4d155d5382b16e4de`。主控确认该文件从 v5 结束后未再变更，随后离线冻结；源前后与副本哈希一致。这个关联明确记录在 `support/fixed-source-v5/snapshot.receipt.json.gz`，不把之后新增覆盖混入 v5。

## 单测、类型与静态审查

`unit-cache-removal` 原生 0：4 文件、36 项通过；`types-cache-removal` 原生 0，日志为空文件且有 SHA256 收据。它们是专项检查，不是完整候选门禁。

静态材料保留各自适用版本：初版产品审查指出压缩拖动需逆算；implemented review 为 Critical 0 / Important 0 / Minor 1（只写缓存），缓存后续已删除；driver review 核对实际 import ESM 与 UMD 的 20ms 仅前沿节流；root-followup 保留删除缓存后的产品与测试固定快照。这些材料均不是动态或视觉通过结论。

## 文件与完整性

文本、JSON、源码快照和二进制备份均为逐字节 gzip；PNG 保留原字节。每个条目在 `manifest.json` 同时登记原始长度/SHA256与存储长度/SHA256，可先解压 ZIP，再解 gzip 校验原始指纹。Playwright JSON 内的 base64 附件另解码保存，原 browser-results 同时保留，并标注派生来源。

选入的所有原件在收集前后重新核对哈希；原目录全部保留。排除 trace/视频、编译产物、运行 profile/数据库、TDX 数据、原始录像导出、大型几何转储、正在进行的录像诊断和主控视觉判断。外部 `package.receipt.json` 绑定 ZIP 和 manifest，并逐成员核对 ZIP 解压后的长度与 SHA256；manifest 不给自身递归填入摘要。
