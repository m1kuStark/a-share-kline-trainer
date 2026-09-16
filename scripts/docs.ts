import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCards } from './docs/metadata.js'
import { updateStatus } from './docs/status.js'
import { validateCards } from './docs/validate.js'
import { checkLinks } from './docs/links.js'
import { checkImpact } from './docs/impact.js'
export interface DocsResult { exitCode: number; messages: string[] }

export async function runDocs(root: string, args: string[]): Promise<DocsResult> {
  const valid = (args[0] === 'check' && args.length === 1)
    || (args[0] === 'status' && (args.length === 1 || (args.length === 2 && args[1] === '--check')))
    || (args[0] === 'impact' && args.length === 5 && new Set([args[1], args[3]]).size === 2
      && [args[1], args[3]].every(arg => ['--base', '--task'].includes(arg)) && !args[2].startsWith('--') && !args[4].startsWith('--'))
  if (!valid) return { exitCode: 1, messages: ['用法：tsx scripts/docs.ts check | impact --base SHA --task DOC-01 | status [--check]'] }
  const { cards, issues } = await readCards(root)
  issues.push(...await validateCards(root, cards))
  const messages: string[] = []
  if (args[0] === 'check') issues.push(...await checkLinks(root))
  if (!issues.some(issue => issue.level === 'ERROR')) {
    if (args[0] === 'impact') {
      const result = checkImpact(root, cards, args[args.indexOf('--base') + 1] ?? '', args[args.indexOf('--task') + 1] ?? '')
      issues.push(...result.issues)
      if (result.summary) messages.push(result.summary)
    } else issues.push(...await updateStatus(root, cards, args[0] === 'check' || args.includes('--check')))
  }
  return { exitCode: issues.some(issue => issue.level === 'ERROR') ? 1 : 0,
    messages: [...issues.map(issue => `${issue.level} ${issue.path}: ${issue.message}`), ...messages,
      `INFO ${args[0]}: ${issues.filter(issue => issue.level === 'ERROR').length} errors, ${issues.filter(issue => issue.level === 'WARN').length} warnings；不更改任务/验收状态。`] }
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  runDocs(process.cwd(), process.argv.slice(2)).then(result => {
    for (const message of result.messages) console.log(message)
    process.exitCode = result.exitCode
  }).catch(error => { console.error(error); process.exitCode = 1 })
}
