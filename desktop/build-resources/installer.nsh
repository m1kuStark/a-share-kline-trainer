; INSTALLER-UPGRADE-01：NSIS 安装包升级检测与呈现（矩阵行 INSTALLER-UPGRADE-DETECT）。
; 用户原话（2026-10-13 第五轮任务 5）：「安装包程序需要检测本地已经安装的 K 线训练器的
; 版本和安装位置，然后触发本体的 update 功能，继承本地版本数据的同时完成版本更新」。
;
; 机制依据（electron-builder v26.15.3 模板实证，阶段①侦察）：
;   - 本文件被 NsisTarget 拼在主安装脚本最前（customInclude），只定义宏不产生顶层指令；
;     customInit 宏在 installer.nsi 的 .onInit 内、initMultiUser 之后展开——此时安装模式
;     继承与安装位置记忆已完成（$INSTDIR 已预填为注册表 InstallLocation 的旧安装位置）。
;   - 宏体在展开点求值：${UNINSTALL_REGISTRY_KEY}/${INSTALL_REGISTRY_KEY}/${PRODUCT_NAME}
;     等编译期 define 由 multiUser.nsh/common.nsh 提供，展开时已生效。
;   - 同位置升级与数据目录继承由 electron-builder 内建承担，本钩子零写指令、不越位复刻：
;     installSection.nsh 调 uninstallOldVersion（installUtil.nsh）静默卸载旧版——命令行
;     固定 /S /KEEP_APP_DATA --updated，注释原文「always pass --updated flag - to ensure
;     that ... user data will be not removed」；随后新文件装入同一 $INSTDIR 并刷新注册表。
;     数据目录 %USERPROFILE%\.a-share-kline-trainer 不在安装目录（INSTALL-NSIS-ASSISTED
;     拍板：唯一默认数据目录），卸载/升级天然不触碰。
;   - 本钩子补齐的内建缺口：向导呈现「已装版本号」（electron-builder 安装模式页只呈现
;     安装位置——multiUserUi.nsh perUserInstallExists($folder)+reinstallUpgrade，不读
;     DisplayVersion）。
;   - 全新安装（无已装版本）不弹窗——呈现以「已装版本非空」为前提。
;
; UIUX-RELEASE-FIX（2026-10-17，用户报障）：向导默认安装位置继承了"目录已不存在"的
; 失效 InstallLocation（本机实证：打包冒烟残留的 per-machine 幽灵注册指向
; %TEMP%\pack05-nsis-…\installed，目录早已删除）——向导默认目录变成临时垃圾路径，
; 且升级话术承诺"安装到同一位置"。修复：customInit 内校验继承位置，目录不存在 ⇒
; 判为幽灵注册——先清除本用户失效登记（自愈），再重置为按用户默认位置
; （$LocalAppData\Programs\<应用名>；显式 /D 参数仍优先）；不作为升级呈现（无弹窗）。
; 存在性判定用 IfFileExists 目录通配，路径形态（8.3 短名/大小写）不影响结果。
!macro customInit
  ; 已装版本：卸载键 DisplayVersion（electron-builder registryAddInstallInfo 写入）。
  ; HKCU 优先（本产品 perMachine=false 默认按用户安装），HKLM 兜底（历史 per-machine 安装）。
  ReadRegStr $R8 HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${If} $R8 == ""
    ReadRegStr $R8 HKLM "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${EndIf}
  ${If} $R8 != ""
    ; 已装位置：与 initMultiUser 同源（INSTALL_REGISTRY_KEY 的 InstallLocation），双分支读取
    ReadRegStr $R9 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R9 == ""
      ReadRegStr $R9 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
    ${If} $R9 != ""
      ${IfNot} ${FileExists} "$R9\*.*"
        ; 幽灵注册：先清除本用户的失效登记（本产品键，目录已亡=登记无效，清除即自愈），
        ; 再经 setInstallModePerUser 重置——宏内部会重读 HKCU InstallLocation，不清键则
        ; 重置空转（仿真实测抓回的缺陷）；HKLM 侧幽灵无提权删不动，但宏切换到按用户
        ; 模式后 INSTDIR 落默认目录，HKLM 幽灵不再被继承。/D 显式参数仍优先。
        ; 标志必须归零（F1–F3 死循环根因）：initMultiUser 置位的 hasPerMachineInstallation
        ; 会在 customInit 之后被 Section "install" 静默分支再次消费——非零则调
        ; setInstallModePerAllUsers 重读 HKLM 幽灵 InstallLocation 把 $INSTDIR 拉回幽灵
        ; 路径，本守卫的复位被二次翻转（ghost-sim 运行时 marker 实证：守卫触发但安装
        ; 仍落幽灵目录）。
        DetailPrint "UIUX-GHOST-GUARD: stale location ignored: $R9"
        DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
        DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
        !insertmacro setInstallModePerUser
        StrCpy $hasPerMachineInstallation "0"
        StrCpy $hasPerUserInstallation "0"
        ; V5（INSTALL-GHOST-FOLDERSNAPSHOT，用户 2026-10-17 报障）：initMultiUser 在
        ; customInit 之前把 HKLM/HKCU InstallLocation 预读进快照变量
        ; （assistedInstaller.nsh:112/117），向导模式页消费快照渲染「已存在安装（位置：…）」
        ; （multiUserUi.nsh:203-216）、目录继承消费 $INSTDIR——V4 只归零 has* 标志，
        ; 快照仍带幽灵路径。两变量由 multiUser.nsh 顶层 Var 声明，此处仅 StrCpy 清值。
        StrCpy $perMachineInstallationFolder ""
        StrCpy $perUserInstallationFolder ""
        StrCpy $R8 ""
        StrCpy $R9 ""
      ${EndIf}
    ${EndIf}
    ${If} $R8 != ""
      ${If} $R9 == ""
        MessageBox MB_OK|MB_ICONINFORMATION "检测到已安装 ${PRODUCT_NAME} v$R8。$\r$\n$\r$\n本次安装将按升级路径执行：原位置升级，用户数据目录完整保留，无需迁移。"
      ${Else}
        MessageBox MB_OK|MB_ICONINFORMATION "检测到已安装 ${PRODUCT_NAME} v$R8（安装位置：$R9）。$\r$\n$\r$\n本次安装将按升级路径执行：安装到同一位置，用户数据目录完整保留，无需迁移。"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
