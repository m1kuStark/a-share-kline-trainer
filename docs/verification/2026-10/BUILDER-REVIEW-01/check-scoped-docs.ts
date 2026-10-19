// Supplementary diagnostics only; does not override failed global docs gates.
import { readCards } from '../../../../scripts/docs/metadata'
import { checkImpact } from '../../../../scripts/docs/impact'
import { checkLinks } from '../../../../scripts/docs/links'
import { createRun } from '../../../../scripts/runtime/run'
import { stageUserDocsAndNotices, findBrokenPackageLinks } from '../../../../scripts/release/build.mjs'
import { cp, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const { cards } = await readCards(root)
const impact = checkImpact(root, cards, 'a91bad2', 'BUILDER-REVIEW-01')
const links = await checkLinks(root)
const run = await createRun(root, 'verify')
const staging = join(run.runDir, 'docs-staging')
await stageUserDocsAndNotices(staging, root)
for (const name of ['README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) await cp(join(root, name), join(staging, name))
const markdown: string[] = []
async function walk(path: string) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (item.isDirectory()) await walk(join(path, item.name))
    else if (item.name.endsWith('.md')) markdown.push(join(path, item.name))
  }
}
await walk(staging)
const packageLinks = await findBrokenPackageLinks(staging, markdown)
const report = { scope: 'diagnostic only; global docs:check/impact/status failures remain', impact, links, packageLinks, runId: run.runId }
await writeFile(join(root, 'docs/verification/2026-10/BUILDER-REVIEW-01/docs-scoped-receipt.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
process.exitCode = impact.issues.some(x => x.level === 'ERROR') || packageLinks.length ? 1 : 0
