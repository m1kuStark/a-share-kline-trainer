# UIUX-RELEASE-FIX：v1.3.0 安装路径幽灵继承——死循环根因分析与修复记录

> 2026-10-17。接力自 UI/UX 重构会话（sess_1bcefa9b）F1–F5 修复迭代（五轮未解）。
> 本文档同时是失败模式的工程沉淀（用户指示：积累经验到工程文档）。
> 修复 commit＝9baae70；矩阵行 INSTALL-GHOST-SELFHEAL（covered，4 用例）。

## 一、问题全景

用户安装 v1.3.0（同号重发包）时，向导默认路径显示为已删除的开发冒烟临时目录
（`%TEMP%\pack05-nsis-…\installed`），并出现不该有的升级弹窗。前一会话五轮修复
（F1–F5）全部失败，陷入"改→打包→ghost-sim 验证 FAIL→再改"死循环。

## 二、根因链（三层）

### 2.1 技术根因：守卫复位被二次翻转（F1–F3 无效的机制）

electron-builder v26.15.3 NSIS 模板执行序（模板源码实证，`app-builder-lib/templates/nsis/`）：

1. `.onInit` → `initMultiUser`（assistedInstaller.nsh:84）：读 HKLM/HKCU `InstallLocation`
   进 `$perMachineInstallationFolder/$perUserInstallationFolder`，置位
   `$hasPerMachineInstallation/$hasPerUserInstallation` 标志；仅 per-machine 有登记（HKLM 幽灵）
   → `setInstallModePerAllUsers` → `$INSTDIR`＝HKLM 幽灵路径。
2. `.onInit` → `customInit`（我们的守卫，installer.nsi:79-80）：检测目录不存在 → 清 HKCU 键
   → `setInstallModePerUser`（宏重读 HKCU，空则落默认目录）→ `$INSTDIR` 一度复位正确。
   **但标志 `$hasPerMachineInstallation` 仍是 "1"（守卫没归零）。**
3. `Section "install"`（installer.nsi:101）：`${if} $hasPerMachineInstallation == "1"
   ${andIf} ${Silent}` → `setInstallModePerAllUsers` → **宏重读 HKLM 幽灵 → `$INSTDIR`
   又变回幽灵路径** → 安装落幽灵目录。

F1–F3 的全部修改都在 customInit 内（清不同的键、调不同的宏），永远打不中第 3 步的
二次翻转——**修改点错位**：在下游修上游已置位、且会被再消费的标志。修复＝守卫内两行：

```nsis
StrCpy $hasPerMachineInstallation "0"
StrCpy $hasPerUserInstallation "0"
```

（F4 的运行时 marker 已实证守卫触发但安装仍落幽灵——证据与根因吻合。）

### 2.2 环境根因：冒烟残留的幽灵注册被当产品缺陷反复追打

HKLM 幽灵键源于本地打包冒烟（pack05）以 per-machine 形态安装到 `%TEMP%` 后目录被删——
**先有环境残留，后有产品健壮性缺口**。正确姿势是两条腿：环境清理（一次性）＋产品自愈
（本修复，给未来所有机器兜底）。前会话在两者间摇摆，拉长了循环。

### 2.3 流程根因（用户点名的失败模式）

1. **语义跃迁未经确认**：用户要求"v1.2.7 改动回退"，会话将其自行解释为"v1.2.7 迁移能力
   整体退役"（删 43 文件 −12415 行，commit 073612c）——**该解释未获用户确认**即执行了
   大破坏性动作；agent 仅在答复里附带"若本意不同可 revert"。
2. **版本身份混淆**：验收 v1.3.0 的语境里，把 v1.2.7 环境资产（桌面目录）当作待清残留
   一并清除，未区分"测试资产"与"用户资产"。
3. **验证失败后的猜测循环**：FAIL 后未回到上游（模板源码数据流）定位消费者，而是猜
   下一个修改点；五轮后仍卡在同一层面。破局动作＝读 `installer.nsi/multiUser.nsh/
   assistedInstaller.nsh` 画出 INSTDIR 的全部读写点（本会话 30 分钟定位）。

## 三、修复与验证

- **修复**（9baae70）：installer.nsh 守卫补标志归零＋marker 调试代码退役；测试 9 用例
  （RED 2 失败=新行为缺失 → GREEN 9/9；既有"零写指令"用例随幽灵自愈语义演进为
  "写面收敛"——唯一受控写=两条 HKCU 登记清除，正负断言双向留痕）。
- **T1 决定性验证**（HKLM 幽灵 1:1 用户场景，干净机器状态）：HKLM 幽灵键在场＋`/S` 无
  `/D` 静默安装 → 落 `%LocalAppData%\Programs\a-share-kline-trainer`（per-user 默认目录）、
  幽灵路径未重建、HKCU 新登记正确。ghost-sim 的期望目录名错误（productName`K线训练器` vs
  实际 APP_FILENAME `a-share-kline-trainer`）已订正于 lab 副本。
- **覆盖边界（如实）**：向导模式（非 /S）与 HKCU 幽灵场景的行为等价性由模板契约锁定
  （同一标志变量），真机向导验收留用户。

## 四、验证工具侧坑（登记，非产品缺陷）

1. ghost-sim.cjs 的 `spawn(setup, ['/S /D=…'], {windowsVerbatimArguments:true})` 单串参数
   形态挂起（NSIS 不识别该 argv 形态）；`cmd /c "<setup> /S /D=…"` 形态正常。
2. **假路径调用卸载器是脏操作**：`Uninstall*.exe /S _?=C:\nonexistent` 触发 NSIS 卸载器
   自我复制机制，在 `%TEMP%\~nsu.tmp\Un_A.exe` 留副本——之后所有 `/S` 安装挂起
   （本会话实测：清该副本前 T2/T3/T4 全挂，T1 是唯一干净窗口）。清场时卸载器必须用
   真实 `_?=<实际卸载器路径>`，或经控制面板/quiet uninstall string。
3. NSIS `/D=` 参数必须反斜杠路径且居末；ghost-sim 曾因正斜杠路径假 FAIL。

## 五、工程守则（沉淀）

1. **修安装器行为前先画数据流**：NSIS/electron-builder 的 `$INSTDIR` 有多个读写点
   （initMultiUser 宏、customInit、Section 分支、目录页），任何"改了没用"的循环＝
   存在未打中的消费者——回模板源码全量枚举，不要在已失败层面继续猜。
2. **大破坏性动作（退役/删除/重发布）必须先向用户确认语义**，"可 revert"不是授权。
3. **环境残留与产品缺陷分轨**：残留（注册表/临时目录）先清场复现，产品侧只修健壮性
   缺口（自愈/防御），两者收据分开记录。
4. 验收机器清场清单：HKCU/HKLM 的 Install+Uninstall 双键、安装目录、`%TEMP%\~nsu.tmp`、
   ghost 类临时目录、挂住的安装器进程——缺一项都可能让后续验证假失败。
