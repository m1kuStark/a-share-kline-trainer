// 已诊断候选的原子保存与来源解析（SETUP-SAVE-01 冻结合同）。
// 测试全用临时目录与注入 inspect/clock；不读取用户 dataDir/TDX。
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  saveTdxChoice,
  readSavedTdxChoice,
  resolveEffectiveTdxRoot,
} from '../src/setup/saved-choice'

const BS = String.fromCharCode(92)
const NOW = new Date('2026-09-27T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()

function okInspect(root: string): Parameters<typeof saveTdxChoice>[2] {
  return async () => ({
    root,
    recognized: true,
    readable: true,
    dailyFileCount: 42,
    latestDate: '2026-09-24',
    hasAdjustment: true,
    hasNames: true,
    hasBenchmark: false,
    problems: [],
  })
}

function failInspect(problems: string[]): Parameters<typeof saveTdxChoice>[2] {
  return async () => ({
    root: 'x',
    recognized: false,
    readable: false,
    dailyFileCount: 0,
    latestDate: null,
    hasAdjustment: false,
    hasNames: false,
    hasBenchmark: false,
    problems,
  })
}

describe('saveTdxChoice', () => {
  it('saves after successful re-inspection with normalized root and same now', async () => {
    const root = await mkdtemp(join(tmpdir(), 'save-ok-'))
    try {
      await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
      const saved = await saveTdxChoice(root, 'D:\\new_tdx', okInspect('D:\\new_tdx'), () => NOW)
      expect(saved).toEqual({
        version: 1, root: 'D:\\new_tdx', savedAt: NOW_ISO, inspectedAt: NOW_ISO,
      })
      const readBack = await readSavedTdxChoice(root)
      expect(readBack).toEqual(saved)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the old choice untouched when re-inspection fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'save-fail-'))
    try {
      await saveTdxChoice(root, 'D:\\old', okInspect('D:\\old'), () => NOW)
      const before = await readSavedTdxChoice(root)
      await expect(saveTdxChoice(root, 'D:\\bad', failInspect(['unreadable']), () => NOW))
        .rejects.toThrow(/problems|不可读|unreadable/i)
      const after = await readSavedTdxChoice(root)
      expect(after).toEqual(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the old choice when the inspector throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'save-throw-'))
    try {
      await saveTdxChoice(root, 'D:\\old', okInspect('D:\\old'), () => NOW)
      await expect(saveTdxChoice(root, 'D:\\bad', async () => { throw new Error('磁盘故障') }, () => NOW))
        .rejects.toThrow(/磁盘故障/)
      expect((await readSavedTdxChoice(root))?.root).toBe('D:\\old')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('allows dailyFileCount = 0 as recognized-but-needs-download', async () => {
    const root = await mkdtemp(join(tmpdir(), 'save-zero-'))
    try {
      const inspector: Parameters<typeof saveTdxChoice>[2] = async () => ({
        root: 'D:\\empty', recognized: true, readable: true, dailyFileCount: 0,
        latestDate: null, hasAdjustment: false, hasNames: false, hasBenchmark: false, problems: [],
      })
      const saved = await saveTdxChoice(root, 'D:\\empty', inspector, () => NOW)
      expect(saved.root).toBe('D:\\empty')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('readSavedTdxChoice', () => {
  it('returns null for a missing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'read-missing-'))
    try {
      expect(await readSavedTdxChoice(root)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null for corrupted json instead of throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'read-corrupt-'))
    try {
      await writeFile(join(root, 'saved-tdx-choice.json'), '{not json', 'utf8')
      expect(await readSavedTdxChoice(root)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts real leap-day and fractional-second timestamps (no over-strict regression)', async () => {
    for (const savedAt of ['2024-02-29T12:00:00Z', '2026-09-27T12:00:00.123Z']) {
      const root = await mkdtemp(join(tmpdir(), 'read-leap-'))
      try {
        await writeFile(join(root, 'saved-tdx-choice.json'), JSON.stringify({
          version: 1, root: 'D:\\ok', savedAt, inspectedAt: savedAt,
        }), { encoding: 'utf-8' })
        const read = await readSavedTdxChoice(root)
        expect(read).not.toBeNull()
        expect(read.root).toBe('D:\\ok')
        expect(read.savedAt).toBe(savedAt)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  it('returns null for wrong version, empty root or non-iso timestamps', async () => {
    const cases = [
      { version: 2, root: 'D:\\x', savedAt: NOW_ISO, inspectedAt: NOW_ISO },
      { version: 1, root: '', savedAt: NOW_ISO, inspectedAt: NOW_ISO },
      { version: 1, root: 'D:\\x', savedAt: 'not-a-date', inspectedAt: NOW_ISO },
      { version: 1, root: 'D:\\x', savedAt: NOW_ISO, inspectedAt: 42 },
      // control-handoff-20260927-22：形状合法但真实历法/时钟非法的时间字段
      { version: 1, root: 'D:\\x', savedAt: '2026-99-99T99:99:99Z', inspectedAt: NOW_ISO },
      { version: 1, root: 'D:\\x', savedAt: '2026-02-30T12:00:00Z', inspectedAt: NOW_ISO },
      { version: 1, root: 'D:\\x', savedAt: '2026-01-01T25:00:00Z', inspectedAt: NOW_ISO },
      { version: 1, root: 'D:\\x', savedAt: NOW_ISO, inspectedAt: '2026-01-01T12:60:00Z' },
    ]
    for (const payload of cases) {
      const root = await mkdtemp(join(tmpdir(), 'read-invalid-'))
      try {
        await writeFile(join(root, 'saved-tdx-choice.json'), JSON.stringify(payload), 'utf8')
        expect(await readSavedTdxChoice(root)).toBeNull()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })
})

describe('resolveEffectiveTdxRoot', () => {
  const saved = { version: 1 as const, root: 'D:\\saved', savedAt: NOW_ISO, inspectedAt: NOW_ISO }

  it('follows the frozen priority env > explicit-config > saved > auto-discovered', () => {
    expect(resolveEffectiveTdxRoot({
      envTdxRoot: 'E:\\env', explicitConfigTdxRoot: 'C:\\cfg',
      savedChoice: saved, autoDiscoveredTdxRoot: 'D:\\auto',
    })).toEqual({ root: 'E:\\env', source: 'env' })
    expect(resolveEffectiveTdxRoot({
      envTdxRoot: null, explicitConfigTdxRoot: 'C:\\cfg',
      savedChoice: saved, autoDiscoveredTdxRoot: 'D:\\auto',
    })).toEqual({ root: 'C:\\cfg', source: 'explicit-config' })
    expect(resolveEffectiveTdxRoot({
      envTdxRoot: null, explicitConfigTdxRoot: null,
      savedChoice: saved, autoDiscoveredTdxRoot: 'D:\\auto',
    })).toEqual({ root: 'D:\\saved', source: 'saved-choice' })
    expect(resolveEffectiveTdxRoot({
      envTdxRoot: null, explicitConfigTdxRoot: null,
      savedChoice: null, autoDiscoveredTdxRoot: 'D:\\auto',
    })).toEqual({ root: 'D:\\auto', source: 'auto-discovered' })
  })

  it('treats whitespace-only values as missing', () => {
    expect(resolveEffectiveTdxRoot({
      envTdxRoot: '   ', explicitConfigTdxRoot: '  ',
      savedChoice: null, autoDiscoveredTdxRoot: 'D:\\auto',
    })).toEqual({ root: 'D:\\auto', source: 'auto-discovered' })
    expect(resolveEffectiveTdxRoot({
      envTdxRoot: ' ', explicitConfigTdxRoot: ' ',
      savedChoice: saved, autoDiscoveredTdxRoot: null,
    })).toEqual({ root: 'D:\\saved', source: 'saved-choice' })
  })

  it('returns null when every source is missing', () => {
    expect(resolveEffectiveTdxRoot({
      envTdxRoot: null, explicitConfigTdxRoot: null,
      savedChoice: null, autoDiscoveredTdxRoot: null,
    })).toBeNull()
  })
})
