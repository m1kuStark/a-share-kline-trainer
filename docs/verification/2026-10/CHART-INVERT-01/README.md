# CHART-INVERT-01 验证记录（2026-10-26 开发轮）

任务：K 线多空反转（视图层镜像开关，chart-invert 矩阵 9 行）。base `66b719e`，工作轮 HEAD 见 commit。

## 门禁表（命令＝字面退出码）

| 门禁 | 命令 | 退出码 | 备注 |
|---|---|---|---|
| RED（server 定向） | `npx vitest run --config server/vitest.config.ts server/test/chart-invert.test.ts` | 1 | 16/16 失败，正确原因：priceMirror.ts ENOENT＋源码契约缺失（实现前） |
| RED（e2e 核心） | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/chart-invert.spec.ts --grep "toggle mirrors" --retries=0` | 1 | 「多空反转」按钮不存在（功能缺失，30s timeout） |
| GREEN（server 定向） | 同 RED server 命令 | 0 | 16/16 通过 |
| GREEN（e2e 全 spec） | `TDX_ROOT='D:\MySoftWares\TDX' npm run journey -- e2e/chart-invert.spec.ts --retries=0` | 0 | 9/9 通过（1.3m，run-eea2a1dd） |
| typecheck | `npm run typecheck:web` | 0 | vue-tsc --noEmit |
| 全量 server 回归 | `node node_modules/vitest/vitest.mjs run --config server/vitest.config.ts`（root 收尾） | 1 | 1786/1787 passed；唯一失败＝train-range-preview「复核一致创建成功…」5320ms 超时——与本卡 diff 零导入关系（纯 web 层），隔离复跑该文件 21/21 exit 0，判负载性 flake（既有范式：换位超时＋定向复跑绿） |
| journey 邻接 | `…journey -- e2e/chart-toggles.spec.ts` / `e2e/drawing-basis.spec.ts` / `e2e/phase-price-line.spec.ts`（root 收尾，三次独立运行） | 0×3 | toggles 3/3＋drawing-basis 2/2＋phase-price-line 3/3，零回归 |
| check-binding | `check-binding.mjs --repo <repo> --matrix chart-invert.yaml --strict --include-untracked` | 3→0 | 回填前 9 planned/exit 3（设计内）；root 回填 9 行 covered＋18 条 test_ids 后 exit 0 全解析 |

## RED 摘要（正确原因失败）

- server：`priceMirror.ts` 模块不存在（ENOENT）导致纯函数层 8 用例全失败；源码契约 8 用例因 KlineChart 无镜像集成失败——均为功能缺失，非语法/环境错。
- e2e：`getByRole('button', { name: '多空反转' })` 等待超时（开关不存在）。

## 变异击杀（executed）

| 变异 | 注入点 | 杀手用例 | 结果 |
|---|---|---|---|
| A：喂入漏镜像 | `chartFeedData()` 去掉 mirrorBars（直接 return loadedData） | `server/test/chart-invert.test.ts::喂入层镜像：镜像只发生在 chart 数据装载前的最后一跳` | exit 1（该用例死；e2e `toggle mirrors all bars...` 为真数据面杀手，纸面推演同样死亡：bars() 断言 2P₀−p） |
| B：capture 误读镜像序列 | `captureState()` 改回 chart.getDataList() | `server/test/chart-invert.test.ts::capture 隔离：captureState 以组件真实序列 loadedData 为唯一源（镜像喂入零渗入）` | exit 1（该用例死；e2e `capture payload keeps real prices while mirrored` 为真数据面杀手，纸面推演同样死亡：capture bars ≠ 真实 API bars） |

还原方式：针对性反转 Edit patch（未用 `git checkout --` 整文件）；还原后 server 定向复跑 exit 0。

## 实现层调整披露

1. **任务卡手算样例勘误**：`{o:9,h:10.5,l:12,c:9.5}` 的 `l:12` 与冻结规则矛盾（l′ 应=2P₀−high=8，且 l:12>h:10.5 为非法 K 线）；按规则与 K 线不变式取 `l:8`，测试 oracle 与实现一致。**needs_user_confirm（低风险勘误，数学自洽）**。
2. `captureState`/`scheduleViewportOperation` 的数据源从 `chart.getDataList()` 改为 `loadedData`（两者 index/时间戳同构——setDataLoader 全量喂入＋forward 前插同构维护；update 类型未实现）。
3. `buildHoverModel` 数据源同上改 `loadedData`（镜像态信息卡显真实价，拍板条款）。
4. `configurePhasePriceRange` 的阶段价并入改经 `displayValue()`（镜像态纵轴范围不被真实价拉错位）。
5. e2e 轴刻度断言从「刻度文本镜像对应」改为「y 轴 range 端点镜像对应（容差 120）」：600519 一年数据值域恰好关于 P₀ 自对称（minR+maxR≈2P₀），刻度文本无法区分镜像与否；range 端点断言为可行最强（nice 取整对端点扩张 ≤2 interval）。喂入层镜像值断言（bars 探针逐根 2P₀−p）已由 toggle 用例强锁定。
6. journey 探针新增（只读，不影响生产行为）：`capture()`、`indicatorResult(name)`、`yAxisTicks()`、`yAxisRange()`。
7. 画线编辑面板「端点价位」输入框在镜像态显示镜像域值（与图上锚点一致；回存反镜像为真实价，持久面不受影响）——**needs_user_decision**（呈现歧义，见 proposed_default 清单）。

## proposed_default 清单（待用户验收确认，先按默认实现）

1. P₀ 冻结粒度＝组件生命周期内一旦解析永不重算（关-补历史-开不重算；「本会话首次启用」取最保守读法）。
2. VOL 副图不镜像（成交量非价格派生）；VOL 指标 result 中的 bar OHLC 载荷随序列镜像（绘图只消费量域字段，无视觉影响）。
3. 开关位置：训练页周期按钮行近旁（.indicator-toggles 之后）＋回放页周期按钮近旁；样式与副图开关同族（开启＝橙色高亮，区别于副图开关青色系）。
4. 水印样式：图表中部（top 22%）倾斜 -12°，主标 26px 半透明琥珀＋副标「坐标为镜像值 · 多头分析之镜，非做空信号」；pointer-events:none。
5. 开关状态不持久化（每会话从关开始）。
6. 指标副图（MACD/KDJ）随镜像同步重算，无独立开关。
7. 悬浮信息卡/订单面板/B-S 悬浮详情/挂单悬浮文本显真实值；阶段价线轴标签文本显真实价（锚定位置镜像）——「交易决策信息不撒谎」读法。
8. 切换开关＝重喂全序列，视窗按数据装载语义回到默认（与数据推进/周期切换现状一致，不做视窗保持）。
9. 编辑面板端点价位在镜像态显示镜像域值（见披露 7）。

## 留用户验收项（本轮不可自动验证通道）

- 读屏器对开关 aria-pressed 与水印 aria-hidden 的实际播报。
- 真机 Electron 暗色主题下的水印观感（半透明琥珀在黑底上的对比度）。
- 镜像态下画线编辑面板显示镜像值的可用性取舍（proposed_default 9）。

## root 收尾记录（2026-10-26，worker 限额中断后续做）

- **中断形态**：开发 worker 在全量回归/邻接 journey/check-binding/report/commit 之前被账户 5 小时限额中断（实现、RED、GREEN、双变异、typecheck、新 spec e2e 已完成并落盘本文件）。
- **root 续做**（supervised-delivery「root 同纪律执行」条款）：定向复跑 chart-invert＋recording-chart-capture 24/24 exit 0；typecheck exit 0；journey 新 spec 独立复跑 9/9 exit 0（run-bc3339c4）＋三邻接 8/8 exit 0；全量回归 1786/1787（1 flake 隔离复跑 21/21 绿）；矩阵 9 行回填 covered（18 条 test_ids，字节级核对用例名）；check-binding --strict --include-untracked exit 0；feat commit。
- **越界处置（root 扩卡）**：`server/test/recording-chart-capture.test.ts` 不在原 allowed_paths——它是 capture/feed 函数的源码形状契约（正则锁实现形态），实现变更必须同步契约且方向为收紧（新增 `not.toMatch(/chart\.getDataList\(\)/)` 禁止 capture 读库内数据列表）。root 判定合法并扩卡入册（依据＝该文件是 INVERT-CAPTURE-ISOLATION 行为的契约属主）。
- **root 自呈失误**：终验首轮漏带 `--include-untracked` 致 18 条 ref 全悬空（假 RED），且 tail -3 截断问题清单险些误判为 3 条转录失真；字节级复核后带旗标重跑 exit 0。「新测试文件必须带旗标」为既有条款，属执行违反非条款缺失。
- **UI/UX 自审缺口**：worker 未及产出 UI/UX 自审映射表；root 以代码级核对补位——开关 aria-pressed/键盘可达、水印 pointer-events:none＋aria-hidden、复用既有 token 与副图开关同族样式已核实，读屏器/暗色观感列入留用户验收项。

## 验收反馈整改（2026-10-28，用户验收后 root 直修）

用户验收结论：**基本通过**＋三项整改（原话要点）：①水印多余——「保持和非多空反转的正常模式下一样的主图背景」②按钮激活色应与 KDJ 按钮一致③按钮间距排列规范整齐。

处置（bug-loop：先 RED 后修）：

| 步骤 | 收据 |
|---|---|
| 矩阵 SUPERSEDED | INVERT-WATERMARK-HIGHLIGHT 行 EARS 重写（零水印＋indicator-toggle 同族高亮）；INVERT-AXIS-MIRROR-VALUE 行说明载体改 title |
| RED | 新 oracle 契约用例对旧码 exit 1（水印仍在＝正确原因）；连带同步两处旧断言（两页接线类名断言、回放用例水印可见断言） |
| GREEN | 定向 24/24 exit 0（chart-invert＋recording-chart-capture）；typecheck:web exit 0 |
| journey | e2e/chart-invert.spec.ts 9/9 exit 0（含新用例 no chart watermark…styles matches subchart toggle family：镜像态零水印＋与 KDJ 激活态计算样式逐项相等＋位于 indicator-toggles 组内） |
| check-binding | --strict exit 0（SUPERSEDED 后 9 行全解析） |
| 击杀证明 | RED 轮即击杀收据（旧码含水印时新用例死）；恢复水印＝复现 RED |

改动面：KlineChart.vue（删水印模板＋CSS）、Training.vue（按钮并入副图开关组，复用 indicator-toggle/off 语义，删独立橙色样式）、SessionReplay.vue（同款类复用，删独立样式）、display.md/interaction.md（防混淆口径更新）、两测试文件（oracle 同步）。旧行为（橙色高亮/水印/独立间距）全部移除，无残留样式。
