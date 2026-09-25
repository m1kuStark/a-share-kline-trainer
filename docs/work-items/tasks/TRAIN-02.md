# TRAIN-02 创建训练范围与周期联动

```json
{
  "id": "TRAIN-02",
  "title": "创建训练范围与周期联动",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "按周期回推默认起始日，增加到最新日线与自定义日K根数，创建前明确覆盖和不足原因。",
  "next_action": "第一片（服务端预览/创建复核/兼容迁移）已交付于task/TRAIN-02-integration，合同见prompts/TRAIN-02-integration.md；待集成人接线web/src/api.ts后派发第二片（表单、预览版本守卫、录制schema），rules.md/recording.md规格同步随第二片进行。",
  "allowed_paths": [
    "server/src/train/**",
    "server/src/api.ts",
    "server/src/db.ts",
    "server/test/**",
    "web/src/views/Launcher.vue",
    "web/src/api.ts",
    "web/src/recording/**",
    "e2e/**",
    "docs/specs/training/rules.md",
    "docs/specs/recording.md",
    "docs/work-items/tasks/TRAIN-02.md",
    "docs/verification/2026-09/TRAIN-02-server/**",
    "docs/verification/README.md"
  ],
  "depends_on": [
    "DATA-02"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/training/rules.md",
      "docs/specs/recording.md",
      "server/src/train/docs/lifecycle.md"
    ],
    "reason": "新范围模式涉及生命周期、API、数据库及录像合同，不能只改前端选项。"
  },
  "verification_refs": [
    "docs/verification/2026-09/START-01/report.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null
}
```

基线d75da88；产品口径与例子只维护在[批次计划](../../proposals/first-use-batch.md#训练范围规则)。本卡是父任务写范围；实际GLM子任务只能拿到其中互不重叠的路径，禁止用server/test/**作为无限制派发权限。

实施分三份可独立审查结果：日期元信息纯规划器与边界测试（RANGE-01已交付）；后端预览/创建/旧训练兼容；表单与录制兼容。共享API/DB类型由集成人负责，worker不得把新模式伪装成已有tier绕过录制枚举校验。

第一片交付（2026-09-25，worktree task/TRAIN-02-integration）：`POST /api/training-ranges/preview`（日期元信息+sourceFingerprint+previewId，无OHLC/收益）；创建复核（409 `RANGE_PREVIEW_STALE`）；trainings 兼容增列 `range_version/range_mode/requested_start/requested_end/range_start/range_end/range_bar_count/range_source_fingerprint/range_notes`（旧行默认 range_version=0/range_mode='tier'，不重建表）；范围模式训练 tier 列写 `RANGE` 哨兵，查询响应附可选 `range` 对象。实现说明见 [lifecycle](../../../server/src/train/docs/lifecycle.md)，证据见 [TRAIN-02-server](../../verification/2026-09/TRAIN-02-server/report.md)。范围模式训练的录像兼容（recording schema）与前端表单属第二片，需第一片响应稳定后单独派发；`web/src/api.ts` 共享接线由集成人串行完成。

验收必须覆盖：默认3M；切换预设重算；手填起点保留；月末和闰年；休市日对齐不移动请求终点；上市较晚与本地历史缺失；起点超过末日、周期尾未下载；N=1和N超过可用量；到最新终点冻结；预览过期；老训练/旧录像恢复；不泄露未来行情。较长自定义范围先测量成本，不自行新增无证据的停录阈值。

派发Prompt：读取任务及批次规则，只用日期元信息、注入时钟与合成夹具，先RED后GREEN；返回修改路径/提交/命令退出码/限制。新旧录制兼容有独立失败回归后才能集成。真实浏览器创建→推进→结算→录像回放及M2由主代理验收。
