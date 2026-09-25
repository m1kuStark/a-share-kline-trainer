import { execFileSync } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRun, buildRun, runNode, startServer } from './runtime/run.js'
import { prepareJourneySnapshot } from './runtime/snapshot.js'
import { classifyReview, REVIEW_POLICY_VERSION, type ReviewProfileName } from './worktree/review-profile.js'

export interface PlannedStep { name: string; action: string }

/** Fixed machine check sets per review profile. docs-only never plans product
 * builds, servers, TDX snapshots, M2 or Journey; the baseline (profile null)
 * keeps the original full sequence without impact or a candidate proof. */
export function planVerification(profile: ReviewProfileName | null, options: { impact: boolean }): PlannedStep[] {
  const steps: PlannedStep[] = [{ name: 'docs', action: 'docs check' }]
  if (options.impact) steps.push({ name: 'impact', action: 'docs impact' })
  if (profile === 'docs-only') {
    steps.push({ name: 'status', action: 'docs status --check' })
    return steps
  }
  steps.push(
    { name: 'unit', action: 'unit tests' },
    { name: 'types', action: 'web types' },
    { name: 'build', action: 'production build' },
    { name: 'snapshot', action: 'journey snapshot' },
    { name: 'm2', action: 'm2 closed loop' },
    { name: 'journey', action: 'browser journey' },
  )
  return steps
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : null
  const taskId = args.includes('--task') ? args[args.indexOf('--task') + 1] : null
  if (args.length && (args.length !== 4 || !base || !taskId || !/^[a-f\d]{7,40}$/i.test(base) || !/^[A-Z0-9-]+$/.test(taskId))) {
    throw new Error('Usage: npm run verify:candidate -- --base SHA --task ID (baseline may omit both)')
  }
  const candidate = Boolean(base && taskId)
  const root = process.cwd()
  const git = (...argv: string[]) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const testedCommit = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}')
  const cleanBefore = git('status', '--porcelain', '--untracked-files=all') === ''
  // Classify the real committed change set once; it selects the machine check
  // plan and is embedded in the proof for the consumer to recompute.
  const review = base && taskId ? classifyReview(root, base, testedCommit, { worktreePath: root }) : null
  const run = await createRun(root, 'verify', process.env.TDX_ROOT ? { tdxRoot: process.env.TDX_ROOT } : {})
  console.log(`Verification run: ${run.manifestPath}`)
  if (review) console.log(`Review profile: ${review.profile} (${review.reason}; visual ${review.visual})`)
  const proofPath = join(root, '.runs', 'candidate-proof.json')
  if (candidate) await rm(proofPath, { force: true })
  const checks: Array<{ name: string; exitCode: number; error?: string }> = []
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('Verification interrupted'))
  process.once('SIGINT', abort); process.once('SIGTERM', abort)
  const cli = (path: string) => join(root, 'node_modules', path)
  async function step(name: string, action: () => Promise<void>) {
    console.log(`Checking ${name}…`)
    try { await action(); checks.push({ name, exitCode: 0 }) }
    catch (error) { checks.push({ name, exitCode: 1, error: String(error) }); throw error }
  }
  let server: Awaited<ReturnType<typeof startServer>> | undefined
  let passed = false
  const runners: Record<string, () => Promise<void>> = {
    docs: () => runNode(run, [cli('tsx/dist/cli.mjs'), 'scripts/docs.ts', 'check'], 'docs.log', { signal: controller.signal }),
    impact: () => runNode(run, [cli('tsx/dist/cli.mjs'), 'scripts/docs.ts', 'impact', '--base', base!, '--task', taskId!], 'impact.log', { signal: controller.signal }),
    status: () => runNode(run, [cli('tsx/dist/cli.mjs'), 'scripts/docs.ts', 'status', '--check'], 'status.log', { signal: controller.signal }),
    unit: () => runNode(run, [cli('vitest/vitest.mjs'), 'run', '--config', 'server/vitest.config.ts', '--allowOnly=false'], 'unit.log', { signal: controller.signal }),
    types: () => runNode(run, [cli('vue-tsc/bin/vue-tsc.js'), '--noEmit', '-p', 'web/tsconfig.json'], 'types.log', { signal: controller.signal }),
    build: () => buildRun(run, 'production', { signal: controller.signal }),
    // Browser runs consume an explicit immutable sample; this is not a whole-market M1 data audit.
    snapshot: () => prepareJourneySnapshot(run),
    m2: () => runNode(run, [cli('tsx/dist/cli.mjs'), 'scripts/verify-m2.ts'], 'm2.log', { signal: controller.signal }),
    journey: async () => {
      await buildRun(run, 'journey', { signal: controller.signal })
      server = await startServer(run)
      await runNode(run, [cli('@playwright/test/cli.js'), 'test', '--retries=0', '--forbid-only'], 'journey.log', { signal: controller.signal })
    },
  }
  try {
    for (const planned of planVerification(review?.profile ?? null, { impact: candidate })) {
      const action = runners[planned.name]
      if (!action) throw new Error(`No runner for planned check: ${planned.name}`)
      await step(planned.name, action)
    }
    passed = true
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally {
    try { await server?.stop() } catch (error) {
      passed = false; checks.push({ name: 'cleanup', exitCode: 1, error: String(error) }); process.exitCode = 1
    }
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort)
    const cleanAfter = git('status', '--porcelain', '--untracked-files=all') === '' && git('rev-parse', 'HEAD') === testedCommit
    const result = review ? {
      schemaVersion: 2, policyVersion: REVIEW_POLICY_VERSION, profile: review.profile, reason: review.reason,
      visual: review.visual, changeSet: review.changeSet, taskId, baseCommit: git('rev-parse', base!), testedCommit, tree,
      passed, checks, runManifest: run.manifestPath, cleanBefore, cleanAfter, createdAt: new Date().toISOString(),
    } : {
      schemaVersion: 1, taskId: null, baseCommit: null, testedCommit, tree,
      passed, checks, runManifest: run.manifestPath, cleanBefore, cleanAfter, createdAt: new Date().toISOString(),
    }
    await writeFile(join(run.artifactsDir, 'verification.json'), JSON.stringify(result, null, 2))
    if (passed && candidate && cleanBefore && cleanAfter) {
      // Recompute the classification after the checks: index flags or live links
      // hidden mid-run must not ride to promotion on the stale initial classification.
      let rechecked = false
      try {
        const recheck = classifyReview(root, base!, testedCommit, { worktreePath: root })
        if (recheck.profile === review!.profile && recheck.changeSet.fingerprint === review!.changeSet.fingerprint) {
          await writeFile(proofPath, JSON.stringify(result, null, 2))
          console.log(`Candidate proof: ${proofPath}`)
          rechecked = true
        } else console.error(`Change set or live worktree safety changed during the checks (${recheck.reason}); no promotion proof issued.`)
      } catch (error) { console.error(`Could not recheck the change set after the checks; no promotion proof issued: ${String(error)}`) }
      if (!rechecked) process.exitCode = 1
    } else if (candidate && passed) {
      console.error('Checks passed, but worktree/commit changed or was dirty; no promotion proof issued.')
      process.exitCode = 1
    }
    console.log(`Results: ${join(run.artifactsDir, 'verification.json')}`)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
