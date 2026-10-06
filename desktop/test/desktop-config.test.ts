// PACK-01 桌面主进程纯函数层单测（DESKTOP-CONFIG-RESOLVE / DESKTOP-SERVER-ENV-ASSEMBLY / DESKTOP-APP-URL）。
// oracle 独立性：期望值手写自 launcher.cjs 冻结口径（scripts/release/launcher.cjs resolveConfig 与
// launch() 的 env 注入清单），不从被测实现反推；路径期望用 node:path join 在测试侧独立拼出。
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { buildAppUrl, buildServerEnv, hasExplicitDataOverride, resolveDesktopConfig } from '../src/desktop-config.js'

const EXE_DIR = join('C:', 'apps', 'trainer')
const APP_ROOT = join('C:', 'apps', 'trainer', 'resources', 'app.asar')

describe('desktop runtime config', () => {
  it('DESKTOP-CONFIG-RESOLVE: defaults mirror the zip launcher (exeDir/data, port 8787)', () => {
    const config = resolveDesktopConfig({}, { exeDir: EXE_DIR, appRoot: APP_ROOT })
    expect(config.dataDir).toBe(join(EXE_DIR, 'data'))
    expect(config.databasePath).toBe(join(EXE_DIR, 'data', 'trainer.sqlite'))
    expect(config.port).toBe(8787)
    expect(config.staticDirectory).toBe(join(APP_ROOT, 'web', 'dist'))
    expect(config.tdxRoot).toBeNull()
    expect(config.controlToken).toMatch(/^ctr-/)
  })

  it('DESKTOP-CONFIG-RESOLVE: env overrides win over defaults (TRAINER_DB / TRAINER_DATA_DIR / PORT / TDX_ROOT)', () => {
    const config = resolveDesktopConfig({
      TRAINER_DATA_DIR: join('D:', 'iso'),
      TRAINER_DB: join('D:', 'iso', 't.sqlite'),
      PORT: '9527',
      TDX_ROOT: join('E:', 'tdx'),
    }, { exeDir: EXE_DIR, appRoot: APP_ROOT })
    expect(config.dataDir).toBe(join('D:', 'iso'))
    expect(config.databasePath).toBe(join('D:', 'iso', 't.sqlite'))
    expect(config.port).toBe(9527)
    expect(config.tdxRoot).toBe(join('E:', 'tdx'))

    const blankTdx = resolveDesktopConfig({ TDX_ROOT: '   ' }, { exeDir: EXE_DIR, appRoot: APP_ROOT })
    expect(blankTdx.tdxRoot).toBeNull()

    const dynamicPort = resolveDesktopConfig({ PORT: '0' }, { exeDir: EXE_DIR, appRoot: APP_ROOT })
    expect(dynamicPort.port).toBe(0)
  })

  it('DESKTOP-CONFIG-RESOLVE: relative TRAINER_DB / TRAINER_DATA_DIR are rejected', () => {
    expect(() => resolveDesktopConfig({ TRAINER_DB: 'rel/trainer.sqlite' }, { exeDir: EXE_DIR, appRoot: APP_ROOT }))
      .toThrow(/TRAINER_DB.*absolute/i)
    expect(() => resolveDesktopConfig({ TRAINER_DATA_DIR: 'rel' }, { exeDir: EXE_DIR, appRoot: APP_ROOT }))
      .toThrow(/TRAINER_DATA_DIR.*absolute/i)
  })

  it('DESKTOP-SERVER-ENV-ASSEMBLY: assembles launcher-parity env for the isolated embedded server', () => {
    const config = resolveDesktopConfig({ PORT: '9600' }, { exeDir: EXE_DIR, appRoot: APP_ROOT })
    const env = buildServerEnv(config, { FOO: 'bar' } as NodeJS.ProcessEnv)
    expect(env.TRAINER_RUN_ID).toMatch(/^run-[0-9a-f-]{36}$/)
    expect(env.TRAINER_DB).toBe(config.databasePath)
    expect(env.TRAINER_DATA_DIR).toBe(config.dataDir)
    expect(env.TRAINER_STATIC_DIR).toBe(config.staticDirectory)
    expect(env.TRAINER_READY_FILE).toBe(join(config.dataDir, 'ready.json'))
    expect(env.TDX_ROOT).toBe('')
    expect(env.HOST).toBe('127.0.0.1')
    expect(env.PORT).toBe('9600')
    expect(env.OPEN_BROWSER).toBe('0')
    expect(env.FOO).toBe('bar')
  })

  it('DESKTOP-SERVER-ENV-ASSEMBLY: keeps an injected control token instead of regenerating one', () => {
    const config = resolveDesktopConfig({ TRAINER_CONTROL_TOKEN: 'tok-keep' }, { exeDir: EXE_DIR, appRoot: APP_ROOT })
    expect(config.controlToken).toBe('tok-keep')
    const env = buildServerEnv(config, {})
    expect(env.TRAINER_CONTROL_TOKEN).toBe('tok-keep')
  })

  it('DESKTOP-APP-URL: builds the loopback app URL from the listening port', () => {
    expect(buildAppUrl(8787)).toBe('http://127.0.0.1:8787')
    expect(buildAppUrl(52341)).toBe('http://127.0.0.1:52341')
  })
})

