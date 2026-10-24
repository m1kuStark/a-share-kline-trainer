# 完整 Journey 首轮失败与修正

候选生产源码对应 `8d08a5a0920abb04964f1e6f68fd20291db55ce7`；以下仅修改 E2E 准备和独立预期，不改产品。首轮命令 `npm run journey -- --retries=0`，显式设置冻结 `TDX_ROOT` 与真实 `MIG_V127_PACKAGE`，run `23338005-34cc-44a9-a0a1-0afa574745e0`：193 passed / 3 failed / 0 skipped，native exit 1。[完整失败与原始数据收据](journey-first-failure.json)。

原始浏览器结果、完整 Journey 日志及三处失败的截图/trace 在[首次失败归档](journey-first-evidence.zip)，逐文件哈希见[归档清单](journey-first-evidence-index.json)。

| 失败 | 证据与修正 |
|---|---|
| 排行首页按钮尚未出现 | trace 中 `/api/env` 用时 4934ms，旧准备只睡眠 400ms 后使用默认 5 秒断言。改为导航前注册环境响应等待，响应成功后保留同一可见性断言。 |
| 盲训刷新后徽标未出现 | reload 时环境请求尚未完成；上一轮相同请求 4456ms。改为等真实环境响应、画线已保存和加载结束，再核对同一徽标数量、相对日期及无真实日期泄露。 |
| 三个月窗口被要求 40–70 根 | 本 run 的 training 95 实际起点 2006-02-06，三个自然月截止 2006-05-06；原始 `.day` 仅有 20 根，最后 2006-04-25。原始数据在 02-23 与 04-17 之间有缺口，产品返回恰为 20。没有查询交易所记录，不能据此断言缺口成因就是停牌。 |

自然月预期来自既有 RF-04/RF3-01 决策与 `RAND-UI-PERIOD-REUSE`，不是按产品输出反推。新断言先核对真实 POST 的 `window_months=3`，只读本 run 数据库取得随机起点，直接从原始 32 字节 TDX 记录提取交易日期，以独立 UTC 日历计算月末裁剪后的截止日，精确核对根数、窗末、预热、完整数据范围及响应偏移。未调用生产解析器/选窗器/日期帮助函数，保留 RANGE、维度与隐藏字段断言。每次运行附上期望日期清单。

原始文件 SHA256：`751558c9c9e3c7172e13dce7d4eb8feca18bd9bb4a2b6287181436337abcc057`。隔离运行、冻结样本、交付样本字节一致。20 根旧失败案例已独立复算，见收据；该事实不代表行情源全市场完整性已验证。

未改测试的诊断复跑：`npm run journey -- e2e/m4-rankings.spec.ts e2e/random-mode.spec.ts e2e/trade-marker-details.spec.ts --retries=0`，run `fe4ba54a-ce34-4b1b-9f86-fae2e75e2876`，23 passed / 0 failed / 0 skipped，native exit 0。由于随机选窗与加载耗时不同，不能据此忽略首轮失败。

同命令修正后复跑：run `02677879-0539-4303-818c-230e5e2adbcb`，23 passed / 0 failed / 0 skipped，native exit 0；新独立日期断言确实执行。完整 196 项重跑另列收据，不把这 23 项拼接成全量通过。

最终完整重跑 `npm run journey -- --retries=0`：run `3cf042ee-172f-4fda-87e4-27b3cf05bf7a`，196 passed / 0 failed / 0 skipped / 0 flaky，native exit 0，耗时约 30.2 分钟。生产输入和测试文件指纹复核无漂移。[完整收据](journey-final.json)。

L2 复核：更换错误的固定根数容差为原始日期精确值；业务口径不变。定向变异为 `paper_only`：返回根数增加 1 将被精确根数断言识别；把窗口固定成 60 根将被实际日期清单长度/窗末断言识别。未声称已对生产代码实际执行这些变异。
