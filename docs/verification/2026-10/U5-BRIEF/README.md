# U5-BRIEF 验证记录：自更新链工程师审查简报（AI 冷审用）

- 任务卡：`docs/work-items/tasks/U5-BRIEF.md`（state planned→active，2026-10-19）
- worktree：`D:\tmp\u5-brief`（分支 task/U5-BRIEF，base=main@6533196）
- 交付物：`docs/engineering/portable-updater-review-brief.md`（下称「简报」）
- 纪律适配（root 预声明，本报告确认）：纯文档任务，零产品码改动——矩阵/TDD 不适用；
  替代收据＝七要素自查清单（下表）＋docs:check 新增错误为零（§2 收据）。

## 1. 七要素自查清单（对照任务卡验收要点逐项）

| # | 要素 | 在简报中的落点 | 自查结论 |
|---|---|---|---|
| 1 | 现有防护清单（每项代码位置＋矩阵行 ID） | §1 表（10 项：sha512/SHA256SUMS/备份 5 份/逆序回滚/prerelease 灰度/90s 看门狗/断线重连/uncaught 兜底/镜像回退/排空守卫） | 齐；prerelease 灰度如实标「无代码落点（发布流程层）＋unknown 项」；备份/回滚明示仅 zip 链有 |
| 2 | 关键代码位置索引（文件级＋函数级） | §2（链 A/B/C 三张索引表，函数名＋行号） | 齐 |
| 3 | 中断点状态机表 | §3（A：NSIS 链 8 步；B：zip 换装 7 步；C：retired 便携 cmd 6 步；每步「中断后状态/下次启动/自动恢复或需人工」三列） | 齐；含 exit 0/3/4 语义与 C2/C3「exe 缺失＋.old 在需人工」关键缺口 |
| 4 | 三类灾难恢复路径 | §4（断电按中断点归并／杀软 7 场景逐问／盘满 7 阶段逐项；有防护标防护、无防护明示缺口） | 齐 |
| 5 | .old 回滚时序与失败分支 | §5（ASCII 时序图＋exit 3/4 分支＋回滚自身失败的复合场景＋EARS 文本漂移警示） | 齐 |
| 6 | per-machine/per-user 双安装模式差异 | §6（yml 事实基线＋6 维对比表＋幽灵注册历史＋per-machine 在线更新 unknown） | 齐 |
| 7 | 历史事故清单 | §7（P0-1/P0-3/P0-4 关联/P0-5/P0-6/UPD-QUIT-TYPEERROR/DL-HANG/MIRROR-URL-FIX/相邻 junction 坏包；每条现象/根因/修复/矩阵行＋来源） | 齐 |
| 附 | reviewer 重点问题清单 | §8（8 问：漏步/恢复充分性/时序竞态/杀软系列/矩阵文本漂移/链 B 定位/per-machine/prerelease） | 齐 |
| 附 | live / retired-but-in-code 两态明示 | §0（三链状态表：A live 主链路／B live 兜底（root 简报未点名，按发布手册 §四 事实补入并标注）／C retired-but-in-code＋复活条件） | 齐 |

### 1.1 事实溯源方式（证据优于声明）

- 简报内每个事实均带「文件:行号」或矩阵行 ID/验证记录章节引用；未验证项显式标
  **unknown**（A6/A7 NSIS 库域中断行为、per-machine 静默更新、prerelease 隐式语义、
  electron-updater 缓存续传细节）。
- 关键行号均在 worktree 源码复核过一次（main.ts/desktop-updates.ts/cn-feed.ts/
  update-adapter.ts/portable-updater.ts/quit-state.ts/updater.ts/updater-core.ts/api.ts/
  updateFlow.ts/installer.nsh/electron-builder.yml/app-update.yml）。
- 修复提交 SHA 经 `git show --stat` 复核存在（6bd4ef5/d9e4be5 等，2026-10-11/12 日期吻合）。

### 1.2 需要说明的裁量（人工判断项，非臆造）

1. **链 B（zip HTTP 兜底链）纳入简报范围**：root 任务卡范围界定只点名 NSIS 链为现行生产链路，
   但任务要素 1 的「备份 5 份/逆序回滚」防护只存在于 zip 链，且发布手册 §四明文「zip 兜底形态
   与 NSIS 同 Release 共存」——不纳入则简报对主防护漏审。已在 §0 以事实来源标注此裁量，
   并列入 §8-6 请 reviewer 复核其定位（needs_user_decision 性质留给冷审结论）。
2. **相邻事故（junction asar 坏包）收录**：发布侧缺陷但直接影响可更新性，来源 MIRROR-URL-FIX §5.1
   披露，标注「无矩阵行（发布流程缺陷）」。
3. 简报长度 23989 字符触发 docs:check 长度 WARN（建议 5000）——按 docs.ts 语义
   「按主题审查，不自动截断」，且任务要求七要素自足完整，未删减。

## 2. docs:check 收据（门禁）

```
基线（改动前，main@6533196 worktree）：
  npm run docs:check → INFO check: 20 errors, 110 warnings
改动后（简报＋本 README＋任务卡 active）：
  npm run docs:check → INFO check: 20 errors, 111 warnings
错误集合逐行 diff（sort 后比对）：IDENTICAL——20 条错误与基线完全一致，新增错误为零。
新增 1 条 WARN＝简报自身长度提示（§1.2-3），非错误、非阻断。
```

结论：**docs:check 新增错误＝0**（主仓 20 条存量与本任务无关，集合未变），gate=0（0=通过）。

## 3. 改动清单

| 文件 | 改动 |
|---|---|
| `docs/engineering/portable-updater-review-brief.md` | 新建（简报，§0-§8＋溯源附录） |
| `docs/verification/2026-10/U5-BRIEF/README.md` | 新建（本文件） |
| `docs/work-items/tasks/U5-BRIEF.md` | state planned→active（docs_impact 同步义务） |

零产品码改动（desktop/src、server/src、web/src、matrix/*.yaml 均未触碰——矩阵只读引用）。

## 4. 遗留与移交

- 简报 §8 的 8 个问题是给独立 AI reviewer 的输入；冷审结论回填矩阵 updater.yaml 由 root 执行
  （本任务卡验收参考 docs/复盘缺口修补-开发计划.md）。
- 简报中标注的 unknown 项（NSIS 库域中断行为、per-machine 静默更新、prerelease 隐式语义）
  需真机/库源码验证后方可转事实——已全部显式标注，未当作已验证事实陈述。
