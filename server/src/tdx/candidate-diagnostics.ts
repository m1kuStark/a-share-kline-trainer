// 诊断组合（SETUP-CLUES-02 冻结接口）：把运行进程线索与 inspectTdxCandidates 组合成
// "诊断结果"，供未来受保护 setup API 使用。纯组合：候选根 = 进程线索根 + 手工根，
// 首次出现顺序、Windows 大小写不敏感去重、单次 inspect、五态与 reason 原样保留。
import type { ProcessClueQueryResult } from './process-clues.js'
import type { TdxCandidateCheck } from './inspect.js'
import { inspectTdxCandidates } from './inspect.js'

export type CandidateSource = 'running-process' | 'manual'

export interface TdxCandidateDiagnostic {
  check: TdxCandidateCheck
  sources: CandidateSource[]
}

export interface CollectDiagnosticsInput {
  process: ProcessClueQueryResult
  manualRoots: readonly string[]
}

export interface CandidateDiagnosticsResult {
  processStatus: ProcessClueQueryResult['status']
  processReason?: string
  candidates: TdxCandidateDiagnostic[]
}

/** Windows 大小写不敏感的去重键 */
function dedupKey(root: string): string {
  return root.toLowerCase()
}

/** 组合诊断：process.clues 根在前、manualRoots 在后，首次出现顺序去重，
 * 同根多来源合并（running-process 在前）；去重后的 roots 只一次传给 inspect，
 * 返回顺序与 inspect 结果一致。process 五态与 reason 原样透传，inspect 不抛错时
 * 空结果正常返回。 */
export async function collectTdxCandidateDiagnostics(
  input: CollectDiagnosticsInput,
  inspect: (roots: readonly string[]) => Promise<TdxCandidateCheck[]> = inspectTdxCandidates,
): Promise<CandidateDiagnosticsResult> {
  const sourcesByRoot = new Map<string, { root: string; sources: CandidateSource[] }>()
  for (const clue of input.process.clues) {
    const key = dedupKey(clue.root)
    const existing = sourcesByRoot.get(key)
    if (existing) continue
    sourcesByRoot.set(key, { root: clue.root, sources: ['running-process'] })
  }
  for (const root of input.manualRoots) {
    const key = dedupKey(root)
    const existing = sourcesByRoot.get(key)
    if (!existing) {
      sourcesByRoot.set(key, { root, sources: ['manual'] })
    } else if (!existing.sources.includes('manual')) {
      existing.sources.push('manual')
    }
  }

  const roots = [...sourcesByRoot.values()].map(entry => entry.root)
  const checks = roots.length > 0 ? await inspect(roots) : []
  const byKey = new Map(checks.map(check => [dedupKey(check.root), check]))
  // 返回顺序与 inspect 结果一致；sources 按去重键回填
  const candidates: TdxCandidateDiagnostic[] = checks.map(check => ({
    check,
    sources: sourcesByRoot.get(dedupKey(check.root))!.sources,
  }))

  return {
    processStatus: input.process.status,
    processReason: input.process.reason,
    candidates,
  }
}
