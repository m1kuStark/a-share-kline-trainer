# U5-BRIEF 冷审报告（独立 AI reviewer，用户 2026-10-19 拍板 9）

- 审查对象：`docs/engineering/portable-updater-review-brief.md`（worktree `D:\tmp\u5-brief`，分支 task/U5-BRIEF，基线 commit 0b34816）
- 审查人：独立 AI 冷审 reviewer（与简报作者无共享上下文；简报一切论断按假设对待，逐项对照代码验证）
- 纪律依据：ai-harness skill（证据优于声明；本文每个论断带「文件:行号」证据；纯假设项显式标注）
- 审查日期：2026-10-19

---

## 0. 已读清单（纪律注入，第一步完成）

1. `D:\Superlinear_Academy\Stock_WorkSpace\.zcode\skills\ai-harness\SKILL.md`（v1.11 全文——审查型任务纪律：证据优于声明、结论必须带代码/文件证据、gate 值语义 0=通过 1=失败）
2. 简报本体：`docs/engineering/portable-updater-review-brief.md`（全文 274 行）
3. 简报作者自查卡：`docs/verification/2026-10/U5-BRIEF/README.md`（只读，用于确认其自查口径）
4. 源码（只读，全文或关键区段）：`desktop/src/{main,portable-updater,desktop-updates,update-adapter,cn-feed,quit-state,update-ipc}.ts`、`server/src/update/{api,updater,updater-core,zip,manifest,status}.ts`（status.ts 全文）、`web/src/updateFlow.ts`、`web/src/components/TrainingSettings.vue`（575-640 区段）
5. 配置（只读）：`desktop/electron-builder.yml`、`desktop/build-resources/{installer.nsh,app-update.yml}`
6. 矩阵（只读）：`D:\Superlinear_Academy\Stock_WorkSpace\.zcode\skills\ai-harness\matrix\updater.yaml`（全文 481 行）
7. 验证记录（只读，定向抽查）：`docs/verification/2026-10/{PORT-UPD-01,DL-HANG-01,CN-FEED-01,MIRROR-URL-FIX,INSTALLER-UPGRADE-01}/README.md` 关键章节
8. 发布手册：`docs/release/desktop-release-manual.md` §四（grep 定向）
9. git 历史：简报 §7 引用的 8 个修复提交（6bd4ef5/6688067/b9e4623/d9e4be5/a713df2/de7878f/0109740/98348c6）逐一 `git log` 核对存在且主题吻合

---

## 1. 事实核验结果

### 1.1 抽查范围与方法

- **§1 防护清单：10/10 全查**（不是抽查 5 项，是全部）——每项打开对应文件核对函数名、行号、行为描述。
- **§2 代码位置索引：三链全部条目全查**（链 A 10 条、链 B 6 条、链 C 6 条）。
- 附带核验：§0 链路界定、§3 中断表的行号引用、§5 时序图与退出码、§6 yml 事实基线、§7 事故清单的提交 SHA 与验证记录章节引用。

### 1.2 核验通过项（抽样列举，全部属实）

