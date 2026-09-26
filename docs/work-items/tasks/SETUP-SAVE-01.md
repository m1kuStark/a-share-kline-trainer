# SETUP-SAVE-01 已诊断候选的原子保存与来源解析

```json
{
  "id": "SETUP-SAVE-01",
  "title": "SETUP-01 第四片：已诊断候选的原子保存与来源解析",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "summary": "saved-choice.ts：saveTdxChoice 保存前 inspectTdxCandidate 复验（recognized+readable 才允许，dailyFileCount=0 可保存；失败/抛错保留旧文件并抛可行动错误）；路径固定 dataDir/saved-tdx-choice.json，同目录随机临时文件（wx）+ rename 原子替换；格式 version=1/root(规范化 check.root)/savedAt/inspectedAt（同一 now ISO）；readSavedTdxChoice 对不存在/损坏/版本错误/空 root/非 ISO 时间返回 null。resolveEffectiveTdxRoot 冻结优先级 env→explicit-config→saved-choice→auto-discovered，空白视为缺失。测试 10/10（临时目录+注入 inspect/clock），零真实 TDX/配置读取。",
  "next_action": "GPT 定向复核；后续重启编排切片（SIGTERM 优雅重启/活动训练拒切源）另片冻结。",
  "allowed_paths": [
    "server/src/setup/saved-choice.ts",
    "server/test/setup-saved-choice.test.ts",
    "docs/work-items/tasks/SETUP-SAVE-01.md"
  ],
  "depends_on": ["SETUP-CLUES-01"],
  "base_commit": "9890eed9f596dede37f44f82d27ca1c7f24acfb5",
  "docs_impact": {
    "reason": "SETUP-SAVE-01 冻结合同授权的三文件切片；纯保存与来源解析，不接 launcher/Fastify/UI/重启/活动训练。",
    "update": ["docs/work-items/tasks/SETUP-SAVE-01.md"]
  },
  "verification_refs": ["server/test/setup-saved-choice.test.ts"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结接口（SETUP-SAVE-01-contract.md）

- `saveTdxChoice(dataDir, root, inspect?, now?)`：先 `inspectTdxCandidate(root)` 复验，recognized+readable 才保存；保存的 root 使用检查结果的规范化 check.root；savedAt/inspectedAt 用同一 `now().toISOString()`；版本固定 1。
- 保存路径 `dataDir/saved-tdx-choice.json`：先确保 dataDir 存在，随机临时文件（同目录、wx、UTF-8 JSON newline）+ rename 原子替换；任何失败不得删除或截断既有目标。
- `readSavedTdxChoice`：不存在/JSON 损坏/版本不为 1/root 空/时间非 ISO → null，不抛出。
- `resolveEffectiveTdxRoot`：env → explicit-config → saved-choice → auto-discovered；空白视为缺失；不读文件、不检查路径、不改变输入。

## 门禁

- setup-saved-choice 10/10；相邻 process-clues/inspect 测试；build:server；docs:check（日志见 attempt-glm-coord-01/logs/）。
