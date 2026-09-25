import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { classifyReview, isDocsCandidatePath, REVIEW_POLICY_VERSION } from '../../scripts/worktree/review-profile.js'
import { planVerification } from '../../scripts/verify-candidate.js'
import { runDocs } from '../../scripts/docs.js'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 15_000 })
const runCli = promisify(execFile)

let sandbox: string
let root: string
let base: string
function gitAt(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown; status?: unknown }
    throw new Error(`git ${args.join(' ')} failed | status=${failure.status} | stdout=${String(failure.stdout)} | stderr=${String(failure.stderr)}`)
  }
}const git = (...args: string[]) => gitAt(root, ...args)
async function put(path: string, content: string) {
  const destination = join(root, path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, content, 'utf8')
}
function commit(message: string): string {
  git('add', '.')
  git('commit', '-m', message)
  return git('rev-parse', 'HEAD')
}
function classify(options: { worktreePath?: string } = {}) {
  const head = git('rev-parse', 'HEAD')
  return classifyReview(root, base, head, options)
}
beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'review-profile-'))
  root = join(sandbox, 'repo')
  await mkdir(root)
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'Review Profile Test')
  git('config', 'user.email', 'review-profile-test@example.invalid')
  git('config', 'core.autocrlf', 'false')
  await put('src/shared.txt', 'base\n')
  await put('docs/keep.md', 'kept\n')
  base = commit('baseline')
})
afterEach(async () => { await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })

describe('docs-only classification', () => {
  it('classifies committed plain markdown as docs-only with visual evidence not applicable', async () => {
    await put('docs/guide.md', '# guide\n')
    await put('docs/topics/basics.md', '# basics\n')
    const head = commit('docs change')
    const review = classify({ worktreePath: root })
    expect(review.profile).toBe('docs-only')
    expect(review.visual).toBe('not_applicable')
    expect(review.policyVersion).toBe(REVIEW_POLICY_VERSION)
    expect(review.reason).toMatch(/markdown/i)
    expect(review.changeSet.entries.map(entry => entry.path)).toEqual(expect.arrayContaining(['docs/guide.md', 'docs/topics/basics.md']))
    expect(head).not.toBe(base)
  })

  it('accepts root README and CONTRIBUTING edits and plain markdown deletions', async () => {
    await put('README.md', '# readme\n')
    await put('CONTRIBUTING.md', '# contributing\n')
    git('rm', '--quiet', 'docs/keep.md')
    git('commit', '--quiet', '-m', 'root docs and removal')
    const review = classify({ worktreePath: root })
    expect(review.profile).toBe('docs-only')
    expect(review.changeSet.entries.find(entry => entry.path === 'docs/keep.md')?.status).toBe('D')
  })

  it('accepts both sides of a pure docs rename by observing deletes and adds without rename pairing', () => {
    git('mv', 'docs/keep.md', 'docs/renamed.md')
    commit('pure docs rename')
    const review = classify({ worktreePath: root })
    expect(review.profile).toBe('docs-only')
    expect(review.changeSet.entries.find(entry => entry.path === 'docs/keep.md')?.status).toBe('D')
    expect(review.changeSet.entries.find(entry => entry.path === 'docs/renamed.md')?.status).toBe('A')
  })
})

