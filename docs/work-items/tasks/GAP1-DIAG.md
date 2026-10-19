# GAP1-DIAG 设置页诊断信息：自实现日志落盘＋复制诊断按钮

```json
{
  "id": "GAP1-DIAG",
  "title": "设置页诊断信息：自实现日志落盘＋「复制诊断信息」按钮",
  "owner": "integrator",
  "state": "planned",
  "milestone": "PACK",
  "summary": "复盘缺口 G1（用户 2026-10-19 拍板计划＋决策 2/8）：先实证 E1（桌面端日志当前是否落盘）；自实现主进程日志追加 <dataDir>/logs/main.log（无新依赖、按大小滚动）；设置页「关于与更新」分栏新增「复制诊断信息」按钮——版本/平台/数据目录/更新通道与最近检查结果/最近错误＋日志尾部有限行，绝不包含训练与交易数据（负向断言锁定）。矩阵预登记行 DESKTOP-DIAG-LOG-PERSIST / DESKTOP-DIAG-CLIPBOARD / DESKTOP-DIAG-IPC（root 单写，worker 不得编辑矩阵文件）。",
  "next_action": "阶段0：E1 实证＋开工简报呈 root 批准后按 TDD 实现；e2e 浏览器运行等 root 串行通知；gpu3060 关机，真机验收场景登记 deferred 由本机隔离冒烟替代。",
  "allowed_paths": [
    "desktop/src/**",
    "desktop/test/**",
    "web/src/**",
    "server/test/**",
    "e2e/**",
    "docs/verification/**",
    "docs/work-items/tasks/GAP1-DIAG.md"
  ],
  "depends_on": [],
  "docs_impact": {
    "update": [
      "docs/work-items/tasks/GAP1-DIAG.md"
    ],
    "reason": "诊断按钮为 v1.3.2 用户可见新功能，卡片与验证记录承载验收证据。"
  },
  "verification_refs": [],
  "integration_ref": null,
  "acceptance_ref": "docs/复盘缺口修补-开发计划.md"
}
```

## 验收要点

- E1 结论（落盘/不落盘＋证据路径）回填验证记录。
- 诊断文本字段清单冻结：应用版本、平台（os/arch/electron/chrome）、数据目录、更新通道与最近检查结果、最近错误、日志尾部（有限行数）；负向断言：不含训练/交易数据字段。
- 既有 UPD-DESKTOP-IPC-MINIMAL 暴露面白名单测试同步扩展 desktopDiagnostics（用户拍板 G1 依据留 binding_note）。
- 验收口径：2 分钟内产出可贴 issue 的诊断文本（本机隔离冒烟；真机场景 deferred）。
