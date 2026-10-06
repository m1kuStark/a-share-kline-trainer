# PACK-01 桌面应用形态·选型验证 spike＋Electron 最小原型

```json
{
  "id": "PACK-01",
  "title": "选型验证 spike＋Electron 最小原型（桌面 exe 形态首任务）",
  "owner": "integrator",
  "state": "review",
  "milestone": "PACK",
  "summary": "选型验证完成＋Electron 最小原型交付（工程验证）：选型 Electron 44.5.1＋electron-builder 26.15.3 实证（内置 Node 24.21.0 满足 engines>=24，node:sqlite 在完整主进程实测通过，进程内嵌成立、降级树未触发）；desktop/（主进程 main.ts＋纯函数 desktop-config.ts＋electron-builder.yml＋dev-window/package-desktop/smoke 三脚本）；server/src/index.ts 行为保持重构（startTrainerServer 导出，CLI 语义不变）；package.json 增 main/dev:desktop/build:desktop/test:desktop＋devDeps electron/electron-builder；便携 exe 99.0MB；打包冒烟 SMOKE_PASS（health 200＋currentVersion 1.2.7＋首页＋窗口「K线训练器」＋退出）；npm test 1521/1521；零破坏（scripts/release/web/launcher.cjs diff 空）；矩阵 desktop-app 4 covered/10 open（PACK-02..05 占位）；变异 2 行 executed 击杀。",
  "next_action": "工程验证完成待架构师复核与用户验收：check-binding desktop-app strict exit 3（covered=4/open=10/RED=0，open 为设计内占位与手册行）；updater/launcher-lifecycle 回归 exit 0；6 项 proposed_default/登记项待拍板（默认数据目录 exe 同级 data、appId/productName、窗口标题固定、产物命名、依赖裁剪、矩阵 open 债务——见验证记录 README 第五节）",
  "base_commit": "c298bce",
  "allowed_paths": [
    "desktop/**（新建全部）",
    "package.json＋package-lock.json（scripts＋devDeps）",
    ".gitignore、tsconfig 相关最小新增",
    "server/src/index.ts（仅行为保持可编程启动重构）",
    "server/test/**（相应测试）",
    "docs/verification/2026-10/PACK-01/**",
    "docs/work-items/tasks/PACK-01.md",
    "docs/work-items/milestones/PACK.md",
    "docs/status.md（仅生成器）",
    ".control/trainer-state.json（仅 CLI）",
    "ai-harness-lab/harness-state.jsonl（仅 gate-report）",
    ".zcode/skills/ai-harness/matrix/desktop-app.yaml＋镜像（skill 侧资产）"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/PACK-01.md",
      "docs/work-items/milestones/PACK.md"
    ],
    "reason": "桌面形态首任务；行为矩阵在工作区 harness skill（desktop-app.yaml）＋镜像 ai-harness-lab/skill-v1/matrix/，不入仓库。"
  },
  "verification_refs": [
    "docs/verification/2026-10/PACK-01/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 门禁清单（派发简报冻结）

1. check-binding strict --include-untracked（desktop-app.yaml）
2. 定向新单测（desktop 纯函数：端口/URL/配置解析）＋ server 入口重构后既有测试全绿
3. `npm test` 全量（存量失败逐名）；`npm run build`
4. 打包冒烟：build:desktop 便携 exe→复制到未跟踪临时目录→启动→`/api/health` 200 且 currentVersion 存在→web 首页 HTML 可达→进程退出（超时强杀并记录）
5. 零破坏证明：`git diff --stat origin/main..HEAD` 不含 scripts/release/**、web/**、launcher.cjs
6. 变异抽检 1~2 行（配置解析/URL 组装）
