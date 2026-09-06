# A股 K线训练器

本地 A 股逐日盲走训练工具。数据只读来自通达信本地日线与权息文件，工程按 [开发计划](./docs/开发计划.md) 的 M1 → M5 顺序推进。

## 环境

- Windows 11
- Node.js 24+
- 通达信本地数据目录，默认自动发现 `D:\MySoftWares\TDX`

## 开发启动

```powershell
npm install
npm run dev
```

浏览器访问 `http://127.0.0.1:5173`，API 位于 `http://127.0.0.1:8787`。

## 生产启动

```powershell
npm run build
npm start
```

`npm start` 会在 `http://127.0.0.1:8787` 托管前端和 API，并自动打开浏览器。设置 `OPEN_BROWSER=0` 可禁止自动打开。

如未自动发现通达信，可在启动前设置：

```powershell
$env:TDX_ROOT = 'D:\MySoftWares\TDX'
```

## 验证

> 自动化用户旅程（六幕 13 测试，真实 Edge 事件）：`npm run journey`（内部先 build:journey）。提验前必须 npm test / build / journey 全绿。

```powershell
npm test
npm run build
npm run verify:m1
npm run verify:m2
```

`verify:m1` 会运行测试与生产构建，并基于本机只读 TDX 数据验证股票目录、SQLite 增量缓存、`gbbq` 解密、前复权数值往返、沪深300读取及周/月聚合边界；同时读取工程内保存的通达信原生导出，对贵州茅台前复权日线做全量核验，对周/月线做最近完成周期与形成中周期核验。生成文件：

- [M1 自动验证报告](./docs/verification/M1-verification-report.md)
- [通达信原生导出抽样明细](./docs/verification/M1-tdx-manual-comparison.csv)
- [通达信原生导出证据](./docs/verification/tdx-export/)
- [工作台浏览器实测截图](./docs/verification/M1-workbench-screenshot.png)（开发侧验证：真实 600519 日线＋MA25/60/144＋VOL 副图渲染正确）

`verify:m2` 会运行测试与生产构建，然后基于真实 TDX 数据走一遍完整训练流程（创建→买入→T+1 拒绝→逐日推进并手算权益→卖出→持有到期自动结算→防未来断言），生成 [M2 端到端报告](./docs/verification/M2-e2e-report.md)；浏览器全流程证据在 [docs/verification/m2/](./docs/verification/m2/)。

## 行情与训练 API

```text
GET  /api/stocks?q=贵州茅台
GET  /api/kline/600519?from=2025-01-01&to=2026-09-02&tf=1D      # 训练进行中返回 409（防未来）
GET  /api/kline/600519?adjust=raw
GET  /api/kline/sh000300?tf=1W
POST /api/trainings            {tier, code, start_date, initial_cash?, blind?, adjust_mode?}
GET  /api/trainings/active
GET  /api/trainings/:id/bars?tf=1D|1W|1M
POST /api/trainings/:id/next
POST /api/trainings/:id/trade  {side:'buy'|'sell', weightPct?|shares?}
POST /api/trainings/:id/settle # 提前结算
POST /api/trainings/:id/abandon
```

- 个股六位代码自动推断市场；基准指数使用 `sh000300` 这类显式市场前缀。
- `adjust=forward` 为默认前复权；`adjust=raw` 返回不复权。
- 周/月 K 线严格先复权、后聚合；最新未结束的周/月作为形成中 K 线返回。
- 训练 K 线由服务端按推进日截断发放（最多 620 根＝420 可见＋200 均线暖机），任何情况下不含推进日之后的数据。
- SQLite 缓存只写训练器自己的数据库，通达信目录始终只读。

当前状态：M0/M1/M2 已获用户验收（M1 的全量对照补强项保持可选）；M3 两次开发、两次按用户要求整体撤销。**2026-09-06 按用户 M2 二次验收反馈修正基线**：①文本标注与画线持久化彻底移除（口径拍板：文本/画线属于 M3，M2 基线不含；前端面板/overlay 与服务端 PUT/GET drawings、drawings 表全栈删除）；②框选图层化——仅主图背景左键拖动触发，副图/坐标轴不触发；③框选双向语义——右滑放大选中区间、左滑按距离比例缩小；④方向键 ↑ 放大、↓ 缩小；⑤训练页一屏排版（默认主图+双副图+交易面板全可见，无需滚动）。**2026-09-06 预检第二轮再修三处**：⑥框选选中框与缩放范围钳制在图表宿主内（指针拖入训练控制台也不越界，overflow:hidden 兜底）；⑦**页面四区域定义**固化为口径修订七——菜单栏（左）/信息栏（上）/训练主界面（中部主副图）/训练控制台（右），硬性规则：主图一切操作（框选、缩放、绘图等）及其视觉元素不得越出训练主界面；⑧最新价线配色改国内红涨绿跌平灰（相对前收）——真因＝klinecharts v10 线体方向色读 priceMark.last.upColor 系（默认国际绿涨红跌）而 line.color 是死键，读源码定位后在主题显式覆盖。**同日预检第三轮**：⑨双盲遮蔽移出 V1（手动选股下隐藏名称无意义——创建表单移除"双盲模式"开关，新建训练一律明示代码/名称/日期；服务端遮蔽机制保留为休眠基建；存量盲训按创建时设置显示）；⑩V2 候选新增**随机股票＋随机时间真盲测模式**（随机抽股＋设定时间范围＋训练中隐藏日期，当前不开发）；⑪MACD 红绿柱体宽度改为库默认的 **2/5**（bar 图元 attrs.width，蜡烛与 VOL 不变）。**同日预检第四轮**：⑫训练标题精简为"名称 · 代码"，训练时长移入小字（"时长 1年"，删除"1Y档"档位表述）；⑬**价格轴滚轮与图面滚轮分离**——轴上滚轮只缩放纵轴比例（不平移）、轴上按下不触发框选，主图区滚轮仍为 K 线平移（坑：klinecharts getSize 的 bounding 仅 left/top/width/height 可靠，right/bottom 恒 0）；⑭主图图例只留开高低收＋均线（去 training·1天 标题行、时间行、成交量行）。**同日预检第五轮**：⑮修复框选缩放后图表纵向漂移——价格轴拖动/滚轮使 klinecharts 进入手动纵轴模式（范围冻结），框选/键盘/复位缩放前现统一恢复纵轴自动适配（restoreYAxisAutoFit），实测连续缩放零漂移。**同日预检第六轮（缩放体系整改）**：⑯可见根数下限 10→**1**（修复 klinecharts barSpaceLimit.max=50px 静默吞掉 setBarSpace 导致的"少根框选退化为平移"，柱宽上限提至 300）；⑰**420 语义修正为同屏最大可见根数（缩放下限），不再是加载总量**——初始载 620 根（420 可见＋200 暖机），视窗移到窗口之前时**动态加载更早历史**（新增 `GET /api/trainings/:id/bars?before=&count=` 分批接口；前端 klinecharts 原生 forward 无限滚动，实测可连续加载至个股数据起点 2008 年）；调试中修复两个二次 bug（库 forward 前插自锚定、勿加补偿滚动；toK 须保留 date 否则 before 丢失致重复加载）。提示条改"缩放 1~420"。全量自动测试 15 文件 **83/83** 通过，构建通过，`verify:m2` **24/24** 通过；浏览器实测通过，截图 [docs/verification/m2/](./docs/verification/m2/)。**M2 二次验收通过（2026-09-06），Git 冻结 M2 基线**。M3 准备中（画线工具链；双盲已移 V2 随机盲测模式）。M4/M5 未开始。