| 简报论断 | 核验证据 | 结论 |
|---|---|---|
| §1-6 看门狗 90s：`desktop-updates.ts:171` 常量 / `:177-183` env 解析 fail-safe / `:241-252` fireStall / `:254-262` 进度重置 | 逐行比对 | 属实 |
| §1-8 uncaught 兜底：`main.ts:124-129` 双 handler＋`:112-122` formatUnknownError＋`:95-111` 注册最早化注释 | 逐行比对 | 属实 |
| §1-9 镜像常量已填 CloudBase：`manifest.ts:27` = `https://k-line-trainer-d9gbbg6il6bf8c320-1505768275.tcloudbaseapp.com/feed` | 直读 | 属实 |
| §1-5 prerelease grep 零命中 | 自跑 `grep -rn "prerelease\|allowPrerelease" desktop/src server/src web/src` → exit 1 零输出 | 属实 |
| §3-B B4/B5：trash 目录在包根旁 `updater.ts:210`（`.update-trash-${plan.attemptId}`） | 直读 | 属实 |
| §3-C 退出码 0/3/4：`renderReplaceScript` :195-213（ping / move→exit 3 / move 失败回滚→exit 4 / del 不阻塞 / start / exit 0），无 exit 2 | 逐行比对 | 属实 |
| §6 yml 基线：`electron-builder.yml:46-52`（oneClick:false :47 / perMachine:false :48 / allowToChangeInstallationDirectory:true :49） | 直读 | 属实 |
| §6 幽灵守卫：`installer.nsh:42-68`（HKCU 清键＋setInstallModePerUser＋has* 标志归零＋V5 快照清值） | 直读 | 属实 |
| §0 链 C fail-closed：`portable-updater.ts:495`「更新源未提供便携版产物…已拒绝更新」 | 直读 | 属实 |
| §7 八个修复提交 | `git log --oneline -1 <sha>` 全部存在且主题吻合 | 属实 |
| CN-FEED-01 §1.2 boot 时序限制、DL-HANG-01 §1.3 900s trickle 残余、MIRROR-URL-FIX §5.1 junction/§5.2 per-user 冒烟、INSTALLER-UPGRADE-01 §1.1/1.2 | grep 定向抽查原文 | 引用准确 |
| 发布手册 §四「zip：历史用户与离线环境兜底…同 Release 共存」（manual :59） | 直读 | 属实 |

### 1.3 事实纠错（简报需修，共 2 项）

**F1（§1-2，函数名错误）**：简报写「`server/src/update/api.ts:83-91`（**pickShaFromSums**：按名取唯一校验和，多处/缺失即拒）」。实际函数名是 **`parseSumsLine`**（`api.ts:84-93`；:84 签名、:90/:91 是「未列出/多个校验和」两拒分支）。行号 83-91 也偏一格（注释在 :83，函数体到 :93）。行为描述本身属实（Set 去重、found.size 0/>1 分拒）。

**F2（§5-3，矩阵行归属错误）**：简报写「清扫失败只留无害残留（**UPD-PORTABLE-DATA-INTACT 行锁定启动清理**）」。核对矩阵：UPD-PORTABLE-DATA-INTACT（updater.yaml:274-280）绑定的唯一测试是「generic feed → base/latest.yml 与 base/<资产名>（尾斜杠归一）」——**该测试锁的是 feed URL 拼接，与启动清理零语义交集（L1 名字对应都谈不上）**。真正锁定启动清理的用例（「便携形态清理的是用户 exe 旁的 .old 与数据目录 staging」「staging 照清但绝不以 execPath 副本为目标删 .old」）绑在 **UPD-PORTABLE-TARGET-ENV** 行（updater.yaml:307-308）。简报引用了错误的行 ID。

（其余全部抽查项通过。特别说明：简报 §2 各行号我逐条比对后均吻合或在 ±2 行容差内——唯一超过容差的就是 F1。）

---

## 2. §8 八问独立回答（基于我自己的代码阅读）

### Q1 中断点状态机有无漏步

- **(a) A 链 quitAndInstall 与 NSIS 交接**：我方证据——同步抛错有就地捕获（`main.ts:795-799` catch→plain quit），异步层面 quitAndInstall 之后主进程 return（`main.ts:801`），不再有我方代码参与；spawn 安装器到安装器进程真正启动之间是库域窗口。简报 A5 行的表述（「应用已退出或正在退出；安装器未跑→旧版本原样启动」）与代码一致。**认可，无新增缺口**。
- **(b) B 链 extract 归类**：**确实漏行**。`updater.ts:207` 先写 `state:'applying'`，`:209` extract 到 `update-work/<attemptId>-extract`，`:213` 才 performSwap。extract 阶段中断的机器状态＝**包文件零改动**（比 B4 更安全），但 status 已是 applying（UI 卡「正在安装」＋见 G1 的 409 阻断后果），且 extractDir 残留（无害，attemptId 隔离）。§3-B 表 B3→B4 之间应单列此行。简报自己在 Q1(b) 提出了疑问，我的答案：是漏项，且其机器状态与 B4 不同（安全态），应区分呈现。
- **(c) C 链 staging 写脚本与 spawn 之间窗口**：发生在 `quitAndInstall` 的 async 体内（`portable-updater.ts:557-566`：复验→render→writeFile→spawnDetached）。该窗口中途中断＝脚本未 spawn＝用户 exe 完好＝已被 C0 行（「主进程 drain/spawn 脚本前中断…用户 exe 完好」）语义覆盖。**无新增缺口**。
- **额外检查**：A 链 boot 检查 fire-and-forget 与退出竞态（`update-ipc.ts:56-80`＋`main.ts:163-174` sendUpdateEvent 窗口销毁丢弃）有防护；`before-quit` 在 quitState≠idle 时 no-op（`main.ts:828-834`），不会与 quitAndInstall 触发的退出双重关服务。**三表总体完备，唯一漏行＝extract（见 G2）**。

