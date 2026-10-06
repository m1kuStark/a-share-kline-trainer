# PACK-03 数据与配置兼容（历史数据零丢失防线）

```json
{
  "id": "PACK-03",
  "title": "首启历史数据发现与原地采用（adopt-in-place）＋旧配置沿用＋双形态共存防双写＋零丢失不变量",
  "owner": "integrator",
  "state": "review",
  "milestone": "PACK",
  "summary": "工程验证完成（2026-10-06 接续轮）：首启发现/原地采用（发现→采用/多候选对话框/无候选新建/二次幂等/旧 config 沿用）＋共存防线（launch.lock＋状态记录三应答＋反向记录＋身份复核清理）＋零丢失不变量（哈希前后对照）全交付；desktop 87/87、全量 1515/1516（1 例既有 flaky 单跑全绿）、build/build:desktop/冒烟 SMOKE_PASS(A-G) 全过；矩阵 desktop-app +7 行 covered（RED=0）；server/src、web、scripts/release、launcher.cjs 零改动。Electron/Windows 平台实测四发现＋隔离事故披露见验证记录 §五。",
  "next_action": "用户验收 proposed_default 8 项（含提示形态收敛 console-only、--adopt-child 宿主规避）后转 done",
  "base_commit": "5f74db0",
  "allowed_paths": [
    "desktop/**",
    "server/src/**（仅数据落点判据/共存防线确需的最小改动，优先零改动）",
    "server/test/**（相应）",
    "docs/verification/2026-10/PACK-03/**",
    "docs/work-items/tasks/PACK-03.md",
    "docs/status.md（仅生成器）",
    ".control/trainer-state.json（仅 CLI）",
    "ai-harness-lab/harness-state.jsonl（仅 gate-report）",
    ".zcode/skills/ai-harness/matrix/desktop-app.yaml＋镜像"
  ],
  "depends_on": ["PACK-01", "PACK-02"],
  "docs_impact": {
    "update": ["docs/work-items/tasks/PACK-03.md", "docs/work-items/milestones/PACK.md"],
    "reason": "数据兼容任务；行为矩阵在工作区 harness skill（desktop-app.yaml）＋镜像。"
  },
  "verification_refs": ["docs/verification/2026-10/PACK-03/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 门禁清单（派发简报冻结）

1. check-binding strict --include-untracked（desktop-app.yaml）
2. desktop 定向单测（发现/决策纯函数：候选枚举/库识别判据/采用记录/旧配置解析/共存裁决）先红后绿；集成（临时目录伪造候选布局）
3. `npm test` 全量（存量失败逐名）；`npm run build`
4. `npm run build:desktop`＋冒烟扩展（PACK-02 三阶段回归＋新断言：spawn exe 时 USERPROFILE 指向临时目录＋预置伪造历史库→断言 exe 沿用该库；绝不动真实 `%USERPROFILE%`）
5. 零破坏证明：diff 不含 scripts/release/**、web/**、launcher.cjs；server/src 仅数据落点判据确需时最小改动
6. 变异抽检 2 行（DATA-DISCOVERY-ADOPT、COEXIST-SAME-DATADIR-GUARD）

## 设计决策（架构师 provisional，proposed_default 见收尾报告）

1. **首启数据发现与采用（adopt-in-place，不搬数据）**：未显式配置 dataDir 且无采用记录时按候选序探测 ①exe 同级 `data/` ②`%USERPROFILE%\.a-share-kline-trainer`；发现含训练库的候选→原地采用（不复制不迁移，解析结果持久化记住），窗口/日志提示「已沿用历史数据」；多候选都有库→对话框让用户选（可注入应答供测试）；都没有→维持现默认（exe 同级 data/）。
2. **旧配置沿用**：exe 同级存在 `trainer.config.json` 时沿用其 port/dataDir/tdxRoot/databasePath（launcher resolveConfig 镜像语义；用户把 exe 放进旧 zip 文件夹＝无缝升级场景）。
3. **双形态共存防双写**：zip（launcher）与 exe 可能同时运行。desktop 起服务前查 dataDir 状态记录（trainer-state.json），发现活跃记录先健康探测再决定复用/询问/拒绝，口径与 PORT-02 一致；desktop 自身启动后写入同格式状态记录（launcher decideRecordedServer/probeMatchesState 可识别→反向防双写）。
4. **零丢失证明**：任何路径都不删除/覆盖既有库文件；唯一允许写的场景是新建空白库于全新目录。测试覆盖：发现→采用、多候选→对话框、无候选→新建、二次启动幂等（不再探测）、旧 config 沿用、共存防线。
5. 迁移（复制）路径 v1 不做（adopt-in-place 已消除迁移必要；%APPDATA% 方案留作未来拍板）。
