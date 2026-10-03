# GITHUB-HEALTH-01 自动检查修复与 GitHub 展示整理

```json
{
  "id": "GITHUB-HEALTH-01",
  "title": "自动检查修复与 GitHub 展示整理",
  "owner": "integrator",
  "state": "active",
  "milestone": "DEV",
  "summary": "排查 main@1a79853 的 Source checks 双平台失败，修复真实原因并整理个人主页和仓库展示。",
  "next_action": "本地完整单测 1412/1412 已通过；推送源码修复并确认 Windows/Ubuntu Source checks、依赖告警及个人主页图片。",
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
  "integration_ref": null,
  "acceptance_ref": null
}
```

用户已授权修复 GitHub 问题并改善账号展示。个人简介只使用现有作品能够证明的信息。
已有 v1.2.7 验收与发布事实继续保留；本任务首先处理源码检查和项目展示。

已定位到 CI 先测试后编译、旧契约断言、宿主路径解析和平台夹具问题。
运行依赖补丁及 Vitest 4.1.11 已更新，官方 npm 审计为零告警。
公开主页 README、两公开仓库说明与标签、依赖告警、密钥保护及私密漏洞报告已设置；账号简介 API 的写入权限不可用。
全量浏览器回归中的既有失败按本轮证据保留，不能将 Source checks 通过写成完整产品验收。
