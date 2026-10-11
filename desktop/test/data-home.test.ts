// PACK-03（DATA-DISCOVERY-ADOPT / DATA-FRESH-DEFAULT / DATA-ADOPT-IDEMPOTENT /
// CONFIG-LEGACY-ADOPT）＋INSTALL-01（2026-10-11 用户拍板：exe 旁 data/ 候选退役，
// 数据目录唯一默认 %USERPROFILE%\.a-share-kline-trainer；矩阵行 INSTALL-NSIS-ASSISTED）。
// oracle 独立性：期望值手写自 launcher.cjs resolveConfig（169-203）冻结语义＋PACK-03
// 派发简报决策①②原文＋库识别判据（design.md §1.3：目录内存在 trainer.sqlite 文件）＋
// INSTALL-01 拍板原文（矩阵行 oracle：不再扫描 exe 旁 data/ 候选——v1.2.7 目录混放不再吸收旧库）；
// 路径期望测试侧用 node:path join 独立拼出；探测/读取全部注入桩，不碰真实文件系统。
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  enumerateDataHomeCandidates,
  parseDataChoiceRecord,
  parseDataHomeAnswerEnv,
  parseLegacyTrainerConfig,
  parseSavedTdxChoice,
  resolveDataHome,
  savedChoiceSearchDir,
  serializeDataChoiceRecord,
  type DataHomeDeps,
} from '../src/data-home.js'

const EXE_DIR = join('C:', 'apps', 'trainer-exe')
const HOME_DIR = join('C:', 'Users', 'tester')
const EXE_DATA = join(EXE_DIR, 'data')
const LEGACY_HOME = join(HOME_DIR, '.a-share-kline-trainer')
const UUID_EXAMPLE = '01234567-89ab-cdef-0123-456789abcdef'

/** 注入桩文件系统：path→JSON 值；libraryDirs＝「有训练库」的目录（探测点＝<dir>/trainer.sqlite） */
function fakeFs(files: Record<string, unknown>, libraryDirs: string[] = []) {
  const readJsonFile = async (path: string) => {
    if (!(path in files)) return { missing: true } as const
    return { missing: false, value: files[path] } as const
  }
  const fileExists = async (path: string) =>
    libraryDirs.some(dir => path === join(dir, 'trainer.sqlite')) || path in files
  return { readJsonFile, fileExists }
}

function depsOf(files: Record<string, unknown>, libraries: string[], answers: string[] = []) {
  const fs = fakeFs(files, libraries)
  const asked: string[] = []
  const deps: DataHomeDeps = {
    ...fs,
    ask: async () => {
      const answer = answers.shift()
      asked.push(answer ?? '<none>')
      if (answer !== 'exe' && answer !== 'legacy' && answer !== 'cancel') throw new Error('no scripted answer')
      return answer
    },
    now: () => '2026-10-06T00:00:00.000Z',
  }
  return { deps, asked }
}

