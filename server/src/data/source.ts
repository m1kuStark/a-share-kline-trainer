// 数据源合约：日线来源（本地通达信 / 在线）的统一接口与在线源注册表。
// R1 仅包装本地 TDX（见 tdxSource.ts）；registerOnlineSource 供 R2 注册真实在线适配器，
// 训练器其余部分（协调器 / API / 前端状态）只依赖本合约，不直接依赖 TDX 路径。

export type SourceKind = 'tdx' | 'online'

/** 单个日线文件的扫描状态（与 data_file_state 表字段一一对应；sha256 系列仅存于历史版本保护库） */
export interface ScannedFileState {
  path: string
  size: number
  mtimeMs: number
  maxDate: string | null
  rows: number
  /**
   * 完整内容 SHA-256（DATA-03）：本批实际读取该文件时计算；元数据复用时沿用基线值。
   * null/缺省＝无内容证据（保护库未建立或来源注入夹具未提供），差异分类退回元数据口径。
   */
  sha256?: string | null
  /**
   * 瞬态差异证据（不入库）：本批读取时对「上一版本前 prefixRows 条记录」计算的前缀哈希。
   * 前缀哈希等于上一版本整文件哈希 ⇒ 纯追加（历史逐字节未变）；不等 ⇒ 追加同时改写历史。
   */
  prefixSha256?: string | null
  prefixRows?: number | null
}

/** 上一次成功扫描留下的基线（path → 文件状态），用于增量比较 */
export type ScanBaseline = Map<string, ScannedFileState>

export interface ScanOutcome {
  kind: SourceKind
  name: string
  /** 本次扫描看到的股票（.day 文件）总数 */
  totalStocks: number
  /** 新增：新出现的文件 + 最大日期前移的既有文件（有新数据的股票数） */
  added: number
  /** 移除：上一次扫描有、本次消失的文件 */
  removed: number
  /** 疑似历史修订：最大日期未前移但 size/mtime 发生变化的文件 */
  revised: number
  /** true＝本次为首扫基线（全部按基线处理，不计修订、不告警） */
  baseline: boolean
  /** 全市场最大日线日期（YYYY-MM-DD 或 null） */
  sourceMaxDate: string | null
  /** 全部文件状态（成功时由协调器一次性提交为快照） */
  files: ScannedFileState[]
}

export interface DailySource {
  kind: SourceKind
  /** 展示名（中文），如“通达信本地数据” */
  name: string
  /** 廉价可用性检查（不得做全量扫描） */
  available(): Promise<boolean>
  /**
   * 可选的廉价结构探测（比 available 更进一步、远轻于 scan）：检查扫描所需的目录结构
   * 当前是否可读。未实现＝来源无可探测结构（状态查询跳过降级）。
   */
  probeReadability?(): Promise<boolean>
  /** 全市场扫描；previous 为上次基线，缺省/为空视为建立首个基线。
   *  任何文件级失败必须抛错（中文 message 指明文件），不得返回部分结果。 */
  scan(previous?: ScanBaseline): Promise<ScanOutcome>
}

const onlineSources = new Map<string, DailySource>()

/** 注册在线数据源（R2 接入点，本批不实现真实适配器）；返回注销函数。同名后注册覆盖先注册。 */
export function registerOnlineSource(source: DailySource): () => void {
  onlineSources.set(source.name, source)
  return () => {
    if (onlineSources.get(source.name) === source) onlineSources.delete(source.name)
  }
}

export function listOnlineSources(): DailySource[] {
  return [...onlineSources.values()]
}

/** 与上次基线比较得出 added/removed/revised；基线首扫全部记为基线（计数为 0）。
 *  DATA-03 修漏报：maxDate 前移过去一律记 added，「追加同时改写历史」因此漏报——
 *  现在两侧都有内容指纹时用前缀哈希判别：前缀一致＝纯追加（added），前缀不一致＝历史被改写（revised）。
 *  无内容证据（任一侧无 sha256）保持元数据口径，不虚构结论。 */
export function diffAgainstBaseline(
  previous: ScanBaseline | undefined,
  files: ScannedFileState[],
): { baseline: boolean; added: number; removed: number; revised: number } {
  if (!previous || previous.size === 0) return { baseline: true, added: 0, removed: 0, revised: 0 }
  let added = 0
  let removed = 0
  let revised = 0
  const currentPaths = new Set(files.map(file => file.path))
  for (const file of files) {
    const prev = previous.get(file.path)
    if (!prev) {
      added += 1
      continue
    }
    // max_date 变大＝正常追加（记入“新增数据”）；相同或变小但字节/时间变化＝疑似历史修订
    if (file.maxDate && prev.maxDate && file.maxDate > prev.maxDate) {
      if (file.prefixSha256 && file.prefixRows != null && prev.sha256) {
        // 内容证据可用：前缀哈希逐字节比对上一版本全部记录
        if (file.prefixSha256 === prev.sha256) added += 1
        else revised += 1
      } else {
        added += 1
      }
      continue
    }
    if (file.size !== prev.size || file.mtimeMs !== prev.mtimeMs) revised += 1
  }
  for (const path of previous.keys()) {
    if (!currentPaths.has(path)) removed += 1
  }
  return { baseline: false, added, removed, revised }
}
