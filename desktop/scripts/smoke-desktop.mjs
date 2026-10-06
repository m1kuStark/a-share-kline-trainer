#!/usr/bin/env node
// PACK-01/02/03 便携 exe 打包冒烟（门禁判据；PACK-02 扩展生命周期断言；PACK-03 扩展数据防线断言）：
//   ① 便携 exe → 复制到未跟踪临时目录 → 启动 → /api/health 200 且 currentVersion 存在
//   ② web 首页 HTML 可达 → 窗口存在（标题「K线训练器」）
//   ③ 第二实例：同 exe 再启动 → 限时自然退出（单实例锁）且首实例存活
//   ④ 优雅退出（替代 PACK-01 强杀）：CloseMainWindow → 自然退出（exit 0）→ 端口可重绑＋health 拒连（无孤儿）
//   ⑤ 冲突 restart 注入：假训练器（独立 node 进程，isTrainerHealth 身份）占随机端口 →
//      TRAINER_DESKTOP_CONFLICT_ANSWER=restart → 假占用者被结束 → exe 自己的服务接管该端口
//   ⑥ PACK-03 首启发现/采用（阶段 F）：exe 复制到全新目录＋USERPROFILE 重定向到临时 home＋
//      预置伪造历史库（真实迁移建库＋settled 训练行）→ 无 TRAINER_DATA_DIR/TRAINER_DB env 启动 →
//      断言沿用该库（health＋/api/trainings/history 返回预置记录）＋exe 同级 data/ 未创建＋
//      desktop-data-choice.json mode=adopted；二次启动幂等（仍沿用、仍不新建 data/）
//   ⑧ PACK-04 更新通道（阶段 H）：本地 fixture HTTP 服务（latest.yml v9.9.9＋假安装器＋
//      sha512）＋TRAINER_DESKTOP_UPDATE_FEED 注入＋boot check 可观测缝（只查不装）→断言
//      packaged exe 通道=packaged 且 fixture 新版被真实检出（electron-updater 真实链路）。
//   ⑦ PACK-03 同库共存防线（阶段 G）：dataDir 预置活 trainer-state.json（记录假训练器 pid/端口）→
//      TRAINER_DESKTOP_CONFLICT_ANSWER=reuse 启动 → 假服务被健康探测＋exe 不启第二服务
//      （自身端口未 bind）＋不新建库文件
//   N PACK-05 NSIS 安装器门禁（--target nsis，--nsis-child 子模式）：静默安装（/S /D=场景
//      临时目录）→ 安装版 exe 启动（全套 profile 沙箱＋显式 TRAINER_DATA_DIR/TRAINER_DB）→
//      health/首页/窗口 → CloseMainWindow 优雅退出 exit 0 → 静默卸载（/S _?=）→ 无残留断言
//      （应用文件/新增 HKCU 卸载键/新增快捷方式消失＋窗口计数回落）。安装目录
//      resources/app-update.yml 存在断言＝PACK-04 extraResources 回退在 NSIS 形态的实证收口。
//      已知瞬态真实系统触碰（非用户数据，报告披露，卸载器自清理＋残留断言兜底）：桌面/开始
//      菜单快捷方式（NSIS $DESKTOP/$SMPROGRAMS 走 shell API，不受 env 重定向影响）＋HKCU
//      卸载注册表键（electron-builder 模板 installSection.nsh 静默分支仍建快捷方式、
//      uninstaller.nsh 卸载段无条件清理——2026-10-06 模板实证，见 PACK-05 design §1.2）。
// 隔离铁律：TRAINER_DATA_DIR/TRAINER_DB 指向临时目录，或阶段 F/N 以全套一致 profile env 重定向
// 到临时 home（USERPROFILE/APPDATA/LOCALAPPDATA/TEMP 等一起搬，见 spawnAdoptExe 注释），
// 绝不触碰真实用户数据（%USERPROFILE%\.a-share-kline-trainer 或任何既有 zip 包的 data/）；
// TDX_ROOT 置空；全程动态/随机端口，绝不动 8787 真实占用者；CloseMainWindow 只发给我们进程树的子进程。
// 用法：node desktop/scripts/smoke-desktop.mjs --exe <便携exe路径> [--keep]
//       node desktop/scripts/smoke-desktop.mjs --target nsis --installer <NSIS安装器路径> [--keep]
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, open, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const exeIndex = args.indexOf('--exe')
const exeArg = exeIndex >= 0 ? args[exeIndex + 1] : null
const installerIndex = args.indexOf('--installer')
const installerArg = installerIndex >= 0 ? args[installerIndex + 1] : null
const targetIndex = args.indexOf('--target')
const targetArg = targetIndex >= 0 ? args[targetIndex + 1] : 'portable'
const isNsisChild = args.includes('--nsis-child')
if (targetArg !== 'portable' && targetArg !== 'nsis') {
  console.error(`usage: --target must be portable or nsis (received ${JSON.stringify(targetArg)})`)
  process.exit(1)
}
if (!isNsisChild && targetArg === 'portable' && !exeArg) {
  console.error('usage: node desktop/scripts/smoke-desktop.mjs --exe <portable-exe-path> [--keep]')
  process.exit(1)
}
if (targetArg === 'nsis' && !installerArg) {
  console.error('usage: node desktop/scripts/smoke-desktop.mjs --target nsis --installer <nsis-setup-exe-path> [--keep]')
  process.exit(1)
}

/**
 * 阶段 F（首启发现/采用）全流程——在独立 node 宿主里执行：
 * 伪造历史库预置（真实迁移建库＋settled 行）→ 无 TRAINER_DATA_DIR/TRAINER_DB、全套一致
 * profile 沙箱重定向 spawn 打包 exe → 断言：health＋history 返回预置行（沿用该库）＋
 * exe 同级 data/ 未创建＋desktop-data-choice.json mode=adopted 指向伪造库 → 优雅退出 exit 0 →
 * 二次启动幂等（仍沿用、仍不新建、exit 0）。绝不触碰真实 %USERPROFILE%。
 */