describe('legacy trainer.config.json parse (launcher resolveConfig mirror)', () => {
  it('CONFIG-LEGACY-ADOPT: absent optional fields fall back to launcher defaults (root/data + trainer.sqlite, port 8787)', () => {
    const config = parseLegacyTrainerConfig({}, EXE_DIR)
    expect(config.dataDir).toBe(EXE_DATA)
    expect(config.dataDirExplicit).toBe(false)
    expect(config.databasePath).toBe(join(EXE_DATA, 'trainer.sqlite'))
    expect(config.databasePathExplicit).toBe(false)
    expect(config.port).toBe(8787)
    expect(config.portExplicit).toBe(false)
    expect(config.tdxRoot).toBeNull()
  })

  it('CONFIG-LEGACY-ADOPT: explicit fields are honored with launcher resolution rules (relative dataDir/tdxRoot vs root, absolute databasePath)', () => {
    const config = parseLegacyTrainerConfig({
      dataDir: 'my-data',
      databasePath: join('D:', 'abs', 't.sqlite'),
      port: 9000,
      tdxRoot: 'tdx-relative',
    }, EXE_DIR)
    expect(config.dataDir).toBe(join(EXE_DIR, 'my-data'))
    expect(config.dataDirExplicit).toBe(true)
    expect(config.databasePath).toBe(join('D:', 'abs', 't.sqlite'))
    expect(config.databasePathExplicit).toBe(true)
    expect(config.port).toBe(9000)
    expect(config.portExplicit).toBe(true)
    expect(config.tdxRoot).toBe(join(EXE_DIR, 'tdx-relative'))
  })

  it('CONFIG-LEGACY-ADOPT: null/blank port and blank dataDir count as unset (launcher isExplicitPortField semantics)', () => {
    const config = parseLegacyTrainerConfig({ port: null, dataDir: '  ' }, EXE_DIR)
    expect(config.port).toBe(8787)
    expect(config.portExplicit).toBe(false)
    expect(config.dataDirExplicit).toBe(false)
  })

  it('CONFIG-LEGACY-ADOPT: invalid shapes are rejected, never guessed (non-object, bad port, relative databasePath)', () => {
    expect(() => parseLegacyTrainerConfig([1, 2], EXE_DIR)).toThrow()
    expect(() => parseLegacyTrainerConfig({ port: 'abc' }, EXE_DIR)).toThrow(/port/)
    expect(() => parseLegacyTrainerConfig({ port: 0 }, EXE_DIR)).toThrow(/port/)
    expect(() => parseLegacyTrainerConfig({ databasePath: 'relative.sqlite' }, EXE_DIR)).toThrow(/absolute/)
  })
})

describe('adoption record shape (desktop-data-choice.json)', () => {
  it('DATA-ADOPT-IDEMPOTENT: strict parse accepts both modes and rejects foreign/garbage shapes', () => {
    expect(parseDataChoiceRecord({ version: 1, mode: 'default', dataDir: null, decidedAt: 'x' })).toEqual({
      version: 1, mode: 'default', dataDir: null, decidedAt: 'x',
    })
    expect(parseDataChoiceRecord({ version: 1, mode: 'adopted', dataDir: LEGACY_HOME, decidedAt: 'x' })).toEqual({
      version: 1, mode: 'adopted', dataDir: LEGACY_HOME, decidedAt: 'x',
    })
    expect(parseDataChoiceRecord({ version: 2, mode: 'adopted', dataDir: LEGACY_HOME })).toBeNull()
    expect(parseDataChoiceRecord({ version: 1, mode: 'weird' })).toBeNull()
    expect(parseDataChoiceRecord({ version: 1, mode: 'adopted', dataDir: 42 })).toBeNull()
    expect(parseDataChoiceRecord(null)).toBeNull()
  })

  it('DATA-ADOPT-IDEMPOTENT: serialize round-trips a record', () => {
    const record = parseDataChoiceRecord(JSON.parse(serializeDataChoiceRecord({ version: 1, mode: 'adopted', dataDir: LEGACY_HOME, decidedAt: 't' })))
    expect(record).not.toBeNull()
    expect(record!.mode).toBe('adopted')
    expect(record!.dataDir).toBe(LEGACY_HOME)
  })
})

describe('candidate enumeration', () => {
  it('INSTALL-01: candidates contain only the legacy home (the exe-side data/ candidate is retired)', () => {
    // oracle: 用户 2026-10-11 拍板（矩阵 INSTALL-NSIS-ASSISTED）——v1.3.0 不再扫描 exe 旁
    // data/ 候选；数据目录唯一默认 %USERPROFILE%\.a-share-kline-trainer
    expect(enumerateDataHomeCandidates({ exeDir: EXE_DIR, homeDir: HOME_DIR })).toEqual([
      { id: 'legacy-home', path: LEGACY_HOME },
    ])
  })
})

