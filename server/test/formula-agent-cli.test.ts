import Fastify from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { FormulaEngine, scanFutureFunctions } from '../../web/src/formula-engine/index'
import { migrateDatabase } from '../src/db.js'
import type { AppConfig } from '../src/config.js'
import type { FormulaEngineModule } from '../src/formulas/engine.js'
import { registerFormulaRoutes } from '../src/formulas/api.js'

const exec = promisify(execFile)
const engineModule = { FormulaEngine, scanFutureFunctions } as unknown as FormulaEngineModule
const engineProvider = async () => engineModule
const cliPath = new URL('../../scripts/formula-agent.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function dayRecord(date: number, open: number, high: number, low: number, close: number, amount: number, volume: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeInt32LE(date, 0)
  buffer.writeInt32LE(Math.round(open * 100), 4)
  buffer.writeInt32LE(Math.round(high * 100), 8)
  buffer.writeInt32LE(Math.round(low * 100), 12)
  buffer.writeInt32LE(Math.round(close * 100), 16)
  buffer.writeFloatLE(amount, 20)
  buffer.writeInt32LE(volume, 24)
  return buffer
}

type CliResult = { code: number; stdout: string; stderr: string }
async function runCli(args: string[]): Promise<CliResult> {
  try {
    const result = await exec(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 30_000, windowsHide: true })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string }
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

function countRows(database: DatabaseSync, table: string): number {
  const row = database.prepare('SELECT COUNT(*) AS n FROM ' + table).get() as unknown as { n: number }
  return Number(row.n)
}

describe('M9-04D 本地只读 agent CLI', () => {
  it('formula-agent CLI list/validate/evaluate 输出 JSON 且校验失败非 0', async () => {
    const root = await mkdtemp(join(tmpdir(), 'formula-agent-cli-'))
    await mkdir(join(root, 'vipdoc', 'sh', 'lday'), { recursive: true })
    await mkdir(join(root, 'T0002', 'hq_cache'), { recursive: true })
    await writeFile(join(root, 'vipdoc', 'sh', 'lday', 'sh600519.day'), Buffer.concat([
      dayRecord(20260901, 10, 11, 9, 10.5, 1000, 100),
      dayRecord(20260902, 10.5, 11.5, 10, 11, 1100, 110),
      dayRecord(20260903, 11, 12, 10.5, 11.5, 1200, 120),
    ]))
    const config: AppConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', tdxRoot: root }
    const database = new DatabaseSync(':memory:')
    migrateDatabase(database)
    const app = Fastify()
    registerFormulaRoutes(app, config, database, { engine: engineProvider })
    const countsBefore = ['trainings', 'trades', 'drawings'].map(table => countRows(database, table))
    try {
      await app.listen({ host: '127.0.0.1', port: 0 })
      const base = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port

      // list：空库 → JSON
      const emptyList = await runCli(['list', '--base', base])
      expect(emptyList.code).toBe(0)
      expect(JSON.parse(emptyList.stdout)).toEqual({ formulas: [] })

      // validate 成功 → JSON ok:true
      const valid = await runCli(['validate', '--source', 'MA2:MA(CLOSE,2);', '--base', base])
      expect(valid.code).toBe(0)
      const validJson = JSON.parse(valid.stdout)
      expect(validJson.ok).toBe(true)
      expect(validJson.futureFunctions).toEqual([])

      // validate 失败 → JSON ok:false + 非 0 退出码 + 中文人话
      const invalid = await runCli(['validate', '--source', 'A:MA(CLOSE,;', '--base', base])
      expect(invalid.code).not.toBe(0)
      const invalidJson = JSON.parse(invalid.stdout)
      expect(invalidJson.ok).toBe(false)
      expect(invalidJson.error.message).toMatch(/[\u4e00-\u9fa5]/)
      expect(invalid.stderr).toMatch(/[\u4e00-\u9fa5]/)

      // evaluate：按证券代码只读求值，透传 dataSource
      const evaluated = await runCli(['evaluate', '--source', 'MA2:MA(CLOSE,2);', '--code', '600519', '--limit', '10', '--base', base])
      expect(evaluated.code).toBe(0)
      const evaluateJson = JSON.parse(evaluated.stdout)
      expect(evaluateJson.ok).toBe(true)
      expect(evaluateJson.dataSource.kind).toBe('tdx')
      expect(evaluateJson.dataSource.note).toContain('不复权')
      expect(evaluateJson.bars).toHaveLength(3)
      expect(evaluateJson.outputs[0].name).toBe('MA2')

      // 写公式库后 list/formulaId evaluate（只读 evaluate 不写公式库/训练）
      const created = await app.inject({ method: 'POST', url: '/api/formulas', payload: { name: 'CLI_MA', description: 'CLI 测试', placement: 'sub', source: 'MA5:MA(CLOSE,5);' } })
      expect(created.statusCode).toBe(201)
      const formulaId = created.json().id as number
      const list = await runCli(['list', '--base', base])
      expect(list.code).toBe(0)
      expect(JSON.parse(list.stdout).formulas.some((formula: { id: number }) => formula.id === formulaId)).toBe(true)
      const byId = await runCli(['evaluate', '--formula-id', String(formulaId), '--code', '600519', '--limit', '10', '--base', base])
      expect(byId.code).toBe(0)
      expect(JSON.parse(byId.stdout).ok).toBe(true)

      // 只读断言：训练/成交/画线计数不变
      expect(['trainings', 'trades', 'drawings'].map(table => countRows(database, table))).toEqual(countsBefore)
    } finally {
      await app.close()
      database.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('服务不可达时输出人话错误并非 0 退出', async () => {
    const result = await runCli(['list', '--base', 'http://127.0.0.1:1'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/[\u4e00-\u9fa5]/)
  }, 30_000)
})
