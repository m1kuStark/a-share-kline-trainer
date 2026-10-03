# v1.2.7 替换发布验证

2026-10-04 按[用户验收授权](../V1.2.7-user-acceptance/README.md)更新现有 [GitHub Release](https://github.com/m1kuStark/a-share-kline-trainer/releases/tag/v1.2.7)，Release ID 保持 `402384887`。

## 来源与资产

- 旧公开基线：`81be8ef922870ec25578fcb1f6175074b46f1ee4`。介绍按该提交到最终包的代码差异编写。
- 最终包源码及远端 `v1.2.7`：`bbd368b09a463183364861678db83a9ae86b1472`。
- ZIP：`kline-trainer-v1.2.7-windows-x64.zip`，54,709,594 字节，GitHub asset `608131607`。
- ZIP SHA256：`704cfa03f2a13bdcab70e7e32ffd475760ab92f4a3b6eb46fbcccc63fd8d05a5`。
- `SHA256SUMS`：GitHub asset `608141422`，文件摘要 `d12edaeacc256d1cc48797ce5f00bda49d94d9d4554896659a7d85c0ec011c35`。
- 两个资产均为 uploaded，远端摘要与本地一致；正文、正式发布状态和标签提交均已核对。[结构化证据](release-verification.json)保存详细结果。

## 验收与验证边界

验收包提交 `3199674` 到最终包没有功能代码变更。逐文件比较 7,181 个 manifest 条目，7,170 项一致；11 项差异仅为 README、用户文档、安全策略、配置示例说明和 `release.json`。服务端、前端构建、启动器与运行时文件完全一致。

最终构建使用校验过的 Node v24.15.0 归档，`scripts/release/build.mjs` 返回 0。解压后 `scripts/release/verify.mjs` 返回 0，检查 7,182 个文件，manifest 一致且无错误。文档 impact、status 与 check 返回 0；check 保留长度建议警告。

功能回归与用户复现见[条件单验证](../V1.2.7-condition-orders/README.md)及[首配修复验证](../V1.2.7-setup-restart-fix/README.md)。此前全套单测仍有 11 项既有基线失败，本记录不声明全套回归通过。

## 本地与接续

`D:\MySoftWares` 只保留 fix 验收目录。旧 final 包完整移到工程内 `.runs/package-archive-20261004/`；fix 中的 `data` 和 `trainer.config.json` 未覆盖或删除。

工作区统一状态已通过结构化 API 更新至 revision 37，保留旧候选、旧发布事件和验收事实。发布后证据文档可另行提交到 main；标签保持指向实际打包源码，不能把后续证据提交当成包来源。