describe('parseDataHomeAnswerEnv (TRAINER_DESKTOP_DATA_ANSWER)', () => {
  // INSTALL-01：双候选决策对话框已退役（唯一候选不可能双命中，ask 回调不再被调用）；
  // 解析函数本身保留（便携遗产路径，回滚保护一个版本周期），断言继续锁定其严格语义
  it('DATA-MULTI-CANDIDATE-DIALOG: accepts exe|legacy|cancel, rejects anything else, null when unset', () => {
    expect(parseDataHomeAnswerEnv({})).toBeNull()
    expect(parseDataHomeAnswerEnv({ TRAINER_DESKTOP_DATA_ANSWER: '   ' })).toBeNull()
    expect(parseDataHomeAnswerEnv({ TRAINER_DESKTOP_DATA_ANSWER: 'exe' })).toBe('exe')
    expect(parseDataHomeAnswerEnv({ TRAINER_DESKTOP_DATA_ANSWER: 'legacy' })).toBe('legacy')
    expect(parseDataHomeAnswerEnv({ TRAINER_DESKTOP_DATA_ANSWER: 'cancel' })).toBe('cancel')
    expect(() => parseDataHomeAnswerEnv({ TRAINER_DESKTOP_DATA_ANSWER: 'yes' })).toThrow(/TRAINER_DESKTOP_DATA_ANSWER/)
  })
})

describe('parseSavedTdxChoice (SETUP-SAVE-01 shape mirror)', () => {
  it('accepts version 1 with non-empty root, rejects everything else without throwing', () => {
    expect(parseSavedTdxChoice({ version: 1, root: join('D:', 'tdx') })).toEqual({ root: join('D:', 'tdx') })
    expect(parseSavedTdxChoice({ version: 2, root: 'x' })).toBeNull()
    expect(parseSavedTdxChoice({ version: 1, root: '  ' })).toBeNull()
    expect(parseSavedTdxChoice('junk')).toBeNull()
  })
})

describe('savedChoiceSearchDir (saved-tdx-choice.json 搜索目录＝生效 dataDir)', () => {
  it('DATA-SAVED-TDX-CHOICE-FOLLOW: env explicit TRAINER_DATA_DIR wins, then the resolved dataDir, then the unique legacy-home default', () => {
    const explicitEnv = { kind: 'explicit-env', dataDir: null, record: null, notice: null, probed: false } as const
    // E0 显式 env：生效 dataDir＝env 目录（不是唯一默认目录）
    expect(savedChoiceSearchDir({ TRAINER_DATA_DIR: join('D:', 'env-data') }, explicitEnv, HOME_DIR)).toBe(join('D:', 'env-data'))
    // E0 只显式 TRAINER_DB：dataDir 兜底＝唯一默认 legacy-home（INSTALL-01 收敛；库可另置，dataDir 不随之漂移）
    expect(savedChoiceSearchDir({ TRAINER_DB: join('D:', 'elsewhere', 'trainer.sqlite') }, explicitEnv, HOME_DIR)).toBe(LEGACY_HOME)
    const legacy = { kind: 'discovery-legacy', dataDir: LEGACY_HOME, record: null, notice: null, probed: true } as const
    expect(savedChoiceSearchDir({}, legacy, HOME_DIR)).toBe(LEGACY_HOME)
  })
})

