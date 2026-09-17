import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanupCandidate, createTask, listWorktrees, prepareCandidate, promoteCandidate, verifyCandidate } from './worktree/workflow.js'

const flags: Record<string, string[]> = {
  create: ['id', 'base', 'path'], list: [], prepare: ['id', 'branch', 'target'],
  verify: ['candidate'], promote: ['candidate', 'visual'], cleanup: ['candidate'],
}
export async function runTask(root: string, args: string[]): Promise<{ exitCode: number; messages: string[] }> {
  try {
    const [command, ...rest] = args
    if (!command || !Object.hasOwn(flags, command)) throw new Error('Usage: npm run task -- create|list|prepare|verify|promote|cleanup [--flag value]')
    const values: Record<string, string> = {}
    for (let index = 0; index < rest.length; index += 2) {
      const key = rest[index].slice(2), value = rest[index + 1]
      if (!rest[index].startsWith('--') || !flags[command].includes(key) || Object.hasOwn(values, key) || !value || value.startsWith('--')) throw new Error(`Invalid or incomplete option: ${rest[index]}`)
      values[key] = value
    }
    const required = (key: string) => {
      if (!values[key]) throw new Error(`--${key} is required for ${command}`)
      return values[key]
    }
    let result: unknown
    switch (command) {
      case 'create': result = await createTask(root, { id: required('id'), base: values.base, path: values.path }); break
      case 'list': result = await listWorktrees(root); break
      case 'prepare': result = await prepareCandidate(root, { id: required('id'), branch: required('branch'), target: values.target }); break
      case 'verify': result = await verifyCandidate(root, required('candidate')); break
      case 'promote': result = await promoteCandidate(root, required('candidate'), resolve(root, required('visual'))); break
      case 'cleanup': result = await cleanupCandidate(root, required('candidate')); break
    }
    return { exitCode: 0, messages: [JSON.stringify(result, null, 2)] }
  } catch (error) { return { exitCode: 1, messages: [String(error)] } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runTask(process.cwd(), process.argv.slice(2))
  for (const message of result.messages) (result.exitCode ? console.error : console.log)(message)
  process.exitCode = result.exitCode
}
