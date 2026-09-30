import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type TaskStatus = 'planned' | 'active' | 'blocked' | 'review' | 'closed' | 'cancelled' | 'waiting_control' | 'waiting_environment'
export type CandidateStatus = 'prepared' | 'failed' | 'verified' | 'promoted' | 'cleaned'
export type RunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'waiting_control' | 'waiting_environment'
export type ReconcileStatus = 'unknown' | 'clean' | 'drift' | 'waiting_control'

export interface WorkflowTaskState {
  status: TaskStatus
  owner?: string
  updated_at: string
  commit?: string
  summary?: string
}

export interface WorkflowCandidateState {
  task_id: string
  status: CandidateStatus
  updated_at: string
  base_commit?: string
  commit?: string
  tree?: string
  worktree_alias?: string
  artifact_id?: string
}

export interface WorkflowRunState {
  run_id: string
  status: RunStatus
  updated_at: string
  task_id?: string
  attempt_id?: string
  worktree_alias?: string
  commit?: string
  artifact_id?: string
}

export interface WorkflowArtifactState {
  artifact_id: string
  kind: 'package' | 'proof' | 'report' | 'screenshot' | 'other'
  status: 'created' | 'verified' | 'rejected'
  updated_at: string
  commit?: string
  sha256?: string
  path_alias?: string
}

export interface WorkflowAcceptanceState {
  engineering: 'unknown' | 'passed' | 'failed'
  user: 'unknown' | 'accepted' | 'rejected'
  publish: 'unknown' | 'approved' | 'rejected'
}

export interface WorkflowEvent {
  event_id: string
  kind: string
  timestamp: string
  task_id?: string
  attempt_id?: string
  commit?: string
  tree?: string
  worktree_alias?: string
  run_id?: string
  artifact_id?: string
  reason?: string
  payload?: Record<string, string | number | boolean | null>
}

export interface WorkflowState {
  schema_version: 1
  state_revision: number
  project_id: 'a-share-kline-trainer'
  active_task: string | null
  candidate: WorkflowCandidateState | null
  tasks: Record<string, WorkflowTaskState>
  runs: Record<string, WorkflowRunState>
  artifacts: Record<string, WorkflowArtifactState>
  acceptance: WorkflowAcceptanceState
  events: WorkflowEvent[]
  reconcile: { status: ReconcileStatus; checked_at: string | null; reason?: string }
  next_action: string
  updated_at: string
}

const STATE_FILE = 'trainer-state.json'
const LOCK_FILE = 'trainer-state.json.lock'
const TASK_STATUSES = new Set<TaskStatus>(['planned', 'active', 'blocked', 'review', 'closed', 'cancelled', 'waiting_control', 'waiting_environment'])
const CANDIDATE_STATUSES = new Set<CandidateStatus>(['prepared', 'failed', 'verified', 'promoted', 'cleaned'])
const RUN_STATUSES = new Set<RunStatus>(['starting', 'running', 'completed', 'failed', 'waiting_control', 'waiting_environment'])
const RECONCILE_STATUSES = new Set<ReconcileStatus>(['unknown', 'clean', 'drift', 'waiting_control'])

function statePath(controlRoot: string): string {
  return join(controlRoot, STATE_FILE)
}

function lockPath(controlRoot: string): string {
  return join(controlRoot, LOCK_FILE)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRelativeAlias(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}|[\\/])/.test(value)
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
}

