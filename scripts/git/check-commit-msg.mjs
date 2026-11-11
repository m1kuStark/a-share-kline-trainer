#!/usr/bin/env node
// 校验提交信息：Conventional Commits + 维护者 task/<ID> 分支的 Task trailer。
// 零依赖；由 .githooks/commit-msg 调用。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/git/check-commit-msg.mjs <commit-msg-file>')
  process.exit(1)
}

const message = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const firstLine = (message.split('\n')[0] || '').trim()
const exempt = /^(Merge |Revert |fixup! |squash! )/.test(firstLine)
if (exempt) process.exit(0)

const header = /^(feat|fix|docs|test|refactor|perf|chore|build|ci|revert)(\([a-z0-9-]+\))?!?: .+$/
const errors = []

if (!header.test(firstLine)) {
  errors.push('标题不符合 Conventional Commits：<type>(<scope>): <摘要>')
}
if (firstLine.length > 100) {
  errors.push('标题超过 100 字符（当前 ' + firstLine.length + '）')
}

let branch = ''
try {
  branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // detached HEAD / 非 git 环境：跳过分支相关校验
}

const taskTrailer = message.match(/^Task:\s*([A-Z][A-Z0-9-]+)\s*$/m)
if (branch.startsWith('task/')) {
  const id = branch.slice('task/'.length)
  if (!taskTrailer) {
    errors.push('task/' + id + ' 分支的提交必须包含 trailer：Task: ' + id)
  } else if (taskTrailer[1] !== id) {
    errors.push('Task trailer (' + taskTrailer[1] + ') 与分支 ID (' + id + ') 不一致')
  }
}

if (errors.length > 0) {
  console.error('\n提交信息校验失败：')
  for (const error of errors) console.error('  - ' + error)
  console.error('\n格式示例：feat(chart): CHART-LAYOUT-01 图表窗格铺满\n\nTask: CHART-LAYOUT-01')
  console.error('规范：docs/engineering/commit-convention.md\n')
  process.exit(1)
}
