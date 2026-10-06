// PACK-03（COEXIST-SAME-DATADIR-GUARD）：双形态共存防双写裁决层。
// oracle 独立性：期望值手写自 scripts/release/launcher.cjs 冻结语义——decideRecordedServer
// （773-788：reuse/clean/拒不可验证活占用）、readOwnedState/assertStateIdentity（704-742：
// appId 门＋runId run-<36hex> 正则＋pid/port 整数范围＋baseURL 与 port 严格一致）、
// probeMatchesState（runId/pid 双匹配）、acquireLaunchLock（803-827：'wx'+死锁恢复+5 轮）、
// pidAlive（EPERM＝活）；探测/杀进程/时钟全部注入桩。
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  acquireLaunchLock,
  buildStateRecord,
  decideCoexistence,
  parseTrainerStateRecord,
  stateRecordIsOurs,
  type CoexistDeps,
  type LaunchLockDeps,
} from '../src/coexist-guard.js'
import type { HealthProbe } from '../src/port-conflict.js'

const DATA_DIR = join('D:', 'trainer-data')
const LOCK_PATH = join(DATA_DIR, 'launch.lock')
const RUN_ID = 'run-01234567-89ab-cdef-0123-456789abcdef'

const VALID_STATE = {
  appId: 'a-share-kline-trainer',
  runId: RUN_ID,
  pid: 4321,
  port: 8788,
  baseURL: 'http://127.0.0.1:8788',
  startedAt: '2026-10-06T00:00:00.000Z',
  databasePath: join(DATA_DIR, 'trainer.sqlite'),
}

function probeOf(body: unknown, status = 200): HealthProbe {
  return { responded: true, refused: false, status, json: body }
}
const MATCHING_HEALTH = { status: 'ok', runId: RUN_ID, pid: 4321 }

function depsWith(overrides: Partial<CoexistDeps> = {}): CoexistDeps & { killed: number[]; asked: number } {
  const killed: number[] = []
  let asked = 0
  return {
    pidAlive: () => true,
    probeHealth: async () => probeOf(MATCHING_HEALTH),
    askConflict: async () => { asked += 1; return 'cancel' },
    killOccupant: async occupant => { killed.push(occupant.pid); return { exited: true } },
    ...overrides,
    killed,
    asked,
  }
}

describe('parseTrainerStateRecord (readOwnedState/assertStateIdentity mirror)', () => {
  it('classifies absent / foreign / valid / stale-with-pid / stale-without-pid', () => {
    expect(parseTrainerStateRecord(undefined)).toEqual({ kind: 'absent' })
    expect(parseTrainerStateRecord(null)).toEqual({ kind: 'absent' })
    expect(parseTrainerStateRecord('junk')).toEqual({ kind: 'stale', pid: null })
    expect(parseTrainerStateRecord({ appId: 'other-app', runId: RUN_ID, pid: 1, port: 2, baseURL: 'http://127.0.0.1:2' }))
      .toEqual({ kind: 'foreign' })
    expect(parseTrainerStateRecord(VALID_STATE)).toEqual({
      kind: 'valid',
      state: { runId: RUN_ID, pid: 4321, port: 8788, baseURL: 'http://127.0.0.1:8788' },
    })
    // 身份字段破坏 → stale，但尽力保留 pid 供存活判断（launcher 同口径）
    expect(parseTrainerStateRecord({ ...VALID_STATE, baseURL: 'http://localhost:8788' })).toEqual({ kind: 'stale', pid: 4321 })
    expect(parseTrainerStateRecord({ ...VALID_STATE, pid: 'x' })).toEqual({ kind: 'stale', pid: null })
  })
})

