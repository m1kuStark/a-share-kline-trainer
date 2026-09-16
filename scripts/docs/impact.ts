import { execFileSync } from 'node:child_process'
import { extname } from 'node:path'
import { slash, type Card, type Issue } from './metadata.js'

function matches(path: string, pattern: string): boolean {
  const escaped = slash(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(path)
}

function runtimePath(path: string): boolean {
  const extension = extname(path).toLowerCase()
  if (['.md', '.mdx'].includes(extension)) return false
  // Fixtures and shipped assets affect behavior; their file extensions do not make them docs.
  if (/^(?:server|web|e2e|scripts|shared)\//i.test(path) && !/\/docs\//i.test(path)) return true
  if (['.png', '.jpg', '.jpeg', '.svg', '.pdf', '.txt'].includes(extension)) return false
  if (path.startsWith('docs/') && ['.html', '.json', '.csv'].includes(extension)) return false
  return true
}

export function checkImpact(root: string, cards: Card[], base: string, taskId: string): { issues: Issue[]; summary: string } {
  const issues: Issue[] = []
  const fail = (message: string) => issues.push({ level: 'ERROR', path: `task:${taskId}`, message })
  const task = cards.find(card => card.kind === 'tasks' && card.data.id === taskId)
  if (!task) { fail('任务不存在'); return { issues, summary: '' } }
  if (!/^[a-f\d]{7,40}$/i.test(base)) { fail('--base 必须是可解析的提交 SHA（7–40 位）'); return { issues, summary: '' } }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let changed: string[]
  try {
    git('rev-parse', '--verify', `${base}^{commit}`)
    changed = [...new Set([...git('diff', '--name-only', '-z', '--no-renames', base, '--').split('\0'),
      ...git('diff', '--cached', '--name-only', '-z', '--no-renames', base, '--').split('\0'),
      ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')].filter(Boolean).map(slash))].sort()
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr
    fail(`无法读取 Git 基线/差异：${stderr ? String(stderr).trim() : String(error)}`)
    return { issues, summary: '' }
  }
  const runtime = changed.filter(runtimePath)
  for (const path of changed) if (!task.data.allowed_paths!.some(pattern => matches(path, pattern))) fail(`超出 allowed_paths 范围：${path}`)
  if (runtime.length) {
    const impact = task.data.docs_impact!
    if (impact.update.length) {
      const modified = new Set(changed.map(path => path.toLowerCase()))
      for (const path of impact.update) if (!modified.has(slash(path).toLowerCase())) fail(`${path} 已声明但相对基线未更新`)
    } else if (impact.reason.trim().length < 8 || /^(?:none|n\/a|todo|无|不需要|无需更新|待定)[.。\s]*$/i.test(impact.reason.trim())) {
      fail('运行代码有变更，docs_impact.update 为空时必须给出具体无文档影响理由（reason）。')
    }
  }
  return { issues, summary: `INFO ${taskId}: 相对 ${base} 检查 ${changed.length} 个变更路径（工作树、暂存区及未跟踪的并集），其中 ${runtime.length} 个运行代码/配置/测试路径；这是工作树预检，不代表集成或验收。` }
}
