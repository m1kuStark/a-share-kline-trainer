# M9-EMA-WARMUP-01 独立审查

审查对象：`C:/Users/Stark_Du666/.codex/worktrees/m9-ema-warmup-01/a-share-kline-trainer`；基点 `df6cedd82fa3fe591615724259f83d16f6bb70fa`。仅对用户已批准的公共 EMA 前导 NaN 修复给出代码判断；M9 产品最终验收另行完成。

裁决：**可合入（EMA 独立修复范围）**。发现 **C0 / I0 / M0**。完整 server+desktop 已在同一次 npm test 中全部通过，原生退出码 0；源码和四个测试指纹与所审补丁保持一致。root 仍需完成最终文档/矩阵及候选门禁；本裁决不等于 M9 产品验收或发布批准。

## 五维检查

| 维度 | 结论及依据 |
| --- | --- |
| 计划对齐 | `math.ts:38-61` 仅寻找首个非 NaN 位置并平移原 SMA 的 seedIndex。保持逆序求和、原系数及递推；没有修改 CROSS/IF、QINIU seed、其他 EMA helper 或内置 MACD。任务允许的四个测试文件和引擎 README 为关联变更。 |
| 代码质量 | 正整数 N 下，首个非 NaN 前缀、余量不足、全 NaN、内部空洞和 ±Infinity 边界均符合批准契约。首个有效位置为 0 时，原运算和比较边界原样保留；N=1 的旧浮点取消效应也刻意保留。 |
| 架构一致性 | 改动留在公共数值函数；无产品层、指标 provider、seed 或渲染逻辑补偿。README 已限定本契约适用于正整数周期，未假称引擎已经校验非法周期。 |
| 测试真实性 | 10 个新增字面用例；手算向量、嵌套 EMA3、真实 DB seed/服务端纯求值、图表纯求值及实际 QINIU 波形均检查数值。波形预期用显式种子位置的闭式权重，未调用生产 EMA 或同一递推；B1 检查完整数组，仅索引 61/93 为 1。 |
| Harness 收据 | 已独立核对所有现有 receipt 的日志 SHA256/字节长度、命令、原生退出码及 base HEAD。RED/回退变异均为同样 8 条 AssertionError；恢复后测试 SHA256 全匹配。5 个新矩阵行仍 planned/空绑定，由 root 收尾；未将手工子集检查当作全局 strict 通过。 |

## 独立复核

- 从基点 `git show` 抽取旧 EMA，6 组冻结测试预期均逐项 `Object.is` 一致；另对 900 组连续有限输入、正整数周期 1..30 比较 old/candidate，0 差异。原实现周期 1 的取消效应是既定兼容约束。
- 线性输入 1..120：EMA12=C−5.5、EMA26=C−12.5，所以 DIF 从索引 25 起恒为 7；9 个 DIF 的 SMA 在索引 33 播种，因此 DEA 前 33 项空、后 87 项为 7。
- 真实语料 manifest 的 29 份输入（6 文件、23 块）均实存，字节和 SHA256 全部吻合。43 项语料/跨周期/市场上下文用例的日志没有缺语料 guard 警告；未删除既有豁免和断言。
- `vitest list` 实际发现“preserves exact frozen old vectors for uninterrupted valid inputs”和“evaluates the real QINIU wave DEA against independent weights and B1 only at 61 and 93”，原生退出码 0；证据见本目录 `vitest-discovery.*`。

## 已核收据与后继门禁

| 步骤 | 原生退出码 | 结果 |
| --- | ---: | --- |
| red-targeted | 1 | 8 failed / 104 passed；8 条都是数值 AssertionError，无加载或编译错误 |
| green-targeted | 0 | 112 passed |
| mutant-old-ema | 1 | 与 RED 同样 8 条字面失败 ID；不是编译/环境失败 |
| restored-targeted | 0 | 112 passed，4 个测试文件哈希与变异前一致 |
| corpus-targeted | 0 | 43 passed，3 文件；本地 6 文件和 23 块均存在 |
| build | 0 | web 类型检查、server/engine bundle/web 构建成功；保留 Vite 大 chunk 提醒 |
| full-test 初次 | -1073740791 | 进程退出，无整套用例结果；原日志/receipt 保留，不推断崩溃原因 |
| full-test-retry1 | 1 | server 2661 passed / 3 failed（188 文件中 workflow-docs 1 文件失败）；desktop 未执行 |
| full-test-isolated-control | 0 | 同一次 npm test：server 188 文件 / 2664 项通过，随后 desktop 34 文件 / 369 项通过；control env=null、两项语料 env 保留 |
| docs:check / docs:impact / docs:status 初次 | 1 | 当时 root 聚合文档尚未收尾；原失败日志保留，等待最终状态重跑 |

