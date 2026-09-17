import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { commonDirectory } from './git.js'

export interface Candidate {
  schemaVersion: 1
  id: string
  taskId: string
  sourceRef: string
  sourceCommit: string
  targetRef: string
  baseCommit: string
  branch: string
  path: string
  commit: string
  tree: string
  status: 'prepared' | 'failed' | 'verified' | 'promoted' | 'cleaned'
  createdAt: string
  failure?: string
}
export const stateDirectory = (root: string) => join(commonDirectory(root), 'trainer-integration')
function statePath(root: string, id: string): string {
  if (!/^[A-Z][A-Z0-9-]*-[a-f0-9]{12}$/.test(id)) throw new Error(`Invalid candidate ID: ${id}`)
  return join(stateDirectory(root), 'candidates', `${id}.json`)
}
export async function saveCandidate(root: string, candidate: Candidate): Promise<void> {
  const path = statePath(root, candidate.id)
  await mkdir(join(stateDirectory(root), 'candidates'), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(candidate, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, path)
}
export async function readCandidate(root: string, id: string): Promise<Candidate> {
  const candidate = JSON.parse(await readFile(statePath(root, id), 'utf8')) as Candidate
  if (candidate.schemaVersion !== 1 || candidate.id !== id || !/^[A-Z][A-Z0-9-]*$/.test(candidate.taskId) || !id.startsWith(`${candidate.taskId}-`) || candidate.branch !== `integration/${id}` || typeof candidate.path !== 'string' || !isAbsolute(candidate.path) || ![candidate.sourceRef, candidate.targetRef].every(ref => typeof ref === 'string' && ref.startsWith('refs/heads/')) || ![candidate.commit, candidate.tree, candidate.baseCommit, candidate.sourceCommit].every(sha => typeof sha === 'string' && /^[a-f0-9]{40,64}$/.test(sha)) || !['prepared', 'failed', 'verified', 'promoted', 'cleaned'].includes(candidate.status)) throw new Error(`Invalid candidate metadata: ${id}`)
  return candidate
}
export async function candidates(root: string): Promise<Candidate[]> {
  let files: string[]
  try { files = await readdir(join(stateDirectory(root), 'candidates')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  return Promise.all(files.filter(file => file.endsWith('.json')).sort().map(file => readCandidate(root, file.slice(0, -5))))
}
