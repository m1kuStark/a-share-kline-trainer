import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Candidate } from '../worktree/state.js'
import { appendWorkflowEvent, updateWorkflowState, type WorkflowRunState } from './state.js'

/** 将候选元数据投影到工作空间唯一状态文件；绝不写入绝对 worktree 路径。 */
export async function mirrorCandidateState(controlRoot: string, candidate: Pick<Candidate, 'id' | 'taskId' | 'status' | 'baseCommit' | 'commit' | 'tree' | 'branch'> & { path?: string }): Promise<void> {
  const now = new Date().toISOString()
  await updateWorkflowState(controlRoot, state => {
    const projection = {
      candidate_id: candidate.id,
      task_id: candidate.taskId,
      status: candidate.status,
      updated_at: now,
      base_commit: candidate.baseCommit,
      commit: candidate.commit,
      tree: candidate.tree,
      worktree_alias: candidate.branch,
    }
    const previous = state.candidates[candidate.id]
    if (previous && (previous.commit !== projection.commit || previous.tree !== projection.tree || previous.base_commit !== projection.base_commit || previous.task_id !== projection.task_id || previous.worktree_alias !== projection.worktree_alias)) {
      throw new Error(`candidate ${candidate.id} state drift: immutable commit/tree binding changed`)
    }
    if (previous && previous.commit === projection.commit && previous.tree === projection.tree && previous.status === projection.status) return
    state.candidates[candidate.id] = projection
    state.candidate = projection
    const eventId = `candidate:${candidate.id}:${candidate.status}:${candidate.commit}`
    const existing = state.events.find(item => item.event_id === eventId)
    if (existing) return
    appendWorkflowEvent(state, {
      event_id: eventId,
      kind: `candidate.${candidate.status}`,
      timestamp: now,
      task_id: candidate.taskId,
      commit: candidate.commit,
      tree: candidate.tree,
      worktree_alias: candidate.branch,
      reason: 'candidate lifecycle projection',
    })
    state.next_action = candidate.status === 'verified'
      ? `候选 ${candidate.id} 已验证，等待独立审查或晋升`
      : `候选 ${candidate.id} 当前状态为 ${candidate.status}`
  })
}

export type WorkflowRunInput = Omit<WorkflowRunState, 'updated_at'> & { updated_at?: string }

/** Project GLM/controller/DWF lifecycle facts. Completion is execution-only; acceptance stays unknown. */
export async function mirrorRunState(controlRoot: string, run: WorkflowRunInput): Promise<void> {
  const now = run.updated_at ?? new Date().toISOString()
  await updateWorkflowState(controlRoot, state => {
    const key = `${run.source}:${run.run_id}`
    const previous = state.runs[key]
    if (previous && new Date(now).getTime() < new Date(previous.updated_at).getTime()) throw new Error(`stale workflow run ${key} event`)
    if (previous && ['completed', 'failed'].includes(previous.status) && previous.status !== run.status) throw new Error(`workflow run ${key} state drift after terminal status`)
    if (previous && previous.status === run.status && previous.commit === run.commit && previous.tree === run.tree && previous.task_id === run.task_id && previous.attempt_id === run.attempt_id && previous.worktree_alias === run.worktree_alias && previous.exit_code === run.exit_code) return
    state.runs[key] = { ...run, run_id: key, updated_at: now }
    appendWorkflowEvent(state, {
      event_id: `run:${key}:${run.status}:${run.commit ?? 'none'}:${run.tree ?? 'none'}`,
      kind: `run.${run.status}`,
      timestamp: now,
      task_id: run.task_id,
      attempt_id: run.attempt_id,
      commit: run.commit,
      tree: run.tree,
      worktree_alias: run.worktree_alias,
      run_id: key,
      reason: `${run.source} lifecycle projection`,
    })
  })
}

/** 从显式环境或工作空间祖先寻找唯一控制目录；未配置时保持旧夹具/独立仓库兼容。 */
export async function findControlRoot(root: string): Promise<string | null> {
  const configured = process.env.TRAINER_CONTROL_ROOT?.trim()
  if (configured) return resolve(configured)
  let current = resolve(root)
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(current, '.control', 'trainer-state.json')
    try {
      await access(candidate)
      return join(current, '.control')
    } catch {
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return null
}

export async function mirrorCandidateIfConfigured(root: string, candidate: Candidate): Promise<void> {
  const controlRoot = await findControlRoot(root)
  if (controlRoot) await mirrorCandidateState(controlRoot, candidate)
}