describe('conservative full classification', () => {
  it('rejects code, config and UI paths as ineligible and names the offending path', async () => {
    await put('src/app.ts', 'export {}\n')
    commit('code change')
    const review = classify({ worktreePath: root })
    expect(review.profile).toBe('full')
    expect(review.visual).toBe('required')
    expect(review.reason).toContain('src/app.ts')
  })

  it('rejects control documentation directories even when the files are markdown', async () => {
    await put('docs/engineering/notes.md', 'control\n')
    await put('docs/specs/rule.md', 'control\n')
    await put('docs/architecture/design.md', 'control\n')
    commit('control docs change')
    expect(classify({ worktreePath: root }).profile).toBe('full')
    git('reset', '--quiet', '--hard', base)
  })

  it('rejects AGENTS and CLAUDE files anywhere including nested docs paths', async () => {
    for (const path of ['AGENTS.md', 'docs/AGENTS.md', 'docs/deep/CLAUDE.md']) {
      git('reset', '--quiet', '--hard', base)
      await put(path, 'control\n')
      commit(`edit ${path}`)
      const review = classify({ worktreePath: root })
      expect(review.profile, path).toBe('full')
      expect(isDocsCandidatePath(path), path).toBe(false)
    }
  })

  it('rejects mixed change sets, non-markdown files under docs, and empty change sets', async () => {
    await put('docs/ok.md', 'docs\n')
    await put('src/mixed.ts', 'export {}\n')
    commit('mixed change')
    expect(classify({ worktreePath: root }).profile).toBe('full')

    git('reset', '--quiet', '--hard', base)
    await put('docs/image.png', 'not markdown\n')
    commit('docs asset')
    const review = classify({ worktreePath: root })
    expect(review.profile).toBe('full')
    expect(review.reason).toContain('docs/image.png')

    git('reset', '--quiet', '--hard', base)
    expect(classify({ worktreePath: root }).reason).toMatch(/empty/i)
  })

  it('rejects executable or symlinked markdown through raw file modes', () => {
    const blob = git('hash-object', '-w', '--stdin')
    git('update-index', '--add', '--cacheinfo', `100755,${blob},docs/executable.md`)
    git('commit', '--quiet', '-m', 'executable markdown')
    expect(git('ls-files', '-s', 'docs/executable.md')).toContain('100755')
    expect(classify({ worktreePath: root }).reason).toMatch(/mode/i)

    const link = git('hash-object', '-w', '--stdin')
    git('update-index', '--add', '--cacheinfo', `120000,${link},docs/link.md`)
    git('commit', '--quiet', '--amend', '-m', 'executable markdown and link')
    expect(classify({ worktreePath: root }).reason).toMatch(/mode/i)
    expect(git('diff', '--raw', '-z', '--no-renames', base, git('rev-parse', 'HEAD'), '--')).toContain('120000')
  })

  it('rejects renames that introduce or remove control paths on either side', async () => {
    await mkdir(join(root, 'docs/engineering'), { recursive: true })
    git('mv', 'docs/keep.md', 'docs/engineering/moved.md')
    commit('rename into control dir')
    expect(classify({ worktreePath: root }).profile).toBe('full')

    git('reset', '--quiet', '--hard', base)
    await put('AGENTS.md', 'control\n')
    base = commit('create AGENTS at base')
    git('mv', 'AGENTS.md', 'docs/moved-agents.md')
    commit('rename agents into docs')
    const review = classify({ worktreePath: root })
    expect(review.profile).toBe('full')
    expect(review.reason).toMatch(/AGENTS\.md/i)
  })
})

describe('git index safety', () => {
  it('refuses the docs exemption while skip-worktree or assume-unchanged flags hide worktree state', async () => {
    await put('docs/guide.md', '# guide\n')
    commit('docs change')
    git('update-index', '--skip-worktree', 'docs/guide.md')
    expect(classify({ worktreePath: root }).reason).toMatch(/hidden|skip-worktree|assume/i)
    git('update-index', '--no-skip-worktree', 'docs/guide.md')
    expect(classify({ worktreePath: root }).profile).toBe('docs-only')

    git('update-index', '--assume-unchanged', 'docs/guide.md')
    const flagged = classify({ worktreePath: root })
    expect(flagged.profile).toBe('full')
    expect(flagged.reason).toMatch(/hidden|skip-worktree|assume/i)
    git('update-index', '--no-assume-unchanged', 'docs/guide.md')
  })
})

