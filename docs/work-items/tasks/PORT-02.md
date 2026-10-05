# PORT-02 训练器启动/关闭进程治理重构

```json
{
  "id": "PORT-02",
  "title": "训练器启动/关闭进程治理重构",
  "owner": "zcode:PORT-02-dev",
  "state": "review",
  "milestone": "M5",
  "summary": "用户 2026-10-06 指令（本任务唯一行为 oracle）：①Start 运行时发现冲突进程（占用目标端口的训练器）改为弹框询问——确认→从已有进程启动（打开已有服务 URL，不开新进程）；拒绝→清理该进程后从新进程启动。②Stop 不再判断是否从当前安装包启动，直接关闭所有训练器进程（身份仍按 isTrainerHealth 验证，不明进程依旧不杀）。根除背景缺陷：朋友机器孤儿训练器进程占用 8787 不在本包 state 记录中，Start 拒绝启动、Stop 管不掉。",
  "next_action": "矩阵先行（launcher-lifecycle.yaml，EARS 行）→ RED（launcher-lifecycle.test.mjs，假训练器服务器＋随机端口＋--conflict-answer 注入，不碰 8787）→ GREEN（launcher.cjs/Start.cmd/Stop.cmd 最小实现）→ 门禁（check-binding --strict＋新测试逐条＋npm test 全量＋变异推演）→ 验证记录＋提交。",
  "allowed_paths": [
    "scripts/release/launcher.cjs",
    "scripts/release/Start.cmd",
    "scripts/release/Stop.cmd",
    "scripts/release/launcher-lifecycle.test.mjs",
    "docs/work-items/tasks/PORT-02.md",
    "docs/work-items/milestones/M5.md",
    "docs/verification/2026-10/PORT-02/**",
    "docs/status.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/verification/2026-10/PORT-02/README.md"
    ],
    "reason": "行为变更（用户拍板取代旧'训练器占用一律拒绝'与'仅杀本包记录 PID'语义）须留验证证据。"
  },
  "verification_refs": [
    "docs/verification/2026-10/PORT-02/README.md"
  ],
  "integration_ref": "主仓库 main 直接开发（base aa000aa）；矩阵＝skill launcher-lifecycle.yaml（8 行全 covered，镜像 ai-harness-lab/skill-v1）；测试＝scripts/release/launcher-lifecycle.test.mjs（node:test 15/15）＋既有 vitest 全量 113 文件/1454 用例无回归",
  "acceptance_ref": null
}
```

## 背景（已核实）

- 发布包启动链：`Start.cmd`→`runtime\node.exe launcher.cjs`；`Stop.cmd`→`launcher.cjs --stop`。cmd 文件刻意 ASCII-only。
- `launcher.cjs` 的 `isTrainerHealth`（GET /api/health 返回 200 且 status==='ok' && runId 为 string && pid 为 integer）是训练器身份唯一口径。
- 旧语义（本任务取代）：端口冲突时"占用者是训练器则一律拒绝启动"；Stop 只杀本包 `data/trainer-state.json` 记录的健康验证通过的 PID。
- 旧语义根除的缺陷：孤儿训练器进程（不在本包 state 记录）占 8787 → Start 拒绝、Stop 管不掉。

## 用户 2026-10-06 指令（唯一行为 oracle）

1. **Start**：发现冲突进程（占用目标端口的训练器）→ 弹出选项框"是否从已有进程启动训练器？"——确认 → 直接启动（连接/打开已有服务，不开新进程）；不同意 → 清理该进程，然后从新进程启动。
2. **Stop**：不再判断已有训练器进程是否从当前安装包启动，直接将所有训练器进程关闭（身份仍须 isTrainerHealth 验证，不明进程依旧不杀）。

## 状态轨迹

- 2026-10-06 开卡（active，zcode:PORT-02-dev）。
- 2026-10-06 实现轮收口（review）：矩阵 8 行全 covered（launcher-lifecycle.yaml）；RED 12 红/3 不变语义锁→GREEN 15/15（node --test scripts/release/launcher-lifecycle.test.mjs）；既有 vitest 52/52（release-launcher）＋全量 113 文件/1454 用例全绿；变异抽检 paper_only 双行有杀手。已知门禁限制：check-binding v2 索引目录（server/test+e2e）不含 scripts/release，15 refs 判悬空＝检查器能力缺口（同款正则直解全部命中，见验证记录"绑定门禁"节），修复路径待拍板。
