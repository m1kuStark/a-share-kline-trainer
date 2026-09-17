import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { repoPath } from '../docs/validate.js'
import { type Candidate } from './state.js'

const requiredChecks = ['docs', 'impact', 'unit', 'types', 'build', 'm2', 'journey']
export async function assertRunDirectory(candidate: Candidate): Promise<void> {
  for (const path of [join(candidate.path, '.runs'), join(candidate.path, '.runs/candidate-verify.log')]) {
    let entry
    try { entry = await lstat(path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    if (entry.isSymbolicLink()) throw new Error(`Candidate run directory and log must be owned, not a symlink or junction: ${path}`)
  }
}
async function ownedFile(root: string, path: string, label: string): Promise<void> {
  try {
    const [owner, file] = await Promise.all([realpath(root), realpath(path)])
    const inside = relative(owner, file)
    if (!inside || inside === '..' || inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(inside) || !(await stat(file)).isFile()) throw new Error('outside owned directory or not a file')
  } catch (error) { throw new Error(`${label} is missing or outside its candidate directory: ${path}; ${String(error)}`) }
}
export async function assertProof(candidate: Candidate): Promise<void> {
  await assertRunDirectory(candidate)
  const path = join(candidate.path, '.runs/candidate-proof.json')
  await ownedFile(join(candidate.path, '.runs'), path, 'Candidate proof')
  const proof = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  if (proof.schemaVersion !== 1 || proof.passed !== true || proof.taskId !== candidate.taskId || proof.baseCommit !== candidate.baseCommit || proof.testedCommit !== candidate.commit || proof.tree !== candidate.tree || typeof proof.createdAt !== 'string' || !Number.isFinite(Date.parse(proof.createdAt))) {
    throw new Error('Candidate proof must match its exact task, baseline, commit and tree and report success')
  }
  const checks = proof.checks as Array<{ name: string; exitCode: number }> | undefined
  if (!Array.isArray(checks) || !checks.every(check => check && typeof check.name === 'string' && check.exitCode === 0) || new Set(checks.map(check => check.name)).size !== checks.length || !requiredChecks.every(name => checks.some(check => check.name === name))) {
    throw new Error(`Candidate proof requires all passing checks: ${requiredChecks.join(', ')}`)
  }
  if (typeof proof.runManifest !== 'string' || !proof.runManifest) throw new Error('Candidate proof runManifest is missing')
  await ownedFile(join(candidate.path, '.runs'), resolve(candidate.path, proof.runManifest), 'Proof run manifest')
}
export async function assertVisual(candidate: Candidate, path: string): Promise<void> {
  let visual: Record<string, unknown>
  try { visual = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown> }
  catch (error) { throw new Error(`Cannot read manual UI review: ${String(error)}`) }
  if (visual.kind !== 'manual-ui' || visual.testedCommit !== candidate.commit || visual.outcome !== 'passed' || typeof visual.reviewer !== 'string' || !visual.reviewer.trim() || !Array.isArray(visual.artifacts) || !visual.artifacts.length || !visual.artifacts.every(repoPath)) {
    throw new Error('Manual UI review must name the exact tested commit, a reviewer, passed outcome and relative artifact paths')
  }
  for (const artifact of visual.artifacts) await ownedFile(candidate.path, resolve(candidate.path, artifact), 'Manual UI artifact')
}
