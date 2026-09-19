import { readFile, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { Card, Issue } from './metadata.js'

const START = '<!-- generated:status:start -->'
const END = '<!-- generated:status:end -->'
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
const link = (path: string, label = path) => `[${cell(label)}](<${posix.relative('docs', path)}>)`
const evidence = (paths: string[]) => paths.length ? paths.map((path, index) => link(path, `证据${index + 1}`)).join('；') : '未记录'

function render(cards: Card[]): string {
  const ordered = [...cards].sort((a, b) => a.data.id.localeCompare(b.data.id, 'en'))
  const lines = ['本区由任务卡与阶段卡生成；工作状态不代表已集成或用户已验收。', '', '### 阶段', '',
    '| 阶段 | 状态 | 摘要 / 下一步 | 验证记录 | 用户验收记录 |', '|---|---|---|---|---|']
  for (const { path, data } of ordered.filter(card => card.kind === 'milestones')) {
    lines.push(`| ${link(path, `${data.id} · ${data.title}`)} | ${data.state} | ${cell(data.summary)} / ${cell(data.next_action)} | ${evidence(data.verification_refs)} | ${data.acceptance_ref ? link(data.acceptance_ref) : '未记录'} |`)
  }
  lines.push('', '### 未关闭任务', '', '| 任务 | 状态 / 负责人 | 摘要 / 下一步 | 验证记录 | 集成引用 | 用户验收记录 |', '|---|---|---|---|---|---|')
  for (const { path, data } of ordered.filter(card => card.kind === 'tasks' && !['closed', 'cancelled'].includes(card.data.state))) {
    lines.push(`| ${link(path, `${data.id} · ${data.title}`)} | ${data.state} / ${cell(data.owner ?? '')} | ${cell(data.summary)} / ${cell(data.next_action)} | ${evidence(data.verification_refs)} | ${cell(data.integration_ref ?? '未记录')} | ${data.acceptance_ref ? link(data.acceptance_ref) : '未记录'} |`)
  }
  return lines.join('\n')
}

export async function updateStatus(root: string, cards: Card[], check: boolean): Promise<Issue[]> {
  const path = 'docs/status.md'
  let source: string
  try { source = await readFile(join(root, path), 'utf8') } catch (error) {
    return [{ level: 'ERROR', path, message: `无法读取状态页：${String(error)}` }]
  }
  if (source.split(START).length !== 2 || source.split(END).length !== 2 || source.indexOf(START) > source.indexOf(END)) {
    return [{ level: 'ERROR', path, message: '缺少、重复或倒置生成区标记，不覆盖手写内容。' }]
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const generated = newline + render(cards).replace(/\n/g, newline) + newline
  const begin = source.indexOf(START) + START.length, end = source.indexOf(END)
  if (source.slice(begin, end) === generated) return []
  if (check) return [{ level: 'ERROR', path, message: '生成区已过期；运行 npm run docs:status 后审查差异。' }]
  await writeFile(join(root, path), source.slice(0, begin) + generated + source.slice(end), 'utf8')
  return []
}
