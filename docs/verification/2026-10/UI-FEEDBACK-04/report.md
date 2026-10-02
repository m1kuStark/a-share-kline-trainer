# UI-FEEDBACK-04 后续界面反馈验证

候选工作树：`wt/integration/v1`（`trainer-wt/int-v1`）

本记录描述工程自验，不代表新的用户验收或 GitHub 发布。基线为 v1.2.3 候选 `5dd01e8`；本轮新增价位线、更新反馈与排行层级回归。

## 结果

| 检查 | 结果 | 说明 |
|---|---:|---|
| `npm test --` 定向 | 79/79 | data status 17、价位线 14、前端契约 27、排行 21 |
| `npm run build` | 通过 | Vue 类型检查、服务端编译、Vite 生产构建；保留既有 chunk 体积警告 |
| `npm run docs:check` | 通过 | 0 errors，28 个既有长度警告 |
| `npm run docs:impact -- --base 5dd01e8 --task UI-FEEDBACK-04` | 通过 | 25 个变更路径、0 errors |
| Journey 定向 | 10/10 | `data-update-feedback` 4、`order-panel` 1、`phase-price-line` 3、`rankings-navigation` 2；Edge、单 worker、冻结 TDX 快照 |

浏览器证据：`.runs/run-5acd576c-1058-4f7d-ad99-5ad023836455/artifacts/journey.log`；截图同目录 `screenshots/`。第一次价位线运行的失败来自测试夹具消费已释放的 `route.fetch()` 响应，改为独立 GET 后复跑通过，不是产品失败。

## 用户反馈对应行为

- 阶段执行价有效时隐藏内置最新价线，只保留与最新价同源的虚线；阶段 overlay 不再在绘图区写价格文字，价格轴绘制一个同色标签。颜色按阶段价与真实日线前收比较，开盘阶段不注入未来 OHLC。跳空价格纳入最新视图纵轴，手动纵轴范围在主题切换后保持。
- 训练页更新状态按 `freshness` 判断；休市的 `current` 不因兼容 `needsUpdate` 变黄。扫描 `updated`/`unchanged`、stale 下一步、409/失败原因均在固定状态栏反馈；推进或成交产生新训练状态后收起旧扫描文案。手动更新在隐藏页被打断时回前台继续同步。
- 排行顶层为训练周期、行业板块、单只股票；自定义区间与固定训练周期并列置于训练周期下，保留子列表和档位，迟到响应不覆盖当前选择。

## 全量基线边界

本轮曾运行全量 `npm test`，记录为 1374/1385 通过、11 项存量失败；失败集中在录制编解码/迁移、设置超时、review-profile 文档工具和 worktree 工具锁超时等既有环境/工具域，不在本轮新增代码路径。全量 Journey 未替代本轮定向 Journey；本轮定向 Journey 使用固定只读 TDX 快照并保持 10/10。

用户验收与发布状态：未在本记录中推断，待用户对新的候选包进行确认。
