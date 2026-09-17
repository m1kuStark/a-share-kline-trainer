import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, unlink } from 'node:fs/promises'
import { assertClean, git, registeredWorktrees, resolveCommit } from './git.js'
import { assertScope, assertTaskReady } from './policy.js'
import { candidates, readCandidate, saveCandidate, type Candidate } from './state.js'
import { withIntegrationLock } from './lock.js'
import { npm } from './process.js'
import { assertCurrent, assertRegistered } from './guard.js'
import { assertProof, assertRunDirectory, assertVisual } from './evidence.js'

export async function createTask(root: string, options: { id: string; base?: string; path?: string }) {
  return withIntegrationLock(root, async () => {
    const baseCommit = resolveCommit(root, options.base ?? 'main')
    assertClean(root, 'Baseline worktree')
    assertTaskReady(root, baseCommit, options.id)
    const path = resolve(options.path ?? join(dirname(registeredWorktrees(root)[0].path), 'trainer-worktrees', options.id))
    const branch = `task/${options.id}`
    git(root, 'worktree', 'add', '-b', branch, path, baseCommit)
    return { path, branch, baseCommit }
  })
}

export async function listWorktrees(root: string) {
  return { worktrees: registeredWorktrees(root), candidates: await candidates(root) }
}

function localBranch(root: string, branch: string): string {
  const ref = branch.startsWith('refs/heads/') ? branch : `refs/heads/${branch}`
  git(root, 'check-ref-format', ref)
  resolveCommit(root, ref)
  return ref
}
function assertBranchClean(root: string, ref: string, label: string): void {
  for (const worktree of registeredWorktrees(root).filter(item => item.branch === ref)) assertClean(worktree.path, label)
}
export async function prepareCandidate(root: string, options: { id: string; branch: string; target?: string }): Promise<Candidate> {
  return withIntegrationLock(root, async () => {
    const sourceRef = localBranch(root, options.branch)
    const targetRef = localBranch(root, options.target ?? 'main')
    if (sourceRef === targetRef) throw new Error('Source and target branches must differ')
    assertBranchClean(root, sourceRef, 'Source worktree')
    assertBranchClean(root, targetRef, 'Target worktree')
    const sourceCommit = resolveCommit(root, sourceRef)
    const baseCommit = resolveCommit(root, targetRef)
    const task = assertTaskReady(root, baseCommit, options.id)
    const commonBase = git(root, 'merge-base', baseCommit, sourceCommit)
    assertScope(root, task, commonBase, sourceCommit)
    const id = `${options.id}-${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const branch = `integration/${id}`
    const path = join(dirname(registeredWorktrees(root)[0].path), 'trainer-integration', id)
    git(root, 'worktree', 'add', '-b', branch, path, baseCommit)
    const candidate: Candidate = { schemaVersion: 1, id, taskId: options.id, sourceRef, sourceCommit, targetRef, baseCommit, branch, path, commit: baseCommit, tree: git(root, 'rev-parse', `${baseCommit}^{tree}`), status: 'prepared', createdAt: new Date().toISOString() }
    try {
      git(path, 'merge', '--no-ff', '--no-edit', sourceCommit)
      candidate.commit = resolveCommit(path, 'HEAD')
      candidate.tree = git(path, 'rev-parse', 'HEAD^{tree}')
      assertScope(root, task, baseCommit, candidate.commit)
      assertClean(path, 'Candidate')
    } catch (error) {
      candidate.status = 'failed'
      candidate.failure = String(error)
      await saveCandidate(root, candidate)
      throw new Error(`Candidate ${id} failed; retained at ${path}: ${String(error)}`)
    }
    await saveCandidate(root, candidate)
    return candidate
  })
}

export async function verifyCandidate(root: string, id: string): Promise<Candidate> {
  return withIntegrationLock(root, async () => {
    const candidate = await readCandidate(root, id)
    if (!['prepared', 'verified'].includes(candidate.status)) throw new Error(`Candidate is ${candidate.status}; prepare a new candidate before verification`)
    assertCurrent(root, candidate)
    await assertRunDirectory(candidate)
    await mkdir(join(candidate.path, '.runs'), { recursive: true })
    const log = join(candidate.path, '.runs/candidate-verify.log')
    const proofPath = join(candidate.path, '.runs/candidate-proof.json')
    await unlink(proofPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
    try {
      let dependencies
      try { dependencies = await lstat(join(candidate.path, 'node_modules')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (dependencies?.isSymbolicLink()) throw new Error('Candidate node_modules must not be shared through a symlink or junction')
      if (dependencies && !dependencies.isDirectory()) throw new Error('Candidate node_modules must be its own dependency directory')
      if (!dependencies) await npm(candidate.path, ['ci', '--no-audit', '--no-fund'], log)
      await npm(candidate.path, ['run', 'verify:candidate', '--', '--base', candidate.baseCommit, '--task', candidate.taskId], log)
      assertCurrent(root, candidate)
      await assertProof(candidate)
      candidate.status = 'verified'
      await saveCandidate(root, candidate)
      return candidate
    } catch (error) {
      candidate.status = 'failed'
      candidate.failure = String(error)
      await saveCandidate(root, candidate)
      throw error
    }
  })
}

export async function promoteCandidate(root: string, id: string, visualPath: string): Promise<Candidate> {
  return withIntegrationLock(root, async () => {
    const candidate = await readCandidate(root, id)
    if (candidate.status !== 'verified') throw new Error(`Candidate must be verified before promotion (currently ${candidate.status})`)
    await assertProof(candidate)
    await assertVisual(candidate, visualPath)
    // Recheck refs and cleanliness after asynchronous evidence reads, under the common lock.
    assertCurrent(root, candidate)
    const target = registeredWorktrees(root).find(worktree => worktree.branch === candidate.targetRef)
    if (target) git(target.path, 'merge', '--ff-only', candidate.commit)
    else git(root, 'update-ref', candidate.targetRef, candidate.commit, candidate.baseCommit)
    candidate.status = 'promoted'
    await saveCandidate(root, candidate)
    return candidate
  })
}

export async function cleanupCandidate(root: string, id: string): Promise<Candidate> {
  return withIntegrationLock(root, async () => {
    const candidate = await readCandidate(root, id)
    if (candidate.status !== 'promoted') throw new Error('Only a promoted candidate can be cleaned up')
    assertRegistered(root, candidate)
    await assertRunDirectory(candidate)
    try { git(root, 'merge-base', '--is-ancestor', candidate.commit, resolveCommit(root, candidate.targetRef)) }
    catch { throw new Error('Candidate is not merged into its target; refusing cleanup') }
    git(root, 'worktree', 'remove', candidate.path)
    git(root, '-c', `branch.${candidate.branch}.remote=.`, '-c', `branch.${candidate.branch}.merge=${candidate.targetRef}`, 'branch', '-d', candidate.branch)
    candidate.status = 'cleaned'
    await saveCandidate(root, candidate)
    return candidate
  })
}