完整原始日志由 worker 保存在 `C:/Users/Stark_Du666/.codex/headroom-cache/m9-ema-warmup-01-20261118`，本审查未改写这些证据。

retry1 的 3 条失败已读原始断言：fixture 应读取 current summary/owner 却读成 old、缺统一 state 应 WARN 却进入真实 state 的生成区过期 ERROR、fixture closed 与卡片 active 应产生 state-drift 却返回空。`scripts/workflow/bridge.ts:75-76` 让显式 `TRAINER_CONTROL_ROOT` 优先于传入根目录，而 `workflow-docs.test.ts:17-23` 会建立独立临时 `.control`。worker 当次把真实工作区 control 传给所有 unit 测试，覆盖了这些 fixture；应仅调整执行环境，不修改产品/测试。修正后完整新批次收据已核对：2026-11-17T18:36:22.7938035Z 至 18:42:26.9871566Z，原生退出码 0，日志 SHA256 为 d11d0bcfb5beccd43d3e755540b0080e25f8c69be84492f380f158198d7e613f。没有把局部 3/3 与失败批次拼成成功。

## 指纹与边界

- 数值源码 SHA256：`2b43e59bd8e6549cf155b6c55fb53b45a5bf16015e9f07bc7dfffd6d19c6becb`。
- 本审查六文件 diff SHA256：`c4aaa24bc7f67a76e33a13234ad47ea0739ec12c17c425376f8bd98c466f2591`，见 `final-reviewed.diff`；测试、README、seed 和 Interpreter 指纹见 `independent-audit.json`。
- `math-before.raw.b64` 解码后的原工作树文件为 7807 字节，Git blob 为 7476 字节；**仅 CRLF/LF 差异，归一 LF 后内容一致，原始字节并不相同**。恢复候选以候选 SHA256 核验，不把 Git blob 字节当作工作树字节。
- 非正整数周期未被注册器或 Interpreter 校验。`period=0` 静态推导新旧都全 NaN；`[NaN,NaN,1], period=-1` 可在新实现前段产生 −0，旧实现全 NaN。非法周期不在本次批准的正整数 N 契约中，不为本补丁扩增参数校验；兼容结论据此限定。

## 拒绝判断项

本轮未验证实际通达信、浏览器渲染、主题/交互、完整 Journey、Windows 实包、录像录制/回放、运行时 bundle 动态加载或人工验收。seed 测试注入真实 FormulaEngine 模块，图表测试是纯函数，二者不能替代这些产品验证。未把本独立修复审查当作 M9 完成、可发布或人工接受。

审查者未修改仓库、矩阵、状态、台账、分支或索引；仅向本审查缓存目录写诊断和报告。

## 候选运行环境建议（静态，不改变代码）

`verify-candidate.ts:65/68` 的 docs/unit 都经 `runtime/run.ts:120` 继承同一 `process.env`。当前 runner 没有分步 control 环境选项。候选验证可全程清除 `TRAINER_CONTROL_ROOT`，在该 worktree 已忽略的 `.control/trainer-state.json` 临时放真实 canonical state 的普通文件冻结副本；docs 向上发现副本，临时 fixture 向上发现自己的 control。docs/status 的读取没有副作用，verify-candidate 的 createRun/runNode 不镜像 workflow state。

副本必须限定在验证生命周期：先确认没有既存文件，记录 canonical revision/SHA 和副本前后 SHA，确认不是 junction/symlink；真实共享 control 上前后另跑 `docs:status --check`。结束后仅清理本轮新建副本和空目录，恢复原现场。副本若留存会遮蔽真实 control；后续 `saveCandidate` 会向近端 control 镜像写入，因此不要在副本存在期间执行 state/promote 操作。无须用 Windows ReadOnly 属性；约束用途加前后哈希即可。此方案既不修改脚本，也不启用允许缺状态的宽松路径。
