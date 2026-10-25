# BUILDER-REVIEW-01 复盘后续：本地访问边界、恢复验证和交付说明

```json
{
  "id": "BUILDER-REVIEW-01",
  "title": "落实 Builder 复盘中的本地访问边界、恢复验证和交付说明",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "base_commit": "a91bad2",
  "summary": "用户 2026-10-19 授权按复盘建议继续。隔离候选复用 M2-DRAWING-01 与 M2-RANDOM-AXIS-01 已有修复，补全本地 HTTP 来源边界和恢复证据，统一安装/备份/更新说明。云费用按用户补充暂不处理，月度可接受 200 元；只核对已有云授权与发布面。",
  "next_action": "本地候选待 review：单测 1750+357、构建、M2 24 项通过；全量 Journey 193 过/1 失败/1 跳过，窄窗成绩单失败已在未改主仓库复现。全局文档门禁仍有 20 项基线错误。安装包与用户验收尚未进行，未合主仓库、未发布；CloudBase 授权可用，feed 指向 v1.3.0。",
  "allowed_paths": [
    "server/src/index.ts",
    "server/src/local-request-guard.ts",
    "server/test/local-request-guard.test.ts",
    "server/README.md",
    "web/vite.config.ts",
    "web/README.md",
    "e2e/local-origin.spec.ts",
    "e2e/backup-restore.spec.ts",
    "e2e/README.md",
    "README.md",
    "SECURITY.md",
    "docs/user/**",
    "docs/release/**",
    "docs/status.md",
    "docs/work-items/tasks/BUILDER-REVIEW-01.md",
    "docs/work-items/tasks/M2-DRAWING-01.md",
    "docs/work-items/tasks/M2-RANDOM-AXIS-01.md",
    "docs/verification/2026-10/BUILDER-REVIEW-01/**",
    "web/src/components/KlineChart.vue",
    "web/src/recording/chartCapture.ts",
    "web/src/views/Training.vue",
    "web/src/randomDatePresentation.ts",
    "server/test/drawing-persistence-contract.test.ts",
    "server/test/recording-chart-capture.test.ts",
    "server/test/random-reveal-trading-day.test.ts",
    "e2e/drawing-basis.spec.ts",
    "docs/verification/2026-10/M2-DRAWING-01/**",
    "docs/verification/2026-10/M2-RANDOM-AXIS-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": ["server/README.md", "web/README.md", "SECURITY.md", "README.md", "docs/user/install.md", "docs/user/README.md", "docs/user/recording.md", "docs/user/desktop-upgrade.md", "docs/release/desktop-upgrade-guide.md", "docs/work-items/tasks/BUILDER-REVIEW-01.md"],
    "reason": "本地 HTTP 信任边界改变；桌面与 ZIP 安装、数据位置及完整备份说明对齐实际行为。"
  },
  "verification_refs": ["docs/verification/2026-10/BUILDER-REVIEW-01/README.md"],
  "integration_ref": "codex/builder-review-followup 分支 5da1564 已并入 main（2026-10-25 以 git merge-base 核实）；该分支与工作树已于同日工程清理中删除，代码事实以 main 为准",
  "acceptance_ref": null
}
```

## 已冻结判断

- 当前是公开下载的本地模拟训练器；数据只保存在用户电脑。云服务用于更新分发。
- 本地服务应拒绝外站来源及非本机 Host；应用自身与开发代理保持可用。没有浏览器来源头的本地脚本保留兼容，既有控制令牌守卫不能绕过。
- 本轮不引入账号、收费、联机；不变更云预算、不上传发布、不把代码验证当用户验收。
- 成功证据：外站读/写被拒且数据不变；同源实际读写成功；干净环境恢复训练事实和可导入录像；双方图表修复定向及全量回归；安装说明按实际形态可执行。

## 执行计划

1. 合并两个已有修复到隔离候选，冲突只保留双方导入。
2. 真实 Fastify 入口及临时文件数据库复现来源漏洞；矩阵先登记，再实现最小入口守卫。
3. 同步桌面/ZIP 用户文档，并查 Z code 会话中的云授权；只记录证据不暴露凭证。
4. 隔离浏览器恢复实验、核心旅程、全量测试、构建和文档检查；保存每项退出码和遗留。

## 本轮交付

实现和隔离验证已完成，状态为 review。机器结果与基线失败见[验收记录](../../verification/2026-10/BUILDER-REVIEW-01/README.md)。此状态不表示整库门禁通过、安装包已验收或用户已接受。
