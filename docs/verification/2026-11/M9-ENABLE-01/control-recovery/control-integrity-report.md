# 真实 workflow 控制状态污染核对

2026-11-18 只读核对。未修改真实 .control、任何仓库或矩阵，未运行测试/构建/产品，也未读取个人 DB、交易记录或凭据。本目录保存了稳定观察快照、比较证据与未执行的清理计划。

## 结论与范围

真实 D:/Superlinear_Academy/Stock_WorkSpace/.control/trainer-state.json 确有测试夹具写入。观察时为 revision 233，文件 86,046 bytes，SHA256 `5e0ca4f38a35ba5e4d4b3f50055edd95a39d103ed1a866408e794331a8413fc6`；读取前后哈希未变，缓存 trainer-state.observed.json 与其一致。

- candidates 共 44 个，其中新增夹具 33 个：TASK-01 25 个、DOCS-01 8 个。
- events 共 91 条，其中新增夹具候选生命周期事件 75 条。
- 当前 candidate 指向 `TASK-01-4779497bfe30`，状态 promoted，是测试候选，不能作为真实集成/验收事实。
- 夹具还曾改写 next_action，并推动 state_revision/updated_at；18:48:51Z 的真实任务更新已重新写入正确的 active_task=M9-EMA-WARMUP-01 与 next_action，必须保留。
- 原 11 个真实候选、原 16 条事件逐条不变；runs、artifacts、acceptance、reconcile 与干净备份完全一致。没有 TASK-01/DOCS-01 任务记录被插入 tasks。历史 acceptance=accepted/publish=approved 未被本次夹具改变，也不构成 M9 用户验收。

直接污染写入点是这个控制 JSON。worktree 测试的 Git 仓库、候选元数据和 docs 输出路径均由临时 root 派生；workflow-docs 从真实 control 错读状态，但向自己的临时 docs/status.md 写入。没有发现该调用链会操作真实产品数据或真实主仓 Git 分支。此判断基于相关源码及快照差异，不是全磁盘取证。

## 根因及时间证据

EMA 树 scripts/workflow/bridge.ts:74-95 的 findControlRoot 优先采用 `process.env.TRAINER_CONTROL_ROOT`，不要求该目录属于传入 root；saveCandidate 在 scripts/worktree/state.ts:27-34 保存临时候选后无条件调用镜像。mirrorCandidateState（bridge.ts:7-43）更新 candidates、candidate、追加事件并改写 next_action；updateWorkflowState（state.ts:245-254）增加 revision 和 updated_at。

server/test/worktree-tools.test.ts:78-171 创建 tmpdir 下的 sandbox，但没有清除/隔离继承的 TRAINER_CONTROL_ROOT。它调用 TASK-01/DOCS-01 prepare/verify/promote，因此临时 Git 工作正常，镜像却写进真实控制目录。workflow-docs.test.ts:15-48 自建临时 .control，但 updateStatus 又通过全局环境优先读真实控制目录，解释了三项断言失败。

| UTC 时间 | 证据 |
| --- | --- |
| 2026-11-17 14:52:47.362 | 干净备份 revision 151：11 个候选、16 条事件，无夹具 |
| 16:48:12.543—16:50:34.711 | 第一批 9 个夹具候选、20 条事件；比 EMA retry1 更早，精确执行来源尚未单独证实 |
| 18:26:32.721 | EMA workflow-state.json 的 npm 前缀后 JSON 是 revision 177，已含上述 9/20 |
| 18:26:43.813—18:32:51.279 | full-test-retry1 明确继承真实 TRAINER_CONTROL_ROOT；期间新增 24 个候选、55 条事件，退出 1，workflow-docs 三项失败 |
| 18:36:22.793—18:42:26.987 | full-test-isolated-control 记录该环境为 null，退出 0；之后没有新增夹具事件 |
| 18:48:51.415 | 真实任务更新为 revision 233；post-retry control-review 输出内 JSON 与当前状态一致 |

UTC 时间加 8 小时为本地 Asia/Shanghai 时间。第一批写入发生于本地 11 月 18 日 00:48—00:50，EMA retry1 对应 02:26—02:32。

EMA 两个名为 .json 的 workflow-state/control-review 文件实际带 npm 文本前缀，必须提取后面的完整 JSON 对象解析；不能把解析失败后的旧变量当作状态。

## 可恢复证据

首选干净备份：`C:/Users/Stark_Du666/.codex/headroom-cache/nagi-skills-20261117/trainer-state-before.json`，revision 151，SHA256 `852b610a8d3653a12c8cfdb9f66d5fe7fbcef9e09845b44d4cace245e7a868b4`。

更早备份在 trainer-health-20261117-root/trainer-state-before.json（revision 148）。真实 .control/backup 目前仅有 Git bundle；state.ts:207-213 采用临时文件原子 rename，不自动保留旧 JSON。可恢复性依赖上述独立缓存快照，而不是 Git bundle。

