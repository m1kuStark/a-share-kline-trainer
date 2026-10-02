import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { discoverTdxRoot } from './tdx/discover.js'
import { readSavedTdxChoice, resolveEffectiveTdxRoot, type TdxRootSource } from './setup/saved-choice.js'

export interface AppConfig {
  port: number
  host: string
  databasePath: string
  tdxRoot: string | null
  /** 可选、显式指定的通达信 56 行业映射文件；未配置时行业排行明确不可用。 */
  industryMapPath?: string | null
  /**
   * 生效行情目录的来源标签（用户确认优先级 env → explicit-config → saved-choice）。
   * tdxRoot 为 null 时为 null。只作展示/解释用，绝不
   * 回传完整本机路径。独立运行（无 runId）由本模块按优先级解析；启动器托管运行
   * （有 runId）由启动器解析后经 TRAINER_TDX_SOURCE 传入，服务端只透传校验过的标签。
   */
  tdxSource: TdxRootSource | null
  /** 保存选择/重启状态等运行数据的目录；独立运行默认数据库所在目录 */
  dataDir: string | null
  /**
   * PORT-01 端口回退标记（只读环境透传）：启动器在"未显式配置端口且默认端口被
   * 系统保留/占用"时自动改用邻近端口，并经 TRAINER_PORT_FALLBACK 注入
   * "<原端口>,<reserved|occupied>"。仅供页面常驻提示，不含任何路径；未发生
   * 回退（独立运行/显式端口/格式非法）时为 null。可选字段：测试直接构造
   * AppConfig 时省略＝未回退。
   */
  portFallback?: { from: number, reason: PortFallbackReason } | null
  runId?: string
  staticDirectory?: string
  readyFile?: string
  /** 受保护 setup 端点的控制令牌（只读环境透传；不生成、不持久化、不回显） */
  controlToken: string | null
  /** 启动器配置文件路径（launcher 经 TRAINER_CONFIG_PATH 注入；独立运行为 null）。
   *  训练数据目录设置（/api/settings/data-dir）写回该文件的 dataDir 字段，重启生效。
   *  可选字段：测试直接构造 AppConfig 时省略＝独立运行。 */
  launcherConfigPath?: string | null
}

const TDX_SOURCE_LABELS: readonly TdxRootSource[] = ['env', 'explicit-config', 'saved-choice']

export type PortFallbackReason = 'reserved' | 'occupied'

/** TRAINER_PORT_FALLBACK 严格解析（"<端口>,<reserved|occupied>"）；任何偏差按未发生回退处理 */
function parsePortFallback(): { from: number, reason: PortFallbackReason } | null {
  const raw = process.env.TRAINER_PORT_FALLBACK?.trim()
  if (!raw) return null
  const match = /^(\d{1,5}),(reserved|occupied)$/.exec(raw)
  if (!match) return null
  const from = Number(match[1])
  if (from < 1 || from > 65535) return null
  return { from, reason: match[2] as PortFallbackReason }
}

function explicitAbsolutePath(name: string): string | null {
  const value = process.env[name]?.trim()
  if (!value) return null
  if (!isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path when set`)
  }
  return resolve(value)
}

export async function loadConfig(): Promise<AppConfig> {
  const runId = process.env.TRAINER_RUN_ID?.trim()
  if (runId) {
    for (const name of ['TRAINER_DB', 'TRAINER_STATIC_DIR', 'TRAINER_READY_FILE']) {
      if (!process.env[name]?.trim() || !isAbsolute(process.env[name]!)) {
        throw new Error(`${name} must be an explicit absolute path for isolated runs`)
      }
    }
  }
  const dataDir = explicitAbsolutePath('TRAINER_DATA_DIR')
  const industryMapPath = explicitAbsolutePath('TRAINER_INDUSTRY_MAP')
  const databasePath = process.env.TRAINER_DB ?? join(homedir(), '.a-share-kline-trainer', 'trainer.sqlite')
  const configuredRoot = process.env.TDX_ROOT?.trim()
  // 启动器/运行器注入的来源标签只作展示；白名单外的值一律按未标注处理
  const sourceLabel = process.env.TRAINER_TDX_SOURCE?.trim()
  const injectedLabel = sourceLabel && (TDX_SOURCE_LABELS as readonly string[]).includes(sourceLabel)
    ? sourceLabel as TdxRootSource
    : null

  let tdxRoot: string | null = null
  let tdxSource: TdxRootSource | null = null
  if (runId) {
    // 启动器托管/隔离运行：目录与来源完全由启动器解析后注入；这里只做结构校验，
    // 绝不读取本机默认候选或 saved-choice（隔离与可测试性的根约束）。
    const discovery = configuredRoot ? await discoverTdxRoot([configuredRoot]) : null
    tdxRoot = discovery?.root ?? null
    tdxSource = tdxRoot ? (injectedLabel ?? 'env') : null
  } else {
    // 独立运行（npm start / 开发）：只读取显式 env/config 或用户已保存的选择；
    // 不扫描默认安装目录、不读取运行中的通达信进程线索。dataDir 未显式给定时与默认数据库同目录。
    const effectiveDataDir = dataDir ?? dirname(resolve(databasePath))
    const savedChoice = await readSavedTdxChoice(effectiveDataDir)
    const effective = resolveEffectiveTdxRoot({
      envTdxRoot: configuredRoot || null,
      explicitConfigTdxRoot: null,
      savedChoice,
    })
    const validated = effective ? await discoverTdxRoot([effective.root]) : null
    tdxRoot = validated?.root ?? null
    tdxSource = tdxRoot ? effective!.source : null
  }

  return {
    port: Number(process.env.PORT ?? 8787),
    host: process.env.HOST ?? '127.0.0.1',
    databasePath,
    tdxRoot,
    industryMapPath,
    tdxSource,
    portFallback: parsePortFallback(),
    // 独立运行必须能落盘保存选择：未显式给定时与解析时同口径取数据库所在目录；
    // 启动器托管运行未注入时保持 null（保存端点据此拒绝而不是猜目录）
    dataDir: dataDir ?? (runId ? null : dirname(resolve(databasePath))),
    runId,
    staticDirectory: process.env.TRAINER_STATIC_DIR,
    readyFile: process.env.TRAINER_READY_FILE,
    controlToken: process.env.TRAINER_CONTROL_TOKEN?.trim() || null,
    // 启动器托管运行注入其配置文件路径（绝对）；独立运行为 null，数据目录设置端点据此 409
    launcherConfigPath: explicitAbsolutePath('TRAINER_CONFIG_PATH'),
  }
}