### Q2 恢复路径是否充分

- **B4/B5 断电 mid-swap**：评级 **P1**。数据无损（preserve 不在搬移清单，`updater-core.ts:36-38`），但包混杂＋trash 残留无任何启动期检测（grep server/src 无 `.update-trash` 的读取方）；用户恢复＝手工 rename trash 内容回包根（需知道这个语义，无指引）。**叠加 G1**：状态卡 applying 使后续 apply 永久 409，即用户即使手工把包修好，HTTP 在线更新通道也已自锁，只能手删 update-status.json 或改走全量包。
- **C2/C3 exe 缺失＋.old 在**：链 C 已退役（v1.3.0 起无便携产物，`portable-updater.ts:1-8` 头注＋矩阵 RELEASE-PORTABLE-METADATA 仍 covered 但发布侧 INSTALL-01 后不再产出便携条目）——现役触发面＝存量 ≤v1.2.7 便携用户＋AV 持锁/断电双条件叠加，评级 **P2**；若便携形态复活则升 **P1**（应用自身无法启动＝清理逻辑不可达，`cleanupPortableUpdateLeftovers` 挂在应用启动路径内 `main.ts:606-612`，自举死锁）。
- **最小修建议**（权衡启动面复杂度）：
  - B 链：不做自动回滚（包混杂场景自动删新文件语义难定），做**启动期检测＋提示**——server 启动时扫包根 `.update-trash-*` 目录，存在即在 /api/update/status 附加告警字段（或 UI 横幅）＋指引文案「检测到未完成更新的残留，可重启更新或手动恢复」。
  - C 链（复活前置）：boot 检查器不可能（应用起不来）——正确修法是**换替换策略**（如先放新名再交换）或至少接受「.old 旁放一个恢复.cmd」；短期最小修＝删掉脚本内 `del .old`（启动清理已存在，in-script del 纯冗余，见 G3）。

### Q3 时序竞态

- **(a) 固定 30s 后旧进程仍存活＋reuse 分支**：**不成立——reuse 分支呈现含混**。证据：`main.ts:624-628` reuse 分支直接 `createWindow(plan.url)`＋console.log，用户得到一个连着旧实例的窗口，**无任何「这是旧版本」的用户可见标识**；旧实例是挂起态（端口仍答 health 但版本陈旧）。三分支对照：`restart`（killOccupant→等退出→bind，`port-conflict.ts:135-158`）反而正确完成更新；`cancel` 退出后用户再双击即可。另注意 **coexist-guard 的第二 reuse 面**（`main.ts:654-658`，读 trainer-state.json 发现同数据目录活实例）——旧进程挂起时其 state 文件未清（退出时才清），新实例会再次走到 reuse/kill 裁决，等于多一次自救机会，但 reuse 答案的呈现同样含混。评级 P2 边缘（需旧进程挂过 30s＋用户选 reuse 双条件）。
- **(b) installPendingUpdate 与多次退出交叠**：`downloading` 在 finally 复位（`desktop-updates.ts:336`），排空窗口（drain prepare→shutdown→exit，数秒级）内渲染端仍可 invoke `downloadAndInstall`：守卫 `downloading=false`、`checked=true`（`:284-285`）→ **二次下载可启动**，随后进程退出中止之。后果良性（electron-updater 缓存可弃；quitAndInstall 安装的是已完成的缓存版本；`installPendingUpdate` 在消费点前置 false，`main.ts:789`，无重复安装）。但矩阵行「concurrent download requests are rejected with a human guard」只覆盖同时并发，不覆盖此窗口。评级 P3。最小修：controller 加 `installRequested` 标志，`requestInstallWithDrain` 置位后拒绝新 downloadAndInstall。
- **(c) boot 检查 auto 默认计划**：代码证据 `main.ts:738`（setupUpdateChannel）先于 `:741`（bootServerAndOpen，内含 :606 portableUpdateDataDir 回填）。我的判定＝**不需收口**：影响仅限非 auto 用户的 boot 检查多打一次镜像（结果同源，CN-FEED-01 §1.2 已登记为 proposed_default）；唯一实际代价是 boot-check.json 观测缝的 sources 会记录 cn-mirror 尝试，诊断时有轻微误导。登记为已知限制即可，重构启动序（UPD-BOOT-AUTO-CHECK「注册即检查」冻结语义）得不偿失。

