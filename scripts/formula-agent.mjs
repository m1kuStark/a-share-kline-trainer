#!/usr/bin/env node
/**
 * M9-04D 本地只读公式 agent CLI（list / validate / evaluate）。
 *
 * 只调用训练器本机只读 HTTP 接口：
 *   GET  /api/formulas            （list）
 *   POST /api/formulas/validate   （validate）
 *   POST /api/formulas/evaluate   （evaluate）
 * 不提供写训练/下单/改公式库的操作。默认 base=http://127.0.0.1:8787，可用 --base 覆盖。
 *
 * 输出：stdout 为 JSON（2 空格缩进）；业务校验失败（ok:false）或请求失败时退出码非 0，
 * 同时向 stderr 打一行人话错误。用法见 --help。契约文档：docs/engineering/formula-agent-api.md
 */
import process from 'node:process'

const DEFAULT_BASE = process.env.TRAINER_BASE_URL || 'http://127.0.0.1:8787'
const REQUEST_TIMEOUT_MS = 10_000

const USAGE = [
  '用法:',
  '  node scripts/formula-agent.mjs list [--base URL]',
  '  node scripts/formula-agent.mjs validate --source "<公式源码>" [--base URL]',
  '  node scripts/formula-agent.mjs evaluate (--source "<源码>" | --formula-id N)',
  '      (--code 600519 | --training-id N) [--timeframe 1D|1W|1M] [--limit 10..2000] [--base URL]',
  '',
  '只读：只调用训练器本机 validate/evaluate/list 接口，不写训练、画线、录像、下单。',
  '默认 base=http://127.0.0.1:8787（可用 --base 或环境变量 TRAINER_BASE_URL 覆盖）。',
].join('\n')

const VALUE_FLAGS = new Set(['base', 'source', 'formula-id', 'training-id', 'code', 'timeframe', 'limit'])

function fail(message, code = 1) {
  process.stderr.write(message + '\n')
  process.exit(code)
}

function parseArgs(argv) {
  const command = argv[0]
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE + '\n')
    process.exit(command === undefined || command === '--help' || command === '-h' ? 0 : 2)
  }
  if (!['list', 'validate', 'evaluate'].includes(command)) fail('未知子命令：' + command + '\n\n' + USAGE, 2)
  const flags = {}
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) fail('无法识别的参数：' + token + '\n\n' + USAGE, 2)
    const name = token.slice(2)
    if (!VALUE_FLAGS.has(name)) fail('未知参数：' + token + '\n\n' + USAGE, 2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) fail('参数 ' + token + ' 缺少取值', 2)
    flags[name] = value
    index += 1
  }
  return { command, flags }
}

function parsePositiveInt(text, label, min, max) {
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max) fail(label + ' 必须是 ' + min + '~' + max + ' 的整数', 2)
  return value
}

async function requestJson(base, method, path, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(base + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let payload = null
    try { payload = text === '' ? null : JSON.parse(text) } catch { payload = { raw: text } }
    if (!response.ok) {
      const reason = payload && typeof payload.error === 'string' ? payload.error : 'HTTP ' + response.status
      fail('请求失败（HTTP ' + response.status + '）：' + reason)
    }
    return payload
  } catch (error) {
    if (error && error.name === 'AbortError') fail('请求超时（' + REQUEST_TIMEOUT_MS + 'ms）：' + base)
    const cause = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)
    fail('无法连接训练器（' + base + '）：' + cause + '\n请先启动训练器，并用 --base 指定实际地址。')
  } finally {
    clearTimeout(timer)
  }
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2))
  const base = (flags.base || DEFAULT_BASE).replace(/\/+$/, '')

  if (command === 'list') {
    printJson(await requestJson(base, 'GET', '/api/formulas'))
    return
  }

  if (command === 'validate') {
    if (!flags.source) fail('validate 需要 --source "<公式源码>"', 2)
    const result = await requestJson(base, 'POST', '/api/formulas/validate', { source: flags.source })
    printJson(result)
    if (!result || result.ok !== true) {
      const message = result && result.error && result.error.message ? result.error.message : '校验失败'
      fail('公式校验失败：' + message)
    }
    return
  }

  // evaluate
  const hasSource = typeof flags.source === 'string' && flags.source.length > 0
  const hasFormulaId = flags['formula-id'] !== undefined
  if (hasSource && hasFormulaId) fail('--source 与 --formula-id 只能二选一', 2)
  if (!hasSource && !hasFormulaId) fail('evaluate 需要 --source 或 --formula-id', 2)
  const hasTraining = flags['training-id'] !== undefined
  const hasCode = typeof flags.code === 'string' && flags.code.length > 0
  if (hasTraining && hasCode) fail('--training-id 与 --code 只能二选一', 2)
  if (!hasTraining && !hasCode) fail('evaluate 需要 --code 或 --training-id（决定数据来源）', 2)
  const payload = {}
  if (hasSource) payload.source = flags.source
  if (hasFormulaId) payload.formulaId = parsePositiveInt(flags['formula-id'], '--formula-id', 1, Number.MAX_SAFE_INTEGER)
  if (hasTraining) payload.trainingId = parsePositiveInt(flags['training-id'], '--training-id', 1, Number.MAX_SAFE_INTEGER)
  if (hasCode) payload.code = flags.code
  if (flags.timeframe !== undefined) {
    if (!['1D', '1W', '1M'].includes(flags.timeframe)) fail('--timeframe 必须是 1D/1W/1M', 2)
    payload.timeframe = flags.timeframe
  }
  payload.limit = parsePositiveInt(flags.limit ?? '500', '--limit', 10, 2000)

  const result = await requestJson(base, 'POST', '/api/formulas/evaluate', payload)
  printJson(result)
  if (!result || result.ok !== true) {
    const message = result && result.error && result.error.message ? result.error.message : '求值失败'
    fail('公式求值失败：' + message)
  }
}

await main()