describe('decideCoexistence decision tree', () => {
  it('absent record proceeds (no defense obligation)', async () => {
    const deps = depsWith()
    await expect(decideCoexistence({ kind: 'absent' }, deps)).resolves.toEqual({ action: 'proceed' })
  })

  it('foreign appId record refuses startup without touching anything', async () => {
    const deps = depsWith()
    const decision = await decideCoexistence({ kind: 'foreign' }, deps)
    expect(decision).toMatchObject({ action: 'quit', fatal: true })
    if (decision.action === 'quit') {
      expect(decision.reason).toContain('another app')
      expect(decision.reason).toContain('其他应用')
    }
  })

  it('stale record with a live recorded pid refuses (unverifiable owner may be writing the same database)', async () => {
    const deps = depsWith()
    const decision = await decideCoexistence({ kind: 'stale', pid: 4321 }, deps)
    expect(decision).toMatchObject({ action: 'quit', fatal: true })
    expect(deps.killed).toEqual([])
  })

  it('stale record with a dead or missing pid proceeds (launcher clean semantics; desktop never deletes foreign records)', async () => {
    const deadDeps = depsWith({ pidAlive: () => false })
    await expect(decideCoexistence({ kind: 'stale', pid: 4321 }, deadDeps)).resolves.toEqual({ action: 'proceed' })
    await expect(decideCoexistence({ kind: 'stale', pid: null }, depsWith())).resolves.toEqual({ action: 'proceed' })
  })

  it('valid record with a dead pid proceeds (leftover record)', async () => {
    const deps = depsWith({ pidAlive: () => false })
    await expect(decideCoexistence(parseTrainerStateRecord(VALID_STATE), deps)).resolves.toEqual({ action: 'proceed' })
  })

  it('live owner that fails identity verification refuses with an actionable PID-bearing reason', async () => {
    const mismatch = depsWith({ probeHealth: async () => probeOf({ status: 'ok', runId: 'run-someone-else', pid: 4321 }) })
    const decision = await decideCoexistence(parseTrainerStateRecord(VALID_STATE), mismatch)
    expect(decision).toMatchObject({ action: 'quit', fatal: true })
    if (decision.action === 'quit') {
      expect(decision.reason).toContain('4321')
      expect(decision.reason).toContain('8788')
    }
    const unreachable = depsWith({ probeHealth: async () => ({ responded: false, refused: false, status: null, json: null }) })
    await expect(decideCoexistence(parseTrainerStateRecord(VALID_STATE), unreachable)).resolves.toMatchObject({ action: 'quit', fatal: true })
  })

  it('verified live trainer asks PORT-02 questions: cancel quits without killing or starting', async () => {
    let asked = 0
    const deps = depsWith({ askConflict: async () => { asked += 1; return 'cancel' } })
    const decision = await decideCoexistence(parseTrainerStateRecord(VALID_STATE), deps)
    expect(decision).toMatchObject({ action: 'quit', fatal: false })
    expect(deps.killed).toEqual([])
    expect(asked).toBe(1)
  })

  it('reuse answer loads the recorded baseURL and never starts a second server', async () => {
    const deps = depsWith({ askConflict: async () => 'reuse' })
    const decision = await decideCoexistence(parseTrainerStateRecord(VALID_STATE), deps)
    expect(decision).toEqual({
      action: 'reuse',
      url: 'http://127.0.0.1:8788',
      occupant: { pid: 4321, port: 8788, runId: RUN_ID },
    })
    expect(deps.killed).toEqual([])
  })

  it('reuse falls back to proceed when the owner vanished after the answer', async () => {
    let calls = 0
    const deps = depsWith({
      askConflict: async () => 'reuse',
      probeHealth: async () => {
        calls += 1
        return calls === 1 ? probeOf(MATCHING_HEALTH) : probeOf(null, 503)
      },
    })
    await expect(decideCoexistence(parseTrainerStateRecord(VALID_STATE), deps)).resolves.toEqual({ action: 'proceed' })
  })

  it('restart answer re-verifies identity, kills, then proceeds; a failed kill refuses', async () => {
    const okDeps = depsWith({ askConflict: async () => 'restart' })
    await expect(decideCoexistence(parseTrainerStateRecord(VALID_STATE), okDeps)).resolves.toEqual({ action: 'proceed' })
    expect(okDeps.killed).toEqual([4321])

    const failedDeps = depsWith({
      askConflict: async () => 'restart',
      killOccupant: async () => ({ exited: false, error: 'still alive' }),
    })
    await expect(decideCoexistence(parseTrainerStateRecord(VALID_STATE), failedDeps)).resolves.toMatchObject({ action: 'quit', fatal: true })
  })

  it('restart spares a vanished or identity-changed owner and proceeds without killing', async () => {
    let calls = 0
    const deps = depsWith({
      askConflict: async () => 'restart',
      probeHealth: async () => {
        calls += 1
        return calls === 1 ? probeOf(MATCHING_HEALTH) : probeOf({ status: 'ok', runId: RUN_ID, pid: 9999 })
      },
    })
    await expect(decideCoexistence(parseTrainerStateRecord(VALID_STATE), deps)).resolves.toEqual({ action: 'proceed' })
    expect(deps.killed).toEqual([])
  })
})

