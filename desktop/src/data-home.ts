// PACK-03 首启数据发现/采用决策层（DATA-DISCOVERY-ADOPT 等行为；纯函数＋注入 fs，vitest 直测）。
// 口径来源＝scripts/release/launcher.cjs 冻结语义镜像＋PACK-03 派发简报决策①②＋INSTALL-01
// （用户 2026-10-11 拍板，矩阵行 INSTALL-NSIS-ASSISTED）：
//   - 库识别判据（design.md §1.3 冻结）：候选目录存在 trainer.sqlite 文件即「有训练库」（含空库）
//   - adopt-in-place：原地采用，不复制不迁移不删除任何既有文件（NO-DELETE-INVARIANT）
//   - 候选枚举（INSTALL-01 收敛）：唯一候选＝<homeDir>/.a-share-kline-trainer（≤v1.2.5 zip
//     默认库目录，v1.3.0 唯一默认数据目录）；**exe 同级 data/ 候选已退役**——v1.2.7 目录混放
//     不再吸收旧库，旧数据迁入唯一入口＝迁移工具（并行任务 MIG-EXT-01）
//   - 采用记录＝exe 同级 desktop-data-choice.json（dataDir 之外的固定点；default 档不记路径）
//   - trainer.config.json 解析镜像 launcher resolveConfig（169-203），差异一处：env 折叠不在此层
//     （env 权威在 desktop-config.ts，避免双处折叠）
//   - 双候选决策对话框（「发现两份训练数据」）随 exe-data 候选退役：唯一候选不可能双命中，
//     ask 回调不再被调用；parseDataHomeAnswerEnv/ask 接口保留一个版本周期（便携遗产回滚保护）
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'

export const LEGACY_HOME_DIR_NAME = '.a-share-kline-trainer'
export const LIBRARY_FILE = 'trainer.sqlite'
export const DATA_CHOICE_FILE = 'desktop-data-choice.json'
export const LEGACY_CONFIG_FILE = 'trainer.config.json'
export const SAVED_TDX_CHOICE_FILE = 'saved-tdx-choice.json'

// ===== trainer.config.json 解析（launcher resolveConfig 镜像；PACK-03 决策②） =====

export interface LegacyTrainerConfig {
  port: number
  /** 用户是否亲手写了 port 字段（launcher isExplicitPortField 口径） */
  portExplicit: boolean
  dataDir: string
  dataDirExplicit: boolean
  databasePath: string
  databasePathExplicit: boolean
  tdxRoot: string | null
}

function requireSaneLegacyPort(value: unknown): number {
  const port = typeof value === 'string' && value.trim() !== '' ? Number(value) : value as number
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`trainer.config.json port must be an integer in 1..65535, got: ${JSON.stringify(value ?? null)}`)
  }
  return port
}

function isExplicitField(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return true
}

export function parseLegacyTrainerConfig(raw: unknown, root: string): LegacyTrainerConfig {
  if (raw !== null && raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error('trainer.config.json must contain a JSON object')
  }
  const fields = (raw ?? {}) as Record<string, unknown>
  const text = (key: string): string => (typeof fields[key] === 'string' ? (fields[key] as string).trim() : '')

  const portExplicit = isExplicitField(fields.port)
  const dataDirRaw = text('dataDir')
  const dataDirExplicit = dataDirRaw !== ''
  const dataDir = dataDirExplicit ? resolve(root, dataDirRaw) : join(root, 'data')
  const databasePathRaw = text('databasePath')
  const databasePathExplicit = databasePathRaw !== ''
  if (databasePathExplicit && !isAbsolute(databasePathRaw)) {
    throw new Error(`trainer.config.json databasePath must be an absolute path: ${databasePathRaw}`)
  }
  const databasePath = databasePathExplicit ? resolve(databasePathRaw) : join(dataDir, LIBRARY_FILE)
  const tdxRootRaw = text('tdxRoot')
  return {
    port: portExplicit ? requireSaneLegacyPort(fields.port) : 8787,
    portExplicit,
    dataDir,
    dataDirExplicit,
    databasePath,
    databasePathExplicit,
    tdxRoot: tdxRootRaw ? resolve(root, tdxRootRaw) : null,
  }
}// ===== 采用记录（desktop-data-choice.json） =====

