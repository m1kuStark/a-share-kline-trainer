# M4-HISTORY-01 真实 Journey RED/GREEN 记录

- 任务：M4-HISTORY-01；真实隔离 run（独立 SQLite/端口/journey 构建；单 worker；retries=0）。
- TDX 冻结样本：`C:/Users/Stark_Du666/.codex/headroom-cache/fixtures/tdx-20260916-d8339f32`（6 文件 sha256 与 snapshot.json 逐一核对一致：sh600519.day `751558c9…`、sz300857.day `616d9738…`、sh000300.day `59200872…`、gbbq `b777dcf3…`、shs.tnf `7a991097…`、szs.tnf `dab6a73a…`）；journey 运行时复制为 run 目录内 `tdx-snapshot` 隔离副本。未使用个人库/真实 TDX/8787/7529。
- 命令：`TDX_ROOT=<冻结样本> npm run journey -- e2e/m4-history.spec.ts --retries=0`（cwd=工作树根）。

## RED（web UI 实现前）

- T2（原件 `red-journey-m4-history.20260928T2.log`，headroom 副本 sha256 见任务证据清单）：exit 1，首个用例在 `getByRole('button', { name: '历史训练' })` 点击处 60s 超时失败——历史入口尚不存在，符合预期 RED。
- 另有 T1（环境失败原件）：未设 TDX_ROOT 时 journey 拒绝启动（"Journey needs a readable TDX sample source"），exit 1，未下载任何数据。

## GREEN（web UI 实现后，e2e/m4-history.spec.ts 4 用例）

1. 空历史：列表空态「暂无已结算训练」→「返回创建训练」→ 创建页。
2. 主链（深色 1440）：表单创建 600519 → 真实画线（线段，等待「已保存」）→ 真实买入 → 真实推进 2 日 → 真实「提前结算/确认结算」→ 结算面板「查看历史成绩单」→ 列表稳定排序+分类徽章+分页禁用态 → 详情（元信息/冻结规则/逐笔成交/已保存权益曲线 SVG/画线标注，无 NaN/undefined）→ 返回列表 → 录像库 → rail 训练回到该局只读视图。pageerror 0。
3. 运行中守卫（浅色 840）：rail 历史训练 → 409 守卫说明「结束当前训练后可查看历史」零行 → rail 训练返回当前训练；放弃后不入列表、原已结算行不受影响。
4. A→B 竞态与稳定排序：创建并结算 300857 后两行按 settle_date DESC 稳定排序（600519 在前）；路由延迟旧行 A 的 report 响应 1.5s，先点 A 立刻点 B：B 正常呈现，A 迟到响应不覆盖、无永续 loading，无 NaN/undefined。

- 运行历史（全部保留，未覆盖）：T1 strict-mode 定位歧义失败（`¥1,000,000` 两处匹配，属测试定位缺陷，改 `.first()`）；T3 rail「训练」按钮可达名为「⌁ 训练」致 exact 匹配失败（改 .rail-item 文本过滤定位）；T4 通过后实查截图发现 840 宽度列表日期截断（产品 CSS 修复：窄屏允许换行）与画线区块未入截图（内部滚动容器，测试补滚底补拍）；T5 补拍后 840 内层滚动仍未到位；T6（最终）exit 0，4/4 通过，43.8s，无 flaky 无 retries。
- 日志：`green-journey-m4-history.20260928T1/T3/T6.log`（本目录）＋ headroom 缓存 `m4-history-20260928-53/evidence/` 下 T2/T4/T5 与 sha256 清单；browser-results.json 为最终 run 产物。

## 截图（主代理已逐一实查，本目录 screenshots/）

| 文件 | 视角 | 实查结论 |
|---|---|---|
| m4-history-list-dark-1440.png | 深色 1440 列表 | 行内容/徽章/权益/收益率配色/分页禁用态正常 |
| m4-history-report-dark-1440.png | 深色 1440 成绩单 | 元信息 8 格、规则行、逐笔成交、权益曲线可读 |
| m4-history-report-drawings-dark-1440.png | 深色 1440 滚底 | 画线标注（线段/主图/锚点/前复权基准说明）完整 |
| m4-history-guard-light-840.png | 浅色 840 守卫 | 守卫说明清晰，无历史行 |
| m4-history-report-light-840.png | 浅色 840 成绩单 | 2 列网格可读；列表日期窄屏换行修复生效 |
| m4-history-report-drawings-light-840.png | 浅色 840 滚底 | 画线标注与只读范围说明完整 |

## 残余

- 空列表「返回创建训练」仅在第 1 用例（run 首局）覆盖；同一 run 内后续用例数据库已有已结算行，无法重复空态。
- 画线锚点时间戳为图表坐标换算结果（2026-03-26/2026-07-03，训练起始日前的可见历史段），如实展示、不做范围过滤；曲线/成交的范围限定由服务测试覆盖。
