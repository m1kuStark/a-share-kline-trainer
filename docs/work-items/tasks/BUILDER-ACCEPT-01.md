# BUILDER-ACCEPT-01 成绩单、文档门禁、真实旧包迁移与独立验收包

```json
{
  "id": "BUILDER-ACCEPT-01",
  "title": "关闭复盘候选剩余失败并生成独立本地验收包",
  "owner": "integrator",
  "state": "review",
  "milestone": "M5",
  "base_commit": "81558ad3b176c07e1f368ef3ea2fdd2fb5da82ed",
  "summary": "成绩单窄窗与 20 个文档错误已修复。单测 server 1750 + desktop 357、M2 24、完整 Journey 196/196 通过，无跳过。真实 v1.2.7 历史/旧 UI 录像迁入实际 Electron 并回放；独立 ZIP 全新解压启动、隔离数据与正常退出通过。待用户验收，未发布。",
  "next_action": "用户按 docs/release/builder-accept-01.md 解压并运行独立验收包；NSIS 安装/覆盖升级未实测，暂不发布。",
  "allowed_paths": [
    "web/src/components/HistoryReport.vue",
    "web/src/styles.css",
    "web/README.md",
    "web/src/components/README.md",
    "e2e/report-feedback.spec.ts",
    "e2e/report-narrow.spec.ts",
    "e2e/migration-v127.spec.ts",
    "e2e/README.md",
    "server/test/report-*.test.ts",
    "scripts/acceptance/**",
    "desktop/scripts/acceptance-*.mjs",
    "docs/work-items/**",
    "docs/verification/2026-10/BUILDER-ACCEPT-01/**",
    "docs/verification/2026-10/UIUX-REFINE-01/**",
    "docs/status.md",
    "docs/release/**",
    "docs/user/desktop-upgrade.md",
    "tools/migrate-v127/**",
    "e2e/m4-rankings.spec.ts",
    "e2e/random-mode.spec.ts",
    "e2e/trade-marker-details.spec.ts"
  ],
  "depends_on": [
    "BUILDER-REVIEW-01"
  ],
  "docs_impact": {
    "update": [
      "web/README.md",
      "e2e/README.md",
      "docs/work-items/tasks/BUILDER-ACCEPT-01.md"
    ],
    "reason": "成绩单窄窗行为修复及回归入口；旧文档事实修复不虚构验收；真实包与本地验收包收据。"
  },
  "verification_refs": [
    "docs/verification/2026-10/BUILDER-ACCEPT-01/README.md"
  ],
  "integration_ref": "codex/builder-review-followup（隔离候选）",
  "acceptance_ref": null
}
```

## 计划与判据

1. 固定带成交的报告，测出溢出元素；新增真实浏览器 RED，补矩阵后最小修复。深浅色、390 窄窗与桌面均可读，交易列仍可查看。
2. 根据已有任务与原始证据修正非法状态、缺少的阶段/依赖及失效日志链接。检查器保持原规则，docs 四门禁通过。
3. 用发布资产 SHA256、release.json 核对 v1.2.7 包；独立端口/数据库/浏览器跑真实旧包导出与新端导入回放，明确录像与训练历史各自覆盖。
4. 全量单测、构建、Journey（旧包用例启用）通过后保存候选提交；本地包标记源码身份，使用独立数据目录/浏览器存储，主代理实测启动与关键路径，交付操作说明及校验和。
5. 不推送、不打标签、不上传云端、不覆盖已装版本；用户体验验收另记。
