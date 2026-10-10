// DATA-ARCH-01 录像归档语义化命名（纯函数，无 DOM/fs 依赖，Node 可测）。
// 命名规格（任务简报冻结）：<股票名>-<训练模式>-<训练周期>-<起始日yyyymmdd>-<收益段>.trainer-session.json.gz
//   股票名＝真实名称（随机模式结算后揭晓）；非法文件名字符替换为下划线，超长截断（20 字符）
//   训练模式＝经典 / 随机股票 / 随机时间 / 全随机（维度来自运行中元信息的 random 字段；结束后该字段消失）
//   训练周期＝档位缩写 1M/3M/6M/1Y/2Y，或「自定义」（preset/latest 自定日期），或「N根」（bars 档与随机根数窗）
//   收益段＝收益+12.34% / 收益-5.00%；未结算（放弃/中断/收益不可得）＝「未结算」
//   同名冲突序号后缀 -2/-3…（resolveArchiveConflict，由桌面写入端以 fs 存在性探测驱动）
// 提取规则：末检查点的训练元信息优先，实时快照（training/settled/returnPct）可覆盖——
// 结束时录制可能已暂停、末检查点过旧；随机维度只能来自文件内运行中元信息（结束态不带）。
import type { CompactRecordingFile } from './compactTypes'
import type { TrainingMeta } from '../api'

export const ARCHIVE_FILE_SUFFIX = '.trainer-session.json.gz'
/** 股票名段字符上限（CJK 按字符计） */
export const STOCK_NAME_MAX_CHARS = 20
/** 整个文件名（含扩展名）长度上限 */
export const ARCHIVE_FILE_NAME_MAX_CHARS = 150
/** 同名冲突序号上限（-2 … -99；超出视为异常路径，如实抛错） */
export const ARCHIVE_CONFLICT_MAX_SUFFIX = 99
/** 随机月份窗口判定为档位的容差天数（窗末＝起始日＋N 自然月内最后一根交易日） */
const TIER_SPAN_TOLERANCE_DAYS = 7

/** 归档命名的语义输入（由 describeRecordingForArchive 组装，也可直接手写喂给 buildArchiveFileName） */
export interface ArchiveNameInput {
  stockName: string | null
  /** 股票名为空时的次选段（代码） */
  stockCode?: string | null
  modeLabel: string
  periodLabel: string
  startDate: string | null
  settled: boolean
  returnPct: number | null
}

/** 实时快照覆盖：结束时训练页持有的权威终态（结算响应） */
export interface ArchiveOverrides {
  training?: TrainingMeta | null
  settled?: boolean
  returnPct?: number | null
}

const TIER_OF_MONTHS: ReadonlyArray<[number, string]> = [[24, '2Y'], [12, '1Y'], [6, '6M'], [3, '3M'], [1, '1M']]
const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g

function parseDay(value: string): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

function dayMs(value: { year: number; month: number; day: number }): number {
  return Date.UTC(value.year, value.month - 1, value.day)
}

/**
 * 随机月份窗口的档位判定：起止跨度与某个经典档位（N 自然月）相差 ≤7 天时返回档位缩写。
 * 档位口径窗末＝起始交易日＋N 自然月（server/src/train/random-mode.ts），对齐到前方
 * 最后一根交易日后通常只差数个自然日；自定义起止/根数窗口不落容差内 → null。
 */
export function monthSpanMatchesTier(start: string, end: string): string | null {
  const from = parseDay(start), to = parseDay(end)
  if (!from || !to) return null
  const endMs = dayMs(to)
  for (const [months, label] of TIER_OF_MONTHS) {
    const targetMonth = from.month - 1 + months
    const target = { year: from.year + Math.floor(targetMonth / 12), month: (targetMonth % 12) + 1, day: from.day }
    if (Math.abs(dayMs(target) - endMs) <= TIER_SPAN_TOLERANCE_DAYS * 86_400_000) return label
  }
  return null
}

/** 段级清洗：非法字符→下划线、去首尾空白与结尾点、按字符截断；清洗后为空返回占位符 */
export function sanitizeArchiveSegment(value: string, maxChars: number, fallback = '未知'): string {
  const cleaned = value.replace(ILLEGAL_FILE_CHARS, '_').trim().replace(/\.+$/, '').trim()
  if (!cleaned || /^_+$/.test(cleaned)) return fallback
  return Array.from(cleaned).slice(0, maxChars).join('')
}

/** 训练周期段：tier 五档原样；RANGE 按 range.mode 分派（bars→N根，preset/latest→自定义，random→档位容差判定） */
export function periodLabelOf(meta: TrainingMeta | null): string {
  const tier = meta?.tier
  if (tier === '1M' || tier === '3M' || tier === '6M' || tier === '1Y' || tier === '2Y') return tier
  const range = meta?.range
  if (!range) return '自定义'
  if (range.mode === 'bars') return `${range.barCount}根`
  if (range.mode === 'random') {
    const tierLabel = monthSpanMatchesTier(range.startDate, range.endDate)
    return tierLabel ?? `${range.barCount}根`
  }
  return '自定义'
}

