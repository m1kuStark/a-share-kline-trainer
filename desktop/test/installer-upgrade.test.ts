// INSTALLER-UPGRADE-01（2026-10-13 第五轮任务 5）：NSIS 安装包升级检测——源形状契约测试。
// oracle 独立性（不从实现反推）：
//   - 用户原话（矩阵行 INSTALLER-UPGRADE-DETECT）：「安装包程序需要检测本地已经安装的
//     K 线训练器的版本和安装位置，然后触发本体的 update 功能，继承本地版本数据的同时
//     完成版本更新」——检测/呈现/同位置/数据继承四个确定性子语义由本文件锁定；
//     「触发本体 update 功能」的具体形态属 needs_user_decision（呈报解读 A/B，不实现）。
//   - electron-builder v26.15.3 NSIS 模板冻结契约（阶段①侦察，node_modules 模板原文）：
//     ① customInclude（buildResources/installer.nsh）由 NsisTarget.computeCommonInstallerScriptHeader
//        拼在主脚本最前（只定义宏）；customInit 宏在 installer.nsi .onInit 的 initMultiUser
//        之后展开——安装模式继承与安装位置记忆已完成。
//     ② 已装版本唯一权威来源＝卸载键 DisplayVersion（UNINSTALL_REGISTRY_KEY =
//        Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_GUID}，registryAddInstallInfo 写入；
//        本产品 appId io.github.m1kustark.a-share-kline-trainer → APP_GUID
//        01d71247-e302-5487-bcb6-a485f2fe0f31，UUIDv5 派生，无显式 guid 配置）。
//     ③ 已装位置来源＝INSTALL_REGISTRY_KEY（Software\{APP_GUID}）的 InstallLocation。
//     ④ 升级链（同位置＋数据继承）由内建 uninstallOldVersion 承担（installUtil.nsh：
//        静默卸旧装新，强制 /KEEP_APP_DATA + --updated）——钩子必须零写指令，不越位复刻。
//   - NSIS 硬约束：宏体在函数内展开，不得含 Var 声明（编译错）；makensis 以
//     -INPUTCHARSET UTF8 编译（NsisTarget.js），文件须 UTF-8 无 BOM。
// 测试形态选型：installer.nsh 是 NSIS 语法无法 vitest 直接执行——按仓库先例
// （release-desktop-lib.test.ts NSIS-ARTIFACT-PRODUCED／portable-updater-release.test.ts
// INSTALL-01 源码契约）采用「源形状契约测试」：读文件断言关键指令存在＋防破坏约束；
// 行为级验证（真机重复安装）留集成阶段（本任务纪律 6 不真实打包安装）。
// 2026-10-17 第九轮扩展（UNINSTALL-DATA-ASK）：卸载侧 customUnInstall 宏源形状契约
// （交互式卸载询问删/留训练数据目录）＋写面收敛断言随 oracle 收窄到 customInit 宏体。
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NSH_PATH = join(repoRoot, 'desktop', 'build-resources', 'installer.nsh')

