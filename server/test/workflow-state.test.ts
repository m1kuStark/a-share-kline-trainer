import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initializeWorkflowState,
  readWorkflowState,
  recordWorkflowEvent,
  updateWorkflowState,
  type WorkflowEvent,
} from '../../scripts/workflow/state.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kline-workflow-state-'))
  roots.push(root)
  return root
}

function event(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    event_id: 'event-1',
    kind: 'task.created',
    timestamp: '2026-10-01T00:00:00.000Z',
    task_id: 'STATE-01',
    ...overrides,
  }
}

describe('canonical workflow state', () => {
  it('creates a readable snapshot with one schema version and empty registries', async () => {
    const root = await makeRoot()

    const state = await initializeWorkflowState(root)

    expect(state.schema_version).toBe(1)
    expect(state.project_id).toBe('a-share-kline-trainer')
    expect(state.tasks).toEqual({})
    expect(state.candidate).toBeNull()
    expect(state.runs).toEqual({})
    expect(state.events).toEqual([])
    await expect(readWorkflowState(root)).resolves.toEqual(state)
  })

  it('updates the snapshot atomically and records an idempotent event once', async () => {
    const root = await makeRoot()
    await initializeWorkflowState(root)

    await updateWorkflowState(root, draft => {
      draft.tasks['STATE-01'] = { status: 'active', owner: 'integrator', updated_at: '2026-10-01T00:00:00.000Z' }
    })
    await recordWorkflowEvent(root, event())
    await recordWorkflowEvent(root, event())

    const state = await readWorkflowState(root)
    expect(state.tasks['STATE-01']?.status).toBe('active')
    expect(state.events).toHaveLength(1)
    expect(JSON.parse(await readFile(join(root, 'trainer-state.json'), 'utf8'))).toEqual(state)
  })

  it('rejects a duplicate event id with different content and preserves the prior snapshot', async () => {
    const root = await makeRoot()
    await initializeWorkflowState(root)
    await recordWorkflowEvent(root, event())

    await expect(recordWorkflowEvent(root, event({ kind: 'task.updated' }))).rejects.toThrow(/event_id/)
    expect((await readWorkflowState(root)).events).toHaveLength(1)
  })

  it('rejects invalid status and absolute worktree paths before writing', async () => {
    const root = await makeRoot()
    await initializeWorkflowState(root)

    await expect(updateWorkflowState(root, draft => {
      draft.tasks['STATE-01'] = { status: 'unknown' as never, owner: 'integrator', updated_at: '2026-10-01T00:00:00.000Z' }
    })).rejects.toThrow(/status/)

    await expect(recordWorkflowEvent(root, event({ worktree_alias: 'D:\\private\\trainer-worktree' }))).rejects.toThrow(/relative/)
    expect((await readWorkflowState(root)).events).toHaveLength(0)
  })

  it('refuses to overwrite a state file while another writer owns the lock', async () => {
    const root = await makeRoot()
    await initializeWorkflowState(root)
    const lockPath = join(root, 'trainer-state.json.lock')
    await writeFile(lockPath, 'test lock', { flag: 'wx' })

    await expect(updateWorkflowState(root, draft => { draft.reconcile.status = 'clean' })).rejects.toThrow(/locked/)
  })
})