/** 训练模式段：随机维度映射；无随机元信息（经典/自选范围）＝「经典」 */
export function modeLabelOf(dimension: string | null): string {
  if (dimension === 'random_stock') return '随机股票'
  if (dimension === 'random_time') return '随机时间'
  if (dimension === 'random_both') return '全随机'
  return '经典'
}

function compactDay(value: string | null): string {
  return parseDay(value ?? '') ? String(value).replaceAll('-', '') : '00000000'
}

function returnSegment(settled: boolean, returnPct: number | null): string {
  if (!settled || returnPct === null || !Number.isFinite(returnPct)) return '未结算'
  const sign = returnPct >= 0 ? '+' : '-'
  return `收益${sign}${Math.abs(returnPct).toFixed(2)}%`
}

/** 语义输入 → 完整归档文件名（含 .trainer-session.json.gz 扩展名） */
export function buildArchiveFileName(input: ArchiveNameInput): string {
  const stock = input.stockName !== null && input.stockName.trim() !== ''
    ? sanitizeArchiveSegment(input.stockName, STOCK_NAME_MAX_CHARS, '未知标的')
    : input.stockCode ? sanitizeArchiveSegment(input.stockCode, STOCK_NAME_MAX_CHARS, '未知标的') : '未知标的'
  const name = `${stock}-${sanitizeArchiveSegment(input.modeLabel, 12)}-${sanitizeArchiveSegment(input.periodLabel, 12)}`
    + `-${compactDay(input.startDate)}-${returnSegment(input.settled, input.returnPct)}${ARCHIVE_FILE_SUFFIX}`
  return Array.from(name).length > ARCHIVE_FILE_NAME_MAX_CHARS
    ? Array.from(name).slice(0, ARCHIVE_FILE_NAME_MAX_CHARS).join('')
    : name
}

/** 末检查点（含训练元信息）的解析：training.metaRef → resources.trainingMeta；无引用时回退表末项 */
function finalMetaOf(file: CompactRecordingFile): TrainingMeta | null {
  const metas = file.resources.trainingMeta
  for (let index = file.checkpoints.length - 1; index >= 0; index -= 1) {
    const training = file.checkpoints[index].training
    if (!training) continue
    const entry = metas.find(item => item.id === training.metaRef)
    return entry ? entry.value : metas.length ? metas[metas.length - 1].value : null
  }
  return metas.length ? metas[metas.length - 1].value : null
}

/** 随机维度：只能来自运行中元信息（结束后服务端不再下发 random 字段） */
function randomDimensionOf(file: CompactRecordingFile): string | null {
  for (const entry of file.resources.trainingMeta) {
    const dimension = entry.value.random?.dimension
    if (dimension) return dimension
  }
  return null
}

/** 末检查点账户（收益兜底推导用；实时覆盖优先） */
function finalEquityOf(file: CompactRecordingFile): number | null {
  for (let index = file.checkpoints.length - 1; index >= 0; index -= 1) {
    const training = file.checkpoints[index].training
    if (!training) continue
    const entry = file.resources.accounts.find(item => item.id === training.accountRef)
    return entry ? entry.value.equity : null
  }
  return file.resources.accounts.length ? file.resources.accounts[file.resources.accounts.length - 1].value.equity : null
}

/** 录制文件（＋可选实时终态覆盖）→ 归档命名输入 */
export function describeRecordingForArchive(file: CompactRecordingFile, overrides: ArchiveOverrides = {}): ArchiveNameInput {
  const meta = overrides.training ?? finalMetaOf(file)
  const settled = overrides.settled ?? meta?.status === 'settled'
  let returnPct = overrides.returnPct ?? null
  if (returnPct === null && settled && meta && meta.initialCash > 0) {
    const equity = finalEquityOf(file)
    if (equity !== null) returnPct = (equity - meta.initialCash) / meta.initialCash * 100
  }
  return {
    stockName: meta?.name ?? null,
    stockCode: meta?.code ?? null,
    modeLabel: modeLabelOf(randomDimensionOf(file)),
    periodLabel: periodLabelOf(meta),
    startDate: meta?.startDate ?? null,
    settled,
    returnPct,
  }
}

/**
 * 同名冲突消解：基础名被占用时依次尝试 <stem>-2/-3/…-99（exists 为异步存在性探测）。
 * 全部被占用时抛错（同日同股同模式同收益训练 98 场属异常路径，如实暴露而非静默覆盖）。
 */
export async function resolveArchiveConflict(fileName: string, exists: (candidate: string) => Promise<boolean>): Promise<string> {
  if (!(await exists(fileName))) return fileName
  const stem = fileName.slice(0, -ARCHIVE_FILE_SUFFIX.length)
  for (let suffix = 2; suffix <= ARCHIVE_CONFLICT_MAX_SUFFIX; suffix += 1) {
    const candidate = `${stem}-${suffix}${ARCHIVE_FILE_SUFFIX}`
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`同名归档已存在且序号用尽（${stem}）：请清理 ${ARCHIVE_FILE_SUFFIX} 归档目录后重试`)
}