async function runAdoptChild() {
  const sceneIndex = args.indexOf('--scene')
  const sceneDir = sceneIndex >= 0 ? args[sceneIndex + 1] : null
  if (!sceneDir) { console.error('[smoke] adoption: FAILED --adopt-child requires --scene'); process.exit(1) }
  let failures = 0
  const childLogHandles = []
  const fExeDir = join(sceneDir, 'f-exe')
  await mkdir(fExeDir, { recursive: true })
  const fExe = join(fExeDir, basename(exeArg))
  await copyFile(exeArg, fExe)
  const fakeHome = join(sceneDir, 'fake-home')
  const legacyLib = join(fakeHome, '.a-share-kline-trainer')
  const markerCode = 'SMOKEF1'
  await seedLegacyLibrary(join(legacyLib, 'trainer.sqlite'), markerCode)
  const fakeRoaming = join(fakeHome, 'AppData', 'Roaming')
  const fakeLocal = join(fakeHome, 'AppData', 'Local')
  const fakeTemp = join(fakeLocal, 'Temp')
  for (const dir of [fakeRoaming, fakeLocal, fakeTemp]) await mkdir(dir, { recursive: true })
  const fPort = await freeLoopbackPort()
  log('adoption-setup', `fExeDir=${fExeDir} fakeHome=${fakeHome} port=${fPort}`)

  const spawnAdoptExe = async (logName) => {
    const stderrLog = await open(join(sceneDir, logName), 'a')
    const stdoutLog = await open(join(sceneDir, `${logName}.out`), 'a')
    childLogHandles.push(stdoutLog, stderrLog)
    return spawn(fExe, [], {
      cwd: fExeDir,
      stdio: ['ignore', stdoutLog.fd, stderrLog.fd],
      windowsHide: true,
      // 关键：不给 TRAINER_DATA_DIR/TRAINER_DB（发现流程必须自己找到②）；
      // 全套 profile 一致重定向（只重定向 USERPROFILE 会留下不一致视图→原生崩溃）
      env: {
        ...process.env,
        USERPROFILE: fakeHome,
        HOMEDRIVE: fakeHome.slice(0, 2),
        HOMEPATH: fakeHome.slice(2),
        APPDATA: fakeRoaming,
        LOCALAPPDATA: fakeLocal,
        TEMP: fakeTemp,
        TMP: fakeTemp,
        PORT: String(fPort),
        TDX_ROOT: '',
        OPEN_BROWSER: '0',
      },
    })
  }

  const awaitHistoryHasMarker = async () => {
    const deadline = Date.now() + 120_000
    for (;;) {
      try {
        const probe = await fetchJson(`http://127.0.0.1:${fPort}/api/trainings/history`, 5_000)
        if (probe.status === 200) {
          const body = JSON.parse(probe.text)
          const items = Array.isArray(body.items) ? body.items : []
          if (items.some(item => item.code === markerCode)) return body
        }
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return null
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  const runOnce = async (logName, label) => {
    const child = await spawnAdoptExe(logName)
    let healthy = false
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const probe = await fetchJson(`http://127.0.0.1:${fPort}/api/health`, 3_000)
        if (probe.status === 200) { healthy = true; break }
      } catch { /* boot */ }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (!healthy) {
      failures++
      log(label, `FAILED exe never became healthy (exit=${child.exitCode})`)
      killTree(child.pid)
      return false
    }
    const history = await awaitHistoryHasMarker()
    if (!history) {
      failures++
      log(label, `FAILED history endpoint did not return the seeded marker row (${markerCode}) — legacy library not adopted`)
    } else {
      log(label, `legacy library adopted in place: history total=${history.total}, marker row visible`)
    }
    const freshDefaultData = await stat(join(fExeDir, 'data')).then(() => true).catch(() => false)
    if (freshDefaultData) { failures++; log(label, 'FAILED a fresh default data/ was created next to the exe') }
    else log(label, 'no fresh data/ created next to the exe')
    closeMainWindowOfChildren(child.pid)
    const quit = await waitForExit(child, GRACEFUL_EXIT_TIMEOUT_MS, 'adopt-exe')
    if (!quit.exited) { failures++; log(label, 'FAILED exe did not exit after window close'); killTree(child.pid) }
    else if (quit.code !== 0) { failures++; log(label, `FAILED exe exit code ${quit.code} (expected 0)`) }
    else log(label, `exe exited with code ${quit.code}`)
    return history !== null && !freshDefaultData && quit.exited && quit.code === 0
  }

  const first = await runOnce('exe-adopt-stderr.log', 'adoption')
  // 采用记录断言（首启后）：desktop-data-choice.json mode=adopted 指向伪造历史库
  const choiceRaw = await readFile(join(fExeDir, 'desktop-data-choice.json'), 'utf8').then(JSON.parse).catch(() => null)
  if (!choiceRaw || choiceRaw.mode !== 'adopted' || choiceRaw.dataDir !== legacyLib) {
    failures++; log('adoption', `FAILED choice record missing/wrong: ${JSON.stringify(choiceRaw)}`)
  } else log('adoption', `choice record mode=adopted -> ${choiceRaw.dataDir}`)
  if (first) {
    await new Promise(resolve => setTimeout(resolve, 2_000))
    await runOnce('exe-adopt2-stderr.log', 'adoption-idempotent')
  }
  if (failures > 0) {
    for (const handle of childLogHandles) { try { await handle.close() } catch { /* best-effort */ } }
    console.error(`[smoke] adoption-child FAIL failures=${failures}`)
    process.exit(1)
  }
  for (const handle of childLogHandles) { try { await handle.close() } catch { /* best-effort */ } }
  log('adoption-child', 'PASS')
  process.exit(0)
}

/**
 * 阶段 H（PACK-04 更新通道）全流程——独立 node 宿主执行（同阶段 F 宿主结论：全套 profile
 * 沙箱重定向的 exe 只能在全新宿主 spawn）：本地 fixture HTTP 服务（latest.yml v9.9.9＋假
 * 安装器＋sha512，测试侧独立计算）→ packaged exe 注入 TRAINER_DESKTOP_UPDATE_FEED＋
 * TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT（一次性 boot check 可观测性缝，只查不装）→
 * 断言 boot-check 结果：channel=packaged＋updateAvailable true＋latestVersion=9.9.9＋
 * currentVersion=1.2.7＋error null；fixture 服务确实收到 latest.yml 请求（真实 electron-updater
 * 链路，非桩）；优雅退出 exit 0。零 api.github.com；真实 %USERPROFILE% 绝不触碰
 * （spawn 前 fail-closed 断言全套重定向路径位于 scene 临时目录内）。
 */
async function runUpdateChild() {
  const sceneIndex = args.indexOf('--scene')
  const sceneDir = sceneIndex >= 0 ? args[sceneIndex + 1] : null
  if (!sceneDir) { console.error('[smoke] update-channel: FAILED --update-child requires --scene'); process.exit(1) }
  let failures = 0
  const { createHash, randomBytes } = await import('node:crypto')
  const { createServer } = await import('node:http')

  const FIXTURE_VERSION = '9.9.9'
  const artifact = Buffer.concat([Buffer.from([0x4d, 0x5a]), randomBytes(600_000)])
  const sha512 = createHash('sha512').update(artifact).digest('base64')
  const latestYml = [
    `version: ${FIXTURE_VERSION}`,
    `path: fake-installer-${FIXTURE_VERSION}.exe`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-10-05T00:00:00.000Z'",
    'files:',
    `  - url: fake-installer-${FIXTURE_VERSION}.exe`,
    `    sha512: ${sha512}`,
    `    size: ${artifact.length}`,
  ].join('\n')
  const servedPaths = []
  const feedServer = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    servedPaths.push(path)
    if (path === '/latest.yml') {
      response.writeHead(200, { 'content-type': 'text/yaml', 'content-length': Buffer.byteLength(latestYml) })
      response.end(latestYml)
      return
    }
    if (path === `/fake-installer-${FIXTURE_VERSION}.exe`) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': artifact.length })
      response.end(artifact)
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })
  await new Promise(resolve => { feedServer.listen(0, '127.0.0.1', resolve) })
  const feedPort = feedServer.address().port
  const feedUrl = `http://127.0.0.1:${feedPort}/`
  log('update-setup', `fixture feed ${feedUrl} (latest.yml v${FIXTURE_VERSION})`)

  const hExeDir = join(sceneDir, 'h-exe')
  await mkdir(hExeDir, { recursive: true })
  const hExe = join(hExeDir, basename(exeArg))
  await copyFile(exeArg, hExe)
  const fakeHome = join(sceneDir, 'h-fake-home')
  const fakeRoaming = join(fakeHome, 'AppData', 'Roaming')
  const fakeLocal = join(fakeHome, 'AppData', 'Local')
  const fakeTemp = join(fakeLocal, 'Temp')
  for (const dir of [fakeRoaming, fakeLocal, fakeTemp]) await mkdir(dir, { recursive: true })
  const hDataDir = join(sceneDir, 'h-data')
  const hPort = await freeLoopbackPort()
  const bootCheckOut = join(sceneDir, 'h-boot-check.json')
  // fail-closed（development-principles §五）：spawn 前断言重定向解析结果确实位于 scene 临时目录
  const resolvedFakeHome = await import('node:path').then(p => p.resolve(fakeHome))
  const resolvedScene = await import('node:path').then(p => p.resolve(sceneDir))
  if (!resolvedFakeHome.startsWith(resolvedScene)) {
    console.error(`[smoke] update-channel: FAILED profile redirect escapes the scene temp dir (${resolvedFakeHome} vs ${resolvedScene})`)
    process.exit(1)
  }

  const stderrLog = await open(join(sceneDir, 'exe-update-stderr.log'), 'a')
  const stdoutLog = await open(join(sceneDir, 'exe-update-stderr.log.out'), 'a')
  const child = spawn(hExe, [], {
    cwd: hExeDir,
    stdio: ['ignore', stdoutLog.fd, stderrLog.fd],
    windowsHide: true,
    env: {
      ...process.env,
      USERPROFILE: fakeHome,
      HOMEDRIVE: fakeHome.slice(0, 2),
      HOMEPATH: fakeHome.slice(2),
      APPDATA: fakeRoaming,
      LOCALAPPDATA: fakeLocal,
      TEMP: fakeTemp,
      TMP: fakeTemp,
      PORT: String(hPort),
      TRAINER_DATA_DIR: hDataDir,
      TRAINER_DB: join(hDataDir, 'trainer.sqlite'),
      TDX_ROOT: '',
      OPEN_BROWSER: '0',
      TRAINER_DESKTOP_UPDATE_FEED: feedUrl,
      TRAINER_DESKTOP_UPDATE_BOOT_CHECK_OUT: bootCheckOut,
    },
  })

  const deadline = Date.now() + 120_000
  let bootCheck = null
  while (Date.now() < deadline && child.exitCode === null) {
    bootCheck = await readFile(bootCheckOut, 'utf8').then(JSON.parse).catch(() => null)
    if (bootCheck !== null) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (bootCheck === null) {
    failures++
    log('update-channel', `FAILED boot check result never appeared (${bootCheckOut})`)
    killTree(child.pid)
  } else {
    if (bootCheck.channel !== 'packaged') { failures++; log('update-channel', `FAILED channel=${bootCheck.channel} (expected packaged)`) }
    else log('update-channel', `channel=packaged detected via IPC-facing boot check`)
    if (bootCheck.updateAvailable !== true || bootCheck.latestVersion !== FIXTURE_VERSION || bootCheck.error !== null) {
      failures++
      log('update-channel', `FAILED check view: ${JSON.stringify(bootCheck)}`)
    } else {
      log('update-channel', `fixture update detected: latest=${bootCheck.latestVersion} current=${bootCheck.currentVersion} updateAvailable=true`)
    }
  }
  // 真实链路证据：packaged exe 的 electron-updater 确实从本地 fixture 拉了 latest.yml（非桩）
  if (!servedPaths.includes('/latest.yml')) { failures++; log('update-channel', 'FAILED fixture server never served latest.yml (feed not exercised)') }
  else log('update-channel', `fixture served: ${[...new Set(servedPaths)].join(', ')}`)

  if (child.exitCode === null) {
    closeMainWindowOfChildren(child.pid)
    const quit = await waitForExit(child, GRACEFUL_EXIT_TIMEOUT_MS, 'update-exe')
    if (!quit.exited) { failures++; log('update-channel', 'FAILED exe did not exit after window close'); killTree(child.pid) }
    else if (quit.code !== 0) { failures++; log('update-channel', `FAILED exe exit code ${quit.code} (expected 0)`) }
    else log('update-channel', `exe exited with code ${quit.code} (boot check only; nothing installed)`)
  }
  await new Promise(resolve => { feedServer.close(() => resolve()) })
  for (const handle of [stderrLog, stdoutLog]) { try { await handle.close() } catch { /* best-effort */ } }
  if (failures > 0) { console.error(`[smoke] update-child FAIL failures=${failures}`); process.exit(1) }
  log('update-child', 'PASS')
  process.exit(0)
}

const HEALTH_TIMEOUT_MS = 120_000
const SECOND_INSTANCE_TIMEOUT_MS = 90_000
const GRACEFUL_EXIT_TIMEOUT_MS = 60_000
const CONFLICT_TAKEOVER_TIMEOUT_MS = 120_000
const KILL_TIMEOUT_MS = 30_000
const OVERALL_TIMEOUT_MS = 480_000
const NSIS_INSTALL_TIMEOUT_MS = 300_000
const NSIS_UNINSTALL_TIMEOUT_MS = 180_000
const WINDOW_TITLE = 'K线训练器'
const UNINSTALL_KEY_ROOT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'

/**
 * 阶段 N（PACK-05 NSIS 门禁）全流程——独立 node 宿主执行（同阶段 F/H 宿主结论）：
 * 静默安装（/S /D=场景临时目录）→ 安装目录断言（应用 exe＋resources/app-update.yml＝
 * PACK-04 extraResources 回退 NSIS 形态实证）→ 安装版 exe 全套 profile 沙箱＋显式数据
 * env 启动 → health/首页/窗口 → CloseMainWindow 优雅退出 → 静默卸载（/S _?=）→
 * 无残留断言。真实系统瞬态触碰（快捷方式＋HKCU 卸载键）先快照→检测→卸载→断言消失。
 * spawn 前 fail-closed 断言全部重定向解析结果位于场景临时目录（development-principles §五）。
 */
async function runNsisChild() {
  const sceneIndex = args.indexOf('--scene')
  const sceneDir = sceneIndex >= 0 ? args[sceneIndex + 1] : null
  if (!sceneDir) { console.error('[smoke] nsis: FAILED --nsis-child requires --scene'); process.exit(1) }
  if (!installerArg) { console.error('[smoke] nsis: FAILED --nsis-child requires --installer'); process.exit(1) }
  let failures = 0
  const resolvedScene = resolve(sceneDir)

  const installDir = join(sceneDir, 'installed')
  const fakeHome = join(sceneDir, 'n-fake-home')
  const fakeRoaming = join(fakeHome, 'AppData', 'Roaming')
  const fakeLocal = join(fakeHome, 'AppData', 'Local')
  const fakeTemp = join(fakeLocal, 'Temp')
  for (const dir of [fakeRoaming, fakeLocal, fakeTemp]) await mkdir(dir, { recursive: true })
  const dataDir = join(sceneDir, 'n-data')
  const port = await freeLoopbackPort()

  // fail-closed（development-principles §五）：spawn 前断言重定向解析结果确实位于场景临时目录
  for (const redirected of [fakeHome, fakeRoaming, fakeLocal, fakeTemp, dataDir]) {
    const resolved = resolve(redirected)
    if (!resolved.startsWith(resolvedScene)) {
      console.error(`[smoke] nsis: FAILED redirect escapes the scene temp dir (${resolved} vs ${resolvedScene})`)
      process.exit(1)
    }
  }
  // NSIS /D= 协议要求安装路径不带引号（spawn 逐参自动加引号会破坏解析）——路径含空格即 fail-closed 拒跑
  if (/\s/.test(installDir)) {
    console.error(`[smoke] nsis: FAILED install dir contains spaces (NSIS /D= unquoted protocol): ${installDir}`)
    process.exit(1)
  }
  log('nsis-setup', `installer=${installerArg} installDir=${installDir} port=${port}`)

  /** shell 目录经 API 解析（NSIS $DESKTOP/$SMPROGRAMS 同通道，env 重定向无效） */
  const shellFolder = (kind) => {
    try {
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `[Environment]::GetFolderPath('${kind}')`], { encoding: 'utf8', timeout: 15_000 }).trim()
    } catch {
      return null
    }
  }
  const listLnks = async (dir) => {
    if (!dir) return []
    try {
      return (await readdir(dir)).filter(name => name.toLowerCase().endsWith('.lnk')).sort()
    } catch {
      return []
    }
  }
  const uninstallKeys = () => {
    try {
      const out = execFileSync('reg', ['query', UNINSTALL_KEY_ROOT], { encoding: 'utf8', timeout: 15_000 })
      return out.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('HKEY_')).sort()
    } catch {
      return []
    }
  }

  const desktopDir = shellFolder('Desktop')
  const programsDir = shellFolder('Programs')
  const lnkSnapshot = async () => [
    ...(await listLnks(desktopDir)).map(name => join(desktopDir, name)),
    ...(await listLnks(programsDir)).map(name => join(programsDir, name)),
  ]
  const titleSnapshot = windowTitleCount(WINDOW_TITLE)

  // ===== 安装前快照 =====
  const lnkBefore = await lnkSnapshot()
  const keysBefore = uninstallKeys()
  log('nsis-snapshot', `desktop=${desktopDir} lnk=${lnkBefore.length} uninstallKeys=${keysBefore.length} windowTitles=${titleSnapshot}`)

  // ===== 静默安装：setup.exe /S /D=<installDir>（/D= 必须末参不带引号→windowsVerbatimArguments） =====
  const installerStat = await stat(installerArg)
  const installer = spawn(installerArg, [`/S /D=${installDir}`], { cwd: sceneDir, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
  const installResult = await waitForExit(installer, NSIS_INSTALL_TIMEOUT_MS, 'nsis-installer')
  if (!installResult.exited) { killTree(installer.pid); console.error(`[smoke] nsis-install: FAILED installer did not finish within ${NSIS_INSTALL_TIMEOUT_MS}ms`); process.exit(1) }
  if (installResult.code !== 0) { console.error(`[smoke] nsis-install: FAILED installer exit code ${installResult.code}`); process.exit(1) }
  log('nsis-install', `silent install finished (${(installerStat.size / 1024 / 1024).toFixed(1)} MB installer)`)

  // ===== 安装目录断言 =====
  const dirEntries = await readdir(installDir).catch(() => null)
  if (!dirEntries) { failures++; log('nsis-install', `FAILED install dir was not created: ${installDir}`) }
  else {
    const appExes = dirEntries.filter(name => name.toLowerCase().endsWith('.exe') && !/^uninstall/i.test(name))
    if (appExes.length !== 1) { failures++; log('nsis-install', `FAILED expected exactly one app exe, found ${JSON.stringify(appExes)}`) }
    const appUpdateYml = await stat(join(installDir, 'resources', 'app-update.yml')).then(() => true).catch(() => false)
    if (!appUpdateYml) { failures++; log('nsis-install', 'FAILED resources/app-update.yml missing from the installed app (PACK-04 fallback under NSIS form)') }
    else log('nsis-install', `installed app exe=${appExes[0] ?? '(missing)'}; resources/app-update.yml present (PACK-04 fallback intact under NSIS)`)
  }
  const appExePath = dirEntries
    ? join(installDir, dirEntries.find(name => name.toLowerCase().endsWith('.exe') && !/^uninstall/i.test(name)) ?? '')
    : null
  const uninstallerPath = dirEntries
    ? join(installDir, dirEntries.find(name => /^uninstall/i.test(name) && name.toLowerCase().endsWith('.exe')) ?? '')
    : null
  if (!appExePath || !uninstallerPath) {
    failures++
    log('nsis-install', `FAILED app exe or uninstaller not found in install dir: ${JSON.stringify(dirEntries)}`)
  }

  // ===== 安装后新增项检测（瞬态真实系统触碰：快捷方式＋HKCU 卸载键） =====
  const lnkAfterInstall = await lnkSnapshot()
  const createdLnks = lnkAfterInstall.filter(path => !lnkBefore.includes(path))
  if (createdLnks.length === 0) log('nsis-install', 'no shortcuts created (installer config or silent behavior) — residue assertion scoped accordingly')
  else log('nsis-install', `shortcuts created: ${createdLnks.map(path => basename(path)).join(', ')}`)
  const keysAfterInstall = uninstallKeys()
  const newKeys = keysAfterInstall.filter(key => !keysBefore.includes(key))
  if (newKeys.length > 1) { failures++; log('nsis-install', `FAILED more than one new HKCU uninstall key: ${newKeys.join(', ')}`) }
  const recordedKey = newKeys[0] ?? null
  if (recordedKey) {
    try {
      const detail = execFileSync('reg', ['query', recordedKey, '/v', 'InstallLocation'], { encoding: 'utf8', timeout: 15_000 })
      const location = /InstallLocation\s+REG_SZ\s+(\S*)/.exec(detail)?.[1] ?? ''
      if (location.trim() && resolve(location.trim()) !== resolve(installDir)) {
        failures++
        log('nsis-install', `FAILED uninstall key InstallLocation=${location} != ${installDir}`)
      } else {
        log('nsis-install', `HKCU uninstall key recorded (${basename(recordedKey)}) InstallLocation matches install dir`)
      }
    } catch { log('nsis-install', 'uninstall key InstallLocation not readable (recorded, not asserted)') }
  } else {
    log('nsis-install', 'no new HKCU uninstall key detected (recorded, not asserted)')
  }

  // ===== 启动安装版 exe（全套 profile 沙箱＋显式数据 env；fail-closed 已在 spawn 前断言） =====
  if (appExePath && !failures) {
    const stderrLog = await open(join(sceneDir, 'nsis-exe-stderr.log'), 'a')
    const stdoutLog = await open(join(sceneDir, 'nsis-exe-stderr.log.out'), 'a')
    // windowsHide 必须 false：node 的 STARTUPINFO SW_HIDE 会被直启的 Electron 首窗口继承
    // （win.show() 也不呈现；渲染进程照常运行、心跳可达——2026-10-06 诊断实证）。便携 exe
    // 不受影响：其窗口属于解压启动器二跳 spawn 的子进程，不携带该旗标（阶段 A 同参可显示）。
    const child = spawn(appExePath, [], {
      cwd: installDir,
      stdio: ['ignore', stdoutLog.fd, stderrLog.fd],
      windowsHide: false,
      env: {
        ...process.env,
        USERPROFILE: fakeHome,
        HOMEDRIVE: fakeHome.slice(0, 2),
        HOMEPATH: fakeHome.slice(2),
        APPDATA: fakeRoaming,
        LOCALAPPDATA: fakeLocal,
        TEMP: fakeTemp,
        TMP: fakeTemp,
        PORT: String(port),
        TRAINER_DATA_DIR: dataDir,
        TRAINER_DB: join(dataDir, 'trainer.sqlite'),
        TDX_ROOT: '',
        OPEN_BROWSER: '0',
      },
    })
    let healthy = null
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const probe = await fetchJson(`http://127.0.0.1:${port}/api/health`, 3_000)
        if (probe.status === 200) { healthy = JSON.parse(probe.text); break }
      } catch { /* boot */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 500))
    }
    if (!healthy) {
      failures++
      log('nsis-run', `FAILED installed exe never became healthy (exit=${child.exitCode})`)
      killTree(child.pid)
    } else {
      log('nsis-run', `health 200 status=${healthy.status} currentVersion=${healthy.currentVersion}`)
      const page = await fetchJson(`http://127.0.0.1:${port}/`, 5_000)
      if (page.status !== 200 || !/<html/i.test(page.text) || !/id="app"/i.test(page.text)) {
        failures++
        log('nsis-run', `FAILED homepage status=${page.status}`)
      } else log('nsis-run', 'homepage html ok')
      // 窗口出现＝有界等待（安装版免解压、启动快于便携：health 就绪时窗口可能尚未创建，一次性计数会误判 0）
      let titles = windowTitleCount(WINDOW_TITLE)
      if (titles === 0) {
        const titleDeadline = Date.now() + 30_000
        while (Date.now() < titleDeadline) {
          await new Promise(resolveWait => setTimeout(resolveWait, 500))
          titles = windowTitleCount(WINDOW_TITLE)
          if (titles > 0) break
        }
      }
      if (titles === -1) log('nsis-run', 'powershell unavailable; window check DEGRADED (recorded, not asserted)')
      else if (titles < 1) { failures++; log('nsis-run', `NO window titled ${WINDOW_TITLE} (count=${titles})`) }
      else log('nsis-run', `window titled ${WINDOW_TITLE} present (count=${titles})`)

      // 优雅关闭：安装版窗口属于 spawn 进程本体（便携 exe 是解压启动器、窗口在其子进程）——两者都关
      closeMainWindowOf(child.pid)
      closeMainWindowOfChildren(child.pid)
      const quit = await waitForExit(child, GRACEFUL_EXIT_TIMEOUT_MS, 'nsis-exe')
      if (!quit.exited) { failures++; log('nsis-run', 'FAILED installed exe did not exit after window close'); killTree(child.pid) }
      else if (quit.code !== 0) { failures++; log('nsis-run', `FAILED installed exe exit code ${quit.code} (expected 0)`) }
      else log('nsis-run', `graceful exit 0 after window close`)
      await new Promise(resolveWait => setTimeout(resolveWait, 1_000))
      const portReleased = await canBindLoopback(port)
      const healthRefused = !(await fetchJson(`http://127.0.0.1:${port}/api/health`, 3_000).then(() => true).catch(() => false))
      if (!portReleased || !healthRefused) { failures++; log('nsis-run', `FAILED no-orphan check: port released=${portReleased} health refused=${healthRefused}`) }
      else log('nsis-run', 'no orphan: port rebindable + health refused after exit')
    }
    for (const handle of [stderrLog, stdoutLog]) { try { await handle.close() } catch { /* best-effort */ } }
  }

  // ===== 静默卸载：Uninstall*.exe /S _?=<installDir>（_?= 阻止自拷贝副本、可等待退出） =====
  if (uninstallerPath && await stat(uninstallerPath).then(() => true).catch(() => false)) {
    const uninstaller = spawn(uninstallerPath, [`/S _?=${installDir}`], { cwd: installDir, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
    const uninstallResult = await waitForExit(uninstaller, NSIS_UNINSTALL_TIMEOUT_MS, 'nsis-uninstaller')
    if (!uninstallResult.exited) { killTree(uninstaller.pid); failures++; log('nsis-uninstall', `FAILED uninstaller did not finish within ${NSIS_UNINSTALL_TIMEOUT_MS}ms`) }
    else log('nsis-uninstall', `silent uninstall finished (exit ${uninstallResult.code})`)
  } else {
    failures++
    log('nsis-uninstall', 'FAILED uninstaller exe not found; cannot clean up real-system traces')
  }

  // ===== 无残留断言 =====
  await new Promise(resolveWait => setTimeout(resolveWait, 2_000))
  const remaining = await readdir(installDir).catch(() => [])
  const appRemains = remaining.filter(name => !/^uninstall/i.test(name))
  if (appRemains.length > 0) { failures++; log('nsis-residue', `FAILED app files remain after uninstall: ${appRemains.join(', ')}`) }
  else log('nsis-residue', `app files removed (only uninstaller residue may remain: ${remaining.join(', ') || 'none'})`)
  if (recordedKey) {
    let keyGone = false
    try {
      execFileSync('reg', ['query', recordedKey], { encoding: 'utf8', timeout: 15_000 })
    } catch { keyGone = true }
    if (!keyGone) { failures++; log('nsis-residue', `FAILED HKCU uninstall key still present: ${recordedKey}`) }
    else log('nsis-residue', 'HKCU uninstall key removed')
  }
  const lnkFinal = await lnkSnapshot()
  const lingeringLnks = createdLnks.filter(path => lnkFinal.includes(path))
  if (lingeringLnks.length > 0) { failures++; log('nsis-residue', `FAILED shortcuts remain: ${lingeringLnks.map(path => basename(path)).join(', ')}`) }
  else log('nsis-residue', `no shortcut residue (${createdLnks.length} created, all removed)`)
  const titleFinal = windowTitleCount(WINDOW_TITLE)
  if (titleFinal !== -1 && titleSnapshot !== -1 && titleFinal > titleSnapshot) {
    failures++
    log('nsis-residue', `FAILED window count did not fall back (before=${titleSnapshot} after=${titleFinal})`)
  } else if (titleFinal !== -1) {
    log('nsis-residue', `window count back to pre-smoke level (before=${titleSnapshot} after=${titleFinal})`)
  }

  // ===== 收尾：清理场景内残骸（卸载器自身因 _?= 协议不自杀） =====
  await rm(installDir, { recursive: true, force: true }).catch(() => {})
  if (failures > 0) { console.error(`[smoke] nsis-child FAIL failures=${failures}`); process.exit(1) }
  log('nsis-child', 'PASS')
  process.exit(0)
}

/** --target nsis 编排：场景目录＋全新 node 宿主执行阶段 N（同阶段 F/H 宿主结论） */
async function runNsisSmoke() {
  const installerStat = await stat(installerArg)
  log('installer', `${installerArg} (${(installerStat.size / 1024 / 1024).toFixed(1)} MB)`)
  tempDir = await mkdtemp(join(tmpdir(), 'pack05-nsis-'))
  log('copy-scene', tempDir)
  const stageN = spawn(process.execPath, [
    fileURLToPath(import.meta.url),
    '--nsis-child',
    '--installer', resolve(installerArg),
    '--scene', tempDir,
  ], { cwd: process.cwd(), stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true })
  const result = await waitForExit(stageN, 720_000, 'stage-n-child')
  if (!result.exited) {
    failures++
    log('nsis', 'FAILED stage-N child did not finish within 720s')
    killTree(stageN.pid)
  } else if (result.code !== 0) {
    failures++
    log('nsis', `FAILED stage-N child exited with code ${result.code}`)
  } else {
    log('nsis', 'stage-N child passed (install/run/quit/uninstall/no-residue assertions above)')
  }
  clearTimeout(overallTimer)
  const totalSeconds = ((Date.now() - startedAt) / 1_000).toFixed(1)
  if (failures > 0) {
    console.error(`[smoke] SMOKE_FAIL failures=${failures} total=${totalSeconds}s`)
    for (const logName of ['nsis-exe-stderr.log']) {
      const text = await readFile(join(tempDir, logName), 'utf8').catch(() => '')
      if (text.trim()) console.error(`[smoke] ${logName} (tail):\n${text.trim().split('\n').slice(-15).join('\n')}`)
    }
    process.exitCode = 1
  } else {
    log('pass', `SMOKE_PASS total=${totalSeconds}s`)
  }
}

function log(step, detail) {
  console.log(`[smoke] ${step}${detail ? `: ${detail}` : ''}`)
}

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function fetchJson(url, timeoutMs = 5_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  const text = await response.text()
  return { status: response.status, text }
}

function canBindLoopback(port) {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => { probe.close(() => resolve(true)) })
    probe.listen(port, '127.0.0.1')
  })
}

