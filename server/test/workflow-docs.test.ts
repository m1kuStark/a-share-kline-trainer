import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initializeWorkflowState, updateWorkflowState } from '../../scripts/workflow/state.js'
import { updateStatus } from '../../scripts/docs/status.js'
import type { Card } from '../../scripts/docs/metadata.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const cards: Card[] = [{ path: 'docs/work-items/tasks/TASK-01.md', kind: 'tasks', data: {
  id: 'TASK-01', title: 'task', state: 'active', owner: 'old owner', summary: 'old summary',
  next_action: 'continue', verification_refs: [], acceptance_ref: null,
} }]
async function fixture(status: 'active' | 'closed') {
  const root = await mkdtemp(join(tmpdir(), 'workflow-docs-'))
  roots.push(root)
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs/status.md'), '# status\n<!-- generated:status:start -->\nold\n<!-- generated:status:end -->\n')
  await initializeWorkflowState(join(root, '.control'))
  await updateWorkflowState(join(root, '.control'), state => {
    state.tasks['TASK-01'] = { status, owner: 'controller', summary: 'current summary', updated_at: '2026-10-01T01:00:00Z' }
  })
  return root
}
describe('canonical docs projection', () => {
  it('uses the canonical summary and owner without modifying the task contract', async () => {
    const root = await fixture('active')
    expect(await updateStatus(root, cards, false)).toEqual([])
    const text = await readFile(join(root, 'docs/status.md'), 'utf8')
    expect(text).toContain('current summary')
    expect(text).toContain('controller')
    expect(cards[0].data.summary).toBe('old summary')
  })
  it('reports state-drift and preserves the status page when the legacy task state disagrees', async () => {
    const root = await fixture('closed')
    const before = await readFile(join(root, 'docs/status.md'), 'utf8')
    expect(await updateStatus(root, cards, false)).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'ERROR', message: expect.stringContaining('state-drift') })]))
    expect(await readFile(join(root, 'docs/status.md'), 'utf8')).toBe(before)
  })
})