export interface DataChoiceRecord {
  version: 1
  /** default＝沿用便携默认（不记路径）；adopted＝dataDir 记绝对路径 */
  mode: 'default' | 'adopted'
  dataDir: string | null
  decidedAt: string
}

export function parseDataChoiceRecord(raw: unknown): DataChoiceRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.version !== 1) return null
  if (value.mode === 'default') {
    return { version: 1, mode: 'default', dataDir: null, decidedAt: typeof value.decidedAt === 'string' ? value.decidedAt : '' }
  }
  if (value.mode === 'adopted') {
    if (typeof value.dataDir !== 'string' || !isAbsolute(value.dataDir)) return null
    return { version: 1, mode: 'adopted', dataDir: resolve(value.dataDir), decidedAt: typeof value.decidedAt === 'string' ? value.decidedAt : '' }
  }
  return null
}

export function serializeDataChoiceRecord(record: DataChoiceRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

// ===== 候选枚举与应答注入 =====

export interface DataHomeCandidate {
  /** 'exe-data'＝便携遗产候选，INSTALL-01 后不再由 enumerateDataHomeCandidates 产出（类型保留供回滚一个版本周期） */
  id: 'exe-data' | 'legacy-home'
  path: string
}

/**
 * 候选枚举（INSTALL-01 收敛，2026-10-11 用户拍板）：唯一候选＝legacy-home
 * （<homeDir>/.a-share-kline-trainer，即 v1.3.0 唯一默认数据目录）。
 * exe 同级 data/ 候选已退役——v1.2.7 目录混放不再吸收旧库（旧数据迁入唯一入口＝迁移工具）；
 * exeDir 参数保留（签名稳定；本函数不再消费）。
 */
export function enumerateDataHomeCandidates(paths: { exeDir: string; homeDir: string }): DataHomeCandidate[] {
  void paths.exeDir
  return [
    { id: 'legacy-home', path: join(paths.homeDir, LEGACY_HOME_DIR_NAME) },
  ]
}

export type DataHomeAnswer = 'exe' | 'legacy' | 'cancel'

/**
 * TRAINER_DESKTOP_DATA_ANSWER 严格解析（unset/空白→null；非法值报错不猜）。
 * @deprecated INSTALL-01（2026-10-11 用户拍板）：双候选决策对话框随 exe-data 候选退役，
 * 本 env 注入口不再被启动路径消费；函数保留一个版本周期（便携遗产回滚保护），断言仍锁定语义。
 */
export function parseDataHomeAnswerEnv(env: NodeJS.ProcessEnv): DataHomeAnswer | null {
  const raw = env.TRAINER_DESKTOP_DATA_ANSWER?.trim()
  if (!raw) return null
  if (raw !== 'exe' && raw !== 'legacy' && raw !== 'cancel') {
    throw new Error(`TRAINER_DESKTOP_DATA_ANSWER only accepts exe|legacy|cancel, got: ${raw}`)
  }
  return raw
}

// ===== saved-tdx-choice.json（SETUP-SAVE-01 形状镜像；PACK-03 §2.4 附加项） =====

export interface SavedTdxChoice {
  root: string
}

export function parseSavedTdxChoice(raw: unknown): SavedTdxChoice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.version !== 1) return null
  if (typeof value.root !== 'string' || value.root.trim() === '') return null
  return { root: value.root }
}

/**
 * saved-tdx-choice.json 的搜索目录＝「生效 dataDir」（矩阵 DATA-SAVED-TDX-CHOICE-FOLLOW）：
 * env 显式 TRAINER_DATA_DIR（E0，绝对性由 desktop-config 校验）> 解析产物 dataDir > 唯一默认
 * legacy-home（INSTALL-01 收敛；原便携默认 exe/data 已退役）。
 * 只显式 TRAINER_DB 不改 dataDir（与 launcher/desktop-config 同语义：库可另置，dataDir 不随之漂移）。
 */
