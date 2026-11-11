#!/usr/bin/env node
// 把仓库内的 .githooks 设为该克隆的 hooks 目录；供 npm run hooks:install / prepare 调用。
import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
} catch {
  console.log('skip git hooks install: not a git worktree')
  process.exit(0)
}
execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
console.log('git hooks installed: core.hooksPath=.githooks')