/** 剥除 NSIS 注释（;/# 行注释到行尾；本仓库 installer.nsh 约定不含块注释），只留指令行 */
function stripNsisComments(source: string): string {
  return source
    .split(/\r?\n/)
    .map(line => {
      const idx = line.search(/[;#]/)
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
}

async function readInstallerNsh(): Promise<string> {
  return readFile(NSH_PATH, 'utf8')
}

/** 截取指定宏（!macro <name> … !macroend）的源体（含宏定义行）；宏不存在返回 '' */
function macroBody(source: string, name: string): string {
  const start = source.search(new RegExp(`!macro\\s+${name}\\b`))
  if (start === -1) return ''
  const end = source.indexOf('!macroend', start)
  return end === -1 ? '' : source.slice(start, end)
}

describe('INSTALLER-UPGRADE-DETECT: installer.nsh 升级检测源形状契约（检测已装版本与位置）', () => {
  it('INSTALL-UPGRADE：定义 customInit 宏且文件为 UTF-8 无 BOM（makensis INPUTCHARSET UTF8 前提）', async () => {
    const raw = await readFile(NSH_PATH) // Buffer：检查 BOM 用原始字节
    expect(raw.length).toBeGreaterThan(0)
    // UTF-8 BOM = EF BB BF；带 BOM 会污染首行指令（makensis -INPUTCHARSET UTF8 下不剥 BOM）
    expect(raw[0]).not.toBe(0xef)
    const source = raw.toString('utf8')
    // electron-builder 捡拾约定：buildResources/installer.nsh 中定义 customInit 宏
    expect(source).toMatch(/!macro\s+customInit\b/)
    expect(source).toMatch(/!macroend/)
  })

  it('INSTALL-UPGRADE：读取已装版本——卸载键 DisplayVersion，HKCU 优先回退 HKLM（per-user 优先，per-machine 兜底）', async () => {
    const code = stripNsisComments(await readInstallerNsh())
    // 已装版本唯一权威来源：UNINSTALL_REGISTRY_KEY 的 DisplayVersion（registryAddInstallInfo 写入）
    expect(code).toMatch(/ReadRegStr\s+\$\w+\s+HKCU\s+"\$\{UNINSTALL_REGISTRY_KEY\}"\s+DisplayVersion/)
    expect(code).toMatch(/ReadRegStr\s+\$\w+\s+HKLM\s+"\$\{UNINSTALL_REGISTRY_KEY\}"\s+DisplayVersion/)
    // HKCU 分支在前（per-user 优先：本产品 perMachine=false 默认按用户安装）
    const hkcu = code.indexOf('HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion'.replace(/\$\{/g, '${'))
    const hklm = code.indexOf('HKLM "${UNINSTALL_REGISTRY_KEY}" DisplayVersion'.replace(/\$\{/g, '${'))
    expect(hkcu).toBeGreaterThanOrEqual(0)
    expect(hklm).toBeGreaterThan(hkcu)
  })

  it('INSTALL-UPGRADE：读取已装位置——INSTALL_REGISTRY_KEY 的 InstallLocation，双注册表分支', async () => {
    const code = stripNsisComments(await readInstallerNsh())
    expect(code).toMatch(/ReadRegStr\s+\$\w+\s+HKCU\s+"\$\{INSTALL_REGISTRY_KEY\}"\s+InstallLocation/)
    expect(code).toMatch(/ReadRegStr\s+\$\w+\s+HKLM\s+"\$\{INSTALL_REGISTRY_KEY\}"\s+InstallLocation/)
  })

  it('INSTALL-UPGRADE：检测到已装版本时向导呈现升级信息（版本号＋位置＋同位置升级＋数据保留语义）', async () => {
    const code = stripNsisComments(await readInstallerNsh())
    // 呈现形态（proposed_default，提验）：customInit 时机（页面显示前）最小可见呈现＝MessageBox
    expect(code).toMatch(/MessageBox\s+MB_OK/)
    // 文案含升级语义与数据保留承诺（用户原话：继承本地版本数据）
    expect(code).toMatch(/升级/)
    expect(code).toMatch(/数据/)
    // 呈现必须以「已装版本非空」为条件——全新安装不弹（检测条件先于呈现）
    const condIdx = code.search(/\$\{If\}\s+\$\w+\s+!=\s*""/)
    const msgIdx = code.indexOf('MessageBox')
    expect(condIdx).toBeGreaterThanOrEqual(0)
    expect(msgIdx).toBeGreaterThan(condIdx)
  })

  it('UPGRADE-SILENT-SAFE：升级检测 MessageBox 带 /SD IDOK 且包在 ${IfNot} ${Silent} 守卫内（静默/自动更新链不得挂死等点击）', async () => {
    // 2026-10-24 P0（bug-loop RED）：NSIS MessageBox 无 /SD 在 silent 模式阻塞等待输入；
    // electron-updater 自动更新链正是以 /S 静默运行本安装器——检测到旧版登记即挂死
    // （3060 HKCU 旧键与本机 HKLM 键双实证；第二轮 3060「下载环节 20 分钟死寂」悬案同源）。
    const code = stripNsisComments(await readInstallerNsh())
    const init = macroBody(code, 'customInit')
    expect(init).not.toBe('')
    // 每个 MessageBox 语句都必须带 /SD IDOK（makensis 3.0.4 实证：/SD 须后置于文本引号，
    // 前置形态解析为 label 报错）——计数等式锁「无遗漏」
    const msgCount = (init.match(/MessageBox/g) ?? []).length
    const sdCount = (init.match(/\/SD IDOK/g) ?? []).length
    expect(msgCount).toBeGreaterThan(0)
    expect(sdCount).toBe(msgCount)
    // 双保险：守卫在外层包住全部 MessageBox（与 customUnInstall 宏同构造）
    const guardIdx = init.indexOf('${IfNot} ${Silent}')
    const firstMsg = init.indexOf('MessageBox')
    expect(guardIdx).toBeGreaterThanOrEqual(0)
    expect(guardIdx).toBeLessThan(firstMsg)
  })

  it('INSTALL-UPGRADE：钩子写面收敛——升级链由内建承担，唯一受控写＝幽灵自愈的两条登记清除（HKCU）', async () => {
    const code = stripNsisComments(await readInstallerNsh())
    // 写面收敛的 oracle 对象＝安装侧钩子 customInit：uninstallOldVersion（installUtil.nsh）
    // 已承担静默卸旧（/KEEP_APP_DATA + --updated）→装新到同 $INSTDIR，安装钩子的删除/写注册/
    // 执行指令＝越位（数据继承链被绕过的风险面）。
    // 例外（INSTALL-GHOST-SELFHEAL，2026-10-17）：幽灵 InstallLocation 自愈允许且仅允许
    // 两条受控登记清除（DeleteRegValue/DeleteRegKey，HKCU、守卫段内）——见幽灵自愈 describe。
    // 范围修订（2026-10-17 第九轮，UNINSTALL-DATA-ASK）：用户拍板卸载侧新增 customUnInstall
    // 宏（受控 RMDir 数据目录，询问式删除）——本用例断言自「全文件」收窄到 customInit 宏体，
    // 非放宽：卸载侧 RMDir 的全文件围栏（唯一目标＝数据目录、唯一位置＝customUnInstall 宏体）
    // 由 UNINSTALL-DATA-ASK describe 单独锁定。
    const init = macroBody(code, 'customInit')
    expect(init).not.toBe('')
    expect((init.match(/\bDeleteRegValue\b/g) ?? []).length).toBe(1)
    expect((init.match(/\bDeleteRegKey\b/g) ?? []).length).toBe(1)
    expect(init).not.toMatch(/\bDelete\b|\bRMDir\b/)
    expect(init).not.toMatch(/\bWriteRegStr\b|\bWriteRegDWORD\b|\bExecWait\b|\bExec\b|\bSetOutPath\b|\bCreateDirectory\b/)
    // 安装钩子不得知道数据目录路径（数据继承是结构性事实：数据不在安装目录）；
    // 卸载钩子对数据目录的知识属 UNINSTALL-DATA-ASK 授权面，由该 describe 围栏。
    expect(init).not.toContain('.a-share-kline-trainer')
  })
})

describe('INSTALL-GHOST-SELFHEAL: 幽灵 InstallLocation 自愈源形状契约（UIUX-RELEASE-FIX）', () => {
  // oracle（独立于实现）：electron-builder v26.15.3 模板冻结契约＋ghost-sim 真机仿真实证——
  // ① initMultiUser（.onInit，customInit 之前）把 HKLM/HKCU InstallLocation 读进
  //   $perMachineInstallationFolder/$perUserInstallationFolder 并置 has*Installation 标志；
  // ② customInit 之后 Section "install" 的静默分支再次消费 $hasPerMachineInstallation＝"1" →
  //   setInstallModePerAllUsers 重读 HKLM InstallLocation 写回 $INSTDIR——customInit 内不重置
  //   标志则守卫被二次翻转（F1–F3 三轮修复无效的根因，ghost-sim marker 实证）；
  // ③ setInstallModePerUser 宏重读 HKCU InstallLocation（非空即继承）——不清键则重置空转。
  // 用户报障（2026-10-16 msg 361）：安装向导默认路径指向已删除的冒烟临时目录＋异常升级弹窗。
  function ghostGuardBody(code: string): string {
    const start = code.indexOf('IfNot} ${FileExists} "$R9\\*.*"')
    if (start === -1) return ''
    const end = code.indexOf('${EndIf}', start)
    return end === -1 ? '' : code.slice(start, end)
  }

  it('INSTALL-GHOST：幽灵 InstallLocation 自愈重置安装模式标志（hasPerMachine/hasPerUser 归零，阻断静默分支二次继承）', async () => {
    const code = stripNsisComments(await readInstallerNsh())
    const guard = ghostGuardBody(code)
    expect(guard).not.toBe('')
    // 死循环根因修复：Section install 静默分支消费 hasPerMachineInstallation 再调
    // setInstallModePerAllUsers（重读 HKLM 幽灵写回 INSTDIR）——不归零则 customInit 的复位被翻转
    expect(guard).toContain('StrCpy $hasPerMachineInstallation "0"')
    expect(guard).toContain('StrCpy $hasPerUserInstallation "0"')
    // 清 HKCU 键后经宏重置（宏重读 HKCU，空则落 $LocalAppData\Programs 默认目录）
    expect(guard).toContain('DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"')
    expect(guard).toContain('DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"')
    expect(guard).toContain('!insertmacro setInstallModePerUser')
  })

  it('INSTALL-GHOST：自愈按全新安装呈现（清空升级话术变量，不弹升级窗）且仅清本用户登记（不触碰 HKLM）', async () => {
    const code = stripNsisComments(await readInstallerNsh())
    const guard = ghostGuardBody(code)
    expect(guard).toContain('StrCpy $R8 ""')
    expect(guard).toContain('StrCpy $R9 ""')
    expect(guard).not.toMatch(/DeleteReg(Value|Key)? HKLM/)
  })

  it('INSTALL-GHOST：无运行时调试残留（marker 文件写入不进发布包）', async () => {
    const code = stripNsisComments(await readInstallerNsh())
    expect(code).not.toContain('uiux-ghost-guard')
    expect(code).not.toMatch(/\bFileOpen\b|\bFileWrite\b|\bFileClose\b/)
  })
})

describe('INSTALL-GHOST-FOLDERSNAPSHOT: 幽灵拦截清空 initMultiUser 预读目录快照（V5）', () => {
  // oracle（矩阵行 INSTALL-GHOST-FOLDERSNAPSHOT，独立于实现）：
  //   - 用户报障（2026-10-17 第八轮任务 1）：装完新版验收后，安装向导中仍出现
  //     Temp\ghostsim-installed 幽灵路径——V4（9baae70）只归零 has* 标志未清 folder 快照。
  //   - electron-builder v26.15.3 模板冻结契约（本轮侦察，模板原文）：
  //     ① initMultiUser（assistedInstaller.nsh:112/117）在 customInit 之前把 HKLM/HKCU
  //        InstallLocation 预读进 $perMachineInstallationFolder/$perUserInstallationFolder；
  //     ② 向导模式页消费快照渲染（multiUserUi.nsh:203/205/214/216：
  //        "$(perUserInstallExists)($perUserInstallationFolder)" 等「已存在安装（位置：…）」
  //        文本，has* 标志门控）；目录页消费 $INSTDIR（setInstallModePerUser/PerAllUsers
  //        内快照→INSTDIR 继承，multiUser.nsh:26-28/75-77）。
  //   - 侦察结论（同类向导快照完备清单）：init 预读快照仅上述两个 folder 变量——
  //     common.nsh:86/95 的 $oldShortcutName/$oldMenuDirectory 是安装期快捷方式修复的
  //     惰性读取（消费时现读注册表，非 init 预读、不进向导页），不属于本清空面；
  //     无 uninstall display name 类快照。
  //   - NSIS 约束：两变量由 multiUser.nsh:19/60 顶层 Var 声明，宏体内只可 StrCpy 赋值。
  function ghostGuardBodyV5(code: string): string {
    const start = code.indexOf('IfNot} ${FileExists} "$R9\\*.*"')
    if (start === -1) return ''
    const end = code.indexOf('${EndIf}', start)
    return end === -1 ? '' : code.slice(start, end)
  }

  it('INSTALL-GHOST：幽灵拦截同时清空 initMultiUser 预读的目录快照变量（perMachine/perUser folder 归空，向导模式页/目录页不再渲染幽灵路径）', async () => {
    const code = stripNsisComments(await readInstallerNsh())
    const guard = ghostGuardBodyV5(code)
    expect(guard).not.toBe('')
    // V5 根因：initMultiUser 在 customInit 之前预读 InstallLocation 进快照变量，向导页消费
    // 快照渲染——V4 只归零 has* 标志，快照仍带幽灵值（用户 2026-10-17 报障实证）。
    expect(guard).toContain('StrCpy $perMachineInstallationFolder ""')
    expect(guard).toContain('StrCpy $perUserInstallationFolder ""')
  })
})

describe('INSTALLER-UPGRADE-DETECT: electron-builder.yml 升级语义前提锁定（配置防回归）', () => {
  it('INSTALL-UPGRADE：不覆盖 nsis include（保持 buildResources/installer.nsh 默认捡拾）且不启用 deleteAppDataOnUninstall', async () => {
    const yml = await readFile(join(repoRoot, 'desktop', 'electron-builder.yml'), 'utf8')
    // NsisTarget 默认 customInclude＝getResource(options.include ?? 'installer.nsh')：
    // 显式 include: 指向别处会让 buildResources/installer.nsh 静默失效
    expect(yml).not.toMatch(/^\s*include:/m)
    // 升级链双保险之外再加一道门：即便内建 uninstallOldVersion 对升级场景强制 --updated
    // （installUtil.nsh 注释原文：user data will be not removed），也永不配置卸载删数据
    expect(yml).not.toContain('deleteAppDataOnUninstall')
  })
})

describe('UNINSTALL-DATA-ASK: 卸载询问式数据目录清理源形状契约（customUnInstall 宏）', () => {
  // oracle（独立于实现，不从实现反推）：
  //   - 用户 2026-10-17 原话（第九轮）：「C:\Users\…\.a-share-kline-trainer 我注意到执行
  //     卸载程序时，这个数据目录不会跟着卸载干净，建议改为询问式，用户在卸载时可以自己
  //     决定要不要保留这些数据」——交互式卸载须询问删/留；选是删、选否完整保留不再打扰。
  //   - 数据目录口径＝desktop/src/data-home.ts 唯一默认 <homeDir>/.a-share-kline-trainer
  //     （os.homedir()＝%USERPROFILE%，NSIS 侧＝$PROFILE）。
  //   - electron-builder v26.15.3 模板冻结契约（侦察实证）：customUnInstall 宏在
  //     uninstaller.nsh 卸载 Section "un.Uninstall" 开头展开（:156-157），先于安装文件
  //     删除；内建 RMDir（:237）只删 $APPDATA\{APP_FILENAME}，够不到数据目录——必须自定义宏。
  //   - 升级链隔离＝静默守卫：installSection.nsh 调 uninstallOldVersion（installUtil.nsh）
  //     以 /S 静默运行卸载器（命令行固定 /KEEP_APP_DATA --updated＝升级强制保留数据），
  //     un.onInit 解析到 /S 即 SetSilent silent（uninstaller.nsh:15-19）——
  //     ${IfNot} ${Silent} 即可隔离升级链（模板同构造先例＝uninstaller.nsh:149）。
  //   - NSIS 编译红线：宏体在 Section 内展开不得含 Var 声明（编译错）。
  //   - 呈现形态 proposed_default（提验）：MessageBox MB_YESNO|MB_ICONQUESTION＋文案要点
  //     （删的是什么/选否完整保留）；具体措辞允许微调——断言只锁语义关键词，不锁整句。
  async function unInstallBody(): Promise<string> {
    const code = stripNsisComments(await readInstallerNsh())
    return macroBody(code, 'customUnInstall')
  }

  it('UNINSTALL-ASK：定义 customUnInstall 宏（卸载钩子存在）且宏体不含 Var 声明（Section 内展开编译红线）', async () => {
    const body = await unInstallBody()
    expect(body).not.toBe('')
    // 宏体在卸载 Section 内展开：Var 声明只能出现在顶层（NSIS 编译错红线，同 customInit 约定）
    expect(body).not.toMatch(/(^|\n)\s*Var\s/)
  })

  it('UNINSTALL-ASK：${IfNot} ${Silent} 守卫在外层包住询问与删除（静默/升级链一律不弹窗不删数据）', async () => {
    const body = await unInstallBody()
    expect(body).not.toBe('')
    expect(body).toContain('${IfNot} ${Silent}')
    // 守卫必须先于询问与删除（外层包住：MessageBox 与 RMDir 均在守卫之后）
    const guardIdx = body.indexOf('${IfNot} ${Silent}')
    expect(body.indexOf('MessageBox')).toBeGreaterThan(guardIdx)
    expect(body.indexOf('RMDir')).toBeGreaterThan(guardIdx)
  })

  it('UNINSTALL-ASK：目录存在才询问——${If} ${FileExists} 数据目录通配守卫先于 MessageBox（目录不存在不打扰）', async () => {
    const body = await unInstallBody()
    expect(body).not.toBe('')
    // 目录存在性判定用目录通配（IfFileExists "dir\*.*" 是 NSIS 目录存在惯用形，同 customInit 幽灵守卫）
    expect(body).toContain('${If} ${FileExists} "$PROFILE\\.a-share-kline-trainer\\*.*"')
    expect(body.indexOf('${If} ${FileExists}')).toBeLessThan(body.indexOf('MessageBox'))
  })

  it('UNINSTALL-ASK：询问＝MessageBox MB_YESNO|MB_ICONQUESTION，文案说清删的是什么与选否保留（proposed_default，锁语义不锁整句）', async () => {
    const body = await unInstallBody()
    expect(body).toMatch(/MessageBox\s+MB_YESNO\|MB_ICONQUESTION/)
    // 文案语义（用户原话：可以自己决定要不要保留）：删的内容含训练数据语义＋选否完整保留语义
    expect(body).toMatch(/训练/)
    expect(body).toMatch(/保留/)
  })

  it('UNINSTALL-ASK：选是 RMDir /r 数据目录、选否仅绕过——全文件 RMDir 围栏（唯一目标＝数据目录，唯一位置＝customUnInstall 宏体）', async () => {
    const code = stripNsisComments(await readInstallerNsh())
    const body = await unInstallBody()
    expect(body).toContain('RMDir /r "$PROFILE\\.a-share-kline-trainer"')
    // 全文件围栏：RMDir 只允许出现在 customUnInstall 宏体且仅此一处（安装钩子/其他位置零删除指令）
    const bodyRmDir = (body.match(/\bRMDir\b/g) ?? []).length
    const totalRmDir = (code.match(/\bRMDir\b/g) ?? []).length
    expect(bodyRmDir).toBe(1)
    expect(totalRmDir).toBe(bodyRmDir)
    // 分支语义（EARS：选是删除、选否则完整保留）——P4 变异抽检补强：
    // YES 落删除：MessageBox 的 IDYES 目标标签定义必须先于 RMDir（选『是』才执行删除）；
    // NO 绕过删除：询问与删除之间必须存在无条件 Goto（选『否』落 Goto 绕开 RMDir——
    // 删掉 Goto＝NO 路径直落删除＝无论选什么都删，此断言即杀手）。
    const idyes = body.match(/MessageBox\s+MB_YESNO\|MB_ICONQUESTION[^\r\n]*\bIDYES\s+(\S+)/)
    expect(idyes).not.toBeNull()
    const yesLabel = idyes![1]
    const yesLabelDef = body.indexOf(`${yesLabel}:`)
    expect(yesLabelDef).toBeGreaterThan(-1)
    expect(yesLabelDef).toBeLessThan(body.indexOf('RMDir'))
    const gotoIdx = body.indexOf('Goto')
    const msgIdx = body.indexOf('MessageBox')
    expect(gotoIdx).toBeGreaterThan(msgIdx)
    expect(gotoIdx).toBeLessThan(body.indexOf('RMDir'))
  })
})
