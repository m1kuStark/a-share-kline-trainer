import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  collectNearbyCandidateRoots,
  defaultTdxCandidates,
  discoverTdxRoot,
  NEARBY_SUGGESTION_LIMIT,
} from '../src/tdx/discover.js'

describe('TDX path discovery', () => {
  it('derives only generic system candidates and never embeds a developer path', () => {
    const candidates = defaultTdxCandidates({
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      ProgramData: 'C:\\ProgramData',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
      APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
      SystemDrive: 'C:',
    })

    expect(candidates.every(candidate => /^[A-Z]:\\/i.test(candidate))).toBe(true)
    expect(candidates.every(candidate => candidate.startsWith('C:\\'))).toBe(true)
    expect(candidates).toEqual(expect.arrayContaining([
      'C:\\Program Files\\TongDaXin',
      'C:\\Program Files\\TDX',
      'C:\\ProgramData\\TongDaXin',
      'C:\\ProgramData\\TDX',
    ]))
  })

  it('accepts a directory with vipdoc day data and hq_cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tdx-discover-'))
    await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
    await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
    await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), Buffer.alloc(32))

    try {
      await expect(discoverTdxRoot([root])).resolves.toMatchObject({ root, source: 'candidate' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null when directory characteristics do not match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'not-tdx-'))
    try {
      await expect(discoverTdxRoot([root])).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// SETUP-01：误选目录的有限邻近识别（tdx-onboarding.md：只允许附近有限范围识别，
// 不做全盘递归；候选仅供用户确认，可用性由 inspectTdxCandidates 判定）
describe('collectNearbyCandidateRoots', () => {
  it('rejects empty, relative, UNC and device-namespace inputs without touching the filesystem', async () => {
    await expect(collectNearbyCandidateRoots('')).resolves.toEqual([])
    await expect(collectNearbyCandidateRoots('   ')).resolves.toEqual([])
    await expect(collectNearbyCandidateRoots('relative/path')).resolves.toEqual([])
    await expect(collectNearbyCandidateRoots('\\\\server\\share\\tdx')).resolves.toEqual([])
    await expect(collectNearbyCandidateRoots('\\\\?\\C:\\tdx')).resolves.toEqual([])
  })

  it('lists the selected directory first and never proposes a drive root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nearby-'))
    const selected = join(base, 'new_tdx')
    await mkdir(selected, { recursive: true })
    try {
      const roots = await collectNearbyCandidateRoots(selected)
      expect(roots[0]).toBe(resolve(selected))
      // 选中目录的直接子目录允许出现，但盘根本身绝不能成为候选
      expect(roots.every(root => !/^[A-Za-z]:\\?$/i.test(root))).toBe(true)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('walks up from a vipdoc subdirectory to the first ancestor that contains vipdoc', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nearby-'))
    const install = join(base, 'tdx-install')
    const deep = join(install, 'vipdoc', 'sh', 'lday')
    await mkdir(deep, { recursive: true })
    try {
      const roots = await collectNearbyCandidateRoots(deep)
      expect(roots[0]).toBe(resolve(deep))
      // 逐级上溯找到的安装根必须出现在前几个候选里
      expect(roots).toContain(resolve(install))
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('includes direct child directories when the user picked a shared parent', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nearby-'))
    const selected = join(base, 'broker-parent')
    await mkdir(join(selected, 'tdxA'), { recursive: true })
    await mkdir(join(selected, 'tdxB'), { recursive: true })
    try {
      const roots = await collectNearbyCandidateRoots(selected)
      expect(roots[0]).toBe(resolve(selected))
      expect(roots).toContain(resolve(join(selected, 'tdxA')))
      expect(roots).toContain(resolve(join(selected, 'tdxB')))
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('caps the returned candidate list', async () => {
    const base = await mkdtemp(join(tmpdir(), 'nearby-'))
    const selected = join(base, 'wide')
    for (let index = 0; index < 12; index++) {
      await mkdir(join(selected, `child-${index}`), { recursive: true })
    }
    try {
      const roots = await collectNearbyCandidateRoots(selected)
      expect(roots.length).toBeLessThanOrEqual(NEARBY_SUGGESTION_LIMIT + 1)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
