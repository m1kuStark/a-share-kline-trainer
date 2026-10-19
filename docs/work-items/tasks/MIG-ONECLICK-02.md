# MIG-ONECLICK-02 一键迁移启动器报错中文化＋自诊断增强

```json
{
  "id": "MIG-ONECLICK-02",
  "title": "一键迁移.cmd 启动器英文报错统一为中文（经 PowerShell 通道）＋检测失败自诊断（打印缺失特征与父目录摘要）",
  "owner": "zcode:mig-oneclick-02",
  "state": "planned",
  "milestone": "R6",
  "summary": "用户验收报告（2026-10-15）：工具在 v1.2.7 目录运行打印英文报错（This tool folder must sit INSIDE...），在 v1.3.x 目录运行为中文——风格不统一；且当前报错信息不指明缺失项。定位：唯一英文输出面=一键迁移.cmd 启动器（cjs 层已全中文）；用户 v1.2.7 侧检测失败停在 .cmd 层。结构复现（现场探测+chcp 65001+双条件+goto 全同构）未能重现报错（现场两条件均 FOUND）——完整触发链未定论（最可能=首次运行时文件夹尚未就位），修复以自诊断增强兜底。",
  "next_action": "bug-loop：.cmd 重构（ASCII 保留、报错走 powershell 中文通道、cjs 检测增强打印特征清单与父目录摘要）→ RED→GREEN → build dist → 发布资产替换由 orchestrator 执行。",
  "allowed_paths": [
    "tools/migrate-v127/",
    "server/test/migration-oneclick-launcher.test.ts",
    "docs/work-items/tasks/MIG-ONECLICK-02.md",
    "docs/verification/2026-10/MIG-ONECLICK-02/**"
  ],
  "depends_on": [
    "MIG-ONECLICK-01"
  ],
  "docs_impact": {
    "update": [],
    "reason": "工具说明文档随新报错形态同步。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": null
}
```

用户原话（oracle）：「迁移工具在 v1.2.7 版本训练器目录中运行后，打印日志如上所述，为英文，但是在 v1.3.x 目录中运行后，打印内容为中文，请将风格进行统一，并解决当前报错信息」（2026-10-15，附英文报错截图）。

## 2026-10-20 元数据修复

旧状态 `queued` 规范为 `planned`；仅对齐既有工作流枚举，不新增实现或用户验收结论。
