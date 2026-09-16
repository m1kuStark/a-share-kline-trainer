import { stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { slash, type Card, type Issue } from './metadata.js'

const states = new Set(['planned', 'active', 'blocked', 'review', 'closed', 'cancelled'])
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
export function repoPath(value: unknown): value is string {
  return text(value) && !/^(?:[a-z]:|\/)/i.test(slash(value)) && !slash(value).split('/').includes('..') && posix.normalize(slash(value)) !== '.'
}

export async function validateCards(root: string, cards: Card[]): Promise<Issue[]> {
  const issues: Issue[] = [], ids = new Map<string, Card>()
  for (const card of cards) {
    const { data, path, kind } = card
    const fail = (message: string) => issues.push({ level: 'ERROR', path, message })
    if (!data || typeof data !== 'object' || Array.isArray(data)) { fail('元信息必须是 JSON object'); continue }
    for (const key of ['id', 'title', 'state', 'summary', 'next_action'] as const) if (!text(data[key])) fail(`${key} 必须是非空字符串`)
    if (!states.has(data.state)) fail(`state 非法：${String(data.state)}`)
    if (text(data.id)) {
      if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(data.id)) fail(`id 格式应为大写字母/数字和连字符：${data.id}`)
      if (ids.has(data.id)) fail(`重复 ID ${data.id}；已见 ${ids.get(data.id)!.path}`)
      else ids.set(data.id, card)
    }
    if (!strings(data.verification_refs)) fail('verification_refs 必须是路径数组')
    if (data.acceptance_ref !== null && !text(data.acceptance_ref)) fail('acceptance_ref 必须是路径或 null')
    if (kind === 'tasks') {
      for (const key of ['owner', 'milestone'] as const) if (!text(data[key])) fail(`${key} 必须是非空字符串`)
      if (!strings(data.allowed_paths) || data.allowed_paths.length === 0 || !data.allowed_paths.every(repoPath)) fail('allowed_paths 必须是非空仓库相对路径/glob数组，不允许越界')
      if (!strings(data.depends_on)) fail('depends_on 必须是 ID 数组')
      if (!data.docs_impact || !strings(data.docs_impact.update) || typeof data.docs_impact.reason !== 'string') fail('docs_impact 需要 update 数组和 reason 字符串')
      if (data.integration_ref !== null && !text(data.integration_ref)) fail('integration_ref 必须是引用字符串或 null')
    } else if (!strings(data.task_ids)) fail('task_ids 必须是任务 ID 数组')
    const refs = [
      ...(strings(data.verification_refs) ? data.verification_refs : []),
      ...(text(data.acceptance_ref) ? [data.acceptance_ref] : []),
      ...(strings(data.docs_impact?.update) ? data.docs_impact.update : []),
    ]
    for (const ref of refs) {
      if (!repoPath(ref)) { fail(`引用必须是仓库相对文件路径：${ref}`); continue }
      try { if (!(await stat(join(root, slash(ref)))).isFile()) fail(`引用不是文件：${ref}`) }
      catch { fail(`引用文件不存在：${ref}`) }
    }
  }
  for (const { data, path, kind } of cards) {
    if (!data || typeof data !== 'object') continue
    const references: Array<[string, 'tasks' | 'milestones']> = kind === 'tasks'
      ? [...(strings(data.depends_on) ? data.depends_on.map(id => [id, 'tasks'] as [string, 'tasks']) : []), ...(text(data.milestone) ? [[data.milestone, 'milestones'] as [string, 'milestones']] : [])]
      : strings(data.task_ids) ? data.task_ids.map(id => [id, 'tasks']) : []
    for (const [id, targetKind] of references) if (ids.get(id)?.kind !== targetKind) issues.push({ level: 'ERROR', path, message: `引用未知 ${targetKind} ID：${id}` })
  }
  const visited = new Set<string>()
  function visit(id: string, chain: string[]) {
    if (chain.includes(id)) {
      issues.push({ level: 'ERROR', path: ids.get(id)!.path, message: `存在依赖环：${[...chain, id].join(' → ')}` })
      return
    }
    if (visited.has(id)) return
    const card = ids.get(id)
    if (card?.kind !== 'tasks') return
    for (const dependency of strings(card.data.depends_on) ? card.data.depends_on : []) visit(dependency, [...chain, id])
    visited.add(id)
  }
  for (const id of ids.keys()) visit(id, [])
  return issues
}