原 candidate 指针应恢复为 `v1.2.7-20261004-published`。它在干净备份中的整个对象与当前 candidates 同名真实条目完全相等，commit=`bbd368b09a463183364861678db83a9ae86b1472`、tree=`1d3c214ac6ec6e01ba0b12b34a513fe8982b69e5`、worktree_alias=`main-checkout`。这只是恢复污染前已知指针，不代表 M9 已接受或发布。

不能整体覆盖干净备份。之后有五个真实任务更新：DEP-SEC-MINIMATCH-01、RUNTIME-CANCEL-02、ENG-PLAN-01、M9-ENABLE-01、M9-EMA-WARMUP-01；当前 tasks、active_task、next_action 需原样保存。

## 最小恢复方案（未执行）

先阻止带真实 TRAINER_CONTROL_ROOT 的测试继续运行，保留现状态及计划哈希。control-cleanup-plan.json 给出精确 33 个候选 ID、75 个事件 ID，以及各完整记录的 SHA256(JSON.stringify(record)) 签名；禁止按 TASK-01/DOCS-01 名称宽泛删除。观察快照保留了每条原始记录，清理应另附恢复事件以解释隔离原因。

计划已最终冻结。签名算法使用 Node crypto SHA256，输入为 JSON.parse 后对象按原属性顺序执行 JSON.stringify 的 UTF-8 文本，未排序 key。expectedCanonicalStateSha256 的字段名虽含 canonical，实际也采用同一原顺序算法；该值为 `2764da9f99091467dcd29b5a1e05ed36d3ca279b747fbcd2a353d34b43daeaa2`。

使用已有 updateWorkflowState API，其内部锁覆盖读取、同步 mutate、schema 检查、revision 加一和原子写入。mutate 内核对整个逻辑状态哈希，避免检查后又被其他写入者改变。下面仅示范安全写法，未执行；root 应从最终源码树导入 API，并在自己的恢复工具中核对计划文件身份。

```javascript
// plan = JSON.parse(readFileSync(cachePlanPath, 'utf8'))
// imports: assert, createHash, updateWorkflowState, appendWorkflowEvent
const digest = value => createHash('sha256')
  .update(JSON.stringify(value)).digest('hex')
await updateWorkflowState(plan.controlRoot, state => {
  assert.equal(state.state_revision, plan.expectedRevision) // 当前预期 233
  assert.equal(digest(state), plan.expectedCanonicalStateSha256)
  assert.equal(digest(state.candidate), plan.expectedCandidatePointerSha256)
  const preserved = new Map(plan.preserveExactly.map(key =>
    [key, JSON.stringify(state[key])]))
  for (const entry of plan.removeCandidates)
    assert.equal(digest(state.candidates[entry.id]), entry.signatureSha256)
  for (const entry of plan.removeEvents) {
    const found = state.events.filter(event => event.event_id === entry.event_id)
    assert.equal(found.length, 1)
    assert.equal(digest(found[0]), entry.signatureSha256)
  }
  assert.deepEqual(state.candidates[plan.restoreCandidate.candidate_id],
    plan.restoreCandidate)
  for (const entry of plan.removeCandidates) delete state.candidates[entry.id]
  const removedEvents = new Set(plan.removeEvents.map(entry => entry.event_id))
  state.events = state.events.filter(event => !removedEvents.has(event.event_id))
  state.candidate = structuredClone(plan.restoreCandidate)
  appendWorkflowEvent(state, {
    event_id: 'control-fixture-contamination-20261118-rev233',
    kind: 'state.integrity.recovered', timestamp: new Date().toISOString(),
    reason: 'Quarantined exact workflow test fixture projections; original state and signatures preserved in cache.',
    payload: { candidate_count: 33, event_count: 75,
      contaminated_sha256: plan.expectedSourceSha256,
      clean_backup_sha256: plan.restoreCandidateEvidence.backupSha256 },
  })
  for (const [key, text] of preserved) assert.equal(JSON.stringify(state[key]), text)
})
```

不要手工减小 revision 或自行设置 updated_at；API 应产生 revision 234（若状态仍为观察版本），候选 11 个、事件 17 条（原 16 条＋恢复事件）。若哈希或 revision 已变化，停止使用旧计划，重新核对后生成新计划；不能绕过前置比较。

写入后重新只读核对全部保留字段、11 个真实候选、16 条原事件、恢复事件及文件哈希；之后再运行 docs:status 对账。测试隔离修复宜放在测试边界：worktree 测试为每个 sandbox 显式使用独立 control，workflow-docs 清除继承值以使用其本地 fixture；正常产品镜像逻辑不需要为这次测试污染改语义。

本报告没有执行恢复，control-cleanup-plan.json 的 recoveryWritePerformed=false。
