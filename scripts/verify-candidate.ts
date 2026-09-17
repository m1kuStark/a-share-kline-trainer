import { execFileSync } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRun, buildRun, runNode, startServer } from './runtime/run.js'
import { prepareJourneySnapshot } from './runtime/snapshot.js'

const args = process.argv.slice(2)
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : null
const taskId = args.includes('--task') ? args[args.indexOf('--task') + 1] : null
if (args.length && (args.length !== 4 || !base || !taskId || !/^[a-f\d]{7,40}$/i.test(base) || !/^[A-Z0-9-]+$/.test(taskId))) {
  throw new Error('Usage: npm run verify:candidate -- --base SHA --task ID (baseline may omit both)')
}
const root = process.cwd()
const git = (...argv: string[]) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
const testedCommit = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}')
const cleanBefore = git('status', '--porcelain', '--untracked-files=all') === ''
const run = await createRun(root, 'verify', process.env.TDX_ROOT ? { tdxRoot: process.env.TDX_ROOT } : {})
console.log(`Verification run: ${run.manifestPath}`)
const proofPath = join(root, '.runs', 'candidate-proof.json')
if (base && taskId) await rm(proofPath, { force: true })
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
try {
  await step('docs', () => runNode(run, [cli('tsx/dist/cli.mjs'), 'scripts/docs.ts', 'check'], 'docs.log', { signal: controller.signal }))
  if (base && taskId) await step('impact', () => runNode(run, [cli('tsx/dist/cli.mjs'), 'scripts/docs.ts', 'impact', '--base', base, '--task', taskId], 'impact.log', { signal: controller.signal }))
  await step('unit', () => runNode(run, [cli('vitest/vitest.mjs'), 'run', '--config', 'server/vitest.config.ts', '--allowOnly=false'], 'unit.log', { signal: controller.signal }))
  await step('types', () => runNode(run, [cli('vue-tsc/bin/vue-tsc.js'), '--noEmit', '-p', 'web/tsconfig.json'], 'types.log', { signal: controller.signal }))
  await step('build', () => buildRun(run, 'production', { signal: controller.signal }))
  // Browser runs consume an explicit immutable sample; this is not a whole-market M1 data audit.
  await step('snapshot', () => prepareJourneySnapshot(run))
  await step('m2', () => runNode(run, [cli('tsx/dist/cli.mjs'), 'scripts/verify-m2.ts'], 'm2.log', { signal: controller.signal }))
  await step('journey', async () => {
    await buildRun(run, 'journey', { signal: controller.signal })
    server = await startServer(run)
    await runNode(run, [cli('@playwright/test/cli.js'), 'test', '--retries=0', '--forbid-only'], 'journey.log', { signal: controller.signal })
  })
  passed = true
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  try { await server?.stop() } catch (error) {
    passed = false; checks.push({ name: 'cleanup', exitCode: 1, error: String(error) }); process.exitCode = 1
  }
  process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort)
  const cleanAfter = git('status', '--porcelain', '--untracked-files=all') === '' && git('rev-parse', 'HEAD') === testedCommit
  const result = { schemaVersion: 1, taskId, baseCommit: base ? git('rev-parse', base) : null, testedCommit, tree,
    passed, checks, runManifest: run.manifestPath, cleanBefore, cleanAfter, createdAt: new Date().toISOString() }
  await writeFile(join(run.artifactsDir, 'verification.json'), JSON.stringify(result, null, 2))
  if (passed && base && taskId && cleanBefore && cleanAfter) {
    await writeFile(proofPath, JSON.stringify(result, null, 2))
    console.log(`Candidate proof: ${proofPath}`)
  } else if (base && taskId && passed) {
    console.error('Checks passed, but worktree/commit changed or was dirty; no promotion proof issued.')
    process.exitCode = 1
  }
  console.log(`Results: ${join(run.artifactsDir, 'verification.json')}`)
}
