# M4-HISTORY-01 结算历史到事实成绩单

```json
{
  "id": "M4-HISTORY-01",
  "title": "结算历史到事实成绩单",
  "owner": "GLM-5.3-Flash",
  "state": "review",
  "milestone": "M4",
  "summary": "在已接受 V1 基线 888778c 上交付完整用户行为：真实结算一局后进入历史训练列表，打开只读事实成绩单查看分类、初始/最终权益、收益率、逐笔成交、已保存权益曲线与画线并返回；运行中/放弃不出现，任何 running 存在时新接口 409 拒答。不实现排行、最大回撤、胜率、盈亏比、基准超额、训练时钟、成交理由或条件单。",
  "next_action": "收编合并 045c07d（wt/D-M4-HISTORY-01＝5bf4484←f707a14，零冲突，合并 diff 32 文件与候选完全一致）已并入；分支追加 e2e 适配 6d50385（UI-03 双框搜索）＋36a25f9（成绩单断言 heading 锚定，M4-01 文案共存），冻结样本复验 journey 双 spec 6 passed（run-9653eee0），详见 report.md 返修段；终态 36a25f9 槽内复验（collect-rerun.md 终态复验段）：npm run build 通过，npm test 两轮仅 runtime-isolation.test.ts 持续失败（RUN-CANCEL-01 范围，本轮排除），其余失败均为超时/hook 超时抖动且串行复跑全绿（api 6/6、docs-tooling 30/30、drawings 7/7、public-source 3/3、review-profile 16/16、worktree-tools 28/28），history-report 23/23 于全量轮通过，docs:check／status --check／impact(base 5bf4484) 均 0 错误；完整候选门禁 verify:candidate --base 5bf4484 --task M4-HISTORY-01 留集成阶段执行，不过即打回或待裁决。",
  "allowed_paths": [
    "server/src/api.ts",
    "server/src/train/history-report.ts",
    "server/src/train/README.md",
    "server/src/train/docs/history-report.md",
    "server/test/history-report.test.ts",
    "web/src/App.vue",
    "web/src/api.ts",
    "web/src/views/History.vue",
    "web/src/components/HistoryReport.vue",
    "web/src/views/Training.vue",
    "web/src/styles.css",
    "e2e/m4-history.spec.ts",
    "docs/specs/roadmap.md",
    "docs/specs/training/history.md",
    "docs/specs/README.md",
    "docs/user/training-history.md",
    "docs/user/README.md",
    "docs/work-items/tasks/M4-HISTORY-01.md",
    "docs/work-items/tasks/M4-01.md",
    "docs/work-items/current-feature.json",
    "docs/status.md",
    "docs/verification/2026-09/M4-HISTORY-01/**"
  ],
  "depends_on": [
    "TRAIN-01",
    "TRAIN-02",
    "REC-01"
  ],
  "docs_impact": {
    "update": [
      "docs/specs/training/history.md",
      "docs/specs/README.md",
      "docs/user/training-history.md",
      "docs/user/README.md",
      "docs/specs/roadmap.md"
    ],
    "reason": "新增历史查询与只读成绩单产品规格（specs/training/history.md）、用户说明（user/training-history.md）及两处 README 最小链接；roadmap §2.7 标注本片已交付范围与仍未交付范围。"
  },
  "verification_refs": [
    "docs/verification/2026-09/M4-HISTORY-01/server-red-green.md",
    "docs/verification/2026-09/M4-HISTORY-01/journey-red-green.md",
    "docs/verification/2026-09/M4-HISTORY-01/report.md",
    "docs/verification/2026-09/M4-HISTORY-01/repair-55.md",
    "docs/verification/2026-09/M4-HISTORY-01/collect-rerun.md"
  ],
  "integration_ref": "收编合并 045c07d（wt/D-M4-HISTORY-01：基线 5bf4484 ← 候选 f707a14，零冲突）＋槽内回填 e8f80f9＋e2e 基线适配 6d50385/36a25f9；完整候选门禁待集成阶段对 base 5bf4484 重跑",
  "acceptance_ref": null
}
```

## 合同与范围

