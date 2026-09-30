import { readWorkflowState, initializeWorkflowState, recordWorkflowEvent, updateWorkflowState, type TaskStatus, type WorkflowEvent } from './state.js'

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name)
  if (!value) throw new Error(`missing --${name}`)
  return value
}

function parseArgs(argv: string[]): { command: string; values: Map<string, string> } {
  const [command, ...rest] = argv
  if (!command) throw new Error('usage: state-cli <init|read|event|task> --control-root PATH')
  const values = new Map<string, string>()
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]
    if (!flag.startsWith('--')) throw new Error(`unexpected argument ${flag}`)
    const name = flag.slice(2)
    const value = rest[++index]
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
    if (values.has(name)) throw new Error(`duplicate --${name}`)
    values.set(name, value)
  }
  return { command, values }
}

async function main(): Promise<void> {
  const { command, values } = parseArgs(process.argv.slice(2))
  const controlRoot = required(values, 'control-root')
  if (command === 'init') {
    console.log(JSON.stringify(await initializeWorkflowState(controlRoot), null, 2))
    return
  }
  if (command === 'read') {
    console.log(JSON.stringify(await readWorkflowState(controlRoot), null, 2))
    return
  }
  if (command === 'event') {
    const event = JSON.parse(required(values, 'json')) as WorkflowEvent
    console.log(JSON.stringify(await recordWorkflowEvent(controlRoot, event), null, 2))
    return
  }
  if (command === 'task') {
    const taskId = required(values, 'id')
    const status = required(values, 'status') as TaskStatus
    const owner = values.get('owner')
    const summary = values.get('summary')
    const nextAction = values.get('next-action')
    const updated = await updateWorkflowState(controlRoot, state => {
      const previous = state.tasks[taskId]
      state.tasks[taskId] = {
        ...previous,
        status,
        ...(owner ? { owner } : {}),
        ...(summary ? { summary } : {}),
        updated_at: new Date().toISOString(),
      }
      state.active_task = status === 'closed' || status === 'cancelled' ? state.active_task === taskId ? null : state.active_task : taskId
      if (nextAction) state.next_action = nextAction
    })
    console.log(JSON.stringify(updated, null, 2))
    return
  }
  throw new Error(`unknown command ${command}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

