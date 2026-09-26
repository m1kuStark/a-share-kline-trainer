// 已诊断候选的原子保存与来源解析（SETUP-SAVE-01 冻结合同）。
// 保存前复验（recognized+readable）；临时文件+rename 原子替换；失败保留旧选择；
// 读取对损坏/版本/字段问题返回 null 不抛；来源解析不读文件、不改输入。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectTdxCandidate, type TdxCandidateCheck } from '../tdx/inspect.js'

export const SAVED_TDX_CHOICE_FILE = 'saved-tdx-choice.json'

export interface SavedTdxChoice {
  version: 1
  root: string
  savedAt: string
  inspectedAt: string
}

export type TdxRootSource = 'env' | 'explicit-config' | 'saved-choice' | 'auto-discovered'

export interface EffectiveTdxRoot {
  root: string
  source: TdxRootSource
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function savedChoicePath(dataDir: string): string {
  return join(dataDir, SAVED_TDX_CHOICE_FILE)
}

/** 保存前复验：recognized+readable 才允许；失败抛可行动错误（含 problems），旧文件保留。 */
async function reinspectOrThrow(root: string, inspect?: (root: string) => Promise<TdxCandidateCheck>): Promise<TdxCandidateCheck> {
  const inspector = inspect ?? inspectTdxCandidate
  const check = await inspector(root)
  if (!(check.recognized && check.readable)) {
    const detail = check.problems.length > 0 ? `；问题：${check.problems.join('；')}` : ''
    throw new Error(`候选未通过复验（root=${JSON.stringify(check.root)}，recognized=${check.recognized}，readable=${check.readable}），未保存新选择${detail}`)
  }
  return check
}

/** 原子保存已复验的候选选择：同目录随机临时文件（wx）+ rename；任何失败保留旧目标。 */
export async function saveTdxChoice(
  dataDir: string,
  root: string,
  inspect?: (root: string) => Promise<TdxCandidateCheck>,
  now?: () => Date,
): Promise<SavedTdxChoice> {
  const nowFn = now ?? ((): Date => new Date())
  const nowIso = nowFn().toISOString()
  const check = await reinspectOrThrow(root, inspect)
  const saved: SavedTdxChoice = {
    version: 1,
    root: check.root,
    savedAt: nowIso,
    inspectedAt: nowIso,
  }
  await mkdir(dataDir, { recursive: true })
  const path = savedChoicePath(dataDir)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' })
  await rename(temporary, path)
  return saved
}

/** 读取保存的选择：不存在/JSON 损坏/版本不为 1/root 空/时间字段非 ISO 一律返回 null，不抛出。 */
export async function readSavedTdxChoice(dataDir: string): Promise<SavedTdxChoice | null> {
  let raw: string
  try {
    raw = await readFile(savedChoicePath(dataDir), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT') return null
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.version !== 1) return null
  if (!isNonEmptyString(record.root)) return null
  if (typeof record.savedAt !== 'string' || !ISO_PATTERN.test(record.savedAt)) return null
  if (typeof record.inspectedAt !== 'string' || !ISO_PATTERN.test(record.inspectedAt)) return null
  return {
    version: 1,
    root: record.root,
    savedAt: record.savedAt,
    inspectedAt: record.inspectedAt,
  }
}

/** 冻结的来源优先级：env → explicit-config → saved-choice → auto-discovered。
 * 空白视为缺失；不读文件、不检查路径、不改变输入。 */
export function resolveEffectiveTdxRoot(input: {
  envTdxRoot?: string | null
  explicitConfigTdxRoot?: string | null
  savedChoice?: SavedTdxChoice | null
  autoDiscoveredTdxRoot?: string | null
}): EffectiveTdxRoot {
  const candidates: Array<{ root: string; source: TdxRootSource }> = [
    { root: input.envTdxRoot ?? '', source: 'env' },
    { root: input.explicitConfigTdxRoot ?? '', source: 'explicit-config' },
    { root: input.savedChoice?.root ?? '', source: 'saved-choice' },
    { root: input.autoDiscoveredTdxRoot ?? '', source: 'auto-discovered' },
  ]
  for (const candidate of candidates) {
    if (isNonEmptyString(candidate.root)) {
      return { root: candidate.root, source: candidate.source }
    }
  }
  return null
}