export function savedChoiceSearchDir(
  env: NodeJS.ProcessEnv,
  resolution: Pick<DataHomeResolution, 'kind' | 'dataDir'>,
  homeDir: string,
): string {
  const envDataDir = env.TRAINER_DATA_DIR?.trim()
  if (envDataDir) return envDataDir
  return resolution.dataDir ?? join(homeDir, LEGACY_HOME_DIR_NAME)
}

// ===== 发现/采用编排（纯决策＋注入 fs/ask） =====

export type DataHomeResolution =
  | { kind: 'explicit-env'; dataDir: null; record: null; notice: null; probed: false }
  | { kind: 'legacy-config'; dataDir: string; record: null; notice: null; probed: false }
  | { kind: 'remembered'; dataDir: string; record: null; notice: null; probed: false }
  | { kind: 'discovery-default'; dataDir: string; record: DataChoiceRecord; notice: null; probed: true }
  | { kind: 'discovery-legacy'; dataDir: string; record: DataChoiceRecord; notice: string; probed: true }

export type DataHomeOutcome =
  | { quit: true; reason: string }
  | { quit: false; legacyConfig: LegacyTrainerConfig | null; resolution: DataHomeResolution }

export interface DataHomeDeps {
  /** 读 JSON 文件；缺失→{missing:true}；文件存在但内容非法由调用方在解析层报错 */
  readJsonFile: (path: string) => Promise<{ missing: true } | { missing: false; value: unknown }>
  fileExists: (path: string) => Promise<boolean>
  /**
   * @deprecated INSTALL-01（2026-10-11 用户拍板）：唯一候选不可能双命中，双候选决策对话框
   * 退役，本回调不再被 resolveDataHome 调用；接口保留一个版本周期（便携遗产回滚保护）。
   */
  ask?: (candidates: { exe: string; legacy: string }) => Promise<DataHomeAnswer>
  now?: () => string
}

function defaultRecord(now: string): DataChoiceRecord {
  return { version: 1, mode: 'default', dataDir: null, decidedAt: now }
}

function adoptedRecord(dataDir: string, now: string): DataChoiceRecord {
  return { version: 1, mode: 'adopted', dataDir, decidedAt: now }
}

/**
 * 首启数据发现/采用编排（design.md §2.2 状态机）：
 * env 显式 > trainer.config.json dataDir > 采用记录（幂等短路）> 首启发现 > 便携默认。
 * 任何分支都不写不改既有文件；record 产物由调用方持久化（persistDataChoiceRecord）。
 */
