# TRAIN-02 创建训练范围与周期联动

```json
{
  "id": "TRAIN-02",
  "title": "创建训练范围与周期联动",
  "owner": "integrator",
  "state": "active",
  "milestone": "M5",
  "summary": "Adopt 73d3e87 backend candidate; 156 tests passed; parallel creation and adjustment fingerprint defects require repair; UI/recording pending.",
  "next_action": "Resume original TRAIN-02 conversation; repair backend first, then freeze recording compatibility and serialize shared frontend integration.",
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
    "docs/work-items/tasks/TRAIN-02.md"
  ],
  "depends_on": [
    "DATA-02",
    "RANGE-01"
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
    "docs/verification/2026-09/START-01/report.md",
    "docs/verification/2026-09/PRODUCT-RESUME-01/report.md",
    "docs/verification/2026-09/GPT-WAKE-02/integrator-review-20260926.md"
  ],
  "integration_ref": null,
  "acceptance_ref": null,
  "base_commit": "af0efafc48ce24e247f3c273b1ee4926be8765c5"
}
```

历史纯模块参考基线d75da88已过时；当前产品基线记录为af0efaf，下一次派发须核对已整理的完整提交SHA及RANGE-01已存在。产品口径与例子只维护在[批次计划](../../proposals/first-use-batch.md#训练范围规则)。本卡是父任务写范围；实际GLM子任务只能拿到其中互不重叠的路径，禁止用server/test/**作为无限制派发权限。

实施分三份可独立审查结果：日期元信息纯规划器与边界测试；后端预览/创建/旧训练兼容；表单与录制兼容。共享API/DB类型由集成人负责，worker不得把新模式伪装成已有tier绕过录制枚举校验。

验收必须覆盖：默认3M；切换预设重算；手填起点保留；月末和闰年；休市日对齐不移动请求终点；上市较晚与本地历史缺失；起点超过末日、周期尾未下载；N=1和N超过可用量；到最新终点冻结；预览过期；老训练/旧录像恢复；不泄露未来行情。较长自定义范围先测量成本，不自行新增无证据的停录阈值。

接续派发：纯规划器已由RANGE-01完成，不重写同名模块。后续按日期元信息预览/创建复核、表单与录制兼容交付完整行为切片；不能把空日期推断成休市，requestedEnd/错误码变化先明确兼容。GLM实现并跑定向检查；主代理围绕接口风险、真实创建→推进→结算→录像回放与M2验收。见[产品分工](../../engineering/product-development.md)。
