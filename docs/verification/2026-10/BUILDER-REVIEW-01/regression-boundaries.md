# 全量回归与基线对照

这是 BUILDER-REVIEW-01 的剩余边界，不是通过清单。[总记录](README.md)保留本轮改动和验收范围。

## 全量候选

`npm run journey -- --retries=0` 原生退出 1。195 项中 193 通过、1 失败、1 条件跳过；没有重试、删除断言或新增 skip。

- 失败：`e2e/report-feedback.spec.ts:92`，390×844 视口下成绩单 `scrollWidth <= clientWidth` 为 false。
- 跳过：`migration-v127.spec.ts:216` 的真实 v1.2.7 包迁移。没有提供 `MIG_V127_PACKAGE`，沿用既有条件；其他迁移用例通过不等于此链路通过。
- 访问守卫、数据库快照＋导出录像恢复、画线、随机日期及录像用例均通过。完整逐项状态与错误保存在 [journey-results.json](journey-results.json)。

## 未改主仓库对照

主仓库代码保持 `a91bad211a44d2d2602f770a6ec95bfef76a1179`。所有对照均使用自有 `.runs` 数据库和浏览器环境，未借用个人训练库。

| 对照 | 原生退出码 | 结果 |
|---|---:|---|
| 空测试库，只跑 report-feedback；run `4b87c256-8b29-4809-ab78-f6bb34975599` | 0 | 1 通过 |
| 将候选全量运行的 SQLite 一致快照复制到新 run，使用未改主仓库构建运行相同 report-feedback；run `e200f8c4-fba2-491d-9b50-8b297926157c` | 1 | 同一行、同一窄窗溢出断言失败 |
| 未改主仓库运行 recording-long 与 report-feedback；run `3e9f546d-4840-4d65-af3e-77c92576beba` | 1 | 2 失败：录像导入后等待「跳到最后一天」按钮超时；随后成绩单同一行失败 |

第二项由 [verify-report-baseline.ts](verify-report-baseline.ts) 执行，[原收据](report-baseline-receipt.json)与[三个对照的状态及完整错误](baseline-results.json)可复核。第三项中录像用例在第 115 行等待按钮超过 720 秒，原因未进一步确定；候选全量运行的该用例通过，不能把基线超时归为本轮新缺陷。

能够确认：窄窗成绩单问题在未修改代码和相同测试历史上存在。尚不能确认：具体布局根因与测试历史选择的各自影响。测试会打开历史列表首项，累积历史可能改变所选报告，这是待验证假设，不当作已证实根因。

后续最小定位动作：固定训练 ID 复现同一份长区间报告，记录各元素 scrollWidth/clientWidth，再判断应修布局还是测试隔离；保留原溢出断言。本轮没有修改该报告或用例。

## 本轮没有覆盖的交付层

没有制作或验收新安装包，没有验证整个 Electron 用户配置迁移、自动归档恢复或安装器升级。浏览器数据库快照＋导出录像恢复证据不能替代这些场景。全局文档检查另有 20 项与基线完全相同的错误，详见[对照](docs-baseline-comparison.json)。因此交付状态是本地候选待 review，不能称为可直接发布。
