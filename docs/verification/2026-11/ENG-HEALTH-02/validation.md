# 本地验证收据（2026-11-17）

[检查总览](README.md)。运行源码基线 `3b5fb110e506eb2e139f754c966cee3a64f55ea1`；本轮只改 Markdown 和维护收据。

## 运行检查

| 命令 | 退出码 | 结果 |
|---|---|---|
| 基线 npm run docs:check | 0 | 0 errors；176 条字符长度建议 |
| 基线 npm run docs:status -- --check | 0 | 0 errors / 0 warnings |
| git fsck --no-reflogs | 0 | 无损坏；74 commit /63 blob /10 tree 为 dangling，未清理 |
| npm run build | 0 | 类型、server、生产 web 构建完成；保留 Vite chunk-size warning |
| npm test | 1 | server 2652 passed /2 failed，648.52s；server失败使该命令未执行desktop |
| runtime-isolation 原配置隔离复跑 | 1 | 14 passed /1 failed，49.77s；同一取消用例15s超时＋EBUSY |
| updater-stale-busy 原配置隔离复跑 | 0 | 9/9，5.84s；首轮5s超时仍保留 |
| npm run test:desktop 单独补跑 | 1 | 368 passed /1 failed，27.11s；真实进程树终止用例15s超时 |
| port-tree-kill 原配置隔离复跑 | 1 | 6 passed /1 failed，15.86s；同用例仍15s超时 |

复跑的完整命令、退出码、统计及源码指纹见 [results.json](results.json)；[failure-excerpts.txt](failure-excerpts.txt)保留首轮与复跑的完整错误段。完整原始日志及逐文件指纹在本机全局 Headroom 缓存 `trainer-health-20261117-local`，没有复制个人训练数据。

两项进程清理失败在本机原配置复跑仍存在，按 [RUNTIME-CANCEL-02](../../../work-items/tasks/RUNTIME-CANCEL-02.md) 接续。取消链20s与桌面taskkill guard30s超过测试15s是线索；未完成根因归因，不能仅延长timeout就声称已修复。updater仅能称“首轮超时、隔离复跑通过”。桌面构建还保留既有 duplicate maxTries 属性警告。

## 本轮修改的验证边界

- 617 个 tracked 运行源码/配置/测试文件 SHA256 前后完全一致，聚合指纹见 results.json。已有用户迁移HTML原字节一致且未暂存。
- TRAINER_DB/TRAINER_DATA_DIR 显式指向隔离缓存目录，spawn前核对路径。未连接个人训练库、未修改 TDX。
- 按本轮创建时间与特有fixture命令查询，未发现可明确归属本轮的活动fixture残留；未杀共享进程，未删临时证据。
- 未执行全量 Journey、M1/M2、安装包、产品视觉或用户验收；本轮不发布，不宣称完整产品验收通过。

最终文档门禁与交付收据见 [delivery.json](delivery.json)。本次零运行代码改动不签发旧候选工具的 docs-only proof。