function windowTitleCount(title) {
  try {
    const command = `(Get-Process | Where-Object { $_.MainWindowTitle -eq '${title}' } | Measure-Object).Count`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15_000 })
    return Number(out.trim())
  } catch (error) {
    return -1
  }
}

/** 只向我们进程树（root pid 的直接子进程）里的窗口发 WM_CLOSE——绝不触碰用户真实实例 */
function closeMainWindowOfChildren(rootPid) {
  try {
    const command = `$kids = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${rootPid} };`
      + ` $closed = 0; foreach ($k in $kids) { try { $p = Get-Process -Id $k.ProcessId -ErrorAction Stop;`
      + ` if ($p.CloseMainWindow()) { $closed += 1 } } catch {} }; Write-Output $closed`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 20_000 })
    return Number(out.trim())
  } catch (error) {
    return -1
  }
}

/** 向指定进程本体的主窗口发 WM_CLOSE（安装版形态：窗口属于 spawn 进程自身而非其子进程） */
function closeMainWindowOf(pid) {
  try {
    const command = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue;`
      + ` if ($p -and $p.CloseMainWindow()) { '1' } else { '0' }`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 20_000 })
    return Number(out.trim())
  } catch (error) {
    return -1
  }
}

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: KILL_TIMEOUT_MS })
    return true
  } catch (error) {
    log('kill', `taskkill failed: ${error.message}`)
    return false
  }
}

function waitForExit(child, timeoutMs, label) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ exited: false, code: null, label }), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ exited: true, code: signal ? null : code, label })
    })
    if (child.exitCode !== null) {
      clearTimeout(timer)
      resolve({ exited: true, code: child.exitCode, label })
    }
  })
}

/** 假训练器占用者：独立 node 子进程，/api/health 回 isTrainerHealth 身份（pid=自身）；
 *  hitsFile 置位时每次 health 命中追加一行（PACK-03 阶段 G 断言「被健康探测」用）。
 *  runId 默认 'run-fake-occupant'（PORT-02 端口冲突身份足够）；阶段 G 预置 trainer-state.json
 *  时必须传 launcher writeStateFile 形状的 run-<uuid36>（coexist-guard RUN_ID_PATTERN 严格校验，
 *  非 36 位 hex 会被判 stale→活 pid→拒绝启动，断言全红——收据：node -e 正则验证 false）。 */
function spawnFakeTrainer(port, hitsFile = null, runId = 'run-fake-occupant') {
  const script = [
    "const http = require('http')",
    "const fs = require('fs')",
    'const server = http.createServer((req, res) => {',
    "  if (req.url === '/api/health') {",
    `    if (process.argv[2]) { try { fs.appendFileSync(process.argv[2], 'hit\\n') } catch {} }`,
    "    res.writeHead(200, { 'content-type': 'application/json' })",
    "    res.end(JSON.stringify({ status: 'ok', runId: process.argv[3], pid: process.pid }))",
    '    return',
    '  }',
    "  res.writeHead(404, { 'content-type': 'application/json' })",
    "  res.end(JSON.stringify({ error: 'NOT_FOUND' }))",
    '})',
    "server.listen(Number(process.argv[1]), '127.0.0.1', () => { process.stdout.write('FAKE_READY') })",
  ].join('\n')
  return spawn(process.execPath, ['-e', script, String(port), hitsFile || '', runId], {
    cwd: tmpdir(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

/** PACK-03 阶段 F：伪造历史库（真实迁移建库＋一条 settled 训练行——历史列表端点可见的预置记录） */
async function seedLegacyLibrary(databasePath, markerCode) {
  const { pathToFileURL } = await import('node:url')
  await mkdir(dirname(databasePath), { recursive: true })
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const dbModule = await import(pathToFileURL(join(repoRoot, 'server', 'dist', 'db.js')).href)
  const database = dbModule.openDatabase(databasePath)
  dbModule.migrateDatabase(database)
  database.prepare(
    "INSERT INTO trainings (tier, code, name, market, start_date, planned_end, status, initial_cash, created_at, settle_date)"
    + " VALUES (?, ?, ?, 'sh', '2026-09-01', '2026-09-30', 'settled', 1000000, '2026-09-01T00:00:00.000Z', '2026-09-30')",
  ).run('classic', markerCode, '冒烟预置历史训练')
  database.close()
}

const startedAt = Date.now()
let tempDir = null
let failures = 0
let overallTimer = null
const cleanups = []
const openLogHandles = []

async function openStderrLog(logName) {
  const handle = await open(join(tempDir, logName), 'a')
  openLogHandles.push(handle)
  return handle
}

async function runSmoke() {
  const exeStat = await stat(exeArg)
  log('exe', `${exeArg} (${(exeStat.size / 1024 / 1024).toFixed(1)} MB)`)

  tempDir = await mkdtemp(join(tmpdir(), 'pack02-smoke-'))
  const copiedExe = join(tempDir, basename(exeArg))
  await copyFile(exeArg, copiedExe)
  log('copy', copiedExe)

  const port = await freeLoopbackPort()
  const dataDir = join(tempDir, 'data')
  log('port', `port=${port} dataDir=${dataDir}`)

  const spawnExe = async (overrides = {}, logName = 'exe-main-stderr.log') => {
    const stderrLog = await openStderrLog(logName)
    return spawn(copiedExe, [], {
      cwd: tempDir,
      stdio: ['ignore', 'ignore', stderrLog.fd],
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port),
        TRAINER_DATA_DIR: dataDir,
        TRAINER_DB: join(dataDir, 'trainer.sqlite'),
        TDX_ROOT: '',
        OPEN_BROWSER: '0',
        ...overrides,
      },
    })
  }

  // ===== 阶段 A：主实例启动 =====
  const spawnedAt = Date.now()
  const main = await spawnExe()
  cleanups.push(() => killTree(main.pid))
  overallTimer = setTimeout(() => {
    log('timeout', `overall ${OVERALL_TIMEOUT_MS}ms exceeded; force killing`)
    for (const cleanup of cleanups) cleanup()
    process.exitCode = 1
    // 强制收口：清理后立即退出（不依赖事件循环排空——存活子进程的 stdio 管道可能钉住进程）
    process.exit(1)
  }, OVERALL_TIMEOUT_MS)

  const awaitHealth = async (targetPort) => {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    for (;;) {
      try {
        const probe = await fetchJson(`http://127.0.0.1:${targetPort}/api/health`, 3_000)
        if (probe.status === 200) return JSON.parse(probe.text)
      } catch { /* not up yet */ }
      if (main.exitCode !== null) throw new Error(`exe exited during startup with code ${main.exitCode}`)
      if (Date.now() > deadline) throw new Error(`health not reachable within ${HEALTH_TIMEOUT_MS}ms on port ${targetPort}`)
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  const health = await awaitHealth(port)
  const bootSeconds = ((Date.now() - spawnedAt) / 1000).toFixed(1)
  if (health.status !== 'ok') { failures++; log('health', `UNEXPECTED status=${health.status}`) }
  if (typeof health.currentVersion !== 'string' || health.currentVersion.trim() === '') {
    failures++; log('health', 'MISSING currentVersion')
  } else {
    log('health', `200 status=ok currentVersion=${health.currentVersion} pid=${health.pid} runId=${health.runId} boot=${bootSeconds}s`)
  }

  // ===== 阶段 B：web 首页＋窗口存在 =====
  const page = await fetchJson(`http://127.0.0.1:${port}/`, 5_000)
  const isHtml = page.status === 200 && /<html/i.test(page.text) && /id="app"/i.test(page.text)
  if (!isHtml) { failures++; log('page', `UNEXPECTED status=${page.status} html=${/<html/i.test(page.text)}`) }
  else log('page', `200 html ok (${page.text.length} bytes)`)

  const titles = windowTitleCount(WINDOW_TITLE)
  if (titles === -1) log('window', 'powershell unavailable; window check DEGRADED (recorded, not asserted)')
  else if (titles < 1) { failures++; log('window', `NO window titled ${WINDOW_TITLE} (count=${titles})`) }
  else log('window', `window titled ${WINDOW_TITLE} present (count=${titles})`)

  // ===== 阶段 C：第二实例（单实例锁）——启动即退＋首实例存活 =====
  const second = await spawnExe({}, 'exe-second-stderr.log')
  const secondResult = await waitForExit(second, SECOND_INSTANCE_TIMEOUT_MS, 'second-instance')
  if (!secondResult.exited) {
    failures++; log('second-instance', `FAILED second instance did not exit within ${SECOND_INSTANCE_TIMEOUT_MS}ms`)
    killTree(second.pid)
  } else if (secondResult.code !== 0) {
    failures++; log('second-instance', `FAILED second instance exit code ${secondResult.code} (expected 0)`)
  } else {
    log('second-instance', `exited promptly with code 0 (single-instance lock honored)`)
  }
  const stillAlive = await fetchJson(`http://127.0.0.1:${port}/api/health`, 5_000).then(r => r.status === 200).catch(() => false)
  if (!stillAlive) { failures++; log('second-instance', 'FAILED first instance no longer healthy after second launch') }
  else log('second-instance', 'first instance still healthy')

  // ===== 阶段 D：优雅退出——CloseMainWindow → 自然退出 → 端口释放（替代强杀） =====
  const closedWindows = closeMainWindowOfChildren(main.pid)
  if (closedWindows === -1) {
    log('graceful-quit', 'powershell unavailable; DEGRADED to force-kill (recorded, not asserted)')
    killTree(main.pid)
    await waitForExit(main, KILL_TIMEOUT_MS, 'main')
  } else {
    const mainResult = await waitForExit(main, GRACEFUL_EXIT_TIMEOUT_MS, 'main')
    if (!mainResult.exited) {
      failures++; log('graceful-quit', `FAILED exe did not exit within ${GRACEFUL_EXIT_TIMEOUT_MS}ms after window close`)
      killTree(main.pid)
    } else if (mainResult.code !== 0) {
      failures++; log('graceful-quit', `FAILED natural exit code ${mainResult.code} (expected 0)`)
    } else {
      log('graceful-quit', `natural exit 0 after window close (closed=${closedWindows})`)
    }
    await new Promise(resolve => setTimeout(resolve, 1_000))
    const portReleased = await canBindLoopback(port)
    const healthRefused = !(await fetchJson(`http://127.0.0.1:${port}/api/health`, 3_000).then(() => true).catch(() => false))
    if (!portReleased || !healthRefused) {
      failures++; log('orphan', `FAILED port released=${portReleased} health refused=${healthRefused}`)
    } else {
      log('orphan', `no orphan: port rebindable + health refused after exit`)
    }
  }

  // ===== 阶段 E：冲突 restart 注入（假训练器占用随机端口） =====
  const conflictPort = await freeLoopbackPort()
  const conflictDataDir = join(tempDir, 'conflict-data')
  const fake = spawnFakeTrainer(conflictPort)
  cleanups.push(() => killTree(fake.pid))
  const fakeReady = await new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => reject(new Error('fake trainer did not become ready')), 10_000)
    fake.stderr.resume()
    fake.stdout.resume()
    const poll = async () => {
      if (settled) return
      try {
        const probe = await fetchJson(`http://127.0.0.1:${conflictPort}/api/health`, 1_000)
        if (probe.status === 200) { settled = true; clearTimeout(timer); resolve(JSON.parse(probe.text)); return }
      } catch { /* retry */ }
      if (fake.exitCode !== null) { settled = true; clearTimeout(timer); reject(new Error(`fake trainer exited early with code ${fake.exitCode}`)); return }
      setTimeout(poll, 200)
    }
    void poll()
  })
  log('conflict-setup', `fake trainer ready on port ${conflictPort} (pid=${fakeReady.pid} runId=${fakeReady.runId})`)

  const conflictStderrLog = await openStderrLog('exe-conflict-stderr.log')
  const conflictExe = spawn(copiedExe, [], {
    cwd: tempDir,
    stdio: ['ignore', 'ignore', conflictStderrLog.fd],
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(conflictPort),
      TRAINER_DATA_DIR: conflictDataDir,
      TRAINER_DB: join(conflictDataDir, 'trainer.sqlite'),
      TDX_ROOT: '',
      OPEN_BROWSER: '0',
      TRAINER_DESKTOP_CONFLICT_ANSWER: 'restart',
    },
  })
  cleanups.push(() => killTree(conflictExe.pid))

  // 断言①：假占用者被结束（restart 应答）
  const fakeExit = await waitForExit(fake, CONFLICT_TAKEOVER_TIMEOUT_MS, 'fake-trainer')
  if (!fakeExit.exited) { failures++; log('conflict-restart', 'FAILED fake trainer occupant was not stopped') }
  else log('conflict-restart', `fake occupant stopped (exit code ${fakeExit.code})`)

  // 断言②：exe 自己的服务接管该端口（health 身份变为 exe：runId≠fake 且带 currentVersion）
  let takeover = null
  const takeoverDeadline = Date.now() + CONFLICT_TAKEOVER_TIMEOUT_MS
  for (;;) {
    try {
      const probe = await fetchJson(`http://127.0.0.1:${conflictPort}/api/health`, 3_000)
      if (probe.status === 200) {
        const body = JSON.parse(probe.text)
        if (body.runId !== fakeReady.runId && typeof body.currentVersion === 'string' && body.currentVersion.trim() !== '') {
          takeover = body
          break
        }
      }
    } catch { /* exe server not up yet */ }
    if (conflictExe.exitCode !== null) { failures++; log('conflict-restart', `FAILED exe exited early with code ${conflictExe.exitCode}`); break }
    if (Date.now() > takeoverDeadline) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (takeover) {
    log('conflict-restart', `exe took over port ${conflictPort} (runId=${takeover.runId} currentVersion=${takeover.currentVersion})`)
  } else if (conflictExe.exitCode === null) {
    failures++; log('conflict-restart', `FAILED exe did not take over port ${conflictPort} within ${CONFLICT_TAKEOVER_TIMEOUT_MS}ms`)
  }

  // 断言③：该实例也能优雅退出
  if (conflictExe.exitCode === null) {
    closeMainWindowOfChildren(conflictExe.pid)
    const conflictResult = await waitForExit(conflictExe, GRACEFUL_EXIT_TIMEOUT_MS, 'conflict-exe')
    if (!conflictResult.exited) {
      failures++; log('conflict-quit', 'FAILED conflict exe did not exit after window close')
      killTree(conflictExe.pid)
    } else {
      log('conflict-quit', `conflict exe exited with code ${conflictResult.code}`)
      await new Promise(resolve => setTimeout(resolve, 1_000))
      const conflictPortReleased = await canBindLoopback(conflictPort)
      if (!conflictPortReleased) { failures++; log('conflict-quit', 'FAILED conflict port not released') }
      else log('conflict-quit', `port ${conflictPort} released`)
    }
  }

  // ===== 阶段 F（PACK-03）：首启发现/采用——USERPROFILE 重定向＋伪造历史库 → 原地沿用 =====
  // 经由全新 node 子进程执行（--adopt-child 模式，本脚本自再入）：便携 exe 的「全套 profile
  // 沙箱重定向」形态在冒烟主进程内直接 spawn 时实测 100% 崩溃（stub/应用自退 0xFFFFF003，
  // 无 WER、无 stdout/stderr 痕迹），而同样的 spawn 参数在独立 node/直连 bash 进程里 100%
  // 健康（诊断矩阵见验证记录 §五）——进程内暂态状态致原生故障，超出脚本层可及范围。
  // 断言面不变：仍是对打包 exe 的真实 spawn＋HTTP/文件证据；仅多一跳宿主进程。
  await new Promise(resolve => setTimeout(resolve, 2_000))
  const stageF = spawn(process.execPath, [
    fileURLToPath(import.meta.url),
    '--adopt-child',
    '--exe', exeArg,
    '--scene', tempDir,
  ], { cwd: process.cwd(), stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true })
  const stageFResult = await waitForExit(stageF, 300_000, 'stage-f-child')
  if (!stageFResult.exited) {
    failures++
    log('adoption', 'FAILED stage-F child did not finish within 300s')
    killTree(stageF.pid)
  } else if (stageFResult.code !== 0) {
    failures++
    log('adoption', `FAILED stage-F child exited with code ${stageFResult.code}`)
  } else {
    log('adoption', 'stage-F child passed (discovery/adopt/idempotent assertions above)')
  }


  // ===== 阶段 G（PACK-03）：同 dataDir 共存防线——活 trainer-state.json → reuse 注入 =====
  // 预置 launcher 格式状态记录指向假训练器（不同端口）；reuse 应答 → 窗口连假服务、
  // 绝不启第二服务（exe 自身端口保持未 bind）、不新建库文件。
  const gPort = await freeLoopbackPort()
  const gExePort = await freeLoopbackPort()
  const gDataDir = join(tempDir, 'g-data')
  await mkdir(gDataDir, { recursive: true })
  const gHitsFile = join(tempDir, 'g-health-hits.txt')
  // runId 必须满足 launcher assertStateIdentity 的 run-<uuid36>（spawnFakeTrainer 头注）
  const gFake = spawnFakeTrainer(gPort, gHitsFile, `run-${randomUUID()}`)
  cleanups.push(() => killTree(gFake.pid))
  const gFakeReady = await new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => reject(new Error('g fake trainer did not become ready')), 10_000)
    gFake.stderr.resume(); gFake.stdout.resume()
    const poll = async () => {
      if (settled) return
      try {
        const probe = await fetchJson(`http://127.0.0.1:${gPort}/api/health`, 1_000)
        if (probe.status === 200) { settled = true; clearTimeout(timer); resolve(JSON.parse(probe.text)); return }
      } catch { /* retry */ }
      if (gFake.exitCode !== null) { settled = true; clearTimeout(timer); reject(new Error(`g fake trainer exited early with code ${gFake.exitCode}`)); return }
      setTimeout(poll, 200)
    }
    void poll()
  })
  // launcher writeStateFile 同构记录（身份字段满足 assertStateIdentity）
  await writeFile(join(gDataDir, 'trainer-state.json'), `${JSON.stringify({
    appId: 'a-share-kline-trainer',
    runId: gFakeReady.runId,
    pid: gFakeReady.pid,
    port: gPort,
    baseURL: `http://127.0.0.1:${gPort}`,
    startedAt: new Date().toISOString(),
    databasePath: join(gDataDir, 'trainer.sqlite'),
  }, null, 2)}\n`, 'utf8')
  // ready-poll 自身的探测不计入断言：spawn exe 前清零，此后每次 hit＝守卫的健康探测
  await writeFile(gHitsFile, '', 'utf8')
  log('coexist-setup', `fake trainer pid=${gFakeReady.pid} port=${gPort}; exe target port=${gExePort}`)

  const gStderrLog = await openStderrLog('exe-coexist-stderr.log')
  const gExe = spawn(copiedExe, [], {
    cwd: tempDir,
    stdio: ['ignore', 'ignore', gStderrLog.fd],
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(gExePort),
      TRAINER_DATA_DIR: gDataDir,
      TRAINER_DB: join(gDataDir, 'trainer.sqlite'),
      TDX_ROOT: '',
      OPEN_BROWSER: '0',
      TRAINER_DESKTOP_CONFLICT_ANSWER: 'reuse',
    },
  })
  cleanups.push(() => killTree(gExe.pid))

  // exe 便携解压＋Electron 引导实测约 12s：断言必须等「守卫已做决策」的证据，而非固定延时。
  // reuse 决策证据＝假服务被探测 ≥2 次（身份复核＋应答后复测）后稳定 3s 仍无第二服务；
  // proceed 证据＝exe 自身端口被 bind 或 dataDir 出现库文件（任一出现即提前判负并保留现场）。
  const decisionState = await (async () => {
    const deadline = Date.now() + 120_000
    for (;;) {
      const hits = await readFile(gHitsFile, 'utf8').then(t => t.trim().split('\n').filter(Boolean).length).catch(() => 0)
      const bound = !(await canBindLoopback(gExePort))
      const libCreated = await stat(join(gDataDir, 'trainer.sqlite')).then(() => true).catch(() => false)
      if (bound || libCreated) return { hits, bound, libCreated, decided: true }
      if (gExe.exitCode !== null) return { hits, bound, libCreated, decided: true }
      if (hits >= 2) {
        await new Promise(resolve => setTimeout(resolve, 3_000))
        const stillBound = !(await canBindLoopback(gExePort))
        const stillLib = await stat(join(gDataDir, 'trainer.sqlite')).then(() => true).catch(() => false)
        return { hits, bound: stillBound, libCreated: stillLib, decided: true }
      }
      if (Date.now() > deadline) return { hits, bound, libCreated, decided: false }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  })()
  if (!decisionState.decided) { failures++; log('coexist-reuse', 'FAILED no coexistence decision observed within 120s (neither probe hits nor server start)') }
  if (decisionState.hits < 1) { failures++; log('coexist-reuse', 'FAILED recorded trainer was never health-probed') }
  else log('coexist-reuse', `recorded trainer health-probed (${decisionState.hits} hits)`)

  // 断言：exe 自身端口未被 bind（未启动第二个服务进程）＋进程存活；不新建库文件
  const gExeAlive = gExe.exitCode === null
  if (decisionState.bound) { failures++; log('coexist-reuse', 'FAILED exe started its own server (port bound despite live same-dir record)') }
  else log('coexist-reuse', 'exe did not start a second server (port stays unbound)')
  if (!gExeAlive) { failures++; log('coexist-reuse', `FAILED exe exited early with code ${gExe.exitCode}`) }
  if (decisionState.libCreated) { failures++; log('coexist-reuse', 'FAILED a library file was created despite reuse decision') }
  else log('coexist-reuse', 'no library file created (reuse decision preceded any server start)')

  // 断言完毕即收尾本阶段：优雅关窗（reuse 窗口加载的是假服务 404 页、可能隐藏，关不掉即强杀兜底），
  // 假训练器用后即杀——不留存活子进程（否则 node 事件循环被其 stdio 管道钉住永不退出）。
  closeMainWindowOfChildren(gExe.pid)
  const gQuit = await waitForExit(gExe, GRACEFUL_EXIT_TIMEOUT_MS, 'g-exe')
  if (!gQuit.exited) { killTree(gExe.pid); log('coexist-cleanup', 'g exe force-killed (hidden reuse window did not close)') }
  else log('coexist-cleanup', `g exe exited with code ${gQuit.code}`)
  killTree(gFake.pid)

  // ===== 阶段 H（PACK-04）：更新通道——packaged exe＋本地 fixture feed＋boot check 可观测缝 =====
  // 经全新 node 宿主执行（--update-child 自再入，同阶段 F 宿主结论）；只查不装（真实安装
  // 全流程待 PACK-05 发布资产＋真机验收）。断言：通道 packaged＋fixture 新版被真实检出。
  await new Promise(resolve => setTimeout(resolve, 2_000))
  const stageH = spawn(process.execPath, [
    fileURLToPath(import.meta.url),
    '--update-child',
    '--exe', exeArg,
    '--scene', tempDir,
  ], { cwd: process.cwd(), stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true })
  const stageHResult = await waitForExit(stageH, 240_000, 'stage-h-child')
  if (!stageHResult.exited) {
    failures++
    log('update-channel', 'FAILED stage-H child did not finish within 240s')
    killTree(stageH.pid)
  } else if (stageHResult.code !== 0) {
    failures++
    log('update-channel', `FAILED stage-H child exited with code ${stageHResult.code}`)
  } else {
    log('update-channel', 'stage-H child passed (packaged channel + fixture feed assertions above)')
  }

  clearTimeout(overallTimer)
  const totalSeconds = ((Date.now() - startedAt) / 1_000).toFixed(1)
  if (failures > 0) {
    console.error(`[smoke] SMOKE_FAIL failures=${failures} total=${totalSeconds}s`)
    // 失败路径同样必须留下 stderr 现场（此前仅 throw 路径打印日志，失败证据随临时目录清理湮灭）
    for (const logName of ['exe-main-stderr.log', 'exe-second-stderr.log', 'exe-conflict-stderr.log', 'exe-adopt-stderr.log', 'exe-adopt-stderr.log.out', 'exe-adopt2-stderr.log', 'exe-adopt2-stderr.log.out', 'exe-coexist-stderr.log', 'exe-update-stderr.log', 'exe-update-stderr.log.out']) {
      const text = await readFile(join(tempDir, logName), 'utf8').catch(() => '')
      if (text.trim()) console.error(`[smoke] ${logName} (tail):\n${text.trim().split('\n').slice(-15).join('\n')}`)
    }
    process.exitCode = 1
  } else {
    log('pass', `SMOKE_PASS total=${totalSeconds}s`)
  }
}

try {
  // PACK-03 阶段 F 子模式（由主冒烟以全新 node 进程再入执行；见阶段 F 注释的宿主上下文结论）。
  // 分发点必须在全部 const/函数声明之后（避免 TDZ）。
  if (args.includes('--adopt-child')) {
    await runAdoptChild()
  }
  if (args.includes('--update-child')) {
    await runUpdateChild()
  }
  if (args.includes('--nsis-child')) {
    await runNsisChild()
  }
  if (targetArg === 'nsis') {
    overallTimer = setTimeout(() => {
      log('timeout', 'overall 720000ms exceeded; force killing')
      for (const cleanup of cleanups) cleanup()
      process.exit(1)
    }, 720_000)
    await runNsisSmoke()
  } else {
    await runSmoke()
  }
} catch (error) {
  console.error(`[smoke] SMOKE_FAIL: ${error.message}`)
  if (overallTimer) clearTimeout(overallTimer)
  try {
    const { readFile } = await import('node:fs/promises')
    if (tempDir) {
      for (const logName of ['exe-main-stderr.log', 'exe-second-stderr.log', 'exe-conflict-stderr.log', 'exe-adopt-stderr.log', 'exe-adopt2-stderr.log', 'exe-coexist-stderr.log', 'exe-update-stderr.log', 'exe-update-stderr.log.out']) {
        const text = await readFile(join(tempDir, logName), 'utf8').catch(() => '')
        if (text.trim()) console.error(`[smoke] ${logName} (tail):\n${text.trim().split('\n').slice(-12).join('\n')}`)
      }
    }
  } catch { /* log best-effort */ }
  for (const cleanup of cleanups) cleanup()
  process.exitCode = 1
} finally {
  for (const handle of openLogHandles) { try { await handle.close() } catch { /* best-effort */ } }
  if (tempDir && !keep) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  else if (tempDir) log('keep', tempDir)
  // 收口保证：全部工作已完成，任何残留句柄不得钉住进程（本轮曾因假训练器 stdio 管道挂死）
  process.exit(process.exitCode ?? 0)
}
