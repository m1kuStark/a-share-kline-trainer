# f701371 首次完整 candidate 失败归档

本次来源提交：f70137182ac75635b006d567b34616cc9a9f1bd4；运行：run-42206f8c-3a30-4e98-9c72-822f4ad8382a。这是完整首次失败，不能作为最终通过或人工验收。

原始 wrapper native exit 1，verification.passed=false。共 261 项：229 通过、18 失败、1 显式跳过、13 串行未运行，无 flaky，retries=0。
docs/impact/unit/types/build/snapshot/M2 退出码均为 0，Journey 为 1；cleanBefore/cleanAfter 均为 true。
原始 verification.json 已归档；candidate-proof.json 在采集时不存在。原隔离收据中四个 control SHA 一致，sourceUnchanged/snapshotUnchanged=true，真实 control 文件本轮未读取或修改。

| 文件与行 | 用例 | 原始失败观察 |
| --- | --- | --- |
| journey.spec.ts:141 | Act2a 线段绘制编辑删除 | 默认四窗格断言收到五窗格 |
| kdj-indicator.spec.ts:56 | KDJ subchart mounts by default with the VOL/MACD panes intact | 默认四窗格断言收到五窗格 |
| kdj-indicator.spec.ts:72 | toggling KDJ off/on takes effect immediately and persists across reload | 默认四窗格断言收到五窗格 |
| kdj-indicator.spec.ts:93 | KDJ pane participates in box select, dbl-click maximize and drawing like other panes | 默认四窗格断言收到五窗格 |
| layout-fill.spec.ts:185 | training chart fills the available height at three desktop sizes in both themes | 默认四窗格断言收到五窗格 |
| layout-fill.spec.ts:206 | fill invariants survive MACD toggle, maximize/restore and window resize | 默认四窗格断言收到五窗格 |
| layout-fill.spec.ts:267 | replay page keeps the inline quote and fills the frame without an empty row | 默认四窗格断言收到五窗格 |
| m3-tools.spec.ts:802 | M3 D28 文本线段混选编辑文本颜色内容并刷新恢复 | D28 用例超过 60000ms；完整 locator 错误保留在 results/errors |
| pane-resize.spec.ts:120 | candle/VOL separator owns diagonal left/right drags in default mode | 默认四窗格断言收到五窗格 |
| pane-resize.spec.ts:120 | VOL/MACD separator owns diagonal left/right drags in default mode | 默认四窗格断言收到五窗格 |
| pane-resize.spec.ts:120 | candle/VOL separator owns diagonal left/right drags in multi mode | 默认四窗格断言收到五窗格 |
| pane-resize.spec.ts:120 | VOL/MACD separator owns diagonal left/right drags in multi mode | 默认四窗格断言收到五窗格 |
| pane-resize.spec.ts:138 | Ctrl separator drag preserves selection through the right axis side | 默认四窗格断言收到五窗格 |
| pane-resize.spec.ts:149 | separator drag preserves an active drawing tool and maximized panes remain usable | 默认四窗格断言收到五窗格 |
| percent-hover.spec.ts:220 | replay view computes the card from the replayed series, first bar shows the gray placeholder | 可见窗口内上涨 K 线悬停目标为 null |
| recording-long.spec.ts:26 | 两年前复权训练含交易画线周期切换，可压缩导出并离线回放 | initialBuyFilled 预期 true、实际 false |
| uiux-training.spec.ts:145 | training keeps trading and drawing available together without shifting chart or advance target | 默认四窗格断言收到五窗格 |
| uiux-training.spec.ts:188 | training keeps enlarged text and every drawing entry reachable by local wheel at actual minimum content size | 默认四窗格断言收到五窗格 |

15 项是 Expected 4 / Received 5，覆盖 Journey 1、KDJ 3、layout 3、pane-resize 6、UIUX 2；其余 3 项是独立观察，尚未做因果归并。所有原始 error/error stack 均在 browser-results.json 与18个 error-context 中保留，failure-summary.json 也复制了原始 results。

显式跳过：migration-v127.spec.ts:216，MIG_V127_PACKAGE 未设置，需要本地 v1.2.7 包路径。其余 13 项均为 Journey serial 组中 Act2a 失败后的未运行用例；JSON 的 skipped=14 不能直接解释为14个显式跳过。

归档包括全部18个 error-context、原始 browser-results/verification、run/snapshot manifest、全部顶层非数据库日志与报告、operations.log、原 wrapper log/隔离收据、HTML报告、3张FAILED截图。没有复制SQLite、profile、行情二进制、产品构建或全市场数据。
原件字节、换行、路径与错误全部保留。ZIP成员索引含每个原始源路径、大小和SHA256；独立验证脚本可校验ZIP CRC和逐成员SHA。

执行 python verify-archive.py 可离线复核。此脚本只读取归档，不访问工程、数据库或网络。
