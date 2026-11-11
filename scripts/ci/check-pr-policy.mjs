#!/usr/bin/env node
// PR 追溯链入口：Conventional 标题 + 同仓 task/<ID> 分支的 Task trailer/任务卡。
// fork PR 只要求标题规范（外部分支不强制 task 前缀）。
import { existsSync, readFileSync } from 'node:fs'

const eventPath = process.env.GITHUB_EVENT_PATH
if (!eventPath || !existsSync(eventPath)) {
  console.log('GITHUB_EVENT_PATH missing; skip PR policy')
  process.exit(0)
}
const event = JSON.parse(readFileSync(eventPath, 'utf8').replace(/^\uFEFF/, ''))
const pr = event.pull_request
if (!pr) {
  console.log('not a pull_request event; skip PR policy')
  process.exit(0)
}

const title = String(pr.title || '').trim()
const body = String(pr.body || '')
const headRef = String(pr.head?.ref || '')
const baseRef = String(pr.base?.ref || '')
const sameRepo = pr.head?.repo?.full_name === pr.base?.repo?.full_name
const errors = []
const header = /^(feat|fix|docs|test|refactor|perf|chore|build|ci|revert)(\([a-z0-9-]+\))?!?: .+$/

if (baseRef !== 'main') errors.push('PR 必须合入 main（当前 base: ' + (baseRef || '未知') + '）')
if (!header.test(title)) errors.push('PR 标题不符合 Conventional Commits：<type>(<scope>): <摘要>')
if (title.length > 100) errors.push('PR 标题超过 100 字符')

if (sameRepo && headRef.startsWith('task/')) {
  const id = headRef.slice('task/'.length)
  if (!/^[A-Z][A-Z0-9-]*[A-Z0-9]$/.test(id)) {
    errors.push('分支 ID 格式不合法：' + id)
  } else {
    const bodyTask = body.match(/^Task:\s*([A-Z][A-Z0-9-]+)\s*$/m)
    if (!bodyTask) errors.push('PR 正文必须包含 Task: ' + id)
    else if (bodyTask[1] !== id) errors.push('正文 Task (' + bodyTask[1] + ') 与分支 ID (' + id + ') 不一致')
    const card = 'docs/work-items/tasks/' + id + '.md'
    if (!existsSync(card)) errors.push('任务卡不存在：' + card)
    else if (!new RegExp('"id"\\s*:\\s*"' + id + '"').test(readFileSync(card, 'utf8'))) {
      errors.push('任务卡 id 与分支不一致：' + card)
    }
  }
}

if (errors.length > 0) {
  console.error('PR policy 校验失败：')
  for (const error of errors) console.error('  - ' + error)
  console.error('\n规范见 docs/engineering/git-workflow.md 与 commit-convention.md')
  process.exit(1)
}
console.log('PR policy OK: ' + (sameRepo ? 'maintainer branch' : 'fork PR'))
