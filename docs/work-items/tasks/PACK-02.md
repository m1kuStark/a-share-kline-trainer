# PACK-02 桌面应用生命周期

```json
{
  "id": "PACK-02",
  "title": "桌面应用生命周期（单实例/优雅退出/端口冲突/外部链接/窗口记忆/安全基线）",
  "owner": "integrator",
  "state": "review",
  "milestone": "PACK",
  "summary": "桌面生命周期工程验证完成：单实例（锁先于一切启动分支＋冒烟双实例断言）；优雅退出复用 SETUP-01 冻结排空（server 句柄新增 drain 字段＋9 行纯增量；in-app 口径 allowActiveTraining:true 训练保留 SQLite）→shutdown→退出，冒烟 CloseMainWindow 自然退出 exit 0＋端口可重绑＋health 拒连；排空超时 15s 默认（env 可覆盖）强制退出如实记录；端口冲突＝PORT-01 镜像自动回退（TRAINER_PORT_FALLBACK 注入）＋PORT-02 三应答（dialog 三选/TRAINER_DESKTOP_CONFLICT_ANSWER 注入；restart 复核 pid 才杀——冒烟假训练器实证接管）；外部链接系统浏览器＋deny 新窗；窗口 bounds 记忆（dataDir/window-state.json、1024×680 最小、工作区 clamp）；安全基线显式锁定。desktop 纯函数层 5 模块 34 新例（TDD RED→GREEN）；npm test 1556/1556；build＋build:desktop exit 0；SMOKE_PASS 53.4s 全断言；零破坏（scripts/release/web/launcher.cjs diff 空）；矩阵 desktop-app covered=12/open=8/RED=0 strict exit 3（open＝设计内占位）；变异 M1/M2 executed 击杀。",
  "next_action": "工程验证完成待架构师复核与用户验收：8 项 proposed_default 待拍板（排空超时 15s/bounds 位置/最小尺寸/菜单形态/非训练器占用一律回退与 launcher 口径差/外部链接 deny 策略/无 preload/对话框文案——见验证记录 README 第五节）；PACK-03/04（electron-updater）/05（NSIS）待派发",
  "base_commit": "cc6289f",
  "allowed_paths": [
    "desktop/**",
    "server/src/**（仅优雅退出/控制接线确需的最小改动，优先零改动）",
    "server/test/**（相应）",
    "docs/verification/2026-10/PACK-02/**",
    "docs/work-items/tasks/PACK-02.md",
    "docs/status.md（仅生成器）",
    ".control/trainer-state.json（仅 CLI）",
    "ai-harness-lab/harness-state.jsonl（仅 gate-report）",
    ".zcode/skills/ai-harness/matrix/desktop-app.yaml＋镜像"
  ],
  "depends_on": ["PACK-01"],
  "docs_impact": {
    "update": ["docs/work-items/tasks/PACK-02.md", "docs/work-items/milestones/PACK.md"],
    "reason": "生命周期任务；行为矩阵在工作区 harness skill（desktop-app.yaml）＋镜像。"
  },
  "verification_refs": ["docs/verification/2026-10/PACK-02/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 门禁清单（派发简报冻结）

1. check-binding strict --include-untracked（desktop-app.yaml）
2. desktop 定向单测（生命周期纯函数层：端口决策/冲突应答映射/退出状态机/bounds 序列化）先红后绿
3. `npm test` 全量（存量失败逐名）；`npm run build`
4. `npm run build:desktop`＋冒烟扩展（smoke-desktop.mjs 增断言：第二实例启动即退＋首实例存活；正常退出后进程消失＋端口释放；冲突应答注入路径至少冒烟 restart 或 reuse 之一——用假训练器服务器占用随机端口）
5. 零破坏证明：diff 不含 scripts/release/**、web/**、launcher.cjs；server/src 仅在确需接线处最小改动且全量测试为证
6. 变异抽检 2 行（GRACEFUL-QUIT-DRAIN、PORT-CONFLICT-TRAINER-ASK）

## 设计决策（架构师 provisional，proposed_default 见收尾报告）

1. 单实例：`app.requestSingleInstanceLock()`；矩阵行 DESKTOP-SINGLE-INSTANCE
2. 优雅退出：窗口 close→有活动训练则走服务端既有冻结/排空语义（复用 SETUP-01 控制端点/函数）→server close→app 退出；退出后无孤儿进程、端口释放（冒烟可断言）；排空超时（默认 15s）后确认退出并如实记录
3. 端口冲突：占用者非训练器→PORT-01 自动换端口；占用者是训练器→Electron 原生 dialog 三选（reuse/restart/cancel），应答可注入 env `TRAINER_DESKTOP_CONFLICT_ANSWER`
4. 外部链接：setWindowOpenHandler＋shell.openExternal 系统默认浏览器
5. 窗口行为：记忆位置/尺寸到数据目录配置文件；最小尺寸 1024×680；菜单保守默认
6. 安全基线：contextIsolation 开、nodeIntegration 关、webSecurity 不放低
