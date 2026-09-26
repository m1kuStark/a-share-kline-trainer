// 进程线索提取（SETUP-CLUES-01 冻结合同）：从注入的进程查询结果提取安装根目录线索。
// 线索只表示"值得检查"，不等于可训练或自动生效；失败与"确实没有进程"必须可区分；
// 生产查询固定程序与参数数组，不拼 shell；测试全程使用合成路径，不读取真实 TDX。
import { describe, expect, it } from 'vitest'
import {
  appendBounded,
  buildProcessQueryScript,
  collectProcessClues,
  parseProcessQueryStdout,
  PROCESS_QUERY_TIMEOUT_MS,
  type ProcessQueryResult,
  MAX_QUERY_OUTPUT_BYTES,
  defaultProcessQuery,
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

// control-handoff-20260926-14：三项限定返修回归

describe('spawn failure handling (P1)', () => {
  it('defaultProcessQuery resolves a failure result when powershell is missing', async () => {
    // 精确反例：PATH 清空后 spawn powershell → ENOENT；模块必须消化 error 事件，不让进程崩溃
    const original = process.env.PATH
    process.env.PATH = ''
    try {
      const result = await defaultProcessQuery()
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBeNull()
      expect(result.stderr.toLowerCase()).toContain('enoent')
    } finally {
      process.env.PATH = original
    }
    // 关键：进程仍活着（未因未处理 error 事件退出）
    expect(process.exitCode ?? 0).not.toBe(1)
  })

  it('collectProcessClues maps spawn failure to unavailable', async () => {
    const original = process.env.PATH
    process.env.PATH = ''
    try {
      const result = await collectProcessClues(() => defaultProcessQuery())
      expect(result.status).toBe('unavailable')
      expect(result.clues).toEqual([])
    } finally {
      process.env.PATH = original
    }
  })
})

describe('drive-root path parsing (P2)', () => {
  it('resolves drive-root executables to the drive root, not a drive-relative path', () => {
    expect(parseProcessQueryStdout('C:\\bin\\TdxW.exe')).toEqual(['C:\\'])
    expect(parseProcessQueryStdout('C:\\TdxW.exe')).toEqual(['C:\\'])
    expect(parseProcessQueryStdout('C:\\new_tdx\\bin\\TdxW.exe')).toEqual(['C:\\new_tdx'])
  })
})

describe('output bounds (有界性合同)', () => {
  it('collectProcessClues treats truncated results as unavailable, not ok', async () => {
    const truncated = await collectProcessClues(async () => ({
      exitCode: 0, stdout: 'D:\new_tdx\bin\TdxW.exe', stderr: '', timedOut: false, truncated: true,
    }))
    expect(truncated.status).toBe('unavailable')
    expect(truncated.clues).toEqual([])
    expect(truncated.reason).toContain('截断')
  })

  it('defines a bounded output cap for the production query', () => {
    expect(MAX_QUERY_OUTPUT_BYTES).toBeGreaterThan(0)
    expect(MAX_QUERY_OUTPUT_BYTES).toBeLessThanOrEqual(1024 * 1024)
  })
})

// control-handoff-20260926-15：有界查询合同四缺口回归

describe('truncation takes precedence over timeout', () => {
  it('reports unavailable (truncated) even when the kill also looks like a timeout', async () => {
    // 超限 kill 的 SIGTERM 会让 close 同时给出 timedOut 与 truncated——截断语义必须优先
    const result = await collectProcessClues(async () => ({
      exitCode: null, stdout: '', stderr: '', timedOut: true, truncated: true,
    }))
    expect(result.status).toBe('unavailable')
    expect(result.reason).toContain('截断')
    expect(result.clues).toEqual([])
  })
})

describe('bounded output counts UTF-8 bytes, not characters', () => {
  function makeState(): { stdout: string; stderr: string; byteTotal: number; truncated: boolean } {
    return { stdout: '', stderr: '', byteTotal: 0, truncated: false }
  }

  it('400k CJK characters exceed the 1MiB byte cap and mark truncation', () => {
    const state = makeState()
    const chunk = '中'.repeat(100_000) // 300k UTF-8 bytes per chunk
    run_codex_noop: {
      // 直接驱动四块：4×30 万字节 = 120 万字节 > 1MiB
    }
    appendBounded(state, 'stdout', chunk)
    appendBounded(state, 'stdout', chunk)
    expect(state.truncated).toBe(false)
    appendBounded(state, 'stdout', chunk)
    appendBounded(state, 'stdout', chunk)
    expect(state.truncated).toBe(true)
    expect(Buffer.byteLength(state.stdout + state.stderr, 'utf8')).toBeLessThanOrEqual(1024 * 1024)
  })

  it('marks truncation when data arrives after the cap is exactly reached', () => {
    const state = makeState()
    appendBounded(state, 'stdout', 'a'.repeat(1024 * 1024))
    expect(state.truncated).toBe(false)
    appendBounded(state, 'stdout', 'b')
    expect(state.truncated).toBe(true)
  })

  it('splitting a multi-byte character across the boundary does not corrupt accounting', () => {
    const state = makeState()
    appendBounded(state, 'stdout', 'x'.repeat(1024 * 1024 - 1))
    appendBounded(state, 'stdout', '中') // 3 字节，只剩 1 字节空间：截断且计数含边界处理
    expect(state.truncated).toBe(true)
    expect(state.byteTotal).toBeLessThanOrEqual(1024 * 1024)
  })
})

describe('production query script bounds result count', () => {
  it('script selects at most 8 executable paths from the whitelist name', () => {
    const script = buildProcessQueryScript()
    expect(script).toContain('-First 8')
    expect(script).toContain('Win32_Process')
    expect(script).toContain("Name='TdxW.exe'")
  })
})
