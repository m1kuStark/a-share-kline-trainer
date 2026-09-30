import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Candidate } from '../worktree/state.js'
import { appendWorkflowEvent, updateWorkflowState } from './state.js'

/** 将候选元数据投影到工作空间唯一状态文件；绝不写入绝对 worktree 路径。 */
export async function mirrorCandidateState(controlRoot: string, candidate: Pick<Candidate, 'id' | 'taskId' | 'status' | 'baseCommit' | 'commit' | 'tree' | 'branch'> & { path?: string }): Promise<void> {
  const now = new Date().toISOString()
  await updateWorkflowState(controlRoot, state => {
    state.candidate = {
      task_id: candidate.taskId,
      status: candidate.status,
      updated_at: now,
      base_commit: candidate.baseCommit,
      commit: candidate.commit,
      tree: candidate.tree,
      worktree_alias: candidate.branch,
    }
    appendWorkflowEvent(state, {
      event_id: `candidate:${candidate.id}:${candidate.status}:${candidate.commit}`,
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

