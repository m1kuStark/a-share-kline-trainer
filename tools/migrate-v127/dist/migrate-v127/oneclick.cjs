'use strict'
/**
 * MIG-ONECLICK-01 一键迁移入口（同一个文件两侧运行，由「一键迁移.cmd」启动）：
 *
 *  - 导出侧：本工具文件夹位于 v1.2.7 便携包根内（旁边有 runtime\node.exe）→
 *    调 export-v127.cjs 的一键模式：停服门禁→训练历史迁移包直接生成到工具文件夹→
 *    旧 origin 端口伺服自动导出页→页面自动扫描 IndexedDB 并上传录像合并包到工具文件夹。
 *  - 导入侧：本工具文件夹位于 v1.3.x 安装目录内（旁边有 K线训练器.exe，本脚本以
 *    ELECTRON_RUN_AS_NODE=1 经该 exe 当 node 运行）→ 自解析新版本数据目录（镜像桌面
 *    data-home/desktop-config 优先级，全程无需用户输入路径）→ 停服门禁（训练器运行中
 *    拒绝写入）→ 把迁移产物暂存到 <dataDir>/migrate-v127-import/（manifest 最后落盘＝
 *    完成标记）→ 拉起新版本训练器，由其 boot 自动完成历史合并与录像导入归位。
 *
 * 模式判定只认目录特征（detectOneClickMode），绝不猜；两侧数据源/目标全部自动推导。
 * 导入侧绝不修改 v1.3.x 既有训练库（历史合并由训练器 boot 走既有 pending 管线，
 * 备份先行、失败零损伤）；v1.2.7 侧只读铁律沿用 export-tool。
 */
