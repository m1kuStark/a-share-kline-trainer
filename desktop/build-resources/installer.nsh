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
;   - 本钩子补齐的内建缺口仅一项：向导呈现「已装版本号」（electron-builder 安装模式页
;     只呈现安装位置——multiUserUi.nsh perUserInstallExists($folder)+reinstallUpgrade，
;     不读 DisplayVersion）。
;   - 全新安装（无已装版本）不弹窗——呈现以「已装版本非空」为前提。
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
    ${If} $R9 == ""
      MessageBox MB_OK|MB_ICONINFORMATION "检测到已安装 ${PRODUCT_NAME} v$R8。$\r$\n$\r$\n本次安装将按升级路径执行：原位置升级，用户数据目录完整保留，无需迁移。"
    ${Else}
      MessageBox MB_OK|MB_ICONINFORMATION "检测到已安装 ${PRODUCT_NAME} v$R8（安装位置：$R9）。$\r$\n$\r$\n本次安装将按升级路径执行：安装到同一位置，用户数据目录完整保留，无需迁移。"
    ${EndIf}
  ${EndIf}
!macroend
