import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

export interface WorkItem {
  id: string; title: string; state: string; summary: string; next_action: string
  verification_refs: string[]; acceptance_ref: string | null
  owner?: string; milestone?: string; allowed_paths?: string[]; depends_on?: string[]
  docs_impact?: { update: string[]; reason: string }; integration_ref?: string | null
  task_ids?: string[]
}
export interface Card { path: string; kind: 'tasks' | 'milestones'; data: WorkItem }
export interface Issue { level: 'ERROR' | 'WARN'; path: string; message: string }
export const slash = (value: string) => value.replace(/\\/g, '/')

export async function readCards(root: string): Promise<{ cards: Card[]; issues: Issue[] }> {
  const cards: Card[] = [], issues: Issue[] = []
  for (const kind of ['tasks', 'milestones'] as const) {
    const directory = join(root, 'docs/work-items', kind)
    let names: string[]
    try { names = await readdir(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      names = []
    }
    for (const name of names.filter(name => name.endsWith('.md')).sort()) {
      const path = slash(relative(root, join(directory, name)))
      try {
        const source = await readFile(join(root, path), 'utf8')
        const block = /^\s*```json\s*\r?\n([\s\S]*?)^\s*```\s*$/m.exec(source)
        if (!block) throw new Error('缺少第一块 json 元信息')
        cards.push({ path, kind, data: JSON.parse(block[1]) as WorkItem })
      } catch (error) { issues.push({ level: 'ERROR', path, message: String(error) }) }
    }
  }
  return { cards, issues }
}
