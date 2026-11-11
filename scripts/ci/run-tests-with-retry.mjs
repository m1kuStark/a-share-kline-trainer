#!/usr/bin/env node
// verify job 测试执行器：真实断言失败不重试；仅在“非 0 退出且没有 Vitest 失败摘要”时按基础设施崩溃重试一次。
// 背景：GitHub run 43012581422 等在测试早期无失败摘要直接 exit 1（worker/进程级崩溃），rerun 即绿；
// 该 flake 会误拦任意 PR。重试不改变测试命令、断言、用例集合或数据范围。
import { spawn } from 'node:child_process'

const DEFAULT_COMMAND = 'npm test -- --reporter=default --reporter=json --outputFile=test-results.json'
const command = process.env.TRAINER_CI_TEST_COMMAND || DEFAULT_COMMAND
const root = process.cwd()

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: root, shell: true, env: process.env })
    let output = ''
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      output += text
      process.stderr.write(text)
    })
    child.on('error', (error) => resolve({ code: 1, output: output + '\n' + String(error) }))
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

function hasVitestFailure(output) {
  return /Failed Tests\s+\d+/.test(output) || /^\s*FAIL\s+/m.test(output) || /Test Files\s+.*failed/.test(output)
}

const first = await runOnce()
if (first.code === 0) process.exit(0)

if (hasVitestFailure(first.output)) {
  console.error('\n[verify] 检测到 Vitest 失败摘要：按真实失败处理，不重试。')
  process.exit(first.code)
}

console.log('\n[verify] 首次执行退出码 ' + first.code + ' 且未检测到 Vitest 失败摘要，按基础设施崩溃重试一次。')
console.log('::warning title=verify infra retry::first attempt exited without test failure summary; retrying once')
const second = await runOnce()
process.exit(second.code)