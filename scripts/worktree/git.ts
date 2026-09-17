import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export function git(root: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
  } catch (error) {
    const failure = error as { stderr?: Buffer | string; message?: string }
    throw new Error(`git ${args[0]} failed: ${String(failure.stderr || failure.message).trim()}`)
  }
}
export const resolveCommit = (root: string, ref: string) => git(root, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`)
export const commonDirectory = (root: string) => resolve(root, git(root, 'rev-parse', '--git-common-dir'))
export function assertClean(root: string, label = 'Worktree'): void {
  if (git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all')) throw new Error(`${label} is dirty; commit or preserve uncommitted work first: ${root}`)
}

export interface Worktree { path: string; head: string; branch?: string; bare?: boolean; locked?: boolean }
export function registeredWorktrees(root: string): Worktree[] {
  return git(root, 'worktree', 'list', '--porcelain', '-z').split('\0\0').filter(Boolean).map(record => {
    const fields = record.split('\0')
    const value = (key: string) => fields.find(field => field.startsWith(`${key} `))?.slice(key.length + 1)
    return { path: value('worktree')!, head: value('HEAD')!, branch: value('branch'), bare: fields.includes('bare'), locked: fields.some(field => field === 'locked' || field.startsWith('locked ')) }
  })
}
