import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeWorkflowState, readWorkflowState } from '../../scripts/workflow/state.js'
import { mirrorCandidateState } from '../../scripts/workflow/bridge.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workflow state adapters', () => {
  it('projects a candidate into the canonical state without storing its absolute worktree path', async () => {
    const controlRoot = await mkdtemp(join(tmpdir(), 'kline-workflow-bridge-'))
    roots.push(controlRoot)
    await initializeWorkflowState(controlRoot)

    await mirrorCandidateState(controlRoot, {
      id: 'TASK-01-aaaaaaaaaaaa',
      taskId: 'TASK-01',
      status: 'verified',
      baseCommit: 'a'.repeat(40),
      commit: 'b'.repeat(40),
      tree: 'c'.repeat(40),
      branch: 'integration/TASK-01-aaaaaaaaaaaa',
      path: 'D:\\private\\trainer-integration\\TASK-01-aaaaaaaaaaaa',
    })

    const state = await readWorkflowState(controlRoot)
    expect(state.candidate).toMatchObject({
      task_id: 'TASK-01',
      status: 'verified',
      base_commit: 'a'.repeat(40),
      commit: 'b'.repeat(40),
      tree: 'c'.repeat(40),
      worktree_alias: 'integration/TASK-01-aaaaaaaaaaaa',
    })
    expect(JSON.stringify(state)).not.toContain('private')
    expect(state.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'candidate.verified', task_id: 'TASK-01', commit: 'b'.repeat(40) }),
    ]))
  })
})

