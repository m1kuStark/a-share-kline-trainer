# 架构（Architecture）

> 面向 AI 与维护者的技术架构单页。改架构先改本文件，再改代码。

## 技术栈与版本钉定

| 组件 | 版本 | 说明 |
|---|---|---|
| Node | >=24 | node:sqlite 内置依赖 |
| TypeScript | ^5.9 | 严格模式 |
| Fastify | ^5.6 | API＋@fastify/static 托管 web/dist |
| Vue | ^3.5 | script setup 组合式 |
| Vite | ^7.1 | root=web，outDir=web/dist |
| klinecharts | **10.0.3 钉定** | 升级必须复查 architecture.md 内部 API 登记表 |
| vitest | ^3.2 | server/test 进程内测试 |

## 数据流

```
通达信本地目录（TDX_ROOT，自动发现 D:\MySoftWares\TDX）
  ├─ vipdoc/{sh,sz,bj}/lday/*.day   32 字节小端日线（dayfile.ts 解析）
  └─ T0002/hq_cache/gbbq            29 字节/条 Feistel 加密权息（gbbq.ts 解密）
        ↓ server/src/tdx/*
训练引擎 train/engine.ts：可见历史=先按推进日截断→前复权(基准=推进日, gbbq 因子)→聚合(日/周/月)→ slice(-620)
        ↓ REST API（api.ts，HttpError→全局 setErrorHandler 透传中文 message）
前端 web/src：api.ts(fetch 封装) → views/Training.vue(四区域布局/模式状态/热键)
        → components/KlineChart.vue(klinecharts 实例＋交互模式机＋多选/画线/框选/轴缩放)
画线状态只存前端内存（持久化属后续单元）；B/S 标记与成本线由服务端 trades 推导（chartPrice 图表空间）。
```

## 交互模式机（KlineChart.vue 事件入口守卫链）

所有指针/键盘交互经 `onHostMouseDown`（host capture）与 `onPointerDown`（host capture）进入，守卫顺序即互斥关系：

```
合成事件标记(__klineSynthetic) → 放行（中键平移的内部合成，防自拦截）
Ctrl+左键 → 画线多选 toggle（命中→加入/移出集合；空白→清空），拦截库事件
中键(button=1) → 合成左键 mousedown 交给库原生滚动管线（横向平移＋手动纵轴纵向平移），
                  释放时补发合成左键 mouseup 清理（库 mouseup 只认左键）
左键 + 画线模式(drawTool) → 放行给库 overlay 取点；Space/B/S 热键禁用；右键取消取点
左键 + 命中用户画线(hitTestUserOverlay, 7px/锚点8px) → 放行给库（选中/拖拽/右键菜单）
左键 + 价格轴(isOverPriceAxis) → axisScaleDrag：指针位置重路由为轴区域合成 mousemove，
                                   库原生缩放持续到松手（多选模式同样生效）
左键 + 主图空白 → 多选模式？橡皮筋矩形选画线（不缩放） ： 框选缩放（stopPropagation 防手动轴纵向叠加）
```

配套状态与清理：
- `axisScaleDrag`／`multiDragStart`／`selecting` 三态互斥，均在 window pointerup 收尾。
- 库 mouseup 只认左键：中键释放必须补发合成左键 mouseup，否则残留 `_startScrollCoordinate` 导致自由移动鼠标持续平移。
- 多选模式关闭（watch props.multiSelect）自动清空多选集合与颜色标识。
- `restoreYAxisAutoFit()`：框选缩放/zoomBy/resetView 四条程序化缩放路径前必须调用（手动轴冻结范围）。

## 内部 API 钉定登记表（升级 klinecharts 必须逐项复查）

| 依赖 | 用途 | 位置 |
|---|---|---|
| `_chartStore.getLayoutOptions().barSpaceLimit.max` | 柱宽上限 300（缩放下限 1 根） | KlineChart onMounted |
| `yAxis.setAutoCalcTickFlag(false/true)` | 纵轴手动/自动模式（restoreYAxisAutoFit、中键平移前强制手动） | KlineChart |
| `yAxis.getRange()/setRange()/valueToRealValue()/realValueToDisplayValue()` | 纵轴值域读写（备用） | 已知可用 |
| `_event._handler`（Event 门面） | `_startScrollCoordinate` 等拖拽状态（中键清理备用） | 已知可用 |
| figure 命中 `DEVIATION=2`（line/rect 等 checkEventOn） | 决定库内画线命中容差，与我们 7px 门限的落差由 onHostMouseDownBubble 补齐 | KlineChart |
| overlay figure `createPointFigures` 钩子名 | 写成 createFigures 静默不渲染 | overlays.ts |
| overlay figure attrs.width 可覆盖柱宽 | MACD 柱 2/5 | indicators.ts |
| forward 前插自锚定 | 动态历史加载禁止补偿滚动 | KlineChart loadEarlierBars |
| drawText 强制左上对齐 | B/S 字母偏移手工补偿 | overlays.ts |
| getSize bounding right/bottom 恒 0 | 只能 left+width/top+height | KlineChart isOverPriceAxis |

## 测试钩子

`window.__trainerChart`（仅 `--mode journey` 构建注入，生产构建零钩子）：overlayCount/selectedCount/mode/yRange 只读计数器，供 e2e/journey 状态断言。

## 事件监听器配对清单（onMounted ↔ onUnmounted）

host：wheel / pointerdown(capture) / mousedown(capture) / mousedown(bubble 修补) / dblclick / contextmenu；
window：pointermove / pointerup / keydown(capture 面板) / pointerdown(capture 全局关闭)。
新增监听必须在本清单与 onUnmounted 同步登记。
