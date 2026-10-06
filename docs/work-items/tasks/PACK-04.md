# PACK-04 更新通道整合（electron-updater 对接 GitHub Releases）

```json
{
  "id": "PACK-04",
  "title": "桌面更新通道整合：packaged→electron-updater（GitHub provider，latest.yml），dev/源码→既有 UPD HTTP 端点不变；最小 IPC（preload 窄接口）；安装前先排空活动训练",
  "owner": "integrator",
  "state": "review",
  "milestone": "PACK",
  "summary": "工程验证完成（2026-10-05）：双通道更新交付——packaged→electron-updater 6.8.10（GitHub provider，feed 可经 env TRAINER_DESKTOP_UPDATE_FEED 注入；check 视图与 UPD HTTP 同形且 updateAvailable 复用 server version.ts compareVersions 单一口径），dev/源码/纯浏览器→既有 UPD HTTP 端点零变化（e2e 3/3 回归为证）。最小 IPC（preload.cts CJS 沙箱形态，desktopUpdates 四成员窄接口，contextIsolation/sandbox 不变）；安装必经排空退出管线（downloaded→drain.prepare(allowActiveTraining:true)→shutdown→exit 分支 resolveInstallActionOnExit→quitAndInstall(true,true)；forced 路径绝不安装）。desktop 102/102（含真实 NsisUpdater＋本地 fixture HTTP 集成 3 例，零 api.github.com）＋全量 1524/102＋build/build:desktop 过＋冒烟 SMOKE_PASS 161.5s（A-H，阶段 H：packaged exe 经 fixture feed 真实检出 v9.9.9）；矩阵 updater.yaml 22/22 covered（6 新行，变异 2 行 executed 击杀）、desktop-app 19 covered/8 open 设计内；禁改区（scripts/release/launcher.cjs/server/src）diff 空；package.json 仅新增 electron-updater。三平台实证：autoUpdater getter 导出须走 CJS default 通道、--publish never 不产 app-update.yml（extraResources 回退＋构建后核验）、sandboxed preload 须 CJS。",
  "next_action": "用户验收 proposed_default 10 项（含手动检查不自动/安装前排空/feed 注入口/boot check 缝/新文案/desktop 不挡活动训练/app-update.yml 入包方式/无签名 fail-open 等，见验证记录 README 与 design §八）后转 done；真实更新全流程待 PACK-05 发布资产＋真机验收",
  "base_commit": "091cf98",
  "allowed_paths": [
    "desktop/**（含新增 preload）",
    "web/src/updateFlow.ts",
    "web/src/components/TrainingSettings.vue（仅通道探测与事件接线，既有三态 UI/文案不动）",
    "web/e2e 相应测试（如 frontend-contract / updater-ui）",
    "server/test/**（相应 web/契约测试）",
    "docs/verification/2026-10/PACK-04/**",
    "docs/work-items/tasks/PACK-04.md",
    "docs/status.md（仅生成器）",
    ".control/trainer-state.json（仅 CLI）",
    "ai-harness-lab/harness-state.jsonl（仅 gate-report）",
    ".zcode/skills/ai-harness/matrix/updater.yaml＋镜像（追加行）",
    ".zcode/skills/ai-harness/matrix/desktop-app.yaml＋镜像（如需行调整）"
  ],
  "depends_on": ["PACK-01", "PACK-02", "PACK-03", "UPD-01", "UPD-02"],
  "docs_impact": {
    "update": ["docs/work-items/tasks/PACK-04.md", "docs/work-items/milestones/PACK.md"],
    "reason": "更新通道整合任务；行为矩阵在工作区 harness skill（updater.yaml desktop 行＋desktop-app.yaml）。"
  },
  "verification_refs": ["docs/verification/2026-10/PACK-04/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 门禁清单（派发简报冻结）

1. 开卡即 gate-report 登记；check-binding strict --include-untracked（updater.yaml＋desktop-app.yaml 都要过）。
2. 主进程更新决策纯函数＋IPC 载荷层 vitest 先红后绿；渲染端通道探测/文案映射纯函数（web/src/updateFlow.ts 扩展，不碰组件既有行为）；electron-updater 集成路径＝注入 feed 的本地 fixture 单测（不装真更新、零 api.github.com）。
3. `npm test` 全量（存量失败逐名）；`npm run build`（含 typecheck:web）；`npm run build:desktop`。
4. 冒烟回归：PACK-02/03 阶段全过＋packaged 模式下 IPC 探测到的通道正确。
5. 零破坏证明：diff 不含 scripts/release/**、launcher.cjs、server/src/update/** 既有行为（允许 import version.ts 只读）；package.json 依赖变更仅允许新增 electron-updater（报告列明）。
6. 变异抽检 2 行（UPD-DESKTOP-CHANNEL-PACKAGED、UPD-DESKTOP-INSTALL-DRAINS-FIRST）。

## 冻结约束（派发简报）

- 双通道：packaged→electron-updater；dev/源码→既有 UPD HTTP 端点不变（UPD-01/02 既有 16 行矩阵不得降级）。
- 最小 IPC：preload 只暴露更新相关窄接口，contextIsolation 保持开。
- 手动检查（不自动检查，proposed_default）；下载失败可重试。
- 版本比较复用 server/src/update/version.ts 口径（不得两套口径）。
- 真实 GitHub 更新全流程留真机验收（发布下一版本后才能真走通，与 UPD-01 同理）；electron-updater 在无签名 Windows 上的行为差异写进验证记录供验收参考。
- 8787 可能被真实服务占用；真实 `%USERPROFILE%` 数据绝不触碰（spawn 前断言重定向解析结果位于临时目录，fail-closed）。
