# 交接（2026-10-05 夜 · M6 图表交互线收官前后）

> 面向下一会话。本页记录 M6 全线状态、AI Native Harness 资产与用法、待办主线与实操陷阱。接续开发前按序读：`AGENTS.md`（工作区根，"一点五"节强制每轮调用 harness skill）→ `docs/status.md` → 本页 → `.control/trainer-state.json`（rev 54）。

## 1. 基线

- **仓库**：`D:\Superlinear_Academy\Stock_WorkSpace\a-share-kline-trainer`，工作树干净，`main = origin/main = 5c76ec4`。
- **发布线不变**：v1.2.7（tag=bbd368b）仍是最新公开版；本轮 M6 系列提交（45bd47a→5c76ec4 共 6 笔）**未发版**，下次打包自然带上。
- 全量门禁快照（M6-05 轮实测）：全量单测 1441/1441；全量 journey 99 通过/29 失败（**全部＝E2E-BASELINE-01 已知存量**）/3 未跑——29 项清单在 GITHUB-HEALTH-01 报告，勿当新回归。

## 2. M6 任务线状态（图表交互与账户动效）

| 任务 | 内容 | 状态 |
|---|---|---|
| M6-01 | KDJ 副图（TDX 口径 9,3,3，偏好开关） | ✅ 用户验收通过（2026-10-05），closed |
| M6-02 | 涨幅徽标（后被 M6-03 重构） | ✅ 验收通过，closed |
| M6-03 | 通达信式悬浮信息卡（停留 1 秒、十字线右下、含日期开高低收涨幅、左上角只留 MA、键盘即时） | ✅ 验收通过，closed |
| M6-04 | KDJ/VOL/MACD 三开关迁周期行 | ✅ 验收通过，closed |
| M6-05+R | Odometer（含 gate-miss 修复：OS reduce 误杀→应用级动效开关） | 修复经真实验证；随 06/07 一并复验后关闭 |
| M6-06 | 无幻影小数（滚动帧取整）＋tabular-nums 字宽稳定 | **待用户复验**（review） |
| M6-07 | 设置面板"动画效果"分栏（顶栏滚动按钮已移除） | **待用户复验**（review） |

- 验收环境：新标签页已交付（见 §5）；复验要点＝权益滚动无小数、收尾无字宽跳动、⚙ 设置动画分栏手感。
- **呈现类待拍板项**（实现为默认，用户说改就改）：悬浮卡星期/量能字段（默认不加）、KDJ 配色（K白/D黄/J紫）、动画分栏与开关文案、动画节奏量纲。

## 3. AI Native Harness（工作区级资产，下一会话必须继续用）

