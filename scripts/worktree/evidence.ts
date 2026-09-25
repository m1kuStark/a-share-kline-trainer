import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { repoPath } from '../docs/validate.js'
import { classifyReview, REVIEW_POLICY_VERSION, type ReviewProfileName, type VisualRequirement } from './review-profile.js'
import { type Candidate } from './state.js'

const legacyRequiredChecks = ['docs', 'impact', 'unit', 'types', 'build', 'm2', 'journey']
const profileRequiredChecks: Record<ReviewProfileName, readonly string[]> = {
  'docs-only': ['docs', 'impact', 'status'],
  full: ['docs', 'impact', 'unit', 'types', 'build', 'snapshot', 'm2', 'journey'],
}
const profileVisualRequirement: Record<ReviewProfileName, VisualRequirement> = {
  'docs-only': 'not_applicable',
  full: 'required',
}

export interface ProofAssessment {
  schemaVersion: 1 | 2
  profile?: ReviewProfileName
  visual?: VisualRequirement
}

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
function assertProofBindings(candidate: Candidate, proof: Record<string, unknown>): void {
  if (proof.passed !== true || proof.taskId !== candidate.taskId || proof.baseCommit !== candidate.baseCommit || proof.testedCommit !== candidate.commit || proof.tree !== candidate.tree || typeof proof.createdAt !== 'string' || !Number.isFinite(Date.parse(proof.createdAt))) {
    throw new Error('Candidate proof must match its exact task, baseline, commit and tree and report success')
  }
  if (typeof proof.runManifest !== 'string' || !proof.runManifest) throw new Error('Candidate proof runManifest is missing')
}
function passingCheckNames(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Candidate proof checks must be a list of named passing checks')
  if (!value.every(check => check && typeof check === 'object' && typeof (check as { name: unknown }).name === 'string' && (check as { exitCode: unknown }).exitCode === 0)) {
    throw new Error('Candidate proof requires every check to have a name and a passing exit code')
  }
  return value.map(check => (check as { name: string }).name)
}
async function assertV2Proof(candidate: Candidate, proof: Record<string, unknown>): Promise<ProofAssessment> {
  if (proof.policyVersion !== REVIEW_POLICY_VERSION) {
    throw new Error(`Candidate proof policyVersion ${JSON.stringify(proof.policyVersion ?? null)} is unknown to this reviewer; expected ${REVIEW_POLICY_VERSION}`)
  }
  // Recompute the classification from the candidate's own commits; the proof's
  // profile, paths and any task-card echoes are never trusted.
  const review = classifyReview(candidate.path, candidate.baseCommit, candidate.commit, { worktreePath: candidate.path })
  if (proof.profile !== review.profile) {
    throw new Error(`Candidate proof profile ${JSON.stringify(proof.profile ?? null)} does not match the recomputed ${review.profile} change set: ${review.reason}`)
  }
  const changeSet = proof.changeSet as { fingerprint?: unknown } | undefined
  if (!changeSet || typeof changeSet !== 'object' || changeSet.fingerprint !== review.changeSet.fingerprint) {
    throw new Error(`Candidate proof change-set fingerprint does not match the recomputed base..head change set (${review.changeSet.fingerprint})`)
  }
  const visual = profileVisualRequirement[review.profile]
  if (proof.visual !== visual) throw new Error(`Candidate proof visual requirement must be ${visual} for a ${review.profile} change set, got ${JSON.stringify(proof.visual ?? null)}`)
  // The producer must promise the worktree was clean before the checks started
  // and after they finished; a v2 proof missing either promise is not evidence.
  if (proof.cleanBefore !== true || proof.cleanAfter !== true) {
    throw new Error(`Candidate proof must promise cleanBefore and cleanAfter worktree cleanliness, got ${JSON.stringify(proof.cleanBefore ?? null)}/${JSON.stringify(proof.cleanAfter ?? null)}`)
  }
  const names = passingCheckNames(proof.checks)
  const expected = profileRequiredChecks[review.profile]
  if (names.length !== expected.length || new Set(names).size !== names.length || !expected.every(name => names.includes(name))) {
    throw new Error(`Candidate proof checks must be exactly the passing ${review.profile} set: ${expected.join(', ')}`)
  }
  return { schemaVersion: 2, profile: review.profile, visual }
}
export async function assertProof(candidate: Candidate): Promise<ProofAssessment> {
  await assertRunDirectory(candidate)
  const path = join(candidate.path, '.runs/candidate-proof.json')
  await ownedFile(join(candidate.path, '.runs'), path, 'Candidate proof')
  const proof = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  assertProofBindings(candidate, proof)
  // Both schema versions must point at a run manifest that exists and lives
  // inside this candidate's own .runs directory (realpath-resolved, so a
  // junction or symlink redirect outside is rejected too).
  await ownedFile(join(candidate.path, '.runs'), resolve(candidate.path, proof.runManifest as string), 'Proof run manifest')
  if (proof.schemaVersion === 2) return assertV2Proof(candidate, proof)
  if (proof.schemaVersion === 1) {
    const names = passingCheckNames(proof.checks)
    if (new Set(names).size !== names.length || !legacyRequiredChecks.every(name => names.includes(name))) {
      throw new Error(`Candidate proof requires all passing checks: ${legacyRequiredChecks.join(', ')}`)
    }
    return { schemaVersion: 1 }
  }
  throw new Error(`Candidate proof schemaVersion ${JSON.stringify(proof.schemaVersion ?? null)} is not supported`)
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
