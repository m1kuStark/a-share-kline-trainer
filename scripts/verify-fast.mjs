#!/usr/bin/env node
// TEST-SPEED-01（用户 2026-11-09 要求缩短测试集成耗时）：轻量迭代门禁。
// 只跑「docs:check + 生产构建（内含 vue-tsc）+ 用户指定的单测/定向 journey」，
// 用于开发循环；正式交付仍需 verify:baseline（或并行 journey 全量）。
// 用法：node scripts/verify-fast.mjs [--unit server/test/a.test.ts ...] [--journey e2e/a.spec.ts ...]
import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)
const pick = (name) => { const i = argv.indexOf(name); if (i < 0) return []; const out = []; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j += 1) out.push(argv[j]); return out }
const units = pick('--unit')
const journeys = pick('--journey')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const root = process.cwd()
const started = Date.now()
const results = []

function run(label, command, args) {
  return new Promise((resolve) => {
    const at = Date.now()
    process.stdout.write('\n[verify:fast] ' + label + ' …\n')
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env }, shell: process.platform === 'win32' })
    child.once('exit', code => {
      results.push({ label, code: code ?? 1, seconds: Math.round((Date.now() - at) / 1000) })
      resolve()
    })
  })
}

await run('docs:check', npm, ['run', 'docs:check'])
await run('build（含 vue-tsc 类型检查）', npm, ['run', 'build'])
if (units.length) await run('unit（指定文件）', npm, ['exec', '--', 'vitest', 'run', ...units, '--config', 'server/vitest.config.ts'])
if (journeys.length) await run('journey（定向 spec）', npm, ['run', 'journey', '--', ...journeys, '--retries=0'])

const failed = results.filter(item => item.code !== 0)
console.log('\n[verify:fast] 用时 ' + Math.round((Date.now() - started) / 1000) + 's')
for (const item of results) console.log('  ' + (item.code === 0 ? 'PASS' : 'FAIL') + '  ' + String(item.seconds).padStart(4) + 's  ' + item.label)
console.log(failed.length ? '[verify:fast] FAIL：' + failed.map(item => item.label).join('、') : '[verify:fast] PASS（轻量迭代门禁；正式交付仍跑全量）')
process.exit(failed.length ? 1 : 0)