const cp = require('node:child_process')
const { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const exportTool = require('./export-v127.cjs')

const STAGING_DIR_NAME = 'migrate-v127-import'
const MANIFEST_FILE = 'manifest.json'
const MANIFEST_FORMAT = 'trainer-oneclick-import'
const MANIFEST_VERSION = 1
const HISTORY_PREFIX = '训练历史迁移-'
const RECORDINGS_PATTERN = /^训练录像库-\d{8}-\d{6}(-\d+)?\.trainer-recordings\.json$/
const HISTORY_MANIFEST_FILE = '迁移清单.json'
const IMPORTER_FILE = 'import-recordings.js'
const DATA_CHOICE_FILE = 'desktop-data-choice.json'
const LEGACY_CONFIG_FILE = 'trainer.config.json'
const LEGACY_HOME_DIR_NAME = '.a-share-kline-trainer'
const STATE_FILE = 'trainer-state.json'
const DB_FILE = 'trainer.sqlite'

// ===== 通用 =====

async function fileExists(target) {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}

async function readJson(target) {
  try {
    return JSON.parse(await readFile(target, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new Error(`无法读取 ${target}: ${error && error.message ? error.message : error}`)
  }
}

// ===== 模式自检测（权威判定：目录特征，不猜） =====

/**
 * 检测工具文件夹所在环境：
 *   - 父目录有 runtime\node.exe → v1.2.7 便携包根（导出侧）；
 *   - 父目录有非 Uninstall 的 .exe（优先 K 开头的 K线训练器.exe）→ v1.3.x 安装目录（导入侧）；
 *   - 否则 unknown（人话指引）。
 */
async function detectOneClickMode(parentDir) {
  if (await fileExists(path.join(parentDir, 'runtime', 'node.exe'))) return { mode: 'export' }
  let names = []
  try {
    names = await readdir(parentDir)
  } catch {
    names = []
  }
  const exes = names.filter(name => name.toLowerCase().endsWith('.exe') && !name.toLowerCase().startsWith('uninstall'))
  const preferred = exes.find(name => name.startsWith('K'))
  if (preferred) return { mode: 'import', exePath: path.join(parentDir, preferred) }
  if (exes.length) return { mode: 'import', exePath: path.join(parentDir, exes[0]) }
  // MIG-ONECLICK-02 自诊断兜底：报错自带已检测特征清单＋父目录内容摘要（前 10 项，
  // 超长截断），用户无需再猜触发链——现场触发原因未定论（结构复现失败），信息自足为先。
  const sample = names.slice(0, 10).join('、')
  const summary = names.length
    ? `前 10 项${names.length > 10 ? `，共 ${names.length} 项` : ''}：${sample}`
    : '（空目录或无法读取）'
  return {
    mode: 'unknown',
    reason: `未在工具文件夹的上一级（${parentDir}）检测到 v1.2.7（应能看到 runtime\\node.exe）或 v1.3.x（应能看到 K线训练器.exe）的安装特征。`
      + `已检测特征：runtime\\node.exe＝未找到；K*.exe（及其他非卸载程序 .exe）＝未找到。`
      + `父目录内容摘要（${summary}）。`
      + `请把整个 migrate-v127 工具文件夹放到旧版本或新版本安装目录内（与程序入口同一级），再双击「一键迁移.cmd」。`,
  }
}

// ===== 导入侧：目标解析（镜像 desktop data-home/desktop-config 优先级） =====

function absoluteEnvPath(env, name) {
  const value = env[name] && String(env[name]).trim()
  if (!value) return null
  if (!path.isAbsolute(value)) throw new Error(`${name} 必须是绝对路径，收到：${value}`)
  return path.resolve(value)
}

/**
 * 解析 v1.3.x 生效数据目录与训练库路径（优先级＝桌面主进程同一口径）：
 *   TRAINER_DATA_DIR/TRAINER_DB（env 显式）> trainer.config.json dataDir（显式）>
 *   desktop-data-choice.json 采用记录（adopted 且库在）> 唯一默认 ~/.a-share-kline-trainer；
 *   databasePath 跟随 TRAINER_DB > trainer.config.json databasePath（显式绝对）> <dataDir>/trainer.sqlite。
 * 全程零用户输入（用户拍板：完全不需要自己思考路径等问题）。
 */
async function resolveImportTargets(env, installDir, homeDir) {
  const legacyHome = path.join(homeDir, LEGACY_HOME_DIR_NAME)
  const configRaw = await readJson(path.join(installDir, LEGACY_CONFIG_FILE))
  if (configRaw !== null && (typeof configRaw !== 'object' || Array.isArray(configRaw))) {
    throw new Error(`${LEGACY_CONFIG_FILE} 必须是 JSON 对象`)
  }
  const config = configRaw ?? {}
  const text = key => (typeof config[key] === 'string' ? config[key].trim() : '')
  const configDataDirRaw = text('dataDir')
  const configDataDir = configDataDirRaw ? path.resolve(installDir, configDataDirRaw) : null
  const configDatabaseRaw = text('databasePath')
  if (configDatabaseRaw && !path.isAbsolute(configDatabaseRaw)) {
    throw new Error(`${LEGACY_CONFIG_FILE} databasePath 必须是绝对路径，收到：${configDatabaseRaw}`)
  }

  const envDataDir = absoluteEnvPath(env, 'TRAINER_DATA_DIR')
  const envDatabase = absoluteEnvPath(env, 'TRAINER_DB')

  let dataDir = null
  let source = ''
  if (envDataDir) {
    dataDir = envDataDir
    source = '环境变量 TRAINER_DATA_DIR（显式）'
  } else if (configDataDir) {
    dataDir = configDataDir
    source = 'trainer.config.json dataDir（显式）'
  } else {
    const choiceRaw = await readJson(path.join(installDir, DATA_CHOICE_FILE))
    let adopted = null
    if (choiceRaw && choiceRaw.version === 1 && choiceRaw.mode === 'adopted'
      && typeof choiceRaw.dataDir === 'string' && path.isAbsolute(choiceRaw.dataDir)) {
      adopted = path.resolve(choiceRaw.dataDir)
    }
    if (adopted && await fileExists(path.join(adopted, DB_FILE))) {
      dataDir = adopted
      source = 'desktop-data-choice.json 采用记录'
    } else {
      dataDir = legacyHome
      source = `默认数据目录 ${LEGACY_HOME_DIR_NAME}（各版本相互独立）`
    }
  }
  const databasePath = envDatabase
    ?? (configDatabaseRaw ? path.resolve(configDatabaseRaw) : null)
    ?? path.join(dataDir, DB_FILE)
  return { dataDir, databasePath, dataDirSource: source }
}

// ===== 导入侧：产物自发现 =====

/** 在工具文件夹内挑最新的训练历史迁移文件夹（含清单＋库）与录像合并包（名称时间戳字典序） */
async function pickOneClickArtifacts(toolDir) {
  const names = await readdir(toolDir).catch(() => [])
  let historyDir = null
  for (const name of names) {
    if (!name.startsWith(HISTORY_PREFIX)) continue
    const candidate = path.join(toolDir, name)
    if (!await fileExists(path.join(candidate, HISTORY_MANIFEST_FILE))) continue
    if (!await fileExists(path.join(candidate, DB_FILE))) continue
    if (!historyDir || name > path.basename(historyDir)) historyDir = candidate
  }
  let recordingsFile = null
  for (const name of names) {
    if (!RECORDINGS_PATTERN.test(name)) continue
    if (!recordingsFile || name > path.basename(recordingsFile)) recordingsFile = path.join(toolDir, name)
  }
  return { historyDir, recordingsFile }
}

// ===== 导入侧：停服门禁（fail-closed，训练器运行中绝不写入） =====

/**
 * 门禁决策（镜像导出侧 MIG-STOP-GATE 口径，作用于新版本数据目录）：
 * 状态记录缺失/无法识别＝按未运行放行；记录 pid 存活或记录端口有应答＝拒绝。
 */
async function decideImportGate(stateRead, probes) {
  if (!stateRead || !stateRead.state) return { ok: true }
  const { pid, port } = stateRead.state
  if (pid && probes.pidAlive(pid)) {
    return {
      ok: false,
      reason: `新版本训练器仍在运行（端口 ${port}，PID ${pid}）。请先在训练器页面正常退出（或关闭训练器窗口等待其完全退出），再重新双击本工具；工具不会在训练器运行时写入迁移数据。`,
    }
  }
  if (port) {
    const probe = await probes.probe(port)
    if (probe.responded) {
      return {
        ok: false,
        reason: `端口 ${port} 上有服务在应答（像是训练器）。请先正常退出训练器，再重新双击本工具；工具不会在有服务运行时写入迁移数据。`,
      }
    }
  }
  return { ok: true }
}

// ===== 导入侧：暂存（manifest 最后落盘＝完成标记；消费端只认 manifest） =====

const defaultStageDeps = {
  copyFile: (source, target) => copyFile(source, target),
  mkdir: target => mkdir(target, { recursive: true }),
  rm: target => rm(target, { recursive: true, force: true }),
  writeFile: (target, data) => writeFile(target, data, 'utf8'),
}

/**
 * 把迁移产物暂存到 <dataDir>/migrate-v127-import/：
 *   recordings.trainer-recordings.json ＋ import-recordings.js（工具自带导入器）＋
 *   history/{trainer.sqlite,迁移清单.json}，manifest.json 最后落盘（写入完成前任何中断
 *   ＝无 manifest ＝消费端整体忽略，下次重跑工具整体替换＝幂等）。
 * 绝不触碰数据目录内其他任何文件（训练库零写入）。
 */
async function stageOneClickImport(input, deps = {}) {
  const fsx = { ...defaultStageDeps, ...deps }
  const { toolDir, dataDir, artifacts } = input
  const now = input.now ?? new Date()
  const stagingDir = path.join(dataDir, STAGING_DIR_NAME)
  try {
    const importerSource = path.join(toolDir, IMPORTER_FILE)
    if (!await fileExists(importerSource)) {
      return { ok: false, error: `工具文件夹内缺少 ${IMPORTER_FILE}（录像导入器脚本），工具不完整；请重新获取完整的 migrate-v127 工具文件夹。` }
    }
    await fsx.rm(stagingDir)
    await fsx.mkdir(stagingDir)
    if (artifacts.recordingsFile) await fsx.copyFile(artifacts.recordingsFile, path.join(stagingDir, 'recordings.trainer-recordings.json'))
    await fsx.copyFile(importerSource, path.join(stagingDir, IMPORTER_FILE))
    if (artifacts.historyDir) {
      await fsx.mkdir(path.join(stagingDir, 'history'))
      await fsx.copyFile(path.join(artifacts.historyDir, DB_FILE), path.join(stagingDir, 'history', DB_FILE))
      await fsx.copyFile(path.join(artifacts.historyDir, HISTORY_MANIFEST_FILE), path.join(stagingDir, 'history', HISTORY_MANIFEST_FILE))
    }
    const manifest = {
      format: MANIFEST_FORMAT,
      version: MANIFEST_VERSION,
      stagedAt: now.toISOString(),
      installDir: path.dirname(toolDir),
      history: artifacts.historyDir ? { manifest: `history/${HISTORY_MANIFEST_FILE}` } : null,
      recordings: artifacts.recordingsFile ? { file: 'recordings.trainer-recordings.json', importer: IMPORTER_FILE } : null,
    }
    await fsx.writeFile(path.join(stagingDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)
    return { ok: true, stagingDir, manifest }
  } catch (error) {
    return { ok: false, error: `暂存迁移数据失败（数据目录既有文件未被触碰，可重试）：${error && error.message ? error.message : error}` }
  }
}

// ===== 拉起新版本训练器（完成自动导入的用户手势收尾） =====

function launchApp(exePath) {
  // 关键：本工具自身以 ELECTRON_RUN_AS_NODE=1 运行；拉起 GUI 必须剥掉该变量，
  // 否则新进程会以 node 模式启动而非 Electron 窗口。
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const child = cp.spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: true, env })
    child.unref()
    return true
  } catch (error) {
    console.error(`[提示] 自动打开训练器失败（${error && error.message ? error.message : error}）：请手动启动一次新版本训练器，迁移同样会自动完成。`)
    return false
  }
}

// ===== 主流程 =====

async function runOneClickMain() {
  const toolDir = path.dirname(__filename)
  const parentDir = path.dirname(toolDir)
  const mode = await detectOneClickMode(parentDir)

  if (mode.mode === 'unknown') {
    console.error(`[错误] ${mode.reason}`)
    process.exitCode = 2
    return
  }

  if (mode.mode === 'export') {
    console.log('[一键] 检测到 v1.2.7 旧版本目录，开始一键导出（训练历史＋录像 → 本工具文件夹）。')
    console.log('[一键] 前提：旧训练器已退出（工具会自动检测，未退出会明确提示）。')
    await exportTool.runExportTool(exportTool.parseArgs([]), { oneclick: true, outputDir: toolDir })
    return
  }

  console.log('── 一键迁移（v1.2.7 → 新版本）────────────────')
  console.log(`安装目录　　　：${parentDir}`)
  const targets = await resolveImportTargets(process.env, parentDir, os.homedir())
  const artifacts = await pickOneClickArtifacts(toolDir)
  console.log(`新版本数据目录：${targets.dataDir}（来源：${targets.dataDirSource}）`)
  console.log(`训练库文件　　：${targets.databasePath}`)
  if (!artifacts.historyDir && !artifacts.recordingsFile) {
    console.error('[错误] 工具文件夹内没有找到任何迁移数据（「训练历史迁移-…」文件夹或「训练录像库-….json」）。')
    console.error('请先在 v1.2.7 旧版本目录里双击本工具完成一键导出，再把整个工具文件夹拷贝或移动到此处。')
    process.exitCode = 2
    return
  }
  console.log(`待迁移数据　　：${[
    artifacts.historyDir ? '训练历史迁移包' : null,
    artifacts.recordingsFile ? '录像合并包' : null,
  ].filter(Boolean).join(' ＋ ')}`)

  const stateRaw = await readJson(path.join(targets.dataDir, STATE_FILE)).catch(() => null)
  const stateRead = stateRaw === null ? { problem: 'state file missing' } : exportTool.readStateIdentity(stateRaw)
  const gate = await decideImportGate(stateRead, {
    pidAlive: exportTool.pidAlive,
    probe: async port => {
      const probe = await exportTool.probeHealth(port)
      return { responded: probe.responded }
    },
  })
  if (!gate.ok) {
    console.error(`[错误] ${gate.reason}`)
    console.error('迁移数据未被写入，可随时重试。')
    process.exitCode = 2
    return
  }

  const staged = await stageOneClickImport({ toolDir, dataDir: targets.dataDir, artifacts })
  if (!staged.ok) {
    console.error(`[错误] ${staged.error}`)
    process.exitCode = 2
    return
  }
  console.log(`已就位待导入　：${staged.stagingDir}（新版本训练器启动时自动完成导入）`)
  console.log('[启动] 正在打开新版本训练器完成自动导入…')
  launchApp(mode.exePath)
  console.log('[完成] 历史训练记录将自动合并进当前训练库（导入前自动备份，与已有新训练并存）；')
  console.log('       训练录像将自动导入录像库（重复自动跳过）。页面左下角会显示导入进度。')
  console.log('       若训练器未自动打开，手动启动一次新版本训练器即可完成迁移。')
}

module.exports = {
  detectOneClickMode,
  resolveImportTargets,
  pickOneClickArtifacts,
  decideImportGate,
  stageOneClickImport,
  STAGING_DIR_NAME,
  MANIFEST_FILE,
  runOneClickMain,
}

if (require.main === module) {
  runOneClickMain().catch(error => {
    console.error(`[错误] ${error instanceof Error ? error.message : String(error)}`)
    console.error('工具异常退出，数据未被修改。')
    process.exit(1)
  })
}