describe('live worktree link safety', () => {
  it('refuses docs-only while a changed directory resolves through a junction and recovers once the real directory returns', async (t) => {
    await put('docs/guide.md', '# guide\n')
    commit('docs change')
    const outside = join(sandbox, 'outside-docs')
    await rename(join(root, 'docs'), outside)
    try { await symlink(outside, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir') }
    catch { t.skip(); return }
    try {
      expect(git('status', '--porcelain')).toBe('')
      const review = classify({ worktreePath: root })
      expect(review.profile).toBe('full')
      expect(review.reason).toMatch(/symlink|junction/i)
      expect(review.reason).toContain('docs')
    } finally {
      await rm(join(root, 'docs'), { force: true })
      await rename(outside, join(root, 'docs'))
    }
    expect(git('status', '--porcelain')).toBe('')
    expect(classify({ worktreePath: root }).profile).toBe('docs-only')
  })

  it('keeps validating deletions from the committed tree and tolerates their missing file under a junctioned parent', async (t) => {
    await put('docs/guide.md', '# guide\n')
    commit('second docs file')
    git('rm', '--quiet', 'docs/keep.md')
    git('commit', '--quiet', '-m', 'delete docs file')
    expect(classify({ worktreePath: root }).profile).toBe('docs-only')
    const outside = join(sandbox, 'outside-docs')
    await rename(join(root, 'docs'), outside)
    try { await symlink(outside, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir') }
    catch { t.skip(); return }
    expect(git('status', '--porcelain')).toBe('')
    const review = classify({ worktreePath: root })
    expect(review.profile).toBe('full')
    expect(review.reason).toMatch(/symlink|junction/i)
  })
})

describe('change-set fingerprint and policy binding', () => {
  it('keeps the fingerprint stable across content edits but changes it with the path set', async () => {
    await put('docs/guide.md', 'version one\n')
    commit('first docs edit')
    const first = classify()
    await put('docs/guide.md', 'version two\n')
    commit('second docs edit')
    const second = classify()
    expect(second.changeSet.fingerprint).toBe(first.changeSet.fingerprint)

    await put('docs/extra.md', 'extra\n')
    commit('third docs edit')
    const third = classify()
    expect(third.changeSet.fingerprint).not.toBe(first.changeSet.fingerprint)
    expect(first.changeSet.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof REVIEW_POLICY_VERSION).toBe('string')
    expect(REVIEW_POLICY_VERSION.length).toBeGreaterThan(0)
  })
})

describe('verification planning', () => {
  it('plans exactly the docs, impact and status checks for docs-only candidates', () => {
    const steps = planVerification('docs-only', { impact: true })
    expect(steps.map(step => step.name)).toEqual(['docs', 'impact', 'status'])
    const forbidden = ['unit', 'types', 'build', 'snapshot', 'm2', 'journey']
    expect(steps.some(step => forbidden.includes(step.name))).toBe(false)
  })

  it('keeps the full eight-check gate for ordinary candidates and the original baseline sequence', () => {
    expect(planVerification('full', { impact: true }).map(step => step.name))
      .toEqual(['docs', 'impact', 'unit', 'types', 'build', 'snapshot', 'm2', 'journey'])
    expect(planVerification(null, { impact: false }).map(step => step.name))
      .toEqual(['docs', 'unit', 'types', 'build', 'snapshot', 'm2', 'journey'])
  })
})

describe('actual producer CLI coverage', () => {
  // Executes the real scripts/verify-candidate.ts CLI (from this repository) in a
  // temporary docs-only git project, proving the docs-only plan runs exactly the
  // docs, impact and status checks — never a product build, TDX snapshot, server,
  // M2 or Journey step. The docs tool source is copied verbatim into the fixture
  // because the plan invokes `scripts/docs.ts` relative to the fixture root.
  it('executes the real verify-candidate CLI on a docs-only fixture and runs only docs, impact and status', async (t) => {
    const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
    const fixtureRoot = join(sandbox, 'cli-repo')
    await mkdir(join(fixtureRoot, 'docs/work-items/tasks'), { recursive: true })
    await mkdir(join(fixtureRoot, 'docs/work-items/milestones'), { recursive: true })
    await writeFile(join(fixtureRoot, '.gitignore'), '.runs/\nnode_modules/\nscripts/\n', 'utf8')
    const gitLocal = (...args: string[]) => gitAt(fixtureRoot, ...args)
    gitLocal('init', '--quiet', '--initial-branch=main')
    gitLocal('config', 'user.name', 'Verify Candidate CLI Test')
    gitLocal('config', 'user.email', 'verify-candidate-cli@example.invalid')
    gitLocal('config', 'core.autocrlf', 'false')
    const milestone = { id: 'MILE-90', title: 'Orchestration fixture', state: 'active', summary: 'Fixture milestone for the CLI probe', next_action: 'Proceed', verification_refs: [], acceptance_ref: null, task_ids: ['DOCS-90'] }
    const task = { id: 'DOCS-90', title: 'Docs-only fixture', state: 'active', owner: 'fixture', milestone: 'MILE-90', summary: 'Fixture docs-only task', next_action: 'Verify', allowed_paths: ['docs/**'], depends_on: [], docs_impact: { update: [], reason: 'Fixture change only adds an unused guide document.' }, verification_refs: [], integration_ref: null, acceptance_ref: null }
    await writeFile(join(fixtureRoot, 'docs/work-items/milestones/MILE-90.md'), '# Milestone\n\n```json\n' + JSON.stringify(milestone, null, 2) + '\n```\n', 'utf8')
    await writeFile(join(fixtureRoot, 'docs/work-items/tasks/DOCS-90.md'), '# Task\n\n```json\n' + JSON.stringify(task, null, 2) + '\n```\n', 'utf8')
    await writeFile(join(fixtureRoot, 'docs/status.md'), '# Status\n\n<!-- generated:status:start -->\n<!-- generated:status:end -->\n', 'utf8')
    gitLocal('add', '.')
    gitLocal('commit', '--quiet', '-m', 'fixture docs baseline')
    const base = gitLocal('rev-parse', 'HEAD')
    expect((await runDocs(fixtureRoot, ['status'])).exitCode).toBe(0)
    gitLocal('add', '.')
    gitLocal('commit', '--quiet', '-m', 'fixture status page')
    await writeFile(join(fixtureRoot, 'docs/guide.md'), '# guide\n', 'utf8')
    gitLocal('add', '.')
    gitLocal('commit', '--quiet', '-m', 'fixture docs-only change')
    const head = gitLocal('rev-parse', 'HEAD')
    try {
      await symlink(join(repoRoot, 'node_modules'), join(fixtureRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
      await mkdir(join(fixtureRoot, 'scripts'), { recursive: true })
      await cp(join(repoRoot, 'scripts/docs.ts'), join(fixtureRoot, 'scripts/docs.ts'))
      await cp(join(repoRoot, 'scripts/docs'), join(fixtureRoot, 'scripts/docs'), { recursive: true })
    } catch { t.skip(); return }
    const executed = await runCli(process.execPath,
      [join(repoRoot, 'node_modules/tsx/dist/cli.mjs'), join(repoRoot, 'scripts/verify-candidate.ts'), '--base', base, '--task', 'DOCS-90'],
      { cwd: fixtureRoot, encoding: 'utf8', windowsHide: true })
    expect(executed.stdout).toContain('Review profile: docs-only')
    expect(executed.stdout).toContain('Candidate proof:')
    const proof = JSON.parse(await readFile(join(fixtureRoot, '.runs/candidate-proof.json'), 'utf8'))
    expect(proof.schemaVersion).toBe(2)
    expect(proof.profile).toBe('docs-only')
    expect(proof.visual).toBe('not_applicable')
    expect(proof.passed).toBe(true)
    expect(proof.cleanBefore).toBe(true)
    expect(proof.cleanAfter).toBe(true)
    expect(proof.taskId).toBe('DOCS-90')
    expect(proof.baseCommit).toBe(base)
    expect(proof.testedCommit).toBe(head)
    expect(proof.checks.map((check: { name: string }) => check.name)).toEqual(['docs', 'impact', 'status'])
    expect((await readdir(join(dirname(proof.runManifest), 'artifacts'))).sort())
      .toEqual(['docs.log', 'impact.log', 'status.log', 'verification.json'])
  }, 120_000)
})
