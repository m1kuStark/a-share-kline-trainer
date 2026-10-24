# 执行记录与验证边界

## 成绩单断言与变异

`e2e/report-narrow.spec.ts` 使用本局训练 ID，真实买入后测量 dialog.scrollWidth/clientWidth，锁定七列表头、ArrowRight 后 scrollLeft 增加、鼠标滚至费用列、关闭按钮可达和 pageerror 为空。预期来自用户修复要求和已有无溢出断言。

首次旧实现 RED：clientWidth 368、scrollWidth 391，run `9d39ed3a-afaa-4de9-bfb4-563acab21a7c`，属于实际执行。最终定向 GREEN：run `4f6514fc-5536-45f8-a29b-8ee335923532`，2 passed，native exit 0，覆盖深浅主题 × 390/1024/1440。

删除任一成交列将触发表头数组断言，此项为 `paper_only`。首次 GREEN 准备失败来自滚到表格底部后仍要求顶部关闭按钮在视口，补真实滚动准备后通过；没有删除或放宽产品断言。

主代理直接查看了最终全量 run 的[390 深色末列](report-narrow-dark-390-trades.png)、[390 浅色末列](report-narrow-light-390-trades.png)，费用列、焦点框与对话框边界可见；并复核实际 Electron 桌面成绩单和旧录像回放截图。[视觉收据](visual-review.json)列明判断与限制。

## 保留的失败与处理

- 单测曾发生 Windows Node 原生退出 `-1073740791`、单 worker 无结果等待、子进程取消清理超时；未改断言。全新依赖轮 1749/1750，唯一失败是 taskkill 未在预算内确认取消结束；随后默认 worker 完整单测 server 1750 + desktop 357 通过，native exit 0。仅据复跑无法确定原生崩溃根因。
- 打包阶段 rename EPERM 两次；验证并解压同版本缓存 Electron ZIP，以临时构建配置 `electronDist` 指向目录。产品配置未改，[运行时身份](electron-runtime.json)。全新 `npm ci`、生产构建与 `release:desktop --publish never` 最终 exit 0。
- 验收启动脚本初版 Hidden 隐藏窗口，改 Normal 后真实可见；此时程序本体未改。[第一次准备失败](launcher-hidden-red.json)、[修正验证](launcher-smoke.json)。
- 旧历史脚本最初误用 `/api/settings`，修正为 `/api/env`；旧 UI 冷启动准备预算不足；Electron APIRequestContext 无 baseURL，改显式地址。原始日志保留，未当作产品 RED。
- “保存并退出”停止服务并显示退出页，关闭 Electron 窗口才结束进程；两步分别验证。ASAR 检查使用 Windows 路径，89 项运行资产完整匹配；类型声明和 sourcemap 不属运行资产。
- 最终 ZIP 第一次冒烟脚本在窗口可见后立即检查 `Local State`，早于 Chromium 落盘而失败；实际文件随后出现在隔离目录。保留失败并正常关闭该进程，改等待该文件（30 秒预算），用全新解压目录重跑通过，app exit 0。[最终收据](zip-launcher-smoke.json)。

## 包身份

版本号沿用 1.3.0；实际身份以候选编号、源码指纹与 ZIP SHA256 为准。staged 构建基于 `81558ad` 的工作树，187 项生产输入与后续本地提交 `8d08a5a` 完全一致。随后只改 E2E/验收脚本/文档，运行资产无漂移。

ZIP SHA256：`54ec4f78273de6a1a9ae0d748e876052be2486728c01f051aee4cf8d7f32d85e`；99 个条目、逐条 CRC 和 SHA256 通过，无联接点、无验证数据库/profile。[ZIP 收据](delivery-zip.json)。

浏览器、桌面包、安装器和用户验收分别记录；没有安装器实测，不声称覆盖升级通过。当前通达信原生 M1 和全市场源数据未核验。