- **Skill**：`D:\Superlinear_Academy\Stock_WorkSpace\.zcode\skills\ai-harness\`（SKILL.md 五步纪律＋scripts＋matrix＋references＋adapters）。工作区 AGENTS.md"一点五"节强制每轮调用；**注入式派发同样有效**（subagent prompt 内嵌 SKILL.md 摘要——M6 三轮四次验证可行），派发模板要点：任务卡路径＋矩阵路径＋独立 oracle 表＋allowed_paths＋"越界先 AskUserQuestion"＋收尾报告六段式。
- **矩阵现状**（部署位为运行时真相，改动后同步 `ai-harness-lab/skill-v1/matrix/`）：
  - account-odometer：8/8 covered（strict=0）
  - chart-toggles：3/3 covered
  - kdj-subchart：4/5（KDJ-THEME-COLORS＝呈现债）
  - candle-percent-hover v2：10/11（CARD-EXTRA-FIELDS＝呈现债）
  - conditional-orders：9/20（**11 行声明债**：10 uncovered 盲区＋ORDER-TPLUS1-SELL proposed_default 等用户拍板）
- **关键文档**：`references/oracle.md`（L1/L2 规程＋环境信号门控条款＋动效断言细则＋契约实操细则——所有教训都在这）；`ai-harness-lab/proposals/consensus-ai-native-harness.md`（P0~P11 共识）；`ai-harness-lab/dialogue/harness-observations.md`（观察账本 25 条，skill 迭代输入）；台账 `ai-harness-lab/harness-state.jsonl`。
- **架构师-子代理分工已跑顺**：架构师锚定（卡＋矩阵＋独立 oracle）→ subagent RED→GREEN →架构师 5 分钟级复核（范围 diff＋oracle 独立性＋定向 gate 重跑）→提交。四轮零返修；效率 32~66 分钟/任务。

## 4. 未结主线（按优先级）

1. **M6-06/07 用户复验→关闭 M6 里程碑**（卡片与状态文件均在 review）。
2. **E2E-BASELINE-01**：29 项存量 journey 失败清偿（清单在卡内＋GITHUB-HEALTH-01 报告）——一切门禁降噪的前提。
3. **T+1 条件单卖出口径**（ORDER-TPLUS1-SELL，proposed_default：触发日不可卖→保持挂起＋记录原因、次日可再触发、昨日触发不锁存）——等用户拍板后实现。
4. conditional-orders 10 行盲区补测（建议首补 CREATE-RANGE-CLOSE-ON，与 v1.2.7 bug 同构相邻）。
5. 共识提案的仓库集成轮（矩阵入仓/docs:check 挂钩/ORCH-02 收据复活＋迁出 CODEX_HOME）——需用户授权后动仓库结构。
6. 小项：录像库再导出/备份方案（待拍板）；旧主目录迁移向导（待拍板）；退出失败误导文案；check-bug：checker 对含引号用例名的解析缺陷（现规避＝用例名避引号）。

## 5. 运行与验收环境（实操）

- 起服务（隔离库，勿用默认 `~/.a-share-kline-trainer`——那是用户真实数据）：
  `cd a-share-kline-trainer && TRAINER_DB='D:\Superlinear_Academy\Stock_WorkSpace\a-share-kline-trainer\.runs\m6-acceptance\trainer.sqlite' TDX_ROOT='D:\MySoftWares\TDX' node server/dist/index.js` → http://127.0.0.1:8787（前端改动后 `npm run build:web` 再刷新页面即可，服务不用重启）。当前有一个这样起的服务在后台跑。
- 验收页面：ZCode 内置浏览器（IAB）新标签页交付；**用新标签页，勿复用长驻旧页**（reload 后 Playwright 点击会持续超时）。
- e2e 单跑：`TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/<spec> --retries=0`；新测试文件先 `git add -N`；全量 journey 约 30 分钟。

## 6. 实操陷阱（血泪清单，详见 oracle.md/观察账本）

1. 页面 evaluate 字符串必须 IIFE：`(() => …)()`，函数字符串会被当表达式求值返回空对象。
2. 验证动画前确认数值真的会变（数据末日推进无权益变化→无动画是**正确行为**）。
3. Windows 到 GitHub 偶发连接重置——重试即可（本轮曾连不通十几分钟后自愈）。
4. 契约断言：CRLF 用 `\r?\n`；源码注释也是契约文本（负向断言会被注释关键词打红）；测试名避开双引号。
5. stash 基线对照 × `git add -N`：先 `git rm --cached` 再 stash。
6. 用户机器 `prefers-reduced-motion: reduce` 恒为 true——任何动效类功能**不得**用 OS 信号做一票否决（环境信号门控条款）。
7. Codex 协作（如需）：进程名 ChatGPT.exe，输入框 setValue＋回车发送（树每秒重编号，点击发送按钮易失配）；Sol Ultra 单轮 60~100 分钟属正常，运行中发消息会安全排队。

## 7. 本轮提交清单（全部已推）

45bd47a docs（M6-03/04/05 开卡＋M6 验收记录）→ ef956f5 feat（悬浮信息卡＋开关迁移）→ f4dd88d feat（Odometer）→ f5080cb fix（动效门改应用偏好）→ 274e1d4 docs（M6-06/07 开卡）→ 5c76ec4 feat（无幻影小数＋等宽＋设置分栏）。
