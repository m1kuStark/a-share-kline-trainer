// PACK-03 集成层：真实临时目录伪造候选布局（DATA-DISCOVERY-ADOPT / DATA-ADOPT-IDEMPOTENT /
// NO-DELETE-INVARIANT）。库识别判据 oracle＝design.md §1.3（trainer.sqlite 文件存在）；
// 哈希不变量 oracle＝派发简报决策④「任何路径都不删除/覆盖既有库文件」——前后字节对照。
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  DATA_CHOICE_FILE,
  LIBRARY_FILE,
  SAVED_TDX_CHOICE_FILE,
  createNodeDataHomeDeps,
  persistDataChoiceRecord,
  readDataChoiceRecord,
  resolveDataHome,
} from '../src/data-home.js'

async function makeLayout() {
  const root = await mkdtemp(join(tmpdir(), 'pack03-fs-'))
  const exeDir = join(root, 'exe')
  const homeDir = join(root, 'home')
  await mkdir(exeDir, { recursive: true })
  await mkdir(homeDir, { recursive: true })
  return { root, exeDir, homeDir, exeData: join(exeDir, 'data'), legacyHome: join(homeDir, '.a-share-kline-trainer') }
}

async function seedLibrary(dir: string, sqliteBytes = 'fake-sqlite-bytes') {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, LIBRARY_FILE), sqliteBytes, 'utf8')
  await writeFile(join(dir, SAVED_TDX_CHOICE_FILE), JSON.stringify({ version: 1, root: join('D:', 'tdx') }), 'utf8')
}

async function sha256(path: string) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

describe('data-home on a real filesystem', () => {
  it('adopts the legacy home library in place when only it exists, and never touches its bytes', async () => {
    const layout = await makeLayout()
    try {
      await seedLibrary(layout.legacyHome, 'legacy-history')
      const before = await sha256(join(layout.legacyHome, LIBRARY_FILE))
      const savedBefore = await sha256(join(layout.legacyHome, SAVED_TDX_CHOICE_FILE))

      const deps = createNodeDataHomeDeps({ ask: async () => { throw new Error('must not ask with a single hit') } })
      const outcome = await resolveDataHome(
        { envExplicit: false, paths: { exeDir: layout.exeDir, homeDir: layout.homeDir } },
        deps,
      )
      expect(outcome.quit).toBe(false)
      if (outcome.quit) return
      expect(outcome.resolution.kind).toBe('discovery-legacy')
      expect(outcome.resolution.dataDir).toBe(layout.legacyHome)

      // NO-DELETE-INVARIANT：既有库文件字节不变；exe 同级未新建任何目录
      expect(await sha256(join(layout.legacyHome, LIBRARY_FILE))).toBe(before)
      expect(await sha256(join(layout.legacyHome, SAVED_TDX_CHOICE_FILE))).toBe(savedBefore)
      await expect(stat(layout.exeData)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(layout.root, { recursive: true, force: true })
    }
  })

  it('persists the choice record and remembers it on the second launch without re-discovery', async () => {
    const layout = await makeLayout()
    try {
      await seedLibrary(layout.legacyHome)
      const deps = createNodeDataHomeDeps({ ask: async () => { throw new Error('must not ask') } })
      const paths = { exeDir: layout.exeDir, homeDir: layout.homeDir }
      const first = await resolveDataHome({ envExplicit: false, paths }, deps)
      expect(first.quit).toBe(false)
      if (first.quit) return
      await persistDataChoiceRecord(layout.exeDir, first.resolution.record!)

      const record = await readDataChoiceRecord(layout.exeDir)
      expect(record).toMatchObject({ version: 1, mode: 'adopted', dataDir: layout.legacyHome })
      // 记录文件落在 exe 同级（dataDir 之外的固定点）
      await expect(stat(join(layout.exeDir, DATA_CHOICE_FILE))).resolves.toBeTruthy()

      // 二次启动：即便 exe 同级后来也出现了库（双命中本应询问），remembered 短路不再探测
      await seedLibrary(layout.exeData)
      const second = await resolveDataHome({ envExplicit: false, paths }, deps)
      expect(second.quit).toBe(false)
      if (second.quit) return
      expect(second.resolution.kind).toBe('remembered')
      expect(second.resolution.dataDir).toBe(layout.legacyHome)
      expect(second.resolution.probed).toBe(false)
    } finally {
      await rm(layout.root, { recursive: true, force: true })
    }
  })

  it('an empty sqlite file still counts as a library (better adopt than miss)', async () => {
    const layout = await makeLayout()
    try {
      await seedLibrary(layout.legacyHome, '')
      const deps = createNodeDataHomeDeps({ ask: async () => { throw new Error('must not ask') } })
      const outcome = await resolveDataHome({ envExplicit: false, paths: { exeDir: layout.exeDir, homeDir: layout.homeDir } }, deps)
      expect(outcome.quit).toBe(false)
      if (outcome.quit) return
      expect(outcome.resolution.kind).toBe('discovery-legacy')
    } finally {
      await rm(layout.root, { recursive: true, force: true })
    }
  })

  it('a remembered adopted record whose library disappeared is discarded and discovery re-runs', async () => {
    const layout = await makeLayout()
    try {
      await seedLibrary(layout.legacyHome)
      const deps = createNodeDataHomeDeps({ ask: async () => { throw new Error('must not ask') } })
      const paths = { exeDir: layout.exeDir, homeDir: layout.homeDir }
      const first = await resolveDataHome({ envExplicit: false, paths }, deps)
      expect(first.quit).toBe(false)
      if (first.quit) return
      await persistDataChoiceRecord(layout.exeDir, first.resolution.record!)

      await rm(layout.legacyHome, { recursive: true, force: true })
      await seedLibrary(layout.exeData, 'fresh-exe-history')

      const second = await resolveDataHome({ envExplicit: false, paths }, deps)
      expect(second.quit).toBe(false)
      if (second.quit) return
      expect(second.resolution.kind).toBe('discovery-default')
      expect(second.resolution.dataDir).toBe(layout.exeData)
    } finally {
      await rm(layout.root, { recursive: true, force: true })
    }
  })

  it('multi-candidate layout asks and honors the exe answer without deleting anything', async () => {
    const layout = await makeLayout()
    try {
      await seedLibrary(layout.exeData, 'exe-history')
      await seedLibrary(layout.legacyHome, 'legacy-history')
      const exeBefore = await sha256(join(layout.exeData, LIBRARY_FILE))
      const legacyBefore = await sha256(join(layout.legacyHome, LIBRARY_FILE))

      const deps = createNodeDataHomeDeps({ ask: async () => 'exe' })
      const outcome = await resolveDataHome({ envExplicit: false, paths: { exeDir: layout.exeDir, homeDir: layout.homeDir } }, deps)
      expect(outcome.quit).toBe(false)
      if (outcome.quit) return
      expect(outcome.resolution.kind).toBe('discovery-default')
      expect(outcome.resolution.dataDir).toBe(layout.exeData)

      expect(await sha256(join(layout.exeData, LIBRARY_FILE))).toBe(exeBefore)
      expect(await sha256(join(layout.legacyHome, LIBRARY_FILE))).toBe(legacyBefore)
    } finally {
      await rm(layout.root, { recursive: true, force: true })
    }
  })
})
