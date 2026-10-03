import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { cleanupCandidate, createTask, listWorktrees, prepareCandidate, promoteCandidate, verifyCandidate } from '../../scripts/worktree/workflow.js'
import { withIntegrationLock } from '../../scripts/worktree/lock.js'
import { classifyReview, REVIEW_POLICY_VERSION } from '../../scripts/worktree/review-profile.js'
import { planVerification } from '../../scripts/verify-candidate.js'
import { runTask } from '../../scripts/worktree.js'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 })

let sandbox: string
let root: string
function gitAt(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
const git = (...args: string[]) => gitAt(root, ...args)
async function put(cwd: string, path: string, content: string) {
  const destination = join(cwd, path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, content, 'utf8')
}
function card(id: string, overrides: Record<string, unknown> = {}): string {
  return '# Task\n\n```json\n' + JSON.stringify({
    id, title: id, owner: 'worker', state: 'active', milestone: 'DEV',
    summary: 'Fixture task', next_action: 'Implement', allowed_paths: ['src/**'], depends_on: [],
    docs_impact: { update: [], reason: 'Internal test fixture has no published documentation.' },
    verification_refs: [], integration_ref: null, acceptance_ref: null, ...overrides,
  }, null, 2) + '\n```\n'
}
function commit(cwd: string, message: string): string {
  gitAt(cwd, 'add', '.')
  gitAt(cwd, 'commit', '--quiet', '-m', message)
  return gitAt(cwd, 'rev-parse', 'HEAD')
}
async function worker(id = 'TASK-01') {
  const task = await createTask(root, { id, path: join(sandbox, id) })
  await put(task.path, `src/${id}.txt`, `${id}\n`)
  commit(task.path, `${id} change`)
  return task
}
async function candidateFixture() {
  const task = await worker()
  const candidate = await prepareCandidate(root, { id: 'TASK-01', branch: task.branch })
  return { task, candidate }
}
// The fixture producer relays the real shared classification into its proof, so
// pipeline tests exercise the same policy object the consumer recomputes with.
async function relayReview(candidate: { path: string; baseCommit: string; commit: string }) {
  const review = classifyReview(candidate.path, candidate.baseCommit, candidate.commit, { worktreePath: candidate.path })
  await mkdir(join(candidate.path, '.runs'), { recursive: true })
  await writeFile(join(candidate.path, '.runs/review-relay.json'), JSON.stringify({
    schemaVersion: 2, policyVersion: review.policyVersion, profile: review.profile, reason: review.reason,
    visual: review.visual, changeSet: review.changeSet,
    checks: planVerification(review.profile, { impact: true }).map(step => ({ name: step.name, exitCode: 0 })),
  }))
  return review
}
async function docsCandidateFixture() {
  await put(root, 'docs/work-items/tasks/DOCS-01.md', card('DOCS-01', { allowed_paths: ['docs/**', 'README.md'] }))
  commit(root, 'add docs task card')
  const task = await createTask(root, { id: 'DOCS-01', path: join(sandbox, 'DOCS-01') })
  await put(task.path, 'docs/guide.md', '# guide\n')
  commit(task.path, 'docs-only change')
  const candidate = await prepareCandidate(root, { id: 'DOCS-01', branch: task.branch })
  return { task, candidate }
}
async function visual(candidate: { path: string; commit: string }, changes: Record<string, unknown> = {}) {
  await put(candidate.path, '.runs/review/screenshot.png', 'fixture image evidence')
  const path = join(candidate.path, '.runs/review/visual.json')
  await writeFile(path, JSON.stringify({ kind: 'manual-ui', testedCommit: candidate.commit, outcome: 'passed', reviewer: 'Test reviewer', artifacts: ['.runs/review/screenshot.png'], ...changes }))
  return path
}
beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'trainer-worktrees-'))
  root = join(sandbox, 'repo')
  await mkdir(root)
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'Worktree Test')
  git('config', 'user.email', 'worktree-test@example.invalid')
  git('config', 'core.autocrlf', 'false')
  await put(root, '.gitignore', 'node_modules/\n.runs\n')
  await put(root, 'src/shared.txt', 'base\n')
  await put(root, 'docs/work-items/tasks/TASK-01.md', card('TASK-01'))
  await put(root, 'docs/work-items/tasks/TASK-02.md', card('TASK-02'))
  await put(root, 'package.json', JSON.stringify({ name: 'worktree-fixture', version: '1.0.0', private: true, scripts: { 'verify:candidate': 'node verify-fixture.cjs' } }))
  await put(root, 'package-lock.json', JSON.stringify({ name: 'worktree-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'worktree-fixture', version: '1.0.0' } } }))
  await put(root, 'verify-fixture.cjs', `
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const flag = name => process.argv[process.argv.indexOf(name) + 1];
const testedCommit = git('rev-parse', 'HEAD');
const cleanBefore = git('status', '--porcelain', '--untracked-files=all') === '';
if (fs.existsSync('.runs/fail-gate')) process.exit(7);
fs.mkdirSync('.runs/test-run', { recursive: true });
fs.writeFileSync('.runs/test-run/manifest.json', JSON.stringify({ root: process.cwd(), commit: testedCommit }));
const cleanAfter = git('status', '--porcelain', '--untracked-files=all') === '';
const binding = { taskId: flag('--task'), baseCommit: flag('--base'), testedCommit, tree: git('rev-parse', 'HEAD^{tree}'), passed: true, runManifest: path.resolve('.runs/test-run/manifest.json'), createdAt: new Date().toISOString() };
let proof;
try {
  const relay = JSON.parse(fs.readFileSync('.runs/review-relay.json', 'utf8'));
  proof = { schemaVersion: relay.schemaVersion, policyVersion: relay.policyVersion, profile: relay.profile, reason: relay.reason, visual: relay.visual, changeSet: relay.changeSet, checks: relay.checks, cleanBefore, cleanAfter, ...binding };
} catch {
  proof = { schemaVersion: 1, ...binding, checks: ['docs','impact','unit','types','build','m2','journey'].map(name => ({ name, exitCode: 0 })) };
}
fs.writeFileSync('.runs/candidate-proof.json', JSON.stringify(proof));
`)
  commit(root, 'baseline')
})

describe('candidate preparation', () => {
  it('combines the latest target with one task and records the exact merged commit without moving main', async () => {
    const task = await worker()
    await put(root, 'src/main.txt', 'main update\n')
    const baseline = commit(root, 'advance main')
    const candidate = await prepareCandidate(root, { id: 'TASK-01', branch: task.branch })
    expect(await readFile(join(candidate.path, 'src/main.txt'), 'utf8')).toBe('main update\n')
    expect(await readFile(join(candidate.path, 'src/TASK-01.txt'), 'utf8')).toBe('TASK-01\n')
    expect(candidate.baseCommit).toBe(baseline)
    expect(candidate.commit).toBe(gitAt(candidate.path, 'rev-parse', 'HEAD'))
    expect(candidate.tree).toBe(gitAt(candidate.path, 'rev-parse', 'HEAD^{tree}'))
    expect(git('rev-parse', 'main')).toBe(baseline)
    expect((await listWorktrees(root)).candidates).toEqual(expect.arrayContaining([expect.objectContaining({ id: candidate.id, status: 'prepared' })]))
  })

  it('retains a conflicting candidate for inspection and never changes main or the worker', async () => {
    const task = await worker()
    await put(task.path, 'src/shared.txt', 'worker\n')
    const source = commit(task.path, 'worker shared change')
    await put(root, 'src/shared.txt', 'main\n')
    const baseline = commit(root, 'main shared change')
    await expect(prepareCandidate(root, { id: 'TASK-01', branch: task.branch })).rejects.toThrow(/conflict|failed/i)
    const failed = (await listWorktrees(root)).candidates.find(candidate => candidate.status === 'failed')!
    expect(failed).toBeDefined()
    expect(gitAt(failed.path, 'diff', '--name-only', '--diff-filter=U')).toContain('src/shared.txt')
    expect(git('rev-parse', 'main')).toBe(baseline)
    expect(gitAt(task.path, 'rev-parse', 'HEAD')).toBe(source)
    expect(await readFile(join(root, 'src/shared.txt'), 'utf8')).toBe('main\n')
  })

  it('enforces the baseline scope even if a task tries to broaden its own card', async () => {
    const task = await worker()
    await put(task.path, 'docs/work-items/tasks/TASK-01.md', card('TASK-01', { allowed_paths: ['**'] }))
    await put(task.path, 'outside.txt', 'unauthorized\n')
    commit(task.path, 'unauthorized scope')
    const baseline = git('rev-parse', 'main')
    await expect(prepareCandidate(root, { id: 'TASK-01', branch: task.branch })).rejects.toThrow(/allowed_paths|scope/i)
    expect(git('rev-parse', 'main')).toBe(baseline)
    expect((await listWorktrees(root)).candidates).toHaveLength(0)
  })

  it('shares an exclusive lock across worktrees and does not steal a lock after an interrupted owner', async () => {
    const task = await worker()
    const baseline = git('rev-parse', 'main')
    await withIntegrationLock(root, async () => {
      await expect(prepareCandidate(task.path, { id: 'TASK-01', branch: task.branch })).rejects.toThrow(/lock/i)
      expect(git('rev-parse', 'main')).toBe(baseline)
    })
    const lock = join(root, '.git/trainer-integration/lock')
    await writeFile(lock, JSON.stringify({ pid: 99999999, token: 'interrupted-owner' }))
    await expect(prepareCandidate(root, { id: 'TASK-01', branch: task.branch })).rejects.toThrow(/lock/i)
    expect(JSON.parse(await readFile(lock, 'utf8')).token).toBe('interrupted-owner')
  })
})
afterEach(async () => { await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })

describe('task worktrees', () => {
  it('routes CLI create and list operations and rejects unknown or incomplete mutation arguments', async () => {
    const created = await runTask(root, ['create', '--id', 'TASK-01', '--path', join(sandbox, 'cli-worker')])
    expect(created.exitCode).toBe(0)
    expect(JSON.parse(created.messages[0]).branch).toBe('task/TASK-01')
    const listing = await runTask(root, ['list'])
    expect(listing.exitCode).toBe(0)
    expect(JSON.parse(listing.messages[0]).worktrees).toHaveLength(2)
    expect((await runTask(root, ['promote', '--candidate', 'missing'])).exitCode).toBe(1)
    expect((await runTask(root, ['create', '--id', 'TASK-02', '--unknown', 'flag'])).exitCode).toBe(1)
    expect(git('branch', '--list', 'task/TASK-02')).toBe('')
  })
  it('creates independent worktrees at the captured baseline and lists both without changing main', async () => {
    const baseline = git('rev-parse', 'main')
    const first = await createTask(root, { id: 'TASK-01', path: join(sandbox, 'one') })
    const second = await createTask(root, { id: 'TASK-02', path: join(sandbox, 'two') })
    expect(gitAt(first.path, 'rev-parse', 'HEAD')).toBe(baseline)
    expect(gitAt(second.path, 'branch', '--show-current')).toBe('task/TASK-02')
    await put(first.path, 'src/one.txt', 'one\n')
    commit(first.path, 'first task')
    expect(gitAt(second.path, 'rev-parse', 'HEAD')).toBe(baseline)
    expect(git('rev-parse', 'main')).toBe(baseline)
    const listed = await listWorktrees(root)
    expect(listed.worktrees.map(worktree => worktree.branch)).toEqual(expect.arrayContaining(['refs/heads/main', 'refs/heads/task/TASK-01', 'refs/heads/task/TASK-02']))
  })

  it('refuses an uncommitted baseline and leaves its edits and refs untouched', async () => {
    const baseline = git('rev-parse', 'main')
    await put(root, 'src/shared.txt', 'personal edit\n')
    await expect(createTask(root, { id: 'TASK-01', path: join(sandbox, 'worker') })).rejects.toThrow(/dirty|uncommitted/i)
    expect(await readFile(join(root, 'src/shared.txt'), 'utf8')).toBe('personal edit\n')
    expect(git('rev-parse', 'main')).toBe(baseline)
    expect(git('branch', '--list', 'task/TASK-01')).toBe('')
  })

  it('requires the task card and its integrated dependencies on the committed baseline', async () => {
    await expect(createTask(root, { id: 'UNKNOWN', path: join(sandbox, 'unknown') })).rejects.toThrow(/task card|UNKNOWN/i)
    await put(root, 'docs/work-items/tasks/TASK-01.md', card('TASK-01', { depends_on: ['TASK-02'] }))
    commit(root, 'declare dependency')
    await expect(createTask(root, { id: 'TASK-01', path: join(sandbox, 'worker') })).rejects.toThrow(/dependency.*TASK-02/i)
    expect(git('branch', '--list', 'task/TASK-01')).toBe('')
  })
})

describe('candidate verification and promotion', () => {
  it('runs the candidate gate and promotes exactly the reviewed commit, then cleans up only that candidate', async () => {
    const { task, candidate } = await candidateFixture()
    const checked = await verifyCandidate(root, candidate.id)
    expect(checked.status).toBe('verified')
    const proof = JSON.parse(await readFile(join(candidate.path, '.runs/candidate-proof.json'), 'utf8'))
    expect(proof.testedCommit).toBe(candidate.commit)
    expect(proof.baseCommit).toBe(candidate.baseCommit)
    await promoteCandidate(root, candidate.id, await visual(candidate))
    expect(git('rev-parse', 'main')).toBe(candidate.commit)
    expect(git('status', '--porcelain')).toBe('')
    await cleanupCandidate(root, candidate.id)
    const listed = await listWorktrees(root)
    expect(listed.worktrees.some(item => item.path === candidate.path)).toBe(false)
    expect(listed.worktrees.some(item => item.branch === `refs/heads/${task.branch}`)).toBe(true)
    expect(listed.candidates.find(item => item.id === candidate.id)?.status).toBe('cleaned')
    expect(git('branch', '--list', candidate.branch)).toBe('')
    await expect(access(candidate.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('requires a verified candidate and a complete passing proof for its exact commit, tree, task and baseline', async () => {
    const { candidate } = await candidateFixture()
    const review = await visual(candidate)
    await expect(promoteCandidate(root, candidate.id, review)).rejects.toThrow(/verified|proof/i)
    await verifyCandidate(root, candidate.id)
    const path = join(candidate.path, '.runs/candidate-proof.json')
    const proof = JSON.parse(await readFile(path, 'utf8'))
    for (const bad of [
      { testedCommit: candidate.baseCommit }, { tree: candidate.baseCommit }, { taskId: 'TASK-02' },
      { baseCommit: candidate.commit }, { passed: false }, { schemaVersion: 2 },
      { checks: proof.checks.slice(1) }, { checks: proof.checks.map((item: {name: string; exitCode: number}) => ({ ...item, exitCode: item.name === 'unit' ? 1 : 0 })) },
      { runManifest: join(root, 'package.json') },
    ]) {
      await writeFile(path, JSON.stringify({ ...proof, ...bad }))
      await expect(promoteCandidate(root, candidate.id, review)).rejects.toThrow(/proof|check|manifest/i)
      expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
    }
  })

  it('rejects proof run manifests that are missing, outside or junction-redirected while retaining valid proofs', async () => {
    const { candidate } = await candidateFixture()
    await verifyCandidate(root, candidate.id)
    const path = join(candidate.path, '.runs/candidate-proof.json')
    const proof = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(join(sandbox, 'outside.json'), '{}')
    await mkdir(join(sandbox, 'outside-store'), { recursive: true })
    await writeFile(join(sandbox, 'outside-store/manifest.json'), '{}')
    await symlink(join(sandbox, 'outside-store'), join(candidate.path, '.runs/redirect'), process.platform === 'win32' ? 'junction' : 'dir')
    for (const bad of [
      { runManifest: '.runs/missing.json' },
      { runManifest: '../outside.json' },
      { runManifest: '.runs/redirect/manifest.json' },
    ]) {
      await writeFile(path, JSON.stringify({ ...proof, ...bad }))
      await expect(promoteCandidate(root, candidate.id, await visual(candidate)), JSON.stringify(bad)).rejects.toThrow(/manifest/i)
      expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
    }
    await writeFile(path, JSON.stringify(proof))
    await promoteCandidate(root, candidate.id, await visual(candidate))
    expect(git('rev-parse', 'main')).toBe(candidate.commit)
  })

  it('applies the same run-manifest ownership to v2 proofs before a visual-exempt promotion', async () => {
    const { candidate } = await docsCandidateFixture()
    await relayReview(candidate)
    await verifyCandidate(root, candidate.id)
    const path = join(candidate.path, '.runs/candidate-proof.json')
    const proof = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(join(sandbox, 'outside.json'), '{}')
    for (const bad of [{ runManifest: '.runs/missing.json' }, { runManifest: '../outside.json' }]) {
      await writeFile(path, JSON.stringify({ ...proof, ...bad }))
      await expect(promoteCandidate(root, candidate.id), JSON.stringify(bad)).rejects.toThrow(/manifest/i)
      expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
    }
    await writeFile(path, JSON.stringify(proof))
    await promoteCandidate(root, candidate.id)
    expect(git('rev-parse', 'main')).toBe(candidate.commit)
  })

  it('requires v2 proofs to promise a clean worktree before and after the checks', async () => {
    const { candidate } = await docsCandidateFixture()
    await relayReview(candidate)
    await verifyCandidate(root, candidate.id)
    const path = join(candidate.path, '.runs/candidate-proof.json')
    const proof = JSON.parse(await readFile(path, 'utf8'))
    expect(proof.cleanBefore).toBe(true)
    expect(proof.cleanAfter).toBe(true)
    for (const bad of [{ cleanBefore: false }, { cleanAfter: false }, { cleanBefore: undefined }, { cleanAfter: undefined }]) {
      await writeFile(path, JSON.stringify({ ...proof, ...bad }))
      await expect(promoteCandidate(root, candidate.id), JSON.stringify(bad)).rejects.toThrow(/clean/i)
      expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
    }
    await writeFile(path, JSON.stringify(proof))
    await promoteCandidate(root, candidate.id)
    expect(git('rev-parse', 'main')).toBe(candidate.commit)
  })

  it('requires a matching manual UI review and existing relative evidence files', async () => {
    const { candidate } = await candidateFixture()
    await verifyCandidate(root, candidate.id)
    for (const bad of [
      { testedCommit: candidate.baseCommit }, { kind: 'automated' }, { outcome: 'failed' },
      { reviewer: '' }, { artifacts: [] }, { artifacts: ['.runs/missing.png'] }, { artifacts: ['../repo/package.json'] },
    ]) {
      await expect(promoteCandidate(root, candidate.id, await visual(candidate, bad))).rejects.toThrow(/manual|visual|review|artifact/i)
      expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
    }
  })

  it('rejects stale source refs before verification and after proof without advancing the target', async () => {
    const { candidate, task } = await candidateFixture()
    await put(task.path, 'src/new.txt', 'new source\n')
    commit(task.path, 'source moved before verification')
    await expect(verifyCandidate(root, candidate.id)).rejects.toThrow(/source.*stale|source.*changed/i)
    const second = await prepareCandidate(root, { id: 'TASK-01', branch: task.branch })
    await verifyCandidate(root, second.id)
    await put(task.path, 'src/another.txt', 'new source again\n')
    commit(task.path, 'source moved after verification')
    await expect(promoteCandidate(root, second.id, await visual(second))).rejects.toThrow(/source.*stale|source.*changed/i)
    expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
  })

  it('rejects an advanced target and never reuses proof against a new main', async () => {
    const { candidate } = await candidateFixture()
    await verifyCandidate(root, candidate.id)
    await put(root, 'src/later.txt', 'main advanced\n')
    const advanced = commit(root, 'advance main after proof')
    await expect(promoteCandidate(root, candidate.id, await visual(candidate))).rejects.toThrow(/target.*stale|target.*changed/i)
    expect(git('rev-parse', 'main')).toBe(advanced)
  })

  it('refuses dirty candidates and targets while preserving their files', async () => {
    const { candidate } = await candidateFixture()
    await verifyCandidate(root, candidate.id)
    const review = await visual(candidate)
    await put(candidate.path, 'src/uncommitted.txt', 'candidate draft\n')
    await expect(promoteCandidate(root, candidate.id, review)).rejects.toThrow(/dirty/i)
    await expect(verifyCandidate(root, candidate.id)).rejects.toThrow(/dirty/i)
    await rm(join(candidate.path, 'src/uncommitted.txt'))
    await put(root, 'src/uncommitted.txt', 'target draft\n')
    await expect(promoteCandidate(root, candidate.id, review)).rejects.toThrow(/dirty/i)
    expect(await readFile(join(root, 'src/uncommitted.txt'), 'utf8')).toBe('target draft\n')
    expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
  })

  it('refuses cleanup before promotion and preserves unmerged candidate files', async () => {
    const { candidate } = await candidateFixture()
    await expect(cleanupCandidate(root, candidate.id)).rejects.toThrow(/promoted/i)
    await expect(access(join(candidate.path, 'src/TASK-01.txt'))).resolves.toBeUndefined()
    expect(git('branch', '--list', candidate.branch)).toContain(candidate.branch)
  })

  it('never writes verification artifacts through a redirected run directory', async () => {
    const { candidate } = await candidateFixture()
    const unrelated = join(sandbox, 'unrelated')
    await mkdir(unrelated)
    await put(unrelated, 'candidate-proof.json', 'keep unrelated proof\n')
    await symlink(unrelated, join(candidate.path, '.runs'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(gitAt(candidate.path, 'status', '--porcelain')).toBe('')
    await expect(verifyCandidate(root, candidate.id)).rejects.toThrow(/run.*directory|symlink|junction|owned/i)
    expect(await readFile(join(unrelated, 'candidate-proof.json'), 'utf8')).toBe('keep unrelated proof\n')
    expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
  })

  it('requires a local dependency directory rather than accepting an arbitrary node_modules file', async () => {
    const { candidate } = await candidateFixture()
    await writeFile(join(root, '.git/info/exclude'), 'node_modules\n')
    await put(candidate.path, 'node_modules', 'unrelated placeholder\n')
    await expect(verifyCandidate(root, candidate.id)).rejects.toThrow(/dependenc|node_modules/i)
    expect(await readFile(join(candidate.path, 'node_modules'), 'utf8')).toBe('unrelated placeholder\n')
    expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
  })

  it('retains failed gate evidence and refuses promotion even if an older proof existed', async () => {
    const { candidate } = await candidateFixture()
    await put(candidate.path, '.runs/fail-gate', 'fail now')
    await put(candidate.path, '.runs/candidate-proof.json', '{"passed":true}')
    await expect(verifyCandidate(root, candidate.id)).rejects.toThrow(/failed.*7/i)
    expect((await listWorktrees(root)).candidates.find(item => item.id === candidate.id)?.status).toBe('failed')
    expect(await readFile(join(candidate.path, '.runs/candidate-verify.log'), 'utf8')).toContain('verify:candidate')
    await expect(access(join(candidate.path, '.runs/candidate-proof.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(promoteCandidate(root, candidate.id, await visual(candidate))).rejects.toThrow(/verified|failed/i)
    expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
  })

  it('promotes through compare-and-swap when the target is not checked out', async () => {
    const { candidate } = await candidateFixture()
    git('switch', '--detach', '--quiet')
    await verifyCandidate(root, candidate.id)
    await promoteCandidate(root, candidate.id, await visual(candidate))
    expect(git('rev-parse', 'main')).toBe(candidate.commit)
    expect(git('rev-parse', 'HEAD')).toBe(candidate.baseCommit)
    await cleanupCandidate(root, candidate.id)
    expect(git('branch', '--list', candidate.branch)).toBe('')
  })

  it('preserves a promoted candidate if it becomes dirty or its registered branch changes', async () => {
    const { candidate } = await candidateFixture()
    await verifyCandidate(root, candidate.id)
    await promoteCandidate(root, candidate.id, await visual(candidate))
    await put(candidate.path, 'src/keep.txt', 'keep my draft\n')
    await expect(cleanupCandidate(root, candidate.id)).rejects.toThrow(/dirty/i)
    expect(await readFile(join(candidate.path, 'src/keep.txt'), 'utf8')).toBe('keep my draft\n')
    await rm(join(candidate.path, 'src/keep.txt'))
    gitAt(candidate.path, 'switch', '-c', 'unrelated')
    await expect(cleanupCandidate(root, candidate.id)).rejects.toThrow(/registered/i)
    await expect(access(candidate.path)).resolves.toBeUndefined()
    expect(git('branch', '--list', 'unrelated')).toContain('unrelated')
  })
})

describe('classified docs-only candidates', () => {
  it('verifies a docs-only candidate with the exact docs check set and promotes without a visual review', async () => {
    const { candidate } = await docsCandidateFixture()
    await relayReview(candidate)
    const checked = await verifyCandidate(root, candidate.id)
    expect(checked.status).toBe('verified')
    const proof = JSON.parse(await readFile(join(candidate.path, '.runs/candidate-proof.json'), 'utf8'))
    expect(proof.schemaVersion).toBe(2)
    expect(proof.profile).toBe('docs-only')
    expect(proof.visual).toBe('not_applicable')
    expect(proof.policyVersion).toBe(REVIEW_POLICY_VERSION)
    expect(proof.changeSet.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(proof.checks.map((check: { name: string }) => check.name)).toEqual(['docs', 'impact', 'status'])
    await promoteCandidate(root, candidate.id)
    expect(git('rev-parse', 'main')).toBe(candidate.commit)
    expect(git('status', '--porcelain')).toBe('')
    await cleanupCandidate(root, candidate.id)
    expect(git('branch', '--list', candidate.branch)).toBe('')
  })

  it('keeps the manual UI requirement for legacy v1 proofs even when the change set is docs-only', async () => {
    const { candidate } = await docsCandidateFixture()
    await verifyCandidate(root, candidate.id)
    const proof = JSON.parse(await readFile(join(candidate.path, '.runs/candidate-proof.json'), 'utf8'))
    expect(proof.schemaVersion).toBe(1)
    await expect(promoteCandidate(root, candidate.id)).rejects.toThrow(/manual|visual/i)
    expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
    await promoteCandidate(root, candidate.id, await visual(candidate))
    expect(git('rev-parse', 'main')).toBe(candidate.commit)
  })

  it('rejects forged docs-only proofs over full change sets and mismatched change-set fingerprints', async () => {
    const { candidate } = await candidateFixture()
    await relayReview(candidate)
    await verifyCandidate(root, candidate.id)
    const proofPath = join(candidate.path, '.runs/candidate-proof.json')
    const proof = JSON.parse(await readFile(proofPath, 'utf8'))
    expect(proof.profile).toBe('full')
    expect(proof.visual).toBe('required')
    await writeFile(proofPath, JSON.stringify({
      ...proof, profile: 'docs-only', visual: 'not_applicable',
      checks: [{ name: 'docs', exitCode: 0 }, { name: 'impact', exitCode: 0 }, { name: 'status', exitCode: 0 }],
    }))
    await expect(promoteCandidate(root, candidate.id)).rejects.toThrow(/profile|classification|recomputed/i)
    expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)

    const docs = await docsCandidateFixture()
    await relayReview(docs.candidate)
    await verifyCandidate(root, docs.candidate.id)
    const docsProofPath = join(docs.candidate.path, '.runs/candidate-proof.json')
    const docsProof = JSON.parse(await readFile(docsProofPath, 'utf8'))
    await writeFile(docsProofPath, JSON.stringify({ ...docsProof, changeSet: { ...docsProof.changeSet, fingerprint: '0'.repeat(64) } }))
    await expect(promoteCandidate(root, docs.candidate.id)).rejects.toThrow(/fingerprint|change/i)
    expect(git('rev-parse', 'main')).toBe(docs.candidate.baseCommit)
  })

  it('rejects unknown policy versions, wrong visual flags and incomplete, extra or duplicated v2 check sets', async () => {
    const { candidate } = await docsCandidateFixture()
    await relayReview(candidate)
    await verifyCandidate(root, candidate.id)
    const path = join(candidate.path, '.runs/candidate-proof.json')
    const proof = JSON.parse(await readFile(path, 'utf8'))
    for (const bad of [
      { policyVersion: 'forged-policy' },
      { policyVersion: undefined },
      { schemaVersion: 3 },
      { schemaVersion: '2' },
      { visual: 'required' },
      { visual: 'unknown' },
      { checks: proof.checks.slice(0, 2) },
      { checks: [...proof.checks, { name: 'unit', exitCode: 0 }] },
      { checks: [...proof.checks, { name: 'docs', exitCode: 0 }] },
      { checks: proof.checks.map((item: { name: string; exitCode: number }) => ({ ...item, exitCode: item.name === 'impact' ? 1 : 0 })) },
      { checks: [] },
      { changeSet: { fingerprint: '0'.repeat(64) } },
      { changeSet: undefined },
    ]) {
      await writeFile(path, JSON.stringify({ ...proof, ...bad }))
      await expect(promoteCandidate(root, candidate.id), JSON.stringify(bad)).rejects.toThrow(/proof|policy|check|visual|fingerprint|supported|change/i)
      expect(git('rev-parse', 'main')).toBe(candidate.baseCommit)
    }
  })

  it('keeps the full eight-check gate, required visual and exact proof bindings for ordinary change sets', async () => {
    const { candidate } = await candidateFixture()
    await relayReview(candidate)
    await verifyCandidate(root, candidate.id)
    const proofPath = join(candidate.path, '.runs/candidate-proof.json')
    const proof = JSON.parse(await readFile(proofPath, 'utf8'))
    expect(proof.schemaVersion).toBe(2)
    expect(proof.profile).toBe('full')
    expect(proof.visual).toBe('required')
    expect(proof.checks.map((check: { name: string }) => check.name)).toEqual(['docs', 'impact', 'unit', 'types', 'build', 'snapshot', 'm2', 'journey'])
    await expect(promoteCandidate(root, candidate.id)).rejects.toThrow(/manual|visual/i)
    await writeFile(proofPath, JSON.stringify({ ...proof, checks: proof.checks.filter((check: { name: string }) => check.name !== 'snapshot') }))
    await expect(promoteCandidate(root, candidate.id, await visual(candidate))).rejects.toThrow(/check/i)
    await writeFile(proofPath, JSON.stringify(proof))
    await promoteCandidate(root, candidate.id, await visual(candidate))
    expect(git('rev-parse', 'main')).toBe(candidate.commit)
  })
})
