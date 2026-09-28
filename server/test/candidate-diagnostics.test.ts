// 诊断组合（SETUP-CLUES-02 冻结接口）：进程线索 + inspectTdxCandidates → 诊断结果。
// 全部使用合成 TdxCandidateCheck 与注入 inspect stub；不读真实 TDX/进程。
import { describe, expect, it } from 'vitest'
import type { TdxCandidateCheck } from '../src/tdx/inspect'
import type { ProcessClueQueryResult } from '../src/tdx/process-clues'
import {
  collectTdxCandidateDiagnostics,
  type CandidateSource,
  type TdxCandidateDiagnostic,
} from '../src/tdx/candidate-diagnostics'

function check(root: string, overrides: Partial<TdxCandidateCheck> = {}): TdxCandidateCheck {
  return {
    root,
    recognized: true,
    readable: true,
    dailyFileCount: 100,
    latestDate: '2026-09-24',
    hasAdjustment: true,
    hasNames: true,
    hasBenchmark: false,
    problems: [],
    ...overrides,
  }
}

function processResult(status: ProcessClueQueryResult['status'], roots: string[] = [], reason?: string): ProcessClueQueryResult {
  return {
    status,
    clues: status === 'ok' ? roots.map(root => ({ root, source: 'running-process' as const })) : [],
    ...(reason !== undefined ? { reason } : {}),
  } as ProcessClueQueryResult
}

function inspectRecorder(results: TdxCandidateCheck[], failure?: Error): {
  calls: string[][]
  inspect: (roots: readonly string[]) => Promise<TdxCandidateCheck[]>
} {
  const calls: string[][] = []
  return {
    calls,
    inspect: async roots => {
      calls.push([...roots])
      if (failure) throw failure
      return results.filter(check => roots.some(root => root.toLowerCase() === check.root.toLowerCase()))
    },
  }
}

describe('collectTdxCandidateDiagnostics', () => {
  it('merges running-process and manual roots keeping first-seen order', async () => {
    const { calls, inspect } = inspectRecorder([
      check('D:\\new_tdx'), check('C:\\Program Files\\TongDaXin'),
    ])
    const result = await collectTdxCandidateDiagnostics({
      process: processResult('ok', ['D:\\new_tdx']),
      manualRoots: ['C:\\Program Files\\TongDaXin'],
    }, inspect)
    expect(result.candidates.map(c => c.check.root)).toEqual([
      'D:\\new_tdx', 'C:\\Program Files\\TongDaXin',
    ])
    expect(result.candidates.map(c => c.sources)).toEqual([['running-process'], ['manual']])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(2)
  })

  it('merges same root from both sources with running-process first', async () => {
    const { calls, inspect } = inspectRecorder([check('D:\\new_tdx')])
    const result = await collectTdxCandidateDiagnostics({
      process: processResult('ok', ['D:\\new_tdx']),
      manualRoots: ['D:\\new_tdx'],
    }, inspect)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].sources).toEqual(['running-process', 'manual'])
    expect(calls).toHaveLength(1)
  })

  it('deduplicates windows case-insensitively', async () => {
    const { calls, inspect } = inspectRecorder([check('D:\\new_tdx')])
    const result = await collectTdxCandidateDiagnostics({
      process: processResult('ok', ['D:\\NEW_TDX']),
      manualRoots: ['d:\\new_tdx'],
    }, inspect)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].check.root.toLowerCase()).toBe('d:\\new_tdx')
    expect(result.candidates[0].sources).toEqual(['running-process', 'manual'])
    expect(calls[0]).toHaveLength(1)
  })

  it('passes deduplicated roots to inspect exactly once', async () => {
    const seenInputs: string[][] = []
    const spy = async (roots: readonly string[]) => {
      seenInputs.push([...roots])
      return roots.map(root => check(root))
    }
    const result = await collectTdxCandidateDiagnostics({
      process: processResult('ok', ['D:\\a', 'D:\\b']),
      manualRoots: ['D:\\b', 'D:\\c'],
    }, spy)
    expect(seenInputs).toEqual([['D:\\a', 'D:\\b', 'D:\\c']])
    expect(result.candidates.map(c => c.check.root)).toEqual(['D:\\a', 'D:\\b', 'D:\\c'])
  })

  it('keeps the inspect result order regardless of input order', async () => {
    const { inspect } = inspectRecorder([check('C:\\second'), check('D:\\first')])
    const result = await collectTdxCandidateDiagnostics({
      process: processResult('ok', ['D:\\first']),
      manualRoots: ['C:\\second'],
    }, inspect)
    expect(result.candidates.map(c => c.check.root)).toEqual(['C:\\second', 'D:\\first'])
  })

  it('preserves all five process statuses and reason verbatim', async () => {
    const cases: Array<ProcessClueQueryResult['status'] | 'ok-with-reason'> = [
      'ok', 'timeout', 'denied', 'unavailable', 'not_applicable',
    ]
    for (const status of cases) {
      const result = await collectTdxCandidateDiagnostics({
        process: processResult(status as ProcessClueQueryResult['status'], [], '原样原因'),
        manualRoots: [],
      }, async () => [])
      expect(result.processStatus).toBe(status === 'ok-with-reason' ? 'ok' : status)
    }
    const withReason = await collectTdxCandidateDiagnostics({
      process: processResult('unavailable', [], '进程查询启动失败：ENOENT'),
      manualRoots: [],
    }, async () => [])
    expect(withReason.processReason).toBe('进程查询启动失败：ENOENT')
  })

  it('returns empty candidates normally when there are no roots', async () => {
    let inspectCalled = false
    const result = await collectTdxCandidateDiagnostics({
      process: processResult('ok', []),
      manualRoots: [],
    }, async roots => {
      inspectCalled = roots.length > 0
      return []
    })
    expect(result.processStatus).toBe('ok')
    expect(result.candidates).toEqual([])
    expect(inspectCalled).toBe(false)
  })

  it('surfaces source diversity across candidate checks', async () => {
    const { inspect } = inspectRecorder([
      check('D:\\new_tdx', { recognized: false, problems: ['未发现行情结构'] }),
      check('C:\\Program Files\\TongDaXin', { hasBenchmark: true }),
    ])
    const result = await collectTdxCandidateDiagnostics({
      process: processResult('ok', ['D:\\new_tdx']),
      manualRoots: ['C:\\Program Files\\TongDaXin'],
    }, inspect)
    expect(result.candidates[0].check.recognized).toBe(false)
    expect(result.candidates[0].check.problems).toContain('未发现行情结构')
    expect(result.candidates[1].sources).toEqual(['manual'])
  })

  it('exposes the frozen candidate-source type values', () => {
    const values: CandidateSource[] = ['running-process', 'manual']
    expect(values).toHaveLength(2)
    const diagnostic: TdxCandidateDiagnostic = { check: check('x'), sources: values }
    expect(diagnostic.sources).toEqual(['running-process', 'manual'])
  })
})
