# SETUP-PASTE-01 通达信目录手动输入/粘贴路径

```json
{
  "id": "SETUP-PASTE-01",
  "title": "连接通达信弹层支持手动输入/粘贴目录路径（保留原生选择器）",
  "owner": "integrator",
  "state": "review",
  "milestone": "GH-202611",
  "base_commit": "3a91c4c",
  "summary": "Issue #8-B（用户 2026-11-07 拍板）：顶栏「连接通达信」由直接弹原生选择器改为弹层，提供「手动输入/粘贴路径」与「浏览文件夹…」两条入口；手动路径必须先通过单目录检查（recognized+readable）才允许保存，保存复用 SETUP-01 的 save-choice→apply→受控重启链路；取消/检查失败零写入。设置页既有手填能力不回退。",
  "next_action": "随本批整批验收；通过后合入 main 并推送。",
  "allowed_paths": [
    "web/src/App.vue",
    "web/src/styles.css",
    "e2e/setup-paste.spec.ts",
    "e2e/data-update.spec.ts",
    "docs/user/install.md",
    "docs/work-items/tasks/SETUP-PASTE-01.md",
    "docs/work-items/milestones/GH-202611.md",
    "docs/work-items/README.md",
    "docs/status.md",
    "docs/verification/2026-11/SETUP-PASTE-01/**"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/user/install.md",
      "docs/work-items/README.md",
      "docs/work-items/milestones/GH-202611.md",
      "docs/status.md"
    ],
    "reason": "首配连接入口从仅原生选择器扩展为手动输入/粘贴＋原生浏览两条路径；SETUP-01 边界与校验语义不变，用户安装说明同步。"
  },
  "verification_refs": ["docs/verification/2026-11/SETUP-PASTE-01/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 边界（沿用 SETUP-01）

- 不自动发现、不扫描默认安装目录或附近候选；只校验用户明确输入的单个目录。
- 保存前必须检查通过（包含 vipdoc 与 T0002、可读）；取消/失败不改动旧选择。
- 保存后复用既有 save-choice → apply → 受控重启；普通接口不回传完整本机路径。
