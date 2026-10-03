# GITHUB-HEALTH-01 自动检查修复与 GitHub 展示整理

```json
{
  "id": "GITHUB-HEALTH-01",
  "title": "自动检查修复与 GitHub 展示整理",
  "owner": "integrator",
  "state": "closed",
  "milestone": "DEV",
  "summary": "Source checks 双平台修复已推送并通过远端完整单测；个人主页、仓库入口和安全设置已更新，两公开仓库当前开放依赖告警为零。",
  "next_action": "本任务已完成；浏览器回归存量失败继续由 E2E-BASELINE-01 和相关业务任务跟进，已验收 v1.2.7 下载包保持原样。",
  "base_commit": "1a79853b69b8c910db514c0c02d97e8a75c0e0c9",
  "allowed_paths": [
    "server/test/**", "server/src/tdx/process-clues.ts", ".github/**", "README.md", "package.json", "package-lock.json",
    "docs/engineering/testing.md", "docs/work-items/tasks/GITHUB-HEALTH-01.md",
    "docs/work-items/README.md", "docs/status.md",
    "docs/verification/2026-10/GITHUB-HEALTH-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": ["README.md", "docs/engineering/testing.md", "docs/work-items/README.md"],
    "reason": "记录自动检查失败的根因和修复边界，并改善面向使用者的下载与项目入口。"
  },
  "verification_refs": ["docs/verification/2026-10/GITHUB-HEALTH-01/report.md", "docs/verification/2026-10/GITHUB-HEALTH-01/result.json"],
  "integration_ref": "main@0715a0a5e5e5f1bf754e9e947c4de30dbcfaaf5d",
  "acceptance_ref": null
}
```

用户已授权修复 GitHub 问题并改善账号展示。个人简介只使用现有作品能够证明的信息。
已有 v1.2.7 验收与发布事实继续保留；本任务首先处理源码检查和项目展示。

已定位到 CI 先测试后编译、旧契约断言、宿主路径解析和平台夹具问题。
运行依赖补丁及 Vitest 4.1.11 已更新，官方 npm 审计为零告警。
公开主页 README、两公开仓库说明与标签、依赖告警、密钥保护及私密漏洞报告已设置；账号简介 API 的本次写入返回 404，资料未修改。
全量浏览器回归中的既有失败按本轮证据保留，不能将 Source checks 通过写成完整产品验收。

远端 Actions `37143145799` 已确认双平台通过：Windows 1423/1423，Ubuntu 1417 通过、6 项既有平台专用测试跳过。此前失败及修复过程保留在验证记录；本任务完成不补造用户验收记录。