### Q4 杀软系列（逐问）

1. **②rename 持锁**：exit 3 已防护——`renderReplaceScript:196-199`（`if not errorlevel 1 goto renamed_ok`，失败即 exit 3，旧 exe/staging 原样）。认可简报。
2. **③staging move 后、④del .old 前隔离新 exe**：**缺口，简报未列**——见 G3。脚本时序是 del .old **先于** start（`:209-211`），新 exe 被隔离后 del 照常执行，结果「exe 与 .old 双亡」，比 C2 更深（C2 尚有 .old 可手工恢复）。评级 P2（retired 链）；若便携复活为 P1。
3. **NSIS mid-way 隔离 dll**：等同 A7 中断窗口②（新旧混杂），库域 unknown；缓解＝安装器可重跑（用户重新下载 setup 或从缓存找——缓存路径无 UI 暴露，实际自助＝重新下载）。与简报判断一致。
4. **隔离缓存中的 blockmap**：electron-updater 差分下载强依赖 blockmap（latest.yml 同目录 .blockmap 文件），缺失/损坏时库行为＝退化为整包重下（库域，repo 无测试＝unknown），影响＝流量浪费不致砖（缓存可弃＋90s 看门狗兜死寂）。**纯库域推断，无 repo 代码依据**。
5. **杀 detached 更新器（B 链）**：状态停在 backing_up/applying——**简报只问了 UI 指引是否足够，漏了更硬的后果**：`api.ts:325-328` 的 apply 守卫持久读 status 文件，`isBusyUpdateState` 含全部五busy 态（`status.ts:15`），而 `reconcileUpdateStatus` 只把 restarting→completed（`status.ts:92-99`），**无任何路径把陈旧 busy 态复位为 failed**（grep 全 server/src：writeUpdateStatus 调用方只有 api.ts catch 的 failed 与 updater.ts 自身）。后果＝**后续 apply 永久 409 UPDATE_IN_PROGRESS**，指引只教「手动运行 Start.cmd」（`TrainingSettings.vue:621`），不教删 update-status.json——**自救不充分**。见 G1（P1）。

### Q5 矩阵文本漂移

1. **UPD-PORTABLE-ROLLBACK 的「exit 2」**（updater.yaml:267）：漂移确认——现行 `renderReplaceScript` 退出码仅 0/3/4（`portable-updater.ts:196-213`）。**我的建议：修 EARS 而非标 superseded**——理由：该行的回滚语义（exit 3 零触碰/exit 4 复位）仍然活着且被冒烟用例锁定，整行 superseded 会造成语义空窗；正确动作＝删去 EARS 中「超时零触碰 exit 2」子句＋binding_note 注明「exit 2 分支随 P0-6 固定延时删除，现行语义由 UPD-PORTABLE-REPLACE-EXEC 承载」。
2. **新发现：UPD-PORTABLE-REPLACE-SCRIPT 行同样漂移且简报漏标**（updater.yaml:257-265）——EARS 仍写「**轮询等旧 pid 消失**…→app.exit(0)」，实际（P0-5/P0-6 后）＝ping 固定延时＋`quitApp: () => app.quit()`（`main.ts:430`）；该行 status=covered、未加任何退役/过时标注，现行语义整段由 UPD-PORTABLE-REPLACE-EXEC 行承载。这是比 ROLLBACK 行更彻底的整段漂移。
3. **两行 superseded 表述是否足以防误读**：RELEASE-PORTABLE-YAML-VALID 的 EARS 首句内联了「已随 INSTALL-UPD-01 便携条目扩展退役」＋oracle 补充（updater.yaml:291-293）——足以防误读；UPD-PORTABLE-DOWNLOAD-VERIFY（updater.yaml:250-256）EARS 仍是活语义句式，只靠 status: superseded＋binding_note 辨别——**建议统一为 EARS 首句内联退役标记**（照 YAML-VALID 样式）。
4. **附带卫生问题（简报均未提）**：① ROLLBACK 行 test_ids 重复列同一用例两次（updater.yaml:271-272）；② UPD-CN-FALLBACK-DESKTOP binding_note 仍写「镜像常量 CN_MIRROR_BASE 当前空串＝安全退化，W4 填真实 URL」（updater.yaml:411）——常量 v1.3.2 起已填（manifest.ts:27），注记过期；③ `server/test/updater-feed-setting.test.ts:116` 用例标题仍写「内置常量当前为空串」，断言已在 :119-120 更新为真实 URL——标题漂移（无红测试，纯卫生）。