describe('resolveDataHome decision tree', () => {
  const base = { envExplicit: false, paths: { exeDir: EXE_DIR, homeDir: HOME_DIR } }

  it('DATA-DISCOVERY-ADOPT: explicit env short-circuits discovery with no probing and no record', async () => {
    const { deps } = depsOf({}, [EXE_DATA, LEGACY_HOME]) // both candidates have libraries
    const outcome = await resolveDataHome({ ...base, envExplicit: true }, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('explicit-env')
    expect(outcome.resolution.dataDir).toBeNull()
    expect(outcome.resolution.record).toBeNull()
    expect(outcome.resolution.probed).toBe(false)
  })

  it('CONFIG-LEGACY-ADOPT: explicit dataDir in trainer.config.json is used verbatim without discovery', async () => {
    const { deps } = depsOf(
      { [join(EXE_DIR, 'trainer.config.json')]: { dataDir: join('D:', 'zip-data') } },
      [join('D:', 'zip-data')], // that dir has a library; candidates irrelevant
    )
    const outcome = await resolveDataHome(base, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.legacyConfig).not.toBeNull()
    expect(outcome.legacyConfig!.dataDir).toBe(join('D:', 'zip-data'))
    expect(outcome.resolution.kind).toBe('legacy-config')
    expect(outcome.resolution.dataDir).toBe(join('D:', 'zip-data'))
    expect(outcome.resolution.probed).toBe(false)
    expect(outcome.resolution.record).toBeNull()
  })

  it('DATA-DISCOVERY-ADOPT: first launch with only the legacy home library adopts it in place with a notice and an adopted record', async () => {
    const { deps } = depsOf({}, [LEGACY_HOME])
    const outcome = await resolveDataHome(base, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('discovery-legacy')
    expect(outcome.resolution.dataDir).toBe(LEGACY_HOME)
    expect(outcome.resolution.record).toEqual({ version: 1, mode: 'adopted', dataDir: LEGACY_HOME, decidedAt: '2026-10-06T00:00:00.000Z' })
    expect(outcome.resolution.notice).toContain('已沿用历史训练数据')
    expect(outcome.resolution.notice).toContain(LEGACY_HOME)
    expect(outcome.resolution.probed).toBe(true)
  })

  it('INSTALL-01: a v1.2.7 exe-side data/ library is NOT scanned or adopted; the unique default is the legacy home with a default-mode record', async () => {
    // oracle: 矩阵 INSTALL-NSIS-ASSISTED——「不再扫描 exe 旁 data/ 候选——v1.2.7 目录混放
    // 不再吸收旧库」；exe 旁有库与无库同落 discovery-default（唯一默认＝legacy-home）
    const { deps, asked } = depsOf({}, [EXE_DATA])
    const outcome = await resolveDataHome(base, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('discovery-default')
    expect(outcome.resolution.dataDir).toBe(LEGACY_HOME)
    // default 档不记绝对路径（唯一默认目录随 home 走）
    expect(outcome.resolution.record!.mode).toBe('default')
    expect(outcome.resolution.record!.dataDir).toBeNull()
    expect(outcome.resolution.notice).toBeNull()
    // 双候选对话框不可能触发（无第二候选）
    expect(asked).toEqual([])
  })

  it('DATA-FRESH-DEFAULT: no candidate has a library -> fresh default dataDir at the legacy home (the only fresh-library scenario) with a default record', async () => {
    const { deps } = depsOf({}, [])
    const outcome = await resolveDataHome(base, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('discovery-default')
    expect(outcome.resolution.dataDir).toBe(LEGACY_HOME)
    expect(outcome.resolution.record!.mode).toBe('default')
  })

  it('DATA-DISCOVERY-ADOPT: a directory containing only saved-tdx-choice.json or -wal files is NOT a library', async () => {
    // saved-tdx-choice.json exists in legacy home; trainer.sqlite does not
    const { deps } = depsOf({ [join(LEGACY_HOME, 'saved-tdx-choice.json')]: { version: 1, root: 'x' } }, [])
    const outcome = await resolveDataHome(base, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('discovery-default')
  })

  it('INSTALL-01: libraries at both old locations no longer open a dialog; the legacy home is adopted in place and exe-side data is ignored', async () => {
    // oracle: 用户 2026-10-11 拍板——双候选决策对话框随 exe-data 候选退役（无第二候选
    // 自然不触发）；两处旧库并存时唯一被探测的候选＝legacy-home，原地采用，绝不开口问
    const bothLibraries = depsOf({}, [EXE_DATA, LEGACY_HOME])
    const outcome = await resolveDataHome(base, bothLibraries.deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('discovery-legacy')
    expect(outcome.resolution.dataDir).toBe(LEGACY_HOME)
    expect(outcome.resolution.record!.mode).toBe('adopted')
    expect(outcome.resolution.notice).toContain('已沿用历史训练数据')
    // 双候选对话框不再可能触发：ask 回调一次都不能被调用
    expect(bothLibraries.asked).toEqual([])
  })

  it('DATA-ADOPT-IDEMPOTENT: a valid remembered record short-circuits discovery without probing candidates', async () => {
    const { deps } = depsOf(
      { [join(EXE_DIR, 'desktop-data-choice.json')]: { version: 1, mode: 'adopted', dataDir: LEGACY_HOME, decidedAt: 't' } },
      [LEGACY_HOME, EXE_DATA], // both have libraries: probing would trigger the ask; remembered must not
    )
    const outcome = await resolveDataHome(base, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('remembered')
    expect(outcome.resolution.dataDir).toBe(LEGACY_HOME)
    expect(outcome.resolution.probed).toBe(false)
    expect(outcome.resolution.record).toBeNull() // 不重写既有记录
  })

  it('DATA-ADOPT-IDEMPOTENT: a default-mode remembered record resolves to the unique legacy-home default without validation probing', async () => {
    const { deps } = depsOf(
      { [join(EXE_DIR, 'desktop-data-choice.json')]: { version: 1, mode: 'default', dataDir: null, decidedAt: 't' } },
      [LEGACY_HOME], // legacy library exists, but the record already decided default
    )
    const outcome = await resolveDataHome(base, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('remembered')
    expect(outcome.resolution.dataDir).toBe(LEGACY_HOME)
    expect(outcome.resolution.probed).toBe(false)
  })

  it('DATA-ADOPT-IDEMPOTENT: a corrupt (non-JSON) choice file is treated as no record and discovery re-runs (design E2 损坏→视为无记录)', async () => {
    // desktop-data-choice.json 是 desktop 自有文件（原子写），写坏≠用户配置错误：
    // 不得 brick 启动——按无记录处理，重新发现（结果幂等，零丢失不受影响）
    const fs = fakeFs({}, [LEGACY_HOME])
    const deps: DataHomeDeps = {
      ...fs,
      readJsonFile: async path => {
        if (path === join(EXE_DIR, 'desktop-data-choice.json')) throw new Error('Unexpected token in JSON')
        return fs.readJsonFile(path)
      },
      ask: async () => { throw new Error('must not ask with a single hit') },
      now: () => '2026-10-06T00:00:00.000Z',
    }
    const outcome = await resolveDataHome(base, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('discovery-legacy')
    expect(outcome.resolution.dataDir).toBe(LEGACY_HOME)
  })

  it('DATA-ADOPT-IDEMPOTENT: an adopted record whose directory lost its library is discarded and discovery re-runs', async () => {
    // record points at LEGACY_HOME but no library exists there anymore; exe-data HAS one now —
    // INSTALL-01 后 exe 旁库不再被吸收：重新发现落到唯一默认目录（legacy-home，全新库场景）
    const { deps } = depsOf(
      { [join(EXE_DIR, 'desktop-data-choice.json')]: { version: 1, mode: 'adopted', dataDir: LEGACY_HOME, decidedAt: 't' } },
      [EXE_DATA],
    )
    const outcome = await resolveDataHome(base, deps)
    expect(outcome.quit).toBe(false)
    if (outcome.quit) return
    expect(outcome.resolution.kind).toBe('discovery-default')
    expect(outcome.resolution.dataDir).toBe(LEGACY_HOME)
    expect(outcome.resolution.record!.mode).toBe('default')
  })

  it('CONFIG-LEGACY-ADOPT: a corrupt trainer.config.json aborts startup with an error, never a guess', async () => {
    const { deps } = depsOf({ [join(EXE_DIR, 'trainer.config.json')]: { port: 'oops' } }, [])
    await expect(resolveDataHome(base, deps)).rejects.toThrow(/port/)
  })
})
