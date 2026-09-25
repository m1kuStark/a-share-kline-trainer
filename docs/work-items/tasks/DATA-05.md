# DATA-05 数据新鲜度与盘后状态

```json
{
  "id": "DATA-05",
  "title": "数据新鲜度与盘后状态",
  "owner": "integrator",
  "state": "active",
  "milestone": "R1",
  "summary": "Adopt d4aa4e8 as candidate; 75 tests passed; ticker race and remaining freshness consumers require repair before integration.",
  "next_action": "Resume original DATA-05 conversation; independently reproduce ticker/Launcher/source availability findings, then fix and run product gates.",
  "allowed_paths": [
    "server/src/data/**",
    "server/test/data-refresh.test.ts",
    "server/test/data-freshness.test.ts",
    "web/src/dataStatus.ts",
    "web/src/App.vue",
    "web/src/api.ts",
    "e2e/data-update.spec.ts",
    "docs/work-items/tasks/DATA-05.md",
    "docs/specs/market-data/requirements.md"
  ],
  "depends_on": [
    "FRESH-01"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/market-data/requirements.md"
    ],
    "reason": "实施需同步最近已收盘交易日、新鲜度未知及本地扫描的区别。"
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

历史纯模块参考基线d75da88已过时；当前产品基线记录为af0efaf。下一次实际派发前须核对已整理的完整提交SHA及FRESH-01已存在。范围是状态判定与说明，不下载行情或改结算。allowed_paths是整任务范围，不代表可同时分配给多个worker。

- 最近已收盘交易日使用Asia/Shanghai及15:00收盘分界；盘中不要求当天完整日线，盘后不能固定退回昨日。可信交易日历应注明来源、版本、覆盖范围，并离线可用；缺失/超范围时保守显示“数据截至……，最新交易日待确认”，周一至周五不能冒充正式交易日历。
- 分离扫描结果updated/unchanged/failed与市场新鲜度current/stale/unknown；扫描无变化不等于已到最新。来源最大日不证明每只股票覆盖；文案注明范围和最近检查时间。
- 落后时提示先在通达信下载盘后日线，再由训练器重新读取；按钮不得暗示会联网补齐。即使状态正常仍能手动重新检查。
- 前台跨收盘/跨日期需重新判定，隐藏页停止计时，回前台刷新；不用高频扫描整盘，不干扰训练和画线。
- 验收：上海2026-09-22 14:59与15:00之后、周末、可靠日历内节假日、日历未知/过期、非上海主机时区、首次未扫描、源无变化但仍落后、扫描失败和个股尾日不同于目录最大日。未知不能呈现绿色“已最新”。

接续派发：日期/新鲜度纯模块已由FRESH-01完成，不再从旧基线新建同名文件。下一切片交付refresh/API/首页的完整可见行为，给GLM明确的接口不变量、独占文件及真实验收场景；共享API/App指定单一owner。提交事实和机器检查后再做页面验收，详见[产品分工](../../engineering/product-development.md)。
