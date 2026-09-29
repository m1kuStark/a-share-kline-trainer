import { access, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname as win32Dirname, isAbsolute, join, resolve } from 'node:path'

export interface TdxDiscovery {
  root: string
  source: 'candidate' | 'manual'
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function isTdxRoot(root: string): Promise<boolean> {
  const dayDirs = await Promise.all(['sh', 'sz', 'bj'].map(async market => {
    const directory = join(root, 'vipdoc', market, 'lday')
    if (!(await exists(directory))) return false
    const names = await readdir(directory).catch(() => [])
    return names.some(name => name.toLowerCase().endsWith('.day'))
  }))
  return dayDirs.some(Boolean) && await exists(join(root, 'T0002', 'hq_cache'))
}

export async function discoverTdxRoot(candidates: string[]): Promise<TdxDiscovery | null> {
  for (const candidate of candidates) {
    const root = resolve(candidate)
    if (await isTdxRoot(root)) return { root, source: 'candidate' }
  }
  return null
}

export function defaultTdxCandidates(environment: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [
    environment.ProgramFiles,
    environment['ProgramFiles(x86)'],
    environment.ProgramData,
    environment.LOCALAPPDATA,
    environment.APPDATA,
    environment.SystemDrive,
    homedir(),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const names = ['TongDaXin', 'TDX']
  return [...new Set(roots.flatMap(root => names.map(name => join(root, name))))]
}

// ===== SETUP-01：误选目录的有限邻近识别 =====
// 用户在原生目录选择框里可能选中通达信根目录的上一级、vipdoc 或它的市场/日线子目录。
// 设计约束（tdx-onboarding.md）：只允许在附近有限范围识别根目录并交由用户确认，
// 不做全盘递归、不跟随目录联接（最终由 inspectTdxCandidate 的符号链接策略兜底）。

/** 直读目录项数量上限：邻近识别只看有限条目，防止把选择框当成全盘扫描入口 */
export const NEARBY_SCAN_ENTRY_LIMIT = 50
/** 返回给前端确认的邻近候选上限 */
export const NEARBY_SUGGESTION_LIMIT = 5

function isPlainChildName(name: string): boolean {
  return name !== '.' && name !== '..'
}

/** 盘根/文件系统根不作为候选：辨识度为零，容易把整个盘当成安装目录误报 */
function isDriveRoot(path: string): boolean {
  return /^[A-Za-z]:\\?$/i.test(path) || path === '\\' || path === '/'
}

/** 选中目录是否可枚举（只 stat 目录本身；readdir 失败按不可枚举处理） */
async function isEnumerableDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 由用户误选的目录推导有限个"可能的真实安装根"候选，按可信度排序：
 * 1) 选中目录本身；
 * 2) 选中目录是 vipdoc 或其下层（vipdoc/sh、vipdoc/sh/lday 等）时，逐级上溯（≤4 层）
 *    找到第一层包含 vipdoc 子目录的祖先；
 * 3) 选中目录的直接子目录（前 NEARBY_SCAN_ENTRY_LIMIT 项，只列目录项名，不做递归）。
 * 返回值只经过去重和上限裁剪，不代表可用——可用性一律由调用方 inspectTdxCandidates 判定。
 */
export async function collectNearbyCandidateRoots(selected: string): Promise<string[]> {
  const trimmed = selected.trim()
  if (!trimmed || !isAbsolute(trimmed)) return []
  // 不接受设备命名空间与 UNC（与 inspectTdxCandidate 的口径一致，尽早排除）
  if (trimmed.startsWith('\\\\.\\') || trimmed.startsWith('\\\\?\\')
    || trimmed.startsWith('\\\\') || trimmed.startsWith('//')) return []

  const seen = new Set<string>()
  const ordered: string[] = []
  const push = (root: string): void => {
    const resolved = resolve(root)
    if (isDriveRoot(resolved)) return
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) return
    seen.add(key)
    ordered.push(resolved)
  }

  push(trimmed)

  // vipdoc 及其下层：逐级上溯，找到第一层包含 vipdoc 子目录的祖先即为安装根
  let cursor = resolve(trimmed)
  for (let depth = 0; depth < 4; depth += 1) {
    const parent = win32Dirname(cursor)
    if (parent === cursor || isDriveRoot(parent)) break
    cursor = parent
    if (await exists(join(cursor, 'vipdoc'))) {
      push(cursor)
      break
    }
  }

  // 直接子目录（有限条目）：误选了多家券商安装共用的父目录时列出实际安装
  if (await isEnumerableDirectory(trimmed)) {
    const entries = await readdir(trimmed).catch(() => [] as string[])
    for (const entry of entries.filter(isPlainChildName).slice(0, NEARBY_SCAN_ENTRY_LIMIT)) {
      push(join(trimmed, entry))
    }
  }

  return ordered.slice(0, NEARBY_SUGGESTION_LIMIT + 1)
}