### Q6 链 B 兜底定位复核

**应在文档显式披露，当前未披露**。发布手册 §四（manual:59）只说「zip 内置的 HTTP 在线更新（UPD-01/02）语义不变，同 Release 共存」——未提防护不对等：B 链有备份 5 份＋逆序回滚＋preserve 核验（updater-core.ts/updater.ts），A 链无应用级备份（结构性替代＝数据目录在安装目录外＋NSIS KEEP_APP_DATA）。方向上这个不对等是合理的（zip 换装本质更危险所以需要备份；NSIS 安装器自带事务性），但 zip 用户应当知道自己的灾难恢复资产在哪（`<dataDir>/backups/update-<ts>/`＋包根旁 `.update-trash-*`）。建议：手册 §四加一段「zip 形态灾难恢复说明」。P2 文档项。

### Q7 per-machine 在线更新

**建议文档先行，不做真机矩阵前置**。依据：正式用户群默认 per-user（electron-builder.yml:48 perMachine:false；§6 幽灵注册历史证明 per-machine 暴露主要来自打包冒烟与个别自选）；管理员会话 VM 矩阵成本高收益低。两级方案：(a) 立即——发布手册/FAQ 声明「per-machine（为所有用户安装）形态请手动下载 setup exe 更新」；(b) 可选——desktop 检查 HKLM 安装键（键形已在 installer.nsh:34 使用），检测到即更新 UI 警示「此安装形态建议手动更新」。P2。

### Q8 prerelease 灰度代码级缺位

**值得补，成本一行＋一条断言**。现状：完全依赖 electron-updater 缺省 allowPrerelease=false（grep 零命中已验证）＋发布流程纪律（v1.3.1 prerelease 验证存档）。风险链：`mapCheckView` 的 compareVersions 会正常比较任何 offered 版本（desktop-updates.ts:96），一旦库缺省值变化或某处误设，RC 版本将无差别推给全量用户且无任何契约拦截。修法：`adaptElectronUpdater` 显式 `updater.allowPrerelease = false`（ElectronUpdaterLike 加字段，update-adapter.ts:10-22）＋desktop-updates-fixture.test.ts 断言。P2 建议项。

---

## 3. 反向找漏（三张中断表之外，冷审核心）

