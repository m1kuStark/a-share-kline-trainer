// 进程线索提取（SETUP-CLUES-01 冻结合同）：从注入的进程查询结果提取安装根目录线索。
// 线索只表示"值得检查"，不等于可训练或自动生效；失败与"确实没有进程"必须可区分；
// 生产查询固定程序与参数数组，不拼 shell；测试全程使用合成路径，不读取真实 TDX。
import { describe, expect, it } from 'vitest'
import {
  collectProcessClues,
  parseProcessQueryStdout,
  PROCESS_QUERY_TIMEOUT_MS,
  type ProcessQueryResult,
} from '../src/tdx/process-clues'

function ok(stdout: string, exitCode = 0): ProcessQueryResult {
  return { exitCode, stdout, stderr: '', timedOut: false }
}

describe('parseProcessQueryStdout', () => {
  it('extracts install roots from standard bin layout, keeping order', () => {
    const stdout = [
      'D:\\new_tdx\\bin\\TdxW.exe',
      'C:\\Program Files\\TongDaXin\\bin\\TdxW.exe',
    ].join('\r\n')
    expect(parseProcessQueryStdout(stdout)).toEqual([
      'D:\\new_tdx',
      'C:\\Program Files\\TongDaXin',
    ])
  })

  it('handles non-standard chinese and space paths', () => {
    const stdout = [
      'E:\\券商定制版 通达信\\bin\\TdxW.exe',
      'D:\\我的 软件\\TdxW.exe',
    ].join('\r\n')
    expect(parseProcessQueryStdout(stdout)).toEqual([
      'E:\\券商定制版 通达信',
      'D:\\我的 软件',
    ])
  })

  it('uses the exe directory itself when there is no bin parent', () => {
    expect(parseProcessQueryStdout('C:\\green\\TdxW.exe')).toEqual(['C:\\green'])
  })

  it('deduplicates case-insensitively on windows and keeps deterministic order', () => {
    const stdout = [
      'D:\\TDX\\bin\\TdxW.exe',
      'd:\\tdx\\BIN\\tdxw.exe',
      'D:\\TDX\\bin\\TdxW.exe',
    ].join('\r\n')
    const roots = parseProcessQueryStdout(stdout)
    expect(roots).toHaveLength(1)
    expect(roots[0].toLowerCase()).toBe('d:\\tdx')
  })

  it('ignores unrelated executables and blank lines', () => {
    const stdout = [
      'C:\\Windows\\notepad.exe',
      '',
      'D:\\new_tdx\\bin\\TdxW.exe',
    ].join('\r\n')
    expect(parseProcessQueryStdout(stdout)).toEqual(['D:\\new_tdx'])
  })
})

describe('collectProcessClues', () => {
  it('returns clues for a successful query', async () => {
    const result = await collectProcessClues(async () => ok('D:\\new_tdx\\bin\\TdxW.exe'))
    expect(result.status).toBe('ok')
    expect(result.clues).toEqual([{ root: 'D:\\new_tdx', source: 'running-process' }])
  })

  it('distinguishes no running process from a failed query', async () => {
    const none = await collectProcessClues(async () => ok(''))
    expect(none.status).toBe('ok')
    expect(none.clues).toEqual([])

    const failed = await collectProcessClues(async () => ({ exitCode: 1, stdout: '', stderr: '拒绝访问。', timedOut: false }))
    expect(failed.status).toBe('denied')
    expect(failed.clues).toEqual([])
    expect(failed.reason).toContain('拒绝')
  })

  it('reports timeout separately', async () => {
    const timedOut = await collectProcessClues(async () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }))
    expect(timedOut.status).toBe('timeout')
    expect(timedOut.clues).toEqual([])
  })

  it('reports query failure separately from empty results', async () => {
    const thrown = await collectProcessClues(async () => { throw new Error('查询失败') })
    expect(thrown.status).toBe('unavailable')
    expect(thrown.clues).toEqual([])
    expect(thrown.reason).toContain('查询失败')
  })

  it('marks the platform not applicable off windows', async () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      const result = await collectProcessClues(async () => ok('D:\\x\\bin\\TdxW.exe'))
      expect(result.status).toBe('not_applicable')
      expect(result.clues).toEqual([])
    } finally {
      Object.defineProperty(process, 'platform', { value: original })
    }
  })

  it('caps the number of clues at the contract limit', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `D:\\tdx${i}\\bin\\TdxW.exe`).join('\r\n')
    const result = await collectProcessClues(async () => ok(lines))
    expect(result.clues.length).toBeLessThanOrEqual(8)
  })

  it('defines a bounded production query timeout', () => {
    expect(PROCESS_QUERY_TIMEOUT_MS).toBeGreaterThan(0)
    expect(PROCESS_QUERY_TIMEOUT_MS).toBeLessThanOrEqual(15000)
  })
})