describe('state record writer (launcher compatibility)', () => {
  it('buildStateRecord emits a body satisfying launcher assertStateIdentity in full', () => {
    const record = buildStateRecord({ runId: RUN_ID, pid: 1234, port: 9001, databasePath: join(DATA_DIR, 'trainer.sqlite'), startedAt: 't' })
    expect(record.appId).toBe('a-share-kline-trainer')
    expect(record.runId).toMatch(/^run-[0-9a-f-]{36}$/)
    expect(record.pid).toBe(1234)
    expect(record.port).toBe(9001)
    expect(record.baseURL).toBe(`http://127.0.0.1:9001`)
    // 反解回 launcher 口径必须 valid（身份字段自洽）
    expect(parseTrainerStateRecord(record).kind).toBe('valid')
  })

  it('stateRecordIsOurs matches only our own runId and pid combination', () => {
    expect(stateRecordIsOurs(buildStateRecord({ runId: RUN_ID, pid: 1234, port: 9001, databasePath: 'x' }), { runId: RUN_ID, pid: 1234 })).toBe(true)
    expect(stateRecordIsOurs(buildStateRecord({ runId: RUN_ID, pid: 1234, port: 9001, databasePath: 'x' }), { runId: 'run-other', pid: 1234 })).toBe(false)
    expect(stateRecordIsOurs(buildStateRecord({ runId: RUN_ID, pid: 1234, port: 9001, databasePath: 'x' }), { runId: RUN_ID, pid: 9999 })).toBe(false)
    expect(stateRecordIsOurs('garbage', { runId: RUN_ID, pid: 1234 })).toBe(false)
    expect(stateRecordIsOurs(null, { runId: RUN_ID, pid: 1234 })).toBe(false)
  })
})

describe('acquireLaunchLock (launcher mirror)', () => {
  function lockDeps(overrides: Partial<LaunchLockDeps> = {}): LaunchLockDeps {
    return {
      openExclusive: async () => ({ ok: true }),
      readLockInfo: async () => null,
      removeFile: async () => {},
      pidAlive: () => false,
      waitMs: 0,
      lockWaitMs: 0,
      ...overrides,
    }
  }

  it('acquires a fresh lock', async () => {
    await expect(acquireLaunchLock(LOCK_PATH, lockDeps())).resolves.toEqual({ ok: true, path: LOCK_PATH })
  })

  it('recovers a lock whose recorded pid is dead (delete + retry)', async () => {
    const removed: string[] = []
    let opened = false
    const deps = lockDeps({
      openExclusive: async () => {
        if (opened) return { ok: true }
        opened = true
        return { ok: false, code: 'EEXIST' }
      },
      readLockInfo: async () => ({ appId: 'a-share-kline-trainer', pid: 777, startedAt: 't' }),
      pidAlive: () => false,
      removeFile: async path => { removed.push(path) },
    })
    await expect(acquireLaunchLock(LOCK_PATH, deps)).resolves.toEqual({ ok: true, path: LOCK_PATH })
    expect(removed).toEqual([LOCK_PATH])
  })

  it('refuses when a live foreign-app or garbage lock persists', async () => {
    const liveOurs = lockDeps({
      openExclusive: async () => ({ ok: false, code: 'EEXIST' }),
      readLockInfo: async () => ({ appId: 'a-share-kline-trainer', pid: 777, startedAt: 't' }),
      pidAlive: () => true,
    })
    await expect(acquireLaunchLock(LOCK_PATH, liveOurs)).resolves.toMatchObject({ ok: false })

    const foreign = lockDeps({
      openExclusive: async () => ({ ok: false, code: 'EEXIST' }),
      readLockInfo: async () => ({ appId: 'someone-else', pid: 777, startedAt: 't' }),
    })
    const foreignResult = await acquireLaunchLock(LOCK_PATH, foreign)
    expect(foreignResult.ok).toBe(false)
    if (!foreignResult.ok) expect(foreignResult.reason).toContain(LOCK_PATH)

    const garbage = lockDeps({
      openExclusive: async () => ({ ok: false, code: 'EEXIST' }),
      readLockInfo: async () => 'not-json-object',
    })
    await expect(acquireLaunchLock(LOCK_PATH, garbage)).resolves.toMatchObject({ ok: false })
  })

  it('gives up after bounded rounds when the lock keeps reappearing', async () => {
    let attempts = 0
    const deps = lockDeps({
      openExclusive: async () => { attempts += 1; return { ok: false, code: 'EEXIST' } },
      readLockInfo: async () => ({ appId: 'a-share-kline-trainer', pid: 777, startedAt: 't' }),
      pidAlive: () => false, // 死锁恢复路径，但锁文件删不掉（removeFile 失败场景由反复 EEXIST 模拟）
      removeFile: async () => {},
    })
    const result = await acquireLaunchLock(LOCK_PATH, deps)
    expect(result.ok).toBe(false)
    expect(attempts).toBe(5)
  })
})
