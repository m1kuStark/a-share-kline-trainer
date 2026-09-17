import { resolve } from 'node:path'
import { assertClean, git, registeredWorktrees, resolveCommit } from './git.js'
import { assertScope, assertTaskReady } from './policy.js'
import { type Candidate } from './state.js'

export function samePath(left: string, right: string): boolean {
  const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
  return normalize(left) === normalize(right)
}
export function assertRegistered(root: string, candidate: Candidate): void {
  const worktree = registeredWorktrees(root).find(item => samePath(item.path, candidate.path))
  if (!worktree || worktree.branch !== `refs/heads/${candidate.branch}` || candidate.branch !== `integration/${candidate.id}` || worktree.locked) throw new Error('Candidate is not its recognized, unlocked registered worktree')
  if (worktree.head !== candidate.commit || resolveCommit(root, `refs/heads/${candidate.branch}`) !== candidate.commit || git(candidate.path, 'rev-parse', 'HEAD^{tree}') !== candidate.tree) throw new Error('Candidate commit or tree changed; prepare and verify a new candidate')
  assertClean(candidate.path, 'Candidate')
}
export function assertCurrent(root: string, candidate: Candidate): void {
  assertRegistered(root, candidate)
  if (resolveCommit(root, candidate.sourceRef) !== candidate.sourceCommit) throw new Error('Source ref changed; candidate is stale')
  if (resolveCommit(root, candidate.targetRef) !== candidate.baseCommit) throw new Error('Target ref changed; candidate is stale')
  for (const item of registeredWorktrees(root)) {
    if (item.branch === candidate.sourceRef) assertClean(item.path, 'Source worktree')
    if (item.branch === candidate.targetRef) assertClean(item.path, 'Target worktree')
  }
  assertScope(root, assertTaskReady(root, candidate.baseCommit, candidate.taskId), candidate.baseCommit, candidate.commit)
}