| # | 漏项 | 链 | 代码依据 | 评级 |
|---|---|---|---|---|
| G1 | **busy 状态自锁**：更新器/服务在 downloading/verifying/backing_up/applying 任一态被杀后，apply 守卫永久 409（UPDATE_IN_PROGRESS），无超时/陈旧判定/启动期复位 | B | `api.ts:325-328`（守卫读文件）＋`status.ts:15`（BUSY_STATES 五态）＋`status.ts:92-99`（reconcile 仅 restarting→completed）＋grep 全 server/src 无其他复位路径 | **P1** |
| G2 | **extract 步骤缺行**：`updater.ts:207` 写 applying 后 `:209` 解压、`:213` 才 performSwap——解压中断＝包零改动安全态但状态/自锁后果同 G1，§3-B 表无此行 | B | 同上 | P2（表补行）＋并入 G1 修复 |
| G3 | **AV 在 ③后④前隔离新 exe**：del .old 先于 start 执行且不检查 start 成败→「exe 与 .old 双亡」深于 C2；且 `start "" /B` 失败脚本仍 exit 0 | C（retired） | `portable-updater.ts:209-213`（del→echo→start→exit 0 无条件检查）；启动清理 `cleanupPortableUpdateLeftovers` 使 in-script del 纯冗余 | P2（复活则 P1） |
| G4 | 排空窗口二次 downloadAndInstall 无守卫（Q3b，见上） | A | `desktop-updates.ts:284-285,336`＋`main.ts:772-811` | P3 |
| G5 | reuse 分支连旧实例无版本提示（Q3a，见上） | A/C 兜底 | `main.ts:624-628`＋`:654-658` | P2 边缘 |
| G6 | per-machine 双 Windows 用户并发更新同一 $INSTDIR | A | **纯假设无代码依据**（单实例锁 `main.ts:838` 只挡同用户；快速用户切换下两个 updaterCacheDir 写同一安装目录） | P3（假设） |
| G7 | 镜像 latest.yml 半写/半传 | 发布流程 | 有防护：`cn-feed.ts:126-131` 任何 checkForUpdates reject（含 YAML 解析失败）按源失败回退 GitHub；上传原子性在 sync-feed 产出目录之外（人工上传），repo 无代码控制 | 已覆盖（登记） |
| G8 | AppData 重定向/漫游配置档使 updaterCacheDirName 落网络盘 | A | **纯假设无代码依据**（app-update.yml:12 只给目录名，落点由 electron-updater 按 %LOCALAPPDATA% 解析，库域） | P3（假设） |
| G9 | backups 目录被 AV 锁死时 B 链回滚指引死路（「从备份目录恢复」不可达） | B | `updater-core.ts:196`（回滚失败文案）＋`:245-262`（restorePreserveFromBackup 也读备份） | P3（边缘之边缘） |

多实例并发更新（任务书举例项）：链 A 有单实例锁（`main.ts:838`）结构性防护；链 B 有 UPDATE_IN_PROGRESS＋activeAttempt 双守卫（`api.ts:325-328`；activeAttempt 内存态，双 apply 并发在单 server 进程内串行）——除 G1 的卡死变体外无并发缺口。下载中用户强杀：A3/B1 行已覆盖（缓存/下载目录可弃）。磁盘只读：B 链备份失败 fail（`updater.ts:200-204`）、C 链 move 失败 exit 3/4——已覆盖。

---

## 4. 恢复路径充分性判定（对简报标缺口点的独立评级）

| 简报缺口 | 我的评级 | 理由 | 最小修复 |
|---|---|---|---|
| B4/B5 断电 mid-swap（trash 残留、包混杂） | **P1**（需人工自救，非 P0） | 数据结构无损；包可手工恢复但无指引无检测；叠加 G1 使在线更新通道同时自锁 | 启动期 `.update-trash-*` 检测＋UI 提示（不自动回滚）；G1 的 stale busy 判定（updatedAt 超 30min 且无 activeAttempt → 视 failed 放行新 apply） |
| C2/C3 exe 缺失＋.old 在（应用无法自启） | **P2**（retired 链）/P1（若复活） | 存量 ≤v1.2.7 便携用户已被 fail-closed 引导改走安装器（`portable-updater.ts:495`）；触发需 AV 锁＋断电双条件；恢复动作极简（rename .old）但用户需知道 | 现在不修；**复活便携形态前置检查清单**必须含：删 in-script del .old（G3）＋恢复路径文档（.old 手工恢复指引随包附带） |

**P0 判定为零的依据**：三条链数据目录均与被替换物结构性分离（A：`%USERPROFILE%\.a-share-kline-trainer` 不在安装目录＋KEEP_APP_DATA，`installer.nsh:92-96`；B：preserve 集不在搬移清单，`updater-core.ts:36-38`；C：staging 落数据目录，`portable-updater.ts:512`）——最坏中断点均不触用户数据；live 主链（A）的最坏状态（A6/A7 安装目录损坏）可经重跑安装器恢复且数据完好。

