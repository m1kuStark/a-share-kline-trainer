#!/usr/bin/env node
// TEST-SPEED-01：把全量 journey 拆成 N 个隔离运行并行跑（每个 run 独立 manifest/端口/DB/构建/报告，
// 保持 e2e 规则的单 run workers:1），墙钟时间约从 30~40min 降到约一半。
// 用法：node scripts/journey-parallel.mjs [--shards 2] [-- e2e/a.spec.ts ...]
import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)
const shardAt = argv.indexOf('--shards')
const shards = shardAt >= 0 ? Math.max(2, Math.min(4, Number(argv[shardAt + 1]) || 2)) : 2
const sep = argv.indexOf('--')
const specs = sep >= 0 ? argv.slice(sep + 1) : []
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const started = Date.now()
const runs = []

for (let index = 1; index <= shards; index += 1) {
  const label = 'journey shard ' + index + '/' + shards
  const at = Date.now()
  const args = ['run', 'journey', '--', '--shard=' + index + '/' + shards, '--retries=0', ...specs]
  console.log('[journey:parallel] spawn ' + label)
  const child = spawn(npm, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env }, shell: process.platform === 'win32' })
  let output = ''
  child.stdout.on('data', chunk => { const text = String(chunk); output += text; process.stdout.write('[shard ' + index + '] ' + text) })
  child.stderr.on('data', chunk => { output += String(chunk) })
  const done = new Promise(resolve => child.once('exit', code => resolve({ label, code: code ?? 1, seconds: Math.round((Date.now() - at) / 1000), output })))
  runs.push(done)
}

const settled = await Promise.all(runs)
const failed = settled.filter(item => item.code !== 0)
console.log('\n[journey:parallel] 用时 ' + Math.round((Date.now() - started) / 1000) + 's（' + shards + ' shards 并行）')
for (const item of settled) console.log('  ' + (item.code === 0 ? 'PASS' : 'FAIL') + '  ' + String(item.seconds).padStart(4) + 's  ' + item.label)
process.exit(failed.length ? 1 : 0)