describe('PACK-03 config merge and state-record identity channel', () => {
  it('CONFIG-LEGACY-ADOPT: defaults (adoption/legacy config) fill in beneath env and above built-ins', () => {
    const adopted = join('C:', 'Users', 'tester', '.a-share-kline-trainer')
    const merged = resolveDesktopConfig({}, { exeDir: EXE_DIR, appRoot: APP_ROOT }, {
      dataDir: adopted,
      port: 9000,
      databasePath: join(adopted, 'trainer.sqlite'),
      tdxRoot: join('E:', 'tdx-legacy'),
    })
    expect(merged.dataDir).toBe(adopted)
    expect(merged.databasePath).toBe(join(adopted, 'trainer.sqlite'))
    expect(merged.port).toBe(9000)
    expect(merged.tdxRoot).toBe(join('E:', 'tdx-legacy'))

    // env 显式值恒胜 defaults（优先级结构化保证）
    const envWins = resolveDesktopConfig({
      TRAINER_DATA_DIR: join('D:', 'env-iso'),
      PORT: '9527',
      TDX_ROOT: join('F:', 'env-tdx'),
    }, { exeDir: EXE_DIR, appRoot: APP_ROOT }, {
      dataDir: adopted,
      port: 9000,
      tdxRoot: join('E:', 'tdx-legacy'),
    })
    expect(envWins.dataDir).toBe(join('D:', 'env-iso'))
    expect(envWins.port).toBe(9527)
    expect(envWins.tdxRoot).toBe(join('F:', 'env-tdx'))
  })

  it('COEXIST-SAME-DATADIR-GUARD: hasExplicitDataOverride detects env data config; buildServerEnv reuses the caller runId and emits the tdx source label', () => {
    expect(hasExplicitDataOverride({})).toBe(false)
    expect(hasExplicitDataOverride({ TRAINER_DATA_DIR: '  ' })).toBe(false)
    expect(hasExplicitDataOverride({ TRAINER_DB: '  ' })).toBe(false)
    expect(hasExplicitDataOverride({ TRAINER_DATA_DIR: join('D:', 'x') })).toBe(true)
    expect(hasExplicitDataOverride({ TRAINER_DB: join('D:', 'x', 't.sqlite') })).toBe(true)

    const config = resolveDesktopConfig({}, { exeDir: EXE_DIR, appRoot: APP_ROOT }, { tdxSource: 'saved-choice' })
    const pinned = 'run-01234567-89ab-cdef-0123-456789abcdef'
    const env = buildServerEnv(config, {}, { runId: pinned })
    // 状态记录身份通道：runId 由调用方预生成（内嵌服务 health 上报与 trainer-state.json 记录同源）
    expect(env.TRAINER_RUN_ID).toBe(pinned)
    expect(env.TRAINER_TDX_SOURCE).toBe('saved-choice')

    const unlabeled = buildServerEnv(resolveDesktopConfig({}, { exeDir: EXE_DIR, appRoot: APP_ROOT }), {})
    expect(unlabeled.TRAINER_TDX_SOURCE).toBeUndefined()
    expect(unlabeled.TRAINER_RUN_ID).toMatch(/^run-[0-9a-f-]{36}$/)
  })
})
