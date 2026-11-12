# UI-TOOLBAR-03 悬浮工具面板固定与可调宽高

```json
{
  "id": "UI-TOOLBAR-03",
  "title": "悬浮工具面板：固定（pin）与可调宽高（resize）",
  "owner": "integrator",
  "state": "active",
  "milestone": "GH-202611",
  "base_commit": "7895a22",
  "summary": "用户 2026-11-10 Issue #8 反馈：悬浮工具面板拉出后无法固定、形状/宽高不可调，遮挡与位置只能靠拖动。任务＝在紧凑面板（UI-TOOLBAR-02）基础上增加「固定」开关与右下角尺寸手柄：固定后面板位置锁定、拖动无效、刷新保持；尺寸手柄可在限定范围内调整宽高并持久化；内容区按需滚动、工具可点击区域不小于 32×32；窗口缩放后仍钳制在视口内。不改画线语义、工具顺序/常用自定义与既有拖拽位置记忆。",
  "next_action": "先写 RED e2e（固定态不可拖动/持久化、尺寸手柄调整/持久化/边界、小窗钳制）→ 实现 pin 与 resize → 定向 toolbar-floating/uiux-training GREEN → verify:fast、docs:impact、binding 门禁 → 证据、提交、draft PR。",
  "allowed_paths": [
    "web/src/views/Training.vue",
    "web/src/styles.css",
    "e2e/toolbar-floating.spec.ts",
    "docs/specs/chart/display.md",
    "docs/user/README.md",
    "docs/work-items/tasks/UI-TOOLBAR-03.md",
    "docs/status.md",
    "docs/verification/2026-11/UI-TOOLBAR-03/**"
  ],
  "depends_on": ["UI-TOOLBAR-02"],
  "docs_impact": {
    "update": ["docs/specs/chart/display.md", "docs/user/README.md"],
    "reason": "悬浮工具面板新增固定态与尺寸调节能力：显示规格补充行为与持久化口径，用户 README 同步对用户可见的 pin/尺寸手柄/双击复位/窄矮面板滚动说明。"
  },
  "verification_refs": ["docs/verification/2026-11/UI-TOOLBAR-03/README.md"],
  "integration_ref": null,
  "acceptance_ref": null
}
```

## 冻结口径（用户 2026-11-10 Issue #8；维护者 2026-11-12 细化）

- 固定（pin）：标题栏新增固定按钮（lucide Pin/PinOff 同类图标，aria-pressed，中文名称与 title）。固定后面板不可拖动（标题栏拖动无效）、位置内存/持久化不变；刷新后保持固定态与位置；取消固定恢复拖动。
- 调宽高（resize）：面板右下角新增尺寸手柄（可见抓握提示、cursor nwse-resize、role/aria-label）；拖动调整宽 240–560px、高 200px–min(85vh, innerHeight−24px)；尺寸持久化（localStorage 独立键），刷新恢复；双击手柄恢复默认尺寸并清除持久键。
- 约束：内容区（.toolbar-tool-lists）在高度不足时按需滚动，工具按钮可点击区域不小于 32×32；面板始终钳制在视口内（含窗口缩放、内容折叠/展开、常用数量变化）；深浅主题、1024×680/1366×705/1440×900 无溢出、不遮挡价格轴关键区域。
- 不改：画线语义/取点/快捷键、工具顺序与常用自定义、面板显隐开关、既有位置拖拽与记忆、保存状态栏固定占位。
- 文案/图标/手柄样式属 proposed_default，随用户验收确认。

## 本轮交付

- 交互：标题栏新增固定按钮（lucide Pin/PinOff、aria-pressed、中文名称与 title）；固定后标题栏拖动无效、位置内存/持久化不变、刷新保持固定态；取消固定恢复拖动与位置记忆。右下角新增尺寸手柄（`role="separator"`＋aria-label、`cursor: nwse-resize`、可见抓取图标）：拖动调整宽 240–560px、高 200px–min(85vh, innerHeight−24px)，刷新恢复；双击手柄恢复默认尺寸并清除尺寸键；高度不足时 `.toolbar-tool-lists` 按需纵向滚动，23 个工具经真实滚轮可到达、按钮可点击区域 ≥32×32（含 125% 字体压力）；窗口 resize 后尺寸与位置仍钳制在视口内。
- 持久化：固定态/尺寸各存独立键 `trainer.drawToolbar.pinned.v1`（`true`/`false`）与 `trainer.drawToolbar.size.v1`（`{width,height}`），位置沿用 `trainer.drawToolbar.position.v1`。
- 测试：`e2e/toolbar-floating.spec.ts` 新增 3 个 pin/resize 用例（固定态锁定/刷新/取消固定恢复、尺寸范围与持久化/双击复位/滚动可达、1024×680/1366×705/1440×900 × 深浅主题截图）。
- 证据：`docs/verification/2026-11/UI-TOOLBAR-03/README.md`（RED run / GREEN run / 截图清单 / 门禁表）。
- 审查修复（lead 只读审查 Important×2 + Minor）：折叠态尺寸手柄只横向调宽并保留下一次展开高度（不再用 ~70px 折叠高度污染 `trainer.drawToolbar.size.v1`）；删除 pointerdown 时间戳启发式，只保留 `@dblclick` 复位（连续快速拖动不再误判）；保存状态栏右侧留 18px 避免尺寸手柄遮挡「重试保存」；pin 两态可访问名称与固定态拖拽手柄 title（「固定中，拖动已锁定」）补齐；`docs_impact.update` 补登 `docs/user/README.md`。
