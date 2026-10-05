# UPD-02 在线版本更新·设置页 UI 与 e2e

```json
{
  "id": "UPD-02",
  "title": "在线版本更新·设置页 UI 与 e2e（关于与更新分栏：检查更新三态、apply 守卫人话、状态机轮询＋断线重连）",
  "owner": "zcode:UPD-02-dev",
  "state": "review",
  "milestone": "UPD",
  "summary": "消费 UPD-01 服务端契约（提交 098c442；契约全文＝docs/verification/2026-10/UPD-01/design.md §2）：设置面板新增「关于与更新」分栏（跟随 M6-07 动画分栏先例）——当前版本号（/api/health currentVersion）＋「检查更新」按钮；结果三态（有新版＝新版本号＋release notes 可折叠＋「下载并更新」／已是最新／检查失败＝error 人话＋可重试）；apply 流程＝确认提示（将自动重启）→POST /api/update/apply→202 轮询 /api/update/status 呈现状态机（下载进度→校验→备份→安装→重启中）→断线窗口按「正在重启，等待服务回来…」呈现并 2s×15 退避重连→恢复后 completed 以 health.currentVersion 显示已更新到 vX.Y.Z／failed 显示原因＋重试入口；守卫消息人话映射（UPDATE_NOT_PACKAGED／UPDATE_IN_PROGRESS／ACTIVE_TRAINING／UPDATE_NOT_AVAILABLE）。文案中文字面量（仓库无 i18n 惯例），全部列入拍板清单。前端纯逻辑（状态文案表、守卫映射、重连退避、终态判定）抽 web/src/updateFlow.ts 经 server/test transpile 提取执行模式单测（kdj 先例）；e2e e2e/update-settings.spec.ts 经 journey 隔离运行：spec 自起本地 fixture 清单 HTTP（临时端口、可变内容、零 api.github.com）＋次级真实服务（run.serverDir 编译产物＋种子 .runs/package.json 提供真实 currentVersion，env TRAINER_UPDATE_MANIFEST_URL 注入），覆盖分栏呈现/三态/守卫；真实换装全流程（发布包布局＋真重启）不进 e2e，留用户真机验收。既有分栏（训练默认/应用偏好/动画效果/数据目录）零回归。",
  "next_action": "工程验证完成待架构师复核与用户验收：矩阵 updater.yaml 16/16 covered（5 新 UI 行＋UPD-01 11 行未动）、check-binding strict exit 0、定向 68/68（含 UPD-01 33 例零红）、npm test 1513/1513 exit 0、build 过、journey 新 spec 3/3＋animation-settings 抽查 1/1 exit 0、README 链接门禁 RED→GREEN；16 项 proposed_default（含 4 项行为类沿简报 provisional 决策）待拍板（验证记录 README §6）；附加授权修复（README 图片→docs/user/images/）独立提交",
  "base_commit": "098c442",
  "allowed_paths": [
    "web/src/**",
    "e2e/update-settings.spec.ts（新）",
    "server/test/updater-ui.test.ts（新，web 纯函数提取执行）",
    "README.md、图片新落点、docs/verification/2026-10/GITHUB-HEALTH-01/（仅附加授权范围：移出图片）",
    "docs/verification/2026-10/UPD-02/README.md",
    "docs/verification/2026-10/UPD-02/design.md",
    "docs/work-items/tasks/UPD-02.md",
    "docs/status.md（仅生成器）",
    ".control/trainer-state.json（仅 CLI）；ai-harness-lab/harness-state.jsonl（仅 gate-report）",
    ".zcode/skills/ai-harness/matrix/updater.yaml（追加 UI 行）＋镜像 ai-harness-lab/skill-v1/matrix/updater.yaml"
  ],
  "depends_on": ["UPD-01"],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/UPD-02.md",
      "docs/verification/2026-10/UPD-02/README.md",
      "docs/verification/2026-10/UPD-02/design.md"
    ],
    "reason": "行为矩阵在工作区 harness skill（.zcode/skills/ai-harness/matrix/updater.yaml）＋镜像，不入仓库；docs/status.md 仅经生成器更新。"
  },
  "verification_refs": [
    "docs/verification/2026-10/UPD-02/README.md",
    "docs/verification/2026-10/UPD-02/design.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结边界（2026-10-06，架构师派发简报）

- **消费不改服务端**：UPD-01 契约（design.md §2）只读消费；发现服务端问题→报告不改。`server/src/**`、`server/test/updater-*.test.ts`（33 例不许红）、`scripts/release/**`、launcher.cjs 均禁改。
- **e2e 务实裁剪（proposed_default）**：真实换装全流程需发布包布局＋真重启，不进 e2e（留用户真机验收）；e2e 覆盖分栏呈现＋当前版本、检查三态（fixture 清单）、apply 守卫（开发环境 503 UPDATE_NOT_PACKAGED）。
- **fixture 注入纪律**：任何测试不得访问 api.github.com；注入通道选 env TRAINER_UPDATE_MANIFEST_URL（manifest.ts 四级优先级之首，journey runEnv 透传 process.env）指向 e2e 自起的本地 fixture HTTP。
- **既有分栏零回归**（训练默认/应用偏好/动画效果/数据目录）。
- **附加授权（独立小修，分开提交）**：README.md:11 图片链接指向不入发布包目录致 release 链接门禁自 b783633 起确定性失败；修复＝图片移入发布包含路径（docs/user/ 下，打包清单已含 docs/user 整树）＋更新 README 链接＋链接门禁验证。

## 关键现状核实结论（UPD-02 补充，2026-10-06）

- **journey 隔离服务 currentVersion=null**：隔离服务从 `.runs/<runId>/server` 编译产物运行，APP_ROOT 上溯三级落 `<repo>/.runs`（无 package.json）→ /api/health 与 /api/update/check 的 currentVersion 为 null、updateAvailable 恒 false——「有新版」态不可经主 journey 服务触达。此为 UPD-01 环境盲点（非产品 bug：发布包/开发运行版本正常），已在收尾报告转呈。e2e 以次级真实服务（同编译产物＋种子 `<repo>/.runs/package.json`＝仓库版本）触达有新版/已是最新两态。
- 设置面板 ⚙ 入口（aria-label 训练默认设置）在 app-shell rail 常驻，任意视图（含首页）可达——e2e 无需创建训练。
