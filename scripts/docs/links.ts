import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { slash, type Issue } from './metadata.js'

const excluded = new Set(['node_modules', 'dist', '.git', '.runs', 'output', 'test-results', 'playwright-report'])
export function withoutFences(source: string): string {
  let marker = '', size = 0
  return source.split(/\r?\n/).map(line => {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (!marker) { marker = fence[1][0]; size = fence[1].length }
      else if (fence[1][0] === marker && fence[1].length >= size) marker = ''
      return ''
    }
    return marker ? '' : line
  }).join('\n')
}

async function markdownFiles(root: string): Promise<string[]> {
  const result: string[] = []
  async function walk(directory: string, recurse: boolean) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && recurse && !excluded.has(entry.name)) await walk(path, true)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) result.push(slash(relative(root, path)))
    }
  }
  await walk(root, false)
  for (const directory of ['docs', 'server', 'web', 'e2e', 'scripts']) await walk(join(root, directory), true)
  return result.sort()
}

function anchors(source: string): Set<string> {
  const result = new Set<string>(), counts = new Map<string, number>()
  const plain = withoutFences(source)
  const lines = plain.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(lines[index])?.[1]
      ?? (index > 0 && /^\s*(?:=+|-+)\s*$/.test(lines[index]) ? lines[index - 1] : undefined)
    if (!heading) continue
    const slug = heading.replace(/<[^>]+>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-')
    const count = counts.get(slug) ?? 0
    counts.set(slug, count + 1)
    result.add(count ? `${slug}-${count}` : slug)
  }
  for (const match of plain.matchAll(/<(?:a|h[1-6])\b[^>]*(?:id|name)=["']([^"']+)["']/gi)) result.add(match[1])
  return result
}

function destinations(source: string): { links: string[]; missingRefs: string[] } {
  const plain = withoutFences(source).replace(/(`+)[\s\S]*?\1/g, '')
  const result: string[] = [], definitions = new Set<string>(), missingRefs: string[] = []
  for (const match of plain.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|(?:[^\s()]+|\([^()]*\))+)\s*(?:["'][^\n]*?["']\s*)?\)/g)) result.push(match[1].replace(/^<|>$/g, ''))
  for (const match of plain.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)) {
    definitions.add(match[1].trim().toLowerCase())
    result.push(match[2].replace(/^<|>$/g, ''))
  }
  for (const match of plain.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const reference = (match[2] || match[1]).trim().toLowerCase()
    if (!definitions.has(reference)) missingRefs.push(reference)
  }
  return { links: [...new Set(result)], missingRefs: [...new Set(missingRefs)] }
}

export async function checkLinks(root: string): Promise<Issue[]> {
  const issues: Issue[] = [], cache = new Map<string, Set<string>>()
  for (const path of await markdownFiles(root)) {
    const source = await readFile(join(root, path), 'utf8')
    // Navigation remains live even inside an archive. New dated run records are strict.
    const index = ['readme.md', 'agents.md'].includes(basename(path).toLowerCase())
    const historical = !index && (path.startsWith('docs/archive/')
      || (path.startsWith('docs/verification/') && !/^docs\/verification\/\d{4}-\d{2}\//.test(path)))
    const report = (message: string) => issues.push({ level: historical ? 'WARN' : 'ERROR', path,
      message: historical ? `${message}（历史证据保留原引用，仅警示；不代表现行入口有效）` : message })
    if (basename(path).toLowerCase() === 'agents.md' && basename(path) !== 'AGENTS.md') report('规范文件名必须为 AGENTS.md')
    const limit = basename(path) === 'AGENTS.md' ? (path === 'AGENTS.md' ? 2000 : 1500) : /\/tasks\//.test(path) ? 3000 : basename(path) === 'README.md' ? 2000 : 5000
    if (!historical && source.length > limit) issues.push({ level: 'WARN', path, message: `长度 ${source.length} 字符超过建议 ${limit}；按主题审查，不自动截断。` })
    const { links, missingRefs } = destinations(source)
    for (const reference of missingRefs) report(`引用式链接缺少定义：${reference}`)
    for (const destination of links) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) continue
      let decoded: string
      try { decoded = decodeURIComponent(destination) } catch { report(`链接编码无效：${destination}`); continue }
      const hash = decoded.indexOf('#'), fragment = hash < 0 ? '' : decoded.slice(hash + 1)
      const targetPath = (hash < 0 ? decoded : decoded.slice(0, hash)).split('?')[0]
      const target = targetPath ? resolve(targetPath.startsWith('/') ? root : dirname(join(root, path)), targetPath.replace(/^\//, '')) : join(root, path)
      if (slash(relative(root, target)).startsWith('../')) { report(`本地链接越出仓库：${destination}`); continue }
      if (basename(target).toLowerCase() === 'agents.md' && basename(target) !== 'AGENTS.md') report(`链接规范文件名必须为 AGENTS.md：${destination}`)
      try { await stat(target) } catch { report(`链接目标不存在：${destination}`); continue }
      if (fragment && extname(target).toLowerCase() === '.md') {
        let headings = cache.get(target)
        if (!headings) { headings = anchors(await readFile(target, 'utf8')); cache.set(target, headings) }
        if (!headings.has(fragment)) report(`标题锚点不存在：${destination}`)
      }
    }
  }
  return issues
}
