# Shift两点快捷测量验证

2026-11-01，基础提交`0ab10657c8e2e49fa6a5fd55a831f49a8f8d2cd9`，分支`feat/chart-analysis`。此前PR #7的功能已提交；本记录只针对其后的未提交工作树，不代表已更新PR、安装包、公开发布或用户验收。

代码/测试/依赖配置指纹见[source-fingerprints](source-fingerprints.json)，冻结行情文件哈希见[data-snapshot](data-snapshot.json)，完整命令、结果与失败尝试见[result](result.json)。

## 范围与口径

仅增加Shift+左键拖动的临时两点测量，五项为涨跌幅、起点价、终点价、价差、含首尾K线数量。按鼠标价位与图表两位价格精度计算，先取的点为涨幅基准；反向不按日期重排，同根纵向测量为1根。浮层和引导线不进入画线、撤销、训练或录像持久层，不新增行情请求或后端接口。

沿已有pointerdown/move/up/cancel、keydown、blur、可视范围订阅与ResizeObserver处理，未新增全局监听器。绘图取点、多选、Ctrl/Alt/Meta组合、轴区及分隔保留优先权；普通模式下显式Shift可从已完成画线上起测而不移动图形。Esc/再次点击/失焦/视窗、尺寸、数据变化取消，松Shift不转交拖动归属。

Windows、Node v24.21.0、npm 11.19.0、系统Edge、klinecharts 10.0.3。TDX只读，使用相同冻结三标的六文件样本，截止2026-09-16；每个Journey使用独立SQLite、端口与构建，M2用内存SQLite。TEMP/TMP为`D:/Ktrain-build-cache/temp`，npm缓存为`D:/Ktrain-build-cache/npm`，未修改全局配置或个人训练库。

## 功能与界面结果

定向计算、现有前端契约与只读契约回归46项通过，退出0；生产构建通过，保留原有大chunk提示。首次定向命令有一个旧文件名过滤器未命中，仅运行了两个文件的41项，已用正确过滤器复跑并保留两份记录。

最终功能Journey `run-fab8a96e-8b56-4ef6-88f5-cf8b39a82870` 7项通过、退出0、pageerror为空。覆盖正反向与同根测量、五字段、Shift提前松开、Esc/点击/失焦/滚轮/尺寸/周期取消、越界钳制、绘图/多选/轴优先、视窗画线保持、无额外请求、只读回放与随机日期遮蔽。主代理检查深浅两主题、1440×900与1280×720全部四种组合的真实截图：浮层紧凑、五字段可读、无溢出或错误覆盖层；首次正向红色测量也已检查。保存[深色预览](measurement-dark.png)、[浅色预览](measurement-light.png)。

## 门禁与范围限制

完整Journey `run-60852c46-0adc-42af-b5eb-d979448b034b` 退出1：三个录像相关用例失败后按max-failures=3停止，204项未运行。此前在未改动`81cef4b`上已复现这三项相同失败；本次按用户要求不扩展修改录像模块，不把未执行项视为通过。基线证据见[前一任务对照](../../2026-10/CHART-ANALYSIS-01/baseline-comparison.json)。完整门禁未通过。

完整单测首次1753通过/7失败，退出1。其中两条图表录制契约把回调正文完全写死，新增展示清理语句导致匹配失败；现调整为保留原刷新/捕获调用及顺序，并明确禁止展示清理上报用户导航。修正后五个相关文件69项通过，退出0；产品代码不变，没有修改录制逻辑或放宽超时。余下5个更新器失败保留：其中2个已有基线复现，另3个所在apply/swap文件在未改动81cef4b和当前代码分别独立复跑均16项通过，退出0，精确原因未确定，不改更新器。不能将局部复跑合成为完整单测全绿。桌面367项通过，M2内存SQLite闭环24项通过，退出均0。最终docs:impact为0错误/0警告、退出0；docs:check为1错误/128警告、docs:status -- --check为1错误，错误均为此前已在基线复现的状态摘要生成区过期。生成器带出的其他任务行恢复基线，只保留本任务新增行；未扩展修改其他任务。git diff --check退出0，九文件指纹核对一致。

## 首次失败与复跑

- `run-c7151e15-e0d8-4e2e-a642-08c3c4d55bbb`：未改生产代码时测量浮层不存在，得到预期RED。
- `run-1fff3d67-feae-43dd-9a32-1d77c637bf83`：测试把投影前的K线高低价当作像素反投影价。10.0.3的YAxis.convertToPixel会取整到整数像素，二者存在像素精度误差。改为使用现有只读yRange及pane高度独立核对实际选取像素的价位；生产代码未变。
- `run-690fc69b-1409-4dbf-825b-0812e8647d85`：价格、双向、同根测量用例通过；兼容与取消用例在最后的切页失焦断言失败。Playwright默认把每页都视作聚焦，切页没有产生真实blur。独立空页面诊断确认两页同时hasFocus=true；关闭浏览器焦点模拟后，切换页签得到true/false、false/true。测试先配置浏览器环境，再切真实页签并断言document.hasFocus状态及应用取消结果，没有派发伪造事件或操作产品内部状态；生产代码未变。

测试环境依据：[Playwright Pages](https://playwright.dev/docs/pages)、[Chrome DevTools焦点模拟](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled)。原始日志、失败截图与trace保留在各run的artifacts中。

## 同一PR交付授权

验证完成后，用户明确要求将两点测量amend到原功能提交，通过[PR #7](https://github.com/m1kuStark/a-share-kline-trainer/pull/7)一起评审。0ab1065保留为本任务实际开发与验证起点；重写后的合并候选以81cef4b为父提交。本页及result.json中未提交/未推送等描述是验证当时的历史状态，最终交付以PR当前头提交为准；不代表合并、发布或用户验收。
