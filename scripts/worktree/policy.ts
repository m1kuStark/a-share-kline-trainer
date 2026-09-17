import { repoPath } from '../docs/validate.js'
import { type WorkItem } from '../docs/metadata.js'
import { git, resolveCommit } from './git.js'

export function validateId(id: string): void {
  if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(id)) throw new Error(`Invalid task ID: ${id}`)
}
export function taskAt(root: string, commit: string, id: string): WorkItem {
  validateId(id)
  let task: WorkItem
  try {
    const text = git(root, 'show', `${commit}:docs/work-items/tasks/${id}.md`)
    const block = /^\s*```json\s*\r?\n([\s\S]*?)^\s*```\s*$/m.exec(text)
    task = JSON.parse(block?.[1] ?? '') as WorkItem
  } catch { throw new Error(`Task card ${id} is missing or invalid on committed baseline ${commit}`) }
  if (task.id !== id || !Array.isArray(task.allowed_paths) || !task.allowed_paths.length || !task.allowed_paths.every(repoPath) || !Array.isArray(task.depends_on) || !task.depends_on.every(item => typeof item === 'string')) {
    throw new Error(`Invalid task card scope or dependencies: ${id}`)
  }
  return task
}
export function assertTaskReady(root: string, commit: string, id: string): WorkItem {
  const task = taskAt(root, commit, id)
  for (const dependency of task.depends_on!) {
    const card = taskAt(root, commit, dependency)
    if (card.state !== 'closed' || !card.integration_ref) throw new Error(`Dependency ${dependency} has not been closed and integrated on the baseline`)
    try {
      const integrated = resolveCommit(root, card.integration_ref)
      git(root, 'merge-base', '--is-ancestor', integrated, commit)
    } catch { throw new Error(`Dependency ${dependency} integration is not an ancestor of the baseline`) }
  }
  return task
}

function matches(path: string, pattern: string): boolean {
  const escaped = pattern.replace(/\\/g, '/').replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(path)
}
export function assertScope(root: string, task: WorkItem, base: string, head: string): void {
  const changed = git(root, 'diff', '--name-only', '-z', '--no-renames', base, head, '--').split('\0').filter(Boolean)
  const unauthorized = changed.filter(path => !task.allowed_paths!.some(pattern => matches(path, pattern)))
  if (unauthorized.length) throw new Error(`Task ${task.id} exceeds allowed_paths scope: ${unauthorized.join(', ')}`)
}