---

## 5. 结论分级

### 事实纠错（须修简报，2 项）
- F1 §1-2：`pickShaFromSums` → 实名 `parseSumsLine`（api.ts:84-93）
- F2 §5-3：启动清理的锁定行是 UPD-PORTABLE-TARGET-ENV 而非 UPD-PORTABLE-DATA-INTACT（后者绑定测试是 feed URL 拼接）

### P0 缺口：0
### P1 缺口：2
1. **G1 B 链 busy 状态自锁**（任何更新中硬中断→后续 apply 永久 409，指引不含自救路径）——进产品待办
2. **B4/B5 断电 mid-swap 无恢复路径**（简报已标缺口，冷审确认 P1 并补充 G1 放大效应与最小修法）——进产品待办
### P2 缺口/改进：6
- G2 §3-B 补 extract 行；G3 便携复活前置（del .old 冗余＋start 不检查）；G5 reuse 呈现含混；Q5 矩阵 EARS 修订（ROLLBACK exit 2＋REPLACE-SCRIPT 轮询/app.exit 双漂移＋两处卫生）；Q6 发布手册补 zip 灾难恢复披露；Q7 per-machine 手动更新声明；Q8 allowPrerelease 显式锁定
### 建议项（可不做）：P3 共 4（G4 排空窗口守卫、G6/G8 假设项登记、G9 备份死路上限、矩阵卫生三条）

### 最薄弱三点（第三档标准）

1. **B 链中断自锁（G1）**——全链唯一「事故发生后在线更新功能永久失效」的点：一次杀软误杀 detached 更新器或断电，用户从此 409，且 15 次重连指引与 Start.cmd 指引均不含真正的自救动作（删 update-status.json）。
2. **A6/A7 NSIS 静默安装中断窗口（简报已标，冷审确认）**——live 主链路唯一直接损坏应用本体的点，完全库域、repo 无观测无恢复；缓存的 setup exe 路径无 UI 暴露，用户实际自助＝重新下载全量安装包。
3. **C 链 exe 缺失类变砖（C2/C3＋G3）**——代码仍在仓库且复活条件明确（恢复便携 target＋latest.yml 条目即整链复燃），但复活前置检查清单不存在；G3 表明现行脚本时序（del .old 先于 start）在 AV 场景下比简报记载的 C2 更深一层（双亡）。

### 与简报的分歧点汇总

1. 简报 Q4 对「杀 detached 更新器」只评估 UI 指引充分性——冷审认为真正的缺口是 409 永久阻断（G1），指引问题其次。
2. 简报 Q5 只标 UPD-PORTABLE-ROLLBACK 一处 EARS 漂移——冷审发现 UPD-PORTABLE-REPLACE-SCRIPT 行整段漂移（轮询/app.exit）＋UPD-CN-FALLBACK-DESKTOP binding_note「常量空串」过期，共三处。
3. 简报 Q1 自问 extract 归类——冷审裁决为确实漏行（G2），且机器状态应与 B4 区分呈现（安全态）。
4. 简报 §4.2/§3-C 对杀软场景的覆盖止于「等同断电」——冷审发现 ③后④前隔离新 exe 是杀软特有且深于断电的场景（G3，断电发生在 ④前会留下 .old，AV 隔离则可能双亡）。
5. 其余八个方面（三链两态界定、防护清单事实、时序图、per-machine 分析、事故史引用、prerelease 缺位判断、链 B 纳入范围的裁量、A 链排空守卫充分性）——冷审独立核验后与简报判断一致。

---

## 6. 收尾收据

- 本报告为唯一写入场（`docs/verification/2026-10/U5-BRIEF/cold-review.md`，新建）；未改简报本体、代码、矩阵、仓库其他任何文件。
- 证据口径：所有「文件:行号」基于 worktree task/U5-BRIEF@0b34816 实读；矩阵行号基于工作区 `.zcode/skills/ai-harness/matrix/updater.yaml` 实读。
- gate：**0**（冷审任务完成：事实核验≥5×2 项要求以 10/10＋全条目覆盖超出，八问全答，反向找漏 9 条各带依据或假设标注，恢复充分性给出评级与最小修，报告落盘并 commit）。