function assertWorkflowState(value: unknown): asserts value is WorkflowState {
  if (!isRecord(value)) throw new Error('workflow state must be an object')
  if (value.schema_version !== 1) throw new Error('workflow state schema_version must be 1')
  if (!Number.isSafeInteger(value.state_revision) || (value.state_revision as number) < 0) throw new Error('workflow state state_revision must be a non-negative integer')
  if (value.project_id !== 'a-share-kline-trainer') throw new Error('workflow state project_id is invalid')
  if (!(value.active_task === null || typeof value.active_task === 'string')) throw new Error('workflow state active_task is invalid')
  if (!isRecord(value.tasks) || !isRecord(value.runs) || !isRecord(value.artifacts)) throw new Error('workflow state registries are invalid')
  if (!Array.isArray(value.events)) throw new Error('workflow state events must be an array')
  if (!isRecord(value.acceptance)) throw new Error('workflow state acceptance is invalid')
  for (const key of ['engineering', 'user', 'publish']) {
    if (!['unknown', 'passed', 'failed', 'accepted', 'rejected', 'approved'].includes(String(value.acceptance[key]))) {
      throw new Error(`workflow state acceptance.${key} is invalid`)
    }
  }
  if (!isRecord(value.reconcile) || !RECONCILE_STATUSES.has(value.reconcile.status as ReconcileStatus)) throw new Error('workflow state reconcile is invalid')
  assertString(value.next_action, 'workflow state next_action')
  assertString(value.updated_at, 'workflow state updated_at')

  for (const [taskId, task] of Object.entries(value.tasks)) {
    if (!isRecord(task) || !TASK_STATUSES.has(task.status as TaskStatus)) throw new Error(`workflow task ${taskId} status is invalid`)
    assertString(task.updated_at, `workflow task ${taskId}.updated_at`)
  }
  for (const [runId, run] of Object.entries(value.runs)) {
    if (!isRecord(run) || run.run_id !== runId || !RUN_STATUSES.has(run.status as RunStatus)) throw new Error(`workflow run ${runId} is invalid`)
    assertString(run.updated_at, `workflow run ${runId}.updated_at`)
    if (run.worktree_alias !== undefined && !isRelativeAlias(run.worktree_alias)) throw new Error(`workflow run ${runId}.worktree_alias must be relative`)
  }
  for (const [artifactId, artifact] of Object.entries(value.artifacts)) {
    if (!isRecord(artifact) || artifact.artifact_id !== artifactId || !['package', 'proof', 'report', 'screenshot', 'other'].includes(String(artifact.kind)) || !['created', 'verified', 'rejected'].includes(String(artifact.status))) throw new Error(`workflow artifact ${artifactId} is invalid`)
    assertString(artifact.updated_at, `workflow artifact ${artifactId}.updated_at`)
    if (artifact.path_alias !== undefined && !isRelativeAlias(artifact.path_alias)) throw new Error(`workflow artifact ${artifactId}.path_alias must be relative`)
  }
  const eventIds = new Set<string>()
  for (const event of value.events) {
    if (!isRecord(event)) throw new Error('workflow event is invalid')
    assertString(event.event_id, 'workflow event event_id')
    assertString(event.kind, 'workflow event kind')
    assertString(event.timestamp, `workflow event ${event.event_id}.timestamp`)
    if (eventIds.has(event.event_id)) throw new Error(`workflow event ${event.event_id} is duplicated`)
    eventIds.add(event.event_id)
    if (event.worktree_alias !== undefined && !isRelativeAlias(event.worktree_alias)) throw new Error(`workflow event ${event.event_id}.worktree_alias must be relative`)
  }
}

function initialState(now = new Date().toISOString()): WorkflowState {
  return {
    schema_version: 1,
    state_revision: 0,
    project_id: 'a-share-kline-trainer',
    active_task: null,
    candidate: null,
    tasks: {},
    runs: {},
    artifacts: {},
    acceptance: { engineering: 'unknown', user: 'unknown', publish: 'unknown' },
    events: [],
    reconcile: { status: 'unknown', checked_at: null },
    next_action: '建立首个任务状态',
    updated_at: now,
  }
}

async function withLock<T>(controlRoot: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(controlRoot, { recursive: true })
  let handle
  try {
    handle = await open(lockPath(controlRoot), 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`workflow state is locked: ${lockPath(controlRoot)}`)
    throw error
  }
  try {
    return await operation()
  } finally {
    await handle.close()
    await unlink(lockPath(controlRoot)).catch(() => undefined)
  }
}

async function writeState(controlRoot: string, state: WorkflowState): Promise<void> {
  assertWorkflowState(state)
  const path = statePath(controlRoot)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, path)
}

export async function initializeWorkflowState(controlRoot: string): Promise<WorkflowState> {
  try {
    return await readWorkflowState(controlRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return withLock(controlRoot, async () => {
    try {
      return await readWorkflowState(controlRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const state = initialState()
    await writeState(controlRoot, state)
    return state
  })
}

export async function readWorkflowState(controlRoot: string): Promise<WorkflowState> {
  const parsed: unknown = JSON.parse(await readFile(statePath(controlRoot), 'utf8'))
  assertWorkflowState(parsed)
  return parsed
}

export async function updateWorkflowState(controlRoot: string, mutate: (draft: WorkflowState) => void): Promise<WorkflowState> {
  return withLock(controlRoot, async () => {
    const current = await readWorkflowState(controlRoot)
    const draft = structuredClone(current)
    mutate(draft)
    draft.state_revision = current.state_revision + 1
    draft.updated_at = new Date().toISOString()
    await writeState(controlRoot, draft)
    return draft
  })
}

export function appendWorkflowEvent(state: WorkflowState, event: WorkflowEvent): void {
  const existing = state.events.find(item => item.event_id === event.event_id)
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(event)) throw new Error(`workflow event_id ${event.event_id} already exists with different content`)
    return
  }
  state.events.push(event)
}

export async function recordWorkflowEvent(controlRoot: string, event: WorkflowEvent): Promise<WorkflowEvent> {
  return withLock(controlRoot, async () => {
    const current = await readWorkflowState(controlRoot)
    const existing = current.events.find(item => item.event_id === event.event_id)
    if (existing && JSON.stringify(existing) === JSON.stringify(event)) return existing
    const draft = structuredClone(current)
    appendWorkflowEvent(draft, event)
    draft.state_revision += 1
    draft.updated_at = new Date().toISOString()
    await writeState(controlRoot, draft)
    return event
  })
}

export { assertWorkflowState, statePath }

