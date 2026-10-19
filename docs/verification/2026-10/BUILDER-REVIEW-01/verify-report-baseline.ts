// Reproduce full-suite history on unchanged main without touching real data.
import { readFile, cp, writeFile } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { createRun, startServer, runNode } from '../../../../scripts/runtime/run'

const root = process.cwd()
const full = JSON.parse(await readFile(join(root, '.runs/run-54e0a9b3-4665-42f9-968a-a4eb5b78f13b/manifest.json'), 'utf8'))
const baselineRoot = join(root, '../../a-share-kline-trainer')
const old = JSON.parse(await readFile(join(baselineRoot, '.runs/run-4b87c256-8b29-4809-ab78-f6bb34975599/manifest.json'), 'utf8'))
const run = await createRun(old.root, 'journey', { tdxRoot: old.tdxRoot })
for (const item of [full, run]) {
  const local = relative(join(item.root, '.runs'), item.databasePath)
  if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('Unowned database')
}
const db = new DatabaseSync(full.databasePath, { readOnly: true })
try { await backup(db, run.databasePath) } finally { db.close() }
await cp(old.serverDir, run.serverDir, { recursive: true })
await cp(old.webDir, run.webDir, { recursive: true })
const server = await startServer(run)
let result = 'passed'
try {
  await runNode(run, [join(run.root, 'node_modules/@playwright/test/cli.js'), 'test', 'e2e/report-feedback.spec.ts', '--retries=0'], 'journey.log')
} catch (error) {
  result = 'failed'
  console.error(String(error))
  process.exitCode = 1
} finally {
  await server.stop()
  const receipt = { baselineCommit: old.commit, candidateDataRun: full.runId, baselineRun: run.runId, result, artifacts: run.artifactsDir }
  await writeFile(join(root, 'docs/verification/2026-10/BUILDER-REVIEW-01/report-baseline-receipt.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt))
}