export async function resolveDataHome(
  input: { envExplicit: boolean; paths: { exeDir: string; homeDir: string } },
  deps: DataHomeDeps,
): Promise<DataHomeOutcome> {
  // E1 旧配置：始终解析（非法即启动报错，不猜）；显式 dataDir 时作为确定来源
  const configFile = await deps.readJsonFile(join(input.paths.exeDir, LEGACY_CONFIG_FILE))
  const legacyConfig = configFile.missing ? null : parseLegacyTrainerConfig(configFile.value, input.paths.exeDir)

  // E0 env 显式：确定性来源，不发现不记录
  if (input.envExplicit) {
    return { quit: false, legacyConfig, resolution: { kind: 'explicit-env', dataDir: null, record: null, notice: null, probed: false } }
  }
  // E1 config 显式 dataDir：无缝升级场景（用户把 exe 放进旧 zip 文件夹且配置了目录）
  if (legacyConfig?.dataDirExplicit) {
    return { quit: false, legacyConfig, resolution: { kind: 'legacy-config', dataDir: legacyConfig.dataDir, record: null, notice: null, probed: false } }
  }

  const candidates = enumerateDataHomeCandidates(input.paths)
  const now = deps.now?.() ?? new Date().toISOString()

  // E2 采用记录：幂等短路（不再探测）；adopted 档失效（路径无库）→ 丢弃重发现。
  // 损坏（非 JSON/读失败）→ 按无记录处理：desktop-data-choice.json 是 desktop 自有原子写文件，
  // 写坏≠用户配置错误，不得 brick 启动（design E2「损坏/异己→视为无记录」；重发现结果幂等）。
  let choiceFile: { missing: true } | { missing: false; value: unknown }
  try {
    choiceFile = await deps.readJsonFile(join(input.paths.exeDir, DATA_CHOICE_FILE))
  } catch (error) {
    console.warn(`[desktop] data choice record is unreadable; re-running first-launch discovery (${(error as Error).message})`)
    choiceFile = { missing: true }
  }
  if (!choiceFile.missing) {
    const record = parseDataChoiceRecord(choiceFile.value)
    if (record?.mode === 'default') {
      const dataDir = candidates[0].path
      return { quit: false, legacyConfig, resolution: { kind: 'remembered', dataDir, record: null, notice: null, probed: false } }
    }
    if (record?.mode === 'adopted' && await deps.fileExists(join(record.dataDir!, LIBRARY_FILE))) {
      return { quit: false, legacyConfig, resolution: { kind: 'remembered', dataDir: record.dataDir!, record: null, notice: null, probed: false } }
    }
    // 记录失效：如实记日志后重新发现（不报错——目录被删属用户自由）
    console.warn(`[desktop] data choice record is invalid (missing library); re-running first-launch discovery`)
  }

  // E3 首启发现（仅在无显式配置且无有效记录时到达；唯一候选＝legacy-home，INSTALL-01）
  const hits: DataHomeCandidate[] = []
  for (const candidate of candidates) {
    if (await deps.fileExists(join(candidate.path, LIBRARY_FILE))) hits.push(candidate)
  }
  if (hits.length === 0) {
    return { quit: false, legacyConfig, resolution: { kind: 'discovery-default', dataDir: candidates[0].path, record: defaultRecord(now), notice: null, probed: true } }
  }
  // 单命中＝唯一候选命中（legacy-home）：原地采用＋提示＋adopted 记录。
  // （INSTALL-01 后不可能双命中——双候选对话框分支已随 exe-data 候选移除，ask 不再被调用。）
  const hit = hits[0]
  return {
    quit: false,
    legacyConfig,
    resolution: {
      kind: 'discovery-legacy',
      dataDir: hit.path,
      record: adoptedRecord(hit.path, now),
      notice: `已沿用历史训练数据：${hit.path}`,
      probed: true,
    },
  }
}

// ===== 真实 fs 适配（main.ts 粘合用；决策函数不依赖此处，单测全部注入桩） =====

export function createNodeDataHomeDeps(options: { ask?: DataHomeDeps['ask'] }): DataHomeDeps {
  return {
    ask: options.ask,
    readJsonFile: async path => {
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { missing: true }
        throw error
      }
      try {
        return { missing: false, value: JSON.parse(text) }
      } catch (error) {
        throw new Error(`trainer config file is not valid JSON: ${path} (${(error as Error).message})`)
      }
    },
    fileExists: async path => {
      try {
        await stat(path)
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    },
  }
}

/** 采用记录原子落盘（临时文件＋rename，server ready 文件同法）；仅写 desktop 专属文件 */
export async function persistDataChoiceRecord(exeDir: string, record: DataChoiceRecord): Promise<void> {
  const path = join(exeDir, DATA_CHOICE_FILE)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, serializeDataChoiceRecord(record), 'utf8')
  await rename(temporary, path)
}

export async function readDataChoiceRecord(exeDir: string): Promise<DataChoiceRecord | null> {
  try {
    return parseDataChoiceRecord(JSON.parse(await readFile(join(exeDir, DATA_CHOICE_FILE), 'utf8')))
  } catch {
    return null
  }
}
