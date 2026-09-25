import { createHash } from 'node:crypto'
import { lstatSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.js'

/** Controlled policy identity; consumer and producer must agree on this exact value. */
export const REVIEW_POLICY_VERSION = 'candidate-review-policy/1'
export type ReviewProfileName = 'docs-only' | 'full'
export type VisualRequirement = 'required' | 'not_applicable'

export interface ChangeSetEntry { path: string; status: string; sourceMode: string; targetMode: string }
export interface ChangeSet { entries: ChangeSetEntry[]; fingerprint: string }
export interface ReviewClassification {
  policyVersion: string
  profile: ReviewProfileName
  reason: string
  visual: VisualRequirement
  changeSet: ChangeSet
}

const CONTROL_DOC_DIRECTORIES = ['docs/engineering/', 'docs/specs/', 'docs/architecture/']
const PLAIN_FILE_MODE = '100644'

/** Docs-only candidates must consist entirely of plain, non-executable Markdown
 * under docs/ or the root README/CONTRIBUTING, never control documentation. */
export function isDocsCandidatePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  if (normalized === 'README.md' || normalized === 'CONTRIBUTING.md') return true
  const lower = normalized.toLowerCase()
  const base = lower.slice(lower.lastIndexOf('/') + 1)
  if (base === 'agents.md' || base === 'claude.md') return false
  if (!normalized.startsWith('docs/') || !normalized.endsWith('.md')) return false
  return !CONTROL_DOC_DIRECTORIES.some(directory => lower.startsWith(directory))
}

function parseRawDiff(output: string): ChangeSetEntry[] {
  const tokens = output.split('\0')
  const entries: ChangeSetEntry[] = []
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const meta = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z]+)$/.exec(tokens[index])
    if (!meta || !tokens[index + 1]) throw new Error(`Unrecognized git diff --raw entry: ${tokens[index]}`)
    entries.push({ sourceMode: meta[1], targetMode: meta[2], status: meta[3], path: tokens[index + 1] })
  }
  return entries
}

function fingerprintChangeSet(entries: ChangeSetEntry[]): string {
  const canonical = [...entries]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map(entry => `${entry.status} ${entry.sourceMode} ${entry.targetMode} ${entry.path}`)
    .join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/** Index flags that hide worktree state (skip-worktree, assume-unchanged) so that
 * a clean `git status` no longer proves the checkout matches the candidate tree. */
function hiddenIndexFlags(worktreePath: string): number {
  return git(worktreePath, 'ls-files', '-v').split('\n')
    .filter(line => {
      const tag = line.charAt(0)
      return line.length > 1 && (tag === 'S' || (tag >= 'a' && tag <= 'z'))
    }).length
}

/** Live worktree parent chains of changed paths must resolve through real
 * directories: a symlink or junction anywhere on the chain lets a clean
 * `git status` describe files that physically live outside the candidate.
 * Deleted files are validated from the committed tree, so a missing component
 * is tolerated. Returns the first offending chain prefix, or null. */
function liveLinkOnChain(worktreePath: string, path: string): string | null {
  const segments = path.replaceAll('\\', '/').split('/')
  let current = worktreePath
  const rootEntry = lstatSync(current, { throwIfNoEntry: false })
  if (!rootEntry) return null
  if (rootEntry.isSymbolicLink()) return '.'
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index])
    let entry: Stats
    try { entry = lstatSync(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    if (entry.isSymbolicLink()) return segments.slice(0, index + 1).join('/')
  }
  return null
}

/** Classify the committed base..head change set. Anything not provably plain
 * documentation — including empty, mixed, unknown-origin or flag-hidden sets —
 * is conservatively classified full and keeps the complete gate. */
export function classifyReview(root: string, base: string, head: string, options: { worktreePath?: string } = {}): ReviewClassification {
  const entries = parseRawDiff(git(root, 'diff', '--raw', '-z', '--no-renames', base, head, '--'))
  const changeSet: ChangeSet = { entries, fingerprint: fingerprintChangeSet(entries) }
  const full = (reason: string): ReviewClassification =>
    ({ policyVersion: REVIEW_POLICY_VERSION, profile: 'full', reason, visual: 'required', changeSet })
  if (!entries.length) return full('change set is empty')
  for (const entry of entries) {
    if (!['A', 'M', 'D'].includes(entry.status)) return full(`change type ${entry.status} is not eligible for docs-only review: ${entry.path}`)
    if ((entry.sourceMode !== PLAIN_FILE_MODE && entry.sourceMode !== '000000') || (entry.targetMode !== PLAIN_FILE_MODE && entry.targetMode !== '000000')) {
      return full(`file mode is not a plain non-executable file (${PLAIN_FILE_MODE} only): ${entry.path}`)
    }
    if (!isDocsCandidatePath(entry.path)) return full(`path is not eligible plain Markdown: ${entry.path}`)
  }
  if (options.worktreePath) {
    const flagged = hiddenIndexFlags(options.worktreePath)
    if (flagged) return full(`${flagged} tracked file(s) carry hidden index flags (skip-worktree or assume-unchanged)`)
    const linked = new Set<string>()
    for (const path of entries.map(entry => entry.path)) {
      const link = liveLinkOnChain(options.worktreePath, path)
      if (link) linked.add(link)
    }
    if (linked.size) return full(`changed path(s) resolve through a symlink or junction in the live worktree: ${[...linked].sort().join(', ')}`)
  }
  return {
    policyVersion: REVIEW_POLICY_VERSION, profile: 'docs-only',
    reason: 'every committed change is plain non-executable Markdown under docs/ or the root README/CONTRIBUTING',
    visual: 'not_applicable', changeSet,
  }
}