- 合同：`control-handoff-20260928-53`（全局缓存 `m4-history-20260928-53/contract.md`，revision 1）。基线 `888778cfc7a4b69e4446012a26618b93a8b05b20`，分支 `task/M4-HISTORY-01`，唯一写者为本工作树。
- 五个 scope：HISTORY-list、HISTORY-report、HISTORY-ui、HISTORY-no-future、HISTORY-compat。预算：执行 2、审查 2（本轮为执行 1）。
- 明确不做：排行（GET /api/rankings 保持 404）、最大回撤、胜率、盈亏比、沪深300超额/基准、训练时钟、成交理由、条件单；不把本片写成 M4 整体完成。
- 复用 `trainings/trades/equity_curve/drawings/position_events` 与现有 snapshot/equityCurve 纯查询；不改 db 迁移、账户/权息算法、录像 schema、SETUP/launcher、门禁/retries/依赖。

## 路径说明（与合同的差异）

- 合同写 `web/src/style.css`；仓库实际全局样式文件为 `web/src/styles.css`，本卡按实际路径冻结，仅限历史页面样式增量。

## 验收条件

1. HISTORY-list：GET /api/trainings/history 只返回 settled；early_settle=false→complete、true→early-settled（结算方式口径）；排除 abandoned/running；settle_date DESC、id DESC 稳定排序；limit 默认 20（1..100）、offset 默认 0（非负），非法 400；返回 total/items/limit/offset；行含 id/code/name/tier/rangeMode（RANGE 的 preset/latest/bars 如实，五档为 tier）/classification/startDate/settleDate/initialCash/finalEquity/returnRate/tradeCount/integrity。
2. finalEquity 只取 equity_curve 中 date===settle_date 的持久点；不以末笔 cash_after、最新价或今日规则重算；结算点缺失/非有限、settle_date 缺失、initialCash 非正有限→integrity=unavailable 且 finalEquity/returnRate=null 并给中文原因；坏 rules/legacy-raw 行列表标不可用但不影响其他行。
3. HISTORY-report：GET /api/trainings/:id/report——非法 ID 400、无此 ID 404、未 settled 409 HISTORY_NOT_SETTLED；坏/缺 rules 409 TRAIN_RULES_UNREADABLE；legacy-raw-unverified 409 LEGACY_RAW_ACCOUNTING_UNVERIFIED；合法 legacy-migration 如实展示；权益缺失 409 HISTORY_EQUITY_UNAVAILABLE；曲线按 date 升序限定 start_date..settle_date，成交同范围 seq 升序，范围外不输出；drawings 坏 JSON 不得变空成功（drawingsStatus=unavailable+中文原因）；画线以只读标注清单呈现，不把价格点画到权益坐标、不新增行情 K 线或编辑器。
4. HISTORY-no-future：任何 running 存在时 history/report（含直接 ID 访问）先返回 409 HISTORY_ACTIVE_TRAINING 且零历史内容；检查与读取在同一同步调用内完成、其间无 await；无 running 时接口不得读行情 bars、TDX 扫描、adj_factors 重放或今日默认重算（no-future oracle：无 TDX 配置仍成功且库内容零变化）。
5. HISTORY-ui：侧栏入口改为可访问"历史训练"；列表分页（上一页/下一页）；详情展示事实、逐笔成交、已保存权益曲线、画线清单；真实结算→历史→详情→返回路径可用；A→B 详情切换迟到响应不覆盖；错误可重试；空列表可返回创建；金额不出现 NaN/undefined；运行中打开历史显示"结束当前训练后可查看历史"且可返回当前训练；录像库导入不回归。
6. HISTORY-compat：既有 /api/trainings/:id、bars、drawings、recording-context、离线录像行为不变；GET /api/rankings 仍 404；既有单测/构建不回归。
7. 验证：先 RED 后 GREEN，失败原件保留；服务测试覆盖分类/稳定排序/report 事实/旧 raw 409/running与abandoned排除/no-future oracle；真实 Journey 用真实结算按钮与历史入口（不得 API 替代关键用户动作），深/浅 1440/840 截图主代理实查，pageerror 0；完整门禁按 base 888778c 一次执行。
