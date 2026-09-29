import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { discoverTdxRoot, defaultTdxCandidates } from './tdx/discover.js'
import { readSavedTdxChoice, resolveEffectiveTdxRoot, type TdxRootSource } from './setup/saved-choice.js'

export interface AppConfig {
  port: number
  host: string
  databasePath: string
  tdxRoot: string | null
  /**
   * 生效行情目录的来源标签（SETUP-01 冻结优先级 env → explicit-config → saved-choice →
   * auto-discovered 的胜出来源）。tdxRoot 为 null 时为 null。只作展示/解释用，绝不
   * 回传完整本机路径。独立运行（无 runId）由本模块按优先级解析；启动器托管运行
   * （有 runId）由启动器解析后经 TRAINER_TDX_SOURCE 传入，服务端只透传校验过的标签。
   */
  tdxSource: TdxRootSource | null
  /** 保存选择/重启状态等运行数据的目录；独立运行默认数据库所在目录 */
  dataDir: string | null
  runId?: string
  staticDirectory?: string
  readyFile?: string
  /** 受保护 setup 端点的控制令牌（只读环境透传；不生成、不持久化、不回显） */
  controlToken: string | null
}

const TDX_SOURCE_LABELS: readonly TdxRootSource[] = ['env', 'explicit-config', 'saved-choice', 'auto-discovered']

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
    // 独立运行（npm start / 开发）：按冻结优先级解析，saved-choice 与本机快速发现
    // 都参与；显式 env 仍最高。dataDir 未显式给定时与默认数据库同目录。
    const effectiveDataDir = dataDir ?? dirname(resolve(databasePath))
    const [savedChoice, discovery] = await Promise.all([
      readSavedTdxChoice(effectiveDataDir),
      discoverTdxRoot(defaultTdxCandidates()),
    ])
    const effective = resolveEffectiveTdxRoot({
      envTdxRoot: configuredRoot || null,
      explicitConfigTdxRoot: null,
      savedChoice,
      autoDiscoveredTdxRoot: discovery?.root ?? null,
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
    tdxSource,
    // 独立运行必须能落盘保存选择：未显式给定时与解析时同口径取数据库所在目录；
    // 启动器托管运行未注入时保持 null（保存端点据此拒绝而不是猜目录）
    dataDir: dataDir ?? (runId ? null : dirname(resolve(databasePath))),
    runId,
    staticDirectory: process.env.TRAINER_STATIC_DIR,
    readyFile: process.env.TRAINER_READY_FILE,
    controlToken: process.env.TRAINER_CONTROL_TOKEN?.trim() || null,
  }
}
