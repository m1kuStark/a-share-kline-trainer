# M9-01 验证记录（公式引擎 vendor＋适配层一期，2026-10-26）

- base `d0da14e`（立卡 docs 提交）；交付 commit `046634a`（feat，60 文件 +17024/−2）；root 合规修复随收口 docs commit
- 规格：docs/work-items/tasks/M9-01.md（冻结判断＋侦察 REPORT.md 缺口工单）；矩阵 formula-engine.yaml 8 行
- 纪律适配（root 预声明）：纯引擎零 UI，journey/e2e 不适用；替代收据＝全量 server 回归＋typecheck＋corpus smoke

## 门禁表（命令＝字面退出码；worker 执行，root 独立复跑标注 ※）

| 门禁 | 命令 | exit | 结果 |
|---|---|---|---|
| vendor 移植基线（patch 前） | `npx vitest run … server/test/formula-engine/` | 0 | 22/22 文件、**717/717＝上游全量移植**（非子集，用例数与上游逐字一致） |
| RED（patch 前） | 同上（patches＋corpus） | 1 | 24 失败＝缺功能正确原因；`<>` 守卫与 5 参拒绝 2 负例按预期绿 |
| GREEN 定向 ※ | 同上 | 0 | **24/24 文件、744/744 用例**（root 复跑一致） |
| typecheck ※ | `npm run typecheck:web` | 0 | 零 tsconfig 豁免、零上游类型改动（root 复跑一致） |
| 全量回归 R1/R2 | `npx vitest run --config server/vitest.config.ts` | 1/1 | 2528/2531 与 2529/2531，失败集完全轮换（history-report/review-profile/runtime-isolation/random-training-mode 超时型），四套件隔离复验全绿（25/25、16/16、15/15、33/33）＝负载性 flake（台账五轮同名先例），本卡目录不被其 import |
| 变异 MUT1 | BACKSET 窗口前后反转 | 1 | 4 杀手击杀→定点反转 patch 还原复绿 |
| 变异 MUT2 | 标记清单剔除 BACKSET | 1 | 1 杀手击杀→还原复绿 |
| corpus smoke ※（root 合规修复后） | `vitest … corpus-smoke.test.ts` | 0 | 3/3（root 复跑） |
| check-binding | `--strict --include-untracked` | 3→0 | 回填前 8 planned/exit 3（设计内）；root 回填 8 covered＋15 test_ids 后 exit 0 全解析 |

## corpus 回放对比（侦察基线 → 本轮）

| 指标 | 侦察基线 | 补丁后 |
|---|---|---|
| 解析通过 | 18/23 | **22/23**（唯一失败＝万能过左峰.md 编码伪影，测试内豁免并注明） |
| 执行通过 | 8/23 | **9/23**（基线 8 块逐名锁定零损失＋新增六龙连山-1） |
| 实盘单行版 | 左峰诅咒线/浪型背离 parse FAIL | **双 PASS** |

剩余执行失败全部归属后续卡：跨周期 3 块＋板块函数 4 块（M9-02/03）、语料抽取伪影 4 块＋参数区伪影 1 块（语料侧已登记）。

## 交付物

| 文件 | 说明 |
|---|---|
| web/src/formula-engine/** | 上游 v1.0.0 冻结基线 vendor（LICENSE＋README 来源/同步策略）＋补丁层：`!=`、语句级修饰（STICKLINE/表达式/赋值三形态）、DRAWNUMBER 四参、BACKSET、VARCAT/STRCAT、futureFunctions.ts 静态标记（13 函数起步清单） |
| server/test/formula-engine/ | 上游 22 套件全量移植（717）＋patches 27 用例＋corpus-smoke 3 用例（环境守卫醒目跳过） |
| 改动保真 | 8 文件全部为标注 `M9-01 patch` 的增量补丁，diff 核对无上游逻辑级改动 |

## root 复核与合规修复（2026-10-26）

- 断言抽查：BACKSET 三手算 oracle（单窗/并集/截断）、未来函数标记精确清单＋零误报、corpus 基线逐名锁定——均真实非空洞；独立复跑定向 744/744、typecheck、corpus 3/3、check-binding 全绿。
- **合规修复**：corpus-smoke 的 `maybeIt = hasCorpus ? it : it.skip` 别名链不被 check-binding 索引（skipIf 双括号同族已知盲区）——按既有解法改普通 it＋内联守卫（守卫语义不变：缺语料醒目 warn 后跳过断言体）；修复后 corpus 3/3＋矩阵 ref 全解析。
- **worker 缺口补位**：验证记录目录未落盘（报告数据完整），本文件由 root 依 worker 报告＋root 复跑收据补写并披露。

## 待用户拍板（M9-01 相关）

1. 同步策略追认：冻结 v1.0.0 不跟进上游，缺口以补丁层维护（README 已载明）。
2. FUTURE_FUNCTIONS 起步清单 13 项确认（BACKSET/FILTER/REFX/REFXV/ZIG/ZIGA/ZIG3/PEAK/PEAKBARS/TROUGH/TROUGHBARS/FINDHIGH/FINDLOW）。
3. VARCAT/STRCAT 数值参数「末根值转字符串」口径追认（速查表只冻结字符串口径）。
4. STRCAT 别名注册追认（卡面只名 VARCAT，按语料实证的「字符串拼接族」处理）。
