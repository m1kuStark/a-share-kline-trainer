import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runDocs } from '../../scripts/docs.js'

let root: string
async function put(path: string, content: string) {
  const destination = join(root, path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, content, 'utf8')
}
const task = (extra: Record<string, unknown> = {}) => ({
  id: 'DOC-01', title: 'Documentation tooling', owner: 'worker', state: 'active',
  milestone: 'M1', summary: 'Work in progress', next_action: 'Review changes',
  allowed_paths: ['server/src/**'], depends_on: [],
  docs_impact: { update: [], reason: 'Internal implementation; published behavior remains unchanged.' },
  verification_refs: [], integration_ref: null, acceptance_ref: null, ...extra,
})
const milestone = { id: 'M1', title: 'First stage', state: 'active', summary: 'Not yet accepted', task_ids: ['DOC-01'], verification_refs: [], acceptance_ref: null, next_action: 'Review' }
const card = (value: unknown) => '# Card\n\n```json\n' + JSON.stringify(value, null, 2) + '\n```\n'
async function fixture(extra: Record<string, unknown> = {}) {
  await put('docs/work-items/tasks/DOC-01.md', card(task(extra)))
  await put('docs/work-items/milestones/M1.md', card(milestone))
  await put('docs/status.md', '# Manual introduction\n\n<!-- generated:status:start -->\nold\n<!-- generated:status:end -->\n\nManual footer.\n')
}
function git(...args: string[]): string { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim() }
async function gitFixture(extra: Record<string, unknown> = {}) {
  await fixture(extra)
  await runDocs(root, ['status'])
  await put('server/src/example.ts', 'export const example = 1\n')
  git('init', '--quiet')
  git('config', 'core.autocrlf', 'false')
  git('config', 'user.email', 'docs-test@example.invalid')
  git('config', 'user.name', 'Documentation Test')
  git('add', '.')
  git('commit', '--quiet', '-m', 'fixture')
  return git('rev-parse', 'HEAD')
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'trainer-docs-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('documentation CLI', () => {
  it('refuses to overwrite a handwritten status page without generation markers', async () => {
    await fixture()
    await put('docs/status.md', '# My handwritten status\nKeep this.\n')
    const result = await runDocs(root, ['status'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toMatch(/marker|标记/i)
    expect(await readFile(join(root, 'docs/status.md'), 'utf8')).toBe('# My handwritten status\nKeep this.\n')
  })

  it('renders task evidence and detects stale summaries without changing manual text or acceptance', async () => {
    await fixture()
    await put('docs/work-items/tasks/DOC-02.md', card(task({ id: 'DOC-02', state: 'closed', title: 'Hidden closed task' })))
    expect((await runDocs(root, ['status', '--check'])).exitCode).toBe(1)
    expect((await runDocs(root, ['status'])).exitCode).toBe(0)
    const rendered = await readFile(join(root, 'docs/status.md'), 'utf8')
    expect(rendered).toContain('# Manual introduction\n\n<!-- generated:status:start -->')
    expect(rendered).toContain('<!-- generated:status:end -->\n\nManual footer.\n')
    expect(rendered).toContain('Work in progress')
    expect(rendered).toContain('DOC-01')
    expect(rendered).not.toContain('Hidden closed task')
    expect(rendered).toContain('未记录')
    expect((await runDocs(root, ['status', '--check'])).exitCode).toBe(0)
    await put('docs/work-items/tasks/DOC-01.md', card(task({ summary: 'Changed summary' })))
    expect((await runDocs(root, ['status', '--check'])).exitCode).toBe(1)
    expect(await readFile(join(root, 'docs/status.md'), 'utf8')).toBe(rendered)
  })

  it.each([
    ['invalid state', { state: 'passed' }, /state/],
    ['missing owner', { owner: '' }, /owner/],
    ['unknown dependency', { depends_on: ['UNKNOWN'] }, /UNKNOWN/],
    ['unknown milestone', { milestone: 'MISSING' }, /MISSING/],
    ['missing evidence', { verification_refs: ['docs/no-evidence.md'] }, /no-evidence/],
    ['escaping scope', { allowed_paths: ['../outside/**'] }, /allowed_paths/],
    ['invalid stable ID', { id: 'DOC 01' }, /id.*格式/],
  ])('rejects task metadata: %s', async (_name, extra, error) => {
    await fixture(extra)
    const result = await runDocs(root, ['check'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toMatch(error as RegExp)
  })

  it('rejects duplicate stable IDs across cards without rewriting status', async () => {
    await fixture()
    await put('docs/work-items/tasks/duplicate.md', card(task()))
    const original = await readFile(join(root, 'docs/status.md'), 'utf8')
    const result = await runDocs(root, ['check'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toMatch(/重复.*DOC-01|duplicate.*DOC-01/)
    expect(await readFile(join(root, 'docs/status.md'), 'utf8')).toBe(original)
  })

  it('checks live relative links and heading anchors while ignoring fenced examples', async () => {
    await fixture()
    await runDocs(root, ['status'])
    await put('README.md', '[valid](docs/guide.md#中文标题)\n[bad file](docs/missing.md)\n[bad anchor](docs/guide.md#absent)\n```md\n[example](missing-example.md)\n```\n')
    await put('docs/guide.md', '# 中文标题\n')
    const result = await runDocs(root, ['check'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toContain('docs/missing.md')
    expect(result.messages.join('\n')).toContain('#absent')
    expect(result.messages.join('\n')).not.toContain('missing-example')
    expect(result.messages.join('\n')).not.toContain('#中文标题')
  })

  it('warns with a historical explanation for archived links but rejects active AGENTS casing', async () => {
    await fixture()
    await runDocs(root, ['status'])
    await put('docs/archive/old.md', '[old](missing.md)\n')
    const warning = await runDocs(root, ['check'])
    expect(warning.exitCode).toBe(0)
    expect(warning.messages.join('\n')).toMatch(/WARN.*历史/)
    await put('server/agents.md', '# Wrong case\n')
    const failed = await runDocs(root, ['check'])
    expect(failed.exitCode).toBe(1)
    expect(failed.messages.join('\n')).toContain('AGENTS.md')
  })

  it('validates reference links, escaped Chinese anchors and duplicate headings', async () => {
    await fixture()
    await runDocs(root, ['status'])
    await put('README.md', '[one][guide]\n[two](docs/guide.md#same-1)\n[missing][absent]\n\n[guide]: <docs/guide.md#%E4%B8%AD%E6%96%87>\n[absent]: docs/lost.md\n')
    await put('docs/guide.md', '# 中文\n# Same\n# Same\n')
    const result = await runDocs(root, ['check'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.filter(line => line.startsWith('ERROR'))).toHaveLength(1)
    expect(result.messages.join('\n')).toContain('docs/lost.md')
  })

  it('requires declared documentation updates for tracked working-tree source changes', async () => {
    await put('docs/guide.md', '# Existing specification\n')
    const base = await gitFixture({ allowed_paths: ['server/src/**', 'docs/guide.md'], docs_impact: { update: ['docs/guide.md'], reason: 'Changed behavior' } })
    await put('server/src/example.ts', 'export const example = 2\n')
    const failed = await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])
    expect(failed.exitCode).toBe(1)
    expect(failed.messages.join('\n')).toMatch(/docs\/guide.md.*未更新/)
    await put('docs/guide.md', '# Revised specification\n')
    expect((await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])).exitCode).toBe(0)
  })

  it('includes untracked runtime files and rejects paths outside the assigned scope', async () => {
    const base = await gitFixture()
    await put('web/src/new-widget.ts', 'export const widget = true\n')
    const result = await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toMatch(/范围.*web\/src\/new-widget.ts/)
  })

  it('rejects empty no-impact reasons but accepts a concrete internal-change explanation', async () => {
    const allowed_paths = ['server/src/**', 'docs/work-items/tasks/DOC-01.md']
    const base = await gitFixture({ allowed_paths, docs_impact: { update: [], reason: '' } })
    await put('server/src/example.ts', 'export const example = 2\n')
    const failed = await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])
    expect(failed.exitCode).toBe(1)
    expect(failed.messages.join('\n')).toMatch(/reason|理由/)
    await put('docs/work-items/tasks/DOC-01.md', card(task({ allowed_paths })))
    expect((await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])).exitCode).toBe(0)
  })

  it('uses the requested base through HEAD, index and working tree, not only staged files', async () => {
    const base = await gitFixture({ allowed_paths: ['other/**'] })
    await put('server/src/example.ts', 'export const example = 2\n')
    git('add', 'server/src/example.ts')
    git('commit', '--quiet', '-m', 'source change')
    const result = await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toContain('server/src/example.ts')
  })

  it('allows documentation-only changes without manufacturing source changes', async () => {
    const base = await gitFixture({ allowed_paths: ['docs/new-guide.md'], docs_impact: { update: [], reason: '' } })
    await put('docs/new-guide.md', '# A new guide\n')
    const result = await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])
    expect(result.exitCode).toBe(0)
  })

  it('executes the CLI and rejects unknown arguments without writing status', async () => {
    await fixture()
    const source = await readFile(join(root, 'docs/status.md'), 'utf8')
    const script = fileURLToPath(new URL('../../scripts/docs.ts', import.meta.url))
    const tsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url))
    const bad = spawnSync(process.execPath, [tsx, script, 'unknown'], { cwd: root, encoding: 'utf8', windowsHide: true })
    expect(bad.status).toBe(1)
    expect(bad.stdout + bad.stderr).toContain('用法')
    expect(await readFile(join(root, 'docs/status.md'), 'utf8')).toBe(source)
    const good = spawnSync(process.execPath, [tsx, script, 'status'], { cwd: root, encoding: 'utf8', windowsHide: true })
    expect(good.status).toBe(0)
    expect(await readFile(join(root, 'docs/status.md'), 'utf8')).toContain('Work in progress')
  })

  it('rejects missing impact arguments instead of silently running status', async () => {
    await fixture()
    const original = await readFile(join(root, 'docs/status.md'), 'utf8')
    const result = await runDocs(root, ['impact', '--base'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toContain('用法')
    expect(await readFile(join(root, 'docs/status.md'), 'utf8')).toBe(original)
  })

  it('uses normalized scope globs for untracked files and rejects invalid base commits', async () => {
    const base = await gitFixture({ allowed_paths: ['SERVER\\SRC\\**\\*.ts'] })
    await put('server/src/sub/new.ts', 'export const another = 1\n')
    expect((await runDocs(root, ['impact', '--task', 'DOC-01', '--base', base])).exitCode).toBe(0)
    const missing = await runDocs(root, ['impact', '--base', 'deadbee', '--task', 'DOC-01'])
    expect(missing.exitCode).toBe(1)
    expect(missing.messages.join('\n')).toMatch(/Git.*基线/)
  })

  it('flags missing reference definitions while accepting explicit HTML anchors', async () => {
    await fixture()
    await runDocs(root, ['status'])
    await put('README.md', '[missing][unknown]\n[good](docs/guide.md#custom)\n')
    await put('docs/guide.md', '<a id="custom"></a>\n# Guide\n')
    const result = await runDocs(root, ['check'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toContain('unknown')
    expect(result.messages.join('\n')).not.toContain('#custom')
  })

  it('keeps newly generated verification records strict rather than treating all evidence as legacy', async () => {
    await fixture()
    await runDocs(root, ['status'])
    await put('docs/verification/2026-09/run/README.md', '[missing](./gone.png)\n')
    expect((await runDocs(root, ['check'])).exitCode).toBe(1)
  })

  it('rejects malformed JSON metadata without rewriting the status page', async () => {
    await fixture()
    await put('docs/work-items/tasks/DOC-01.md', '# Broken\n```json\n{"id":}\n```\n')
    const source = await readFile(join(root, 'docs/status.md'), 'utf8')
    const result = await runDocs(root, ['status'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toContain('DOC-01.md')
    expect(await readFile(join(root, 'docs/status.md'), 'utf8')).toBe(source)
  })

  it('rejects dependency cycles so a parallel work queue cannot deadlock silently', async () => {
    await fixture({ depends_on: ['DOC-02'] })
    await put('docs/work-items/tasks/DOC-02.md', card(task({ id: 'DOC-02', depends_on: ['DOC-01'] })))
    const result = await runDocs(root, ['check'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toMatch(/依赖环.*DOC-01.*DOC-02/)
  })

  it('keeps archive and evidence navigation indexes strict even beside historical documents', async () => {
    await fixture()
    await runDocs(root, ['status'])
    await put('docs/archive/README.md', '[active navigation](gone.md)\n')
    await put('docs/verification/README.md', '[active evidence index](gone.md)\n')
    const result = await runDocs(root, ['check'])
    expect(result.messages.filter(message => message.startsWith('ERROR'))).toHaveLength(2)
    expect(result.exitCode).toBe(1)
  })

  it('treats test fixtures and shipped assets as runtime inputs, even with text or image extensions', async () => {
    const base = await gitFixture()
    await put('server/test/fixtures/input.txt', 'meaningful test input\n')
    await put('web/src/assets/icon.svg', '<svg/>\n')
    const result = await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toContain('server/test/fixtures/input.txt')
    expect(result.messages.join('\n')).toContain('web/src/assets/icon.svg')
  })

  it('enforces allowed_paths for Markdown, AGENTS and task cards as well as runtime files', async () => {
    const base = await gitFixture()
    await put('docs/outside.md', '# Unauthorized documentation\n')
    await put('AGENTS.md', '# Unauthorized rules\n')
    await put('docs/work-items/tasks/DOC-01.md', card(task({ summary: 'Changed without task-card ownership' })))
    const result = await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])
    expect(result.exitCode).toBe(1)
    const errors = result.messages.filter(message => message.startsWith('ERROR'))
    expect(errors).toHaveLength(3)
    for (const path of ['docs/outside.md', 'AGENTS.md', 'docs/work-items/tasks/DOC-01.md']) {
      expect(errors.some(message => message.includes('allowed_paths') && message.endsWith(path))).toBe(true)
    }
  })

  it('includes staged changes even when the working tree restores the baseline content', async () => {
    const base = await gitFixture({ allowed_paths: ['docs/**'] })
    await put('server/src/example.ts', 'export const example = 2\n')
    git('add', 'server/src/example.ts')
    await put('server/src/example.ts', 'export const example = 1\n')
    expect(git('diff', '--name-only', base)).toBe('')
    const result = await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toMatch(/allowed_paths.*server\/src\/example.ts/)
  })

  it('requires docs impact reasoning for executable scripts inside scripts/docs', async () => {
    const base = await gitFixture({ allowed_paths: ['scripts/docs/**'], docs_impact: { update: [], reason: '' } })
    await put('scripts/docs/new-check.ts', 'export const strict = true\n')
    const result = await runDocs(root, ['impact', '--base', base, '--task', 'DOC-01'])
    expect(result.exitCode).toBe(1)
    expect(result.messages.join('\n')).toMatch(/运行代码.*理由/)
    expect(result.messages.join('\n')).not.toContain('超出 allowed_paths')
  })
})
