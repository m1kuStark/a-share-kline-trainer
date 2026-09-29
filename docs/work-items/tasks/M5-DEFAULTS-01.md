# M5-DEFAULTS-01 保存训练默认资金与复权

```json
{
  "id": "M5-DEFAULTS-01",
  "title": "训练默认资金与复权设置闭环",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M5",
  "summary": "实现默认初始资金/复权的持久设置、创建显式覆盖及当前训练/录像不漂移；基于已接受V1候选888778c",
  "next_action": "M5-DEFAULTS-01 五scope实现与完整门禁完成后待GPT集中检查（control-handoff-20260928-50）；有效预算4/5，余初审/必要返修/末审。",
  "base_commit": "888778cfc7a4b69e4446012a26618b93a8b05b20",
  "allowed_paths": [
    "server/src/settings/training.ts",
    "server/src/settings/creation-defaults.ts",
    "server/src/train/engine.ts",
    "server/src/train/README.md",
    "server/src/train/docs/**",
    "web/src/api.ts",
    "web/src/settingsPanel.ts",
    "web/src/components/TrainingSettings.vue",
    "web/src/views/Launcher.vue",
    "web/src/App.vue",
    "server/test/settings-training.test.ts",
    "server/test/training-rules-frontend.test.ts",
    "server/test/training-creation-defaults.test.ts",
    "server/test/frontend-contract.test.ts",
    "e2e/training-defaults.spec.ts",
    "e2e/training-rules.spec.ts",
    "e2e/training-range.spec.ts",
    "e2e/data-update.spec.ts",
    "docs/specs/training/rules.md",
    "docs/specs/roadmap.md",
    "docs/user/training-rules.md",
    "docs/work-items/tasks/M5-DEFAULTS-01.md",
    "docs/work-items/tasks/M5-01.md",
    "docs/work-items/current-feature.json",
    "docs/status.md",
    "docs/verification/2026-09/M5-DEFAULTS-01/**",
    "docs/verification/2026-09/V1-INTEGRATE-01/repair-48.md",
    "docs/verification/README.md",
    "e2e/README.md"
  ],
  "depends_on": [
    "TRAIN-01",
    "V1-INTEGRATE-01"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/roadmap.md"
    ],
    "reason": "本控制提交冻结M5可执行子行为及候选；实现阶段按合同同步rules与用户说明，不冒称M5整体完成"
  },
  "verification_refs": [],
  "integration_ref": "not integrated; codex/m5-training-defaults base 888778cfc7a4b69e4446012a26618b93a8b05b20",
  "acceptance_ref": null
}
```

实现事实（control-handoff-20260928-50，分支 codex/m5-training-defaults，base 888778c）：

- **API**：GET/PUT `/api/settings/training` 四字段（feesEnabled/tPlusOne/initialCash/adjustMode）原子事务保存；旧两布尔 PUT 兼容（只更新旧两键，保留新默认，不声称修复坏键）；部分对象/未知字段/非对象 400 零写；资金域 0.01..1,000,000,000 元至多两位小数（不取整不截断）；损坏键（GET/创建缺省依赖时）409 `TRAINING_DEFAULTS_UNREADABLE`，完整合法 PUT 即修复入口；无 TDX 可读写；drain 门闩保持。
- **创建优先级**：显式合法值 > 持久默认 > 缺省内建（1,000,000/forward）；缺省仅指 undefined，显式 null/错误类型 400；省略字段在 BEGIN IMMEDIATE 提交边界解析（beforeCommit 可控验证等待期漂移取边界值）；写入既有 trainings.initial_cash/adjust_mode，rules_json schema 不变；五档与 RANGE 共用提交段。
- **RANGE 预览**：预览未给复权取当时默认并固化进预览（响应含 adjustMode 可解释）；提交显式须与预览一致；提交省略复权遇提交边界默认与预览不一致 409 `RANGE_PREVIEW_STALE` 零写；资金不影响范围。
- **UI**：设置弹层四字段一起保存（inert/Tab陷阱/Esc还焦点/录制不卸载保持）；损坏默认经面板完整保存即可修复；Launcher 挂载读取默认作初值、读取完成前开始训练禁用、读取失败可重试；迟到/重复响应按字段 dirty 不覆盖已编辑字段；设置保存只更新未编辑创建字段（已编辑保留并提示"本次使用自定义值"）；实际复权变化使范围预览与在途预览失效。

## F4-launcher-initial-read-loading-owner 收尾（2026-09-29，M5-01 开发片核证）

控制记录曾把该遗留项指向 `scripts/release/launcher.cjs`；经核证 verdict.json（m5-defaults-review-20260928-51）F4 证据清单（ui-results.json / ui-probe.mts / launcher-stale.png / modal-stale.png），缺陷实体是 **web 创建页 Launcher.vue 初次读取失效后 loading 不收敛**（保存作废在途初读后完成所有权未移交→开始训练永久禁用），与桌面启动器无关。修复已随重建提交落地：`7e9b046` 保存广播 watch 将 defaultsState 收敛为 ready，`e944958` e2e 显式门闩用例覆盖；M5-01 开发片全量单测复跑无回归，浏览器 e2e 复跑归集成阶段。该项视为闭合，无需修改 launcher.cjs。
