#!/usr/bin/env node
// pre-push：禁止直推 main。真正强制边界是 main Ruleset。
import { execFileSync } from 'node:child_process'

const input = await new Promise((resolve) => {
  let data = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { data += chunk })
  process.stdin.on('end', () => resolve(data))
  process.stdin.resume()
})

const lines = input.split('\n').map((line) => line.trim()).filter(Boolean)
const protectedPush = lines.some((line) => {
  const [, , remoteRef] = line.split(' ')
  return remoteRef === 'refs/heads/main'
})

let branch = ''
try {
  branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {}

if (protectedPush || branch === 'main') {
  console.error('\n禁止直接 push main：main 只经 PR 合入。')
  console.error('请切到 task/<TASK-ID> 分支，推送后开 PR；详见 docs/engineering/git-workflow.md\n')
  process.exit(1)
}

if (branch && !/^(task\/|dependabot\/|feat\/|fix\/|hotfix\/|release\/|docs\/|chore\/)/.test(branch)) {
  console.warn('提示：分支名 "' + branch + '" 不符合约定；建议使用 task/<TASK-ID>。')
}
