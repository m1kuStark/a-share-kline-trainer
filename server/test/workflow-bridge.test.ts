import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeWorkflowState, readWorkflowState } from '../../scripts/workflow/state.js'
import * as bridge from '../../scripts/workflow/bridge.js'
const { mirrorCandidateState } = bridge

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workflow state adapters', () => {
  const candidate = (id = 'TASK-01-aaaaaaaaaaaa') => ({
    id, taskId: 'TASK-01', status: 'verified' as const, baseCommit: 'a'.repeat(40),
    commit: 'b'.repeat(40), tree: 'c'.repeat(40), branch: `integration/${id}`,
  })

  async function root() {
    const controlRoot = await mkdtemp(join(tmpdir(), 'kline-workflow-bridge-'))
    roots.push(controlRoot)
    await initializeWorkflowState(controlRoot)
    return controlRoot
  }

  it('keeps every candidate and consumes a repeated lifecycle notification without rewriting state', async () => {
    const controlRoot = await root()
    await mirrorCandidateState(controlRoot, candidate())
    const before = await readWorkflowState(controlRoot)
    await new Promise(resolve => setTimeout(resolve, 3))
    await mirrorCandidateState(controlRoot, candidate())
    expect(await readWorkflowState(controlRoot)).toEqual(before)
    await mirrorCandidateState(controlRoot, candidate('TASK-01-bbbbbbbbbbbb'))
    expect(Object.keys((await readWorkflowState(controlRoot)).candidates!)).toHaveLength(2)
  })

  it('refuses changed tree bytes under the same candidate lifecycle event', async () => {
    const controlRoot = await root()
    await mirrorCandidateState(controlRoot, candidate())
    const before = await readWorkflowState(controlRoot)
    await expect(mirrorCandidateState(controlRoot, { ...candidate(), tree: 'd'.repeat(40) })).rejects.toThrow(/different content|drift/)
    expect(await readWorkflowState(controlRoot)).toEqual(before)
  })

  it('projects GLM and DWF execution without granting engineering or user acceptance', async () => {
    const controlRoot = await root()
    expect(bridge.mirrorRunState).toBeTypeOf('function')
    const run = { run_id: 'batch-1', source: 'glm' as const, status: 'completed' as const,
      updated_at: '2026-10-01T01:00:00.000Z', task_id: 'TASK-01', attempt_id: 'batch-1',
      commit: 'b'.repeat(40), tree: 'c'.repeat(40), worktree_alias: 'wt-A', exit_code: 0 }
    await bridge.mirrorRunState(controlRoot, run)
    const before = await readWorkflowState(controlRoot)
    await bridge.mirrorRunState(controlRoot, run)
    expect(await readWorkflowState(controlRoot)).toEqual(before)
    await bridge.mirrorRunState(controlRoot, { ...run, run_id: 'dwf-1', source: 'dwf', task_id: undefined })
    const state = await readWorkflowState(controlRoot)
    expect(state.runs['glm:batch-1']).toMatchObject({ source: 'glm', status: 'completed', commit: run.commit })
    expect(state.runs['dwf:dwf-1']).toMatchObject({ source: 'dwf', status: 'completed' })
    expect(state.acceptance).toEqual({ engineering: 'unknown', user: 'unknown', publish: 'unknown' })
    expect(state.tasks['TASK-01']).toBeUndefined()
  })

  it('rejects a delayed running notification after a completed run', async () => {
    const controlRoot = await root()
    expect(bridge.mirrorRunState).toBeTypeOf('function')
    await bridge.mirrorRunState(controlRoot, { run_id: 'batch-1', source: 'glm', status: 'completed',
      updated_at: '2026-10-01T01:00:00.000Z', commit: 'a'.repeat(40), tree: 'b'.repeat(40) })
    await expect(bridge.mirrorRunState(controlRoot, { run_id: 'batch-1', source: 'glm', status: 'running',
      updated_at: '2026-10-01T00:00:00.000Z', commit: 'a'.repeat(40), tree: 'b'.repeat(40) })).rejects.toThrow(/stale|drift/)
    expect((await readWorkflowState(controlRoot)).runs['glm:batch-1'].status).toBe('completed')
  })
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

