# PACK-ZIP-COMPAT-01 Windows 解压兼容

```json
{
  "id": "PACK-ZIP-COMPAT-01",
  "title": "适配 Windows PowerShell 的 ZIP 解压重载",
  "state": "active",
  "milestone": "ENG",
  "owner": "integrator",
  "base_commit": "fe0989736ebf7428deb6dafcf1dbba992c2b50dc",
  "summary": "两个依赖 PR 与未改依赖的 main 均复现打包工具 Expand-Archive 三参数重载错误，独立修复，不改依赖。",
  "next_action": "以现有 main 的远端红灯为起点，锁定 Framework 兼容路径、文件内容和失败传播，检查 Windows CI 后再接回依赖 PR。",
  "allowed_paths": [
    "scripts/release/build.mjs",
    "server/test/release-package.test.ts",
    "docs/work-items/tasks/PACK-ZIP-COMPAT-01.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/PACK-ZIP-COMPAT-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "reason": "记录 runner 专属打包失败与主线对照，保护既有压缩断言。",
    "update": [
      "docs/work-items/tasks/PACK-ZIP-COMPAT-01.md",
      "docs/work-items/README.md",
      "docs/status.md"
    ]
  },
  "verification_refs": [
    "docs/verification/2026-11/PACK-ZIP-COMPAT-01/README.md"
  ],
  "acceptance_ref": null,
  "integration_ref": null
}
```
