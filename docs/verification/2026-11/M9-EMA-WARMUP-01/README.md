# M9-EMA-WARMUP-01 验证记录

2026-11-18，`task/M9-EMA-WARMUP-01`，基线 `df6cedd82fa3fe591615724259f83d16f6bb70fa`。本记录针对未提交工作树，产品与测试的最终字节指纹见 [source-fingerprints-final.json](artifacts/source-fingerprints-final.json)。

## 修复范围与独立预期

`EMA` 从首个非 NaN 值开始等待连续 N 个原始位置，以原来的逆序 SMA 求和种子和递推计算。只跳过开头的 NaN；中途缺口继续传播，Infinity 保持旧处理。契约适用于正整数周期 N，本任务未新增非法周期数值校验。

产品仅修改 `web/src/formula-engine/interpreter/functions/math.ts` 的 `EMA`；四个测试文件新增 10 个用例，README 补充契约。产品 SHA256 为 `2b43e59bd8e6549cf155b6c55fb53b45a5bf16015e9f07bc7dfffd6d19c6becb`。GREEN 后产品与四个测试文件字节未变；README 随后补明正整数 N 范围。

- 手算 `[NaN,NaN,2,4,6,8]` 的 EMA3：前四项 NaN，随后为 4、6；嵌套 EMA3 对 1～7：前四项 NaN，随后为 3、4、5。
- 正常有限输入使用修改前冻结的精确向量，保留逆序求和及浮点行为；空输入、全 NaN、样本不足、N=1、中途 NaN 和正负 Infinity 单独断言。
- 真实 QINIU seed 保持原公式：线性 120 根数据 DIF 前 25 项暖机、DEA 前 33 项暖机，随后均为 7，B1 全零；服务端与图表将暖机输出为 null。波形序列按独立闭式指数权重求 DEA，B1 只在索引 61、93 触发，预期不调用生产 EMA 或其递推。

五条行为矩阵的 10 个精确测试 ID 见 [test-bindings.json](artifacts/test-bindings.json)。

## 验证结果

全部原命令、参数、环境、UTC 起止时间和即时 `$LASTEXITCODE` 见 [receipt-index.json](receipt-index.json) 及其 14 份原样收据。结果机器可读入口为 [result.json](result.json)。

| 步骤 | 原生退出码 | 结果 |
| --- | ---: | --- |
| red-targeted | 1 | 4 文件，112 项：104 通过、8 项预期语义失败 |
| green-targeted | 0 | 4 文件，112/112 |
| mutant-old-ema | 1 | 实际撤回 EMA 修复后，同 8 项语义失败重新出现 |
| restored-targeted | 0 | 恢复修复且哈希一致，112/112 |
| corpus-targeted | 0 | 3 文件，43/43；6 个真实公式文件和 23 个语料块全部存在 |
| build | 0 | `npm run build`，含类型检查、服务端及引擎 bundle、Web 构建 |
| workflow-docs-isolated | 0 | 原断言和配置，3/3，验证控制环境隔离修正 |
| full-test-isolated-control | 0 | 单次完整 `npm test`：服务端 188 文件、2664/2664；桌面端 34 文件、369/369 |

完整测试日志 SHA256：`d11d0bcfb5beccd43d3e755540b0080e25f8c69be84492f380f158198d7e613f`。这次 3033 项来自同一完整命令。真实语料输入逐文件指纹见 [corpus-inputs.json](artifacts/corpus-inputs.json)；没有用缺失文件的提前返回替代执行。

## 保留的失败及环境修正

首次 `full-test` 原生退出 `-1073740791`（`0xC0000409`），只有 Vitest RUN 头，无断言汇总，桌面端未执行。Windows Application 查询无匹配事件，内存观测无 OOM 证据；该原生崩溃原因尚未确认，保留 [环境诊断](artifacts/native-crash-environment.json) 与原日志。

同候选、同配置复跑 `full-test-retry1`：服务端 2664 项中 2661 通过，`workflow-docs.test.ts` 的 3 项失败，桌面端未执行。根因是继承的真实 `TRAINER_CONTROL_ROOT` 在 `findControlRoot` 中优先于测试临时 fixture。root 批准只在 unit 进程移除该变量，保留两个真实语料目录环境变量；先以原断言运行该文件 3/3，再执行完整 `npm test` 得到上表结果。源码、测试配置、并发和超时保持原值。正式文档门禁仍由 root 显式使用真实控制目录执行。

早期文档检查也原样保留：`docs-check` 退出 1（1 error、181 warnings）、`docs-status-check` 退出 1；首次 `docs-impact` 因漏传 base/task 参数退出 1，补齐参数后 `docs-impact-scoped` 仍退出 1。初始任务引用了尚不存在的 `docs/specs/formulas.md`，共享规范与状态随后由 root 更新。这些早期收据不代表最终文档门禁；最终结果由 root 的汇总记录负责。

## 归档与边界

[evidence-inventory.json](evidence-inventory.json) 映射 15 份原日志、14 份原生收据、补丁、初始 manifest 和源码快照。日志及部分文本以原字节 Base64 保存，22 个编码文件均已解码核对 SHA256；收据按字节原样复制，其 log 字段保留缓存原路径。`matrix-before` 仅保留历史输出，无独立原生收据，矩阵状态由 root 汇总。

解码示例（输出到工程外的临时文件）：

```powershell
$taskBytes = [Convert]::FromBase64String((Get-Content -Raw -LiteralPath '.\logs\full-test-isolated-control.raw.b64').Trim())
[IO.File]::WriteAllBytes((Join-Path $env:TEMP 'M9-EMA-full-test.log'), $taskBytes)
```

本 worker 未运行浏览器旅程、Windows 包或用户验收，也未提交、推送或合并。独立审查、最终文档/矩阵/控制状态、任务卡以及 M9 整体验收由 root 接续；本记录中的通过仅覆盖上表对象。

## 集成人复核（2026-11-18）

root 已逐文件核对冻结的六个指纹，读取实际 EMA 补丁、独立 oracle、专项失败与完整单次测试收据。独立五维审查[裁决可合入](review/code-review.md)，Critical/Important/Minor 均为 0；审查报告中 planned 的矩阵状态是审查时快照，后由 root 统一绑定。

最终 `check-binding.mjs --strict --include-untracked` 原生退出 0：13 行 covered=13、open=0、RED=0；L1 名称可解析，五条新增 EMA 行的 L2 由手算/旧精确向量/独立指数权重及实际回退变异锁定。`docs:check` 退出 0（0 error、182 条长度/历史字段等提醒）、`docs:impact -- --base df6cedd82fa3fe591615724259f83d16f6bb70fa --task M9-EMA-WARMUP-01`、`docs:status -- --check`、`git diff --check` 均退出 0。完整原始输出和即时退出码见 [root-gates](root-gates/docs-check.receipt.json)，矩阵快照及 SHA256 见 [matrix-final.json](artifacts/matrix-final.json)。

这是独立修复的集成门禁。后继 M9 统一候选仍须完成浏览器整批、主代理视觉、Windows 生产包和录像回放；此处未补造这些结果或人工验收。
