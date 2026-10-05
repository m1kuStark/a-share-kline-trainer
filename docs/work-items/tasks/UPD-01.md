# UPD-01 在线版本更新·服务端核心

```json
{
  "id": "UPD-01",
  "title": "在线版本更新·服务端核心（检查更新/下载校验/备份/换装编排/重启链路/版本暴露/SHA256SUMS 资产）",
  "owner": "integrator",
  "state": "review",
  "milestone": "UPD",
  "summary": "在线版本更新服务端核心完成（工程验证）：GET /api/update/check（清单源 env>config>release>默认四级可注入，网络失败 200＋人话 error）、POST /api/update/apply（202 受理→异步 下载→SHA256SUMS 强制校验/zip 完整性＋版本 tag＋nodeVersion 完全一致校验→更新器工作目录准备→spawn detached 更新器）、GET /api/update/status（状态机 idle|downloading|verifying|backing_up|applying|restarting|completed|failed，状态文件跨重启窗口可读＋restarting→completed 补全协调）；更新器 runFromPlan（control/prepare 排空→control/shutdown→等退出→preserve 备份(保留5)→manifest 驱动换装（旧移走→新就位、失败逆序回滚、runtime/ 跳过）→preserve 核验/恢复→spawn launcher.cjs Start 语义重启→健康版本核验→completed）；/api/health 增 currentVersion（包根 package.json 构建时版本，三身份字段不动）。build.mjs SHA256SUMS 资产核实＝已存在（零改动，发布时上传为 release 资产即可）。矩阵 updater.yaml 11 行全 covered；updater-* 测试 33 例（零 api.github.com）。",
  "next_action": "工程验证完成待架构师复核与用户验收：check-binding strict exit 0（11 covered/0 open/0 RED）、定向 33/33、npm test 1501/1501 exit 0（history-report 负载型偶发已三重复核登记，基线提交同样存在）、npm run build 过、变异抽检 2 行 executed 击杀；release 构建验证见验证记录；8 项 proposed_default 待拍板（见验证记录 README 末节）",
  "base_commit": "cd06a71",
  "allowed_paths": [
    "server/src/**",
    "server/test/**",
    "scripts/release/build.mjs（仅 SHA256SUMS 资产配套）",
    "scripts/release/ 下更新器脚本新文件",
    "docs/verification/2026-10/UPD-01/**",
    "docs/work-items/tasks/UPD-01.md",
    "docs/work-items/milestones/UPD.md",
    "docs/status.md（仅生成器）"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/UPD-01.md",
      "docs/work-items/milestones/UPD.md"
    ],
    "reason": "在线更新服务端核心；行为矩阵在工作区 harness skill（.zcode/skills/ai-harness/matrix/updater.yaml）＋镜像 ai-harness-lab/skill-v1/matrix/，不入仓库；docs/status.md 仅经生成器更新。"
  },
  "verification_refs": [
    "docs/verification/2026-10/UPD-01/README.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结边界（2026-10-06，架构师派发简报）

- **数据现状（先核实再依赖）**：V1.2.6 起默认 dataDir＝`<包根>/data`（包内！launcher.cjs resolveConfig），而非旧版主目录 `~/.a-share-kline-trainer`——preserve 清单必须覆盖整个 `data/` 目录（含 trainer.sqlite 历史训练数据）与包根 `trainer.config.json`。
- 更新清单源 URL 可配置/可注入（trainer.config.json `update.manifest_url` 或环境变量）；任何测试不得访问 api.github.com。
- API 契约由本任务定稿写入 design.md，UPD-02 消费。
- 换装编排：独立 detached 更新器进程；服务端 spawn 后自行优雅退出（复用 SETUP-01 冻结排空/退出语义）。
- v1 范围裁剪（YAGNI，proposed_default）：不做增量更新、强制更新、自动检查、签名；runtime 大版本升级不走在线换装（明确提示全量包重装）。
- 备份保留最近 5 份，更旧自动清理。
- 禁改 `web/**`（UPD-02）；禁改 launcher.cjs 启动/停止语义（PORT-02 冻结；只读复用）；禁数据库 schema 变更。
