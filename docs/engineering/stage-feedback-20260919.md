# 阶段验收返修合同（2026-09-19）

来源：用户浏览器批注及画线偏移截图。尚未验收通过，本批只返修M3/REC，M4/M5继续等待。

## 用户确认的行为

1. 主图画线跟随前复权基准，除息/送转后与同一历史K线对齐；纯轴缩放不改变价格。锚点不能按屏幕像素或价格比猜测。保存、刷新、撤销重做、周期切换一致，VOL/MACD不套主图价格公式。
2. 状态栏简短显示快捷键。录制开关、状态和唯一gzip导出移到顶部，保护主图和账户空间；移除更多和JSON导出。
3. 结束/放弃确认默认勾选“保留到本机训练历史”。用户已确认取消只丢弃本轮录像，不删除成绩或画线。保存失败可重试；自然到期也有保存选择。
4. 首页和侧栏明确提供“训练录像”，可查看本机历史、导入分享文件。活动训练期间进出录像能回原训练，不隐式结束。
5. 用户列表/计数只突出完成的买卖、图形/文字变更，一次操作计一次，拒单标注。推进构成交易日轴；暂停/恢复/中断保留元数据/缺口但不算交易操作。工具选择/主题/图表加载/保存不新增业务事件。旧文件兼容，不篡改既有历史。
6. 回放以交易日为单位倒退、前进，空格下一日，按用户设定秒数自动播放。日/周/月、缩放、Home与播放独立，不写成交、不编辑图形。推进不反复重建图表打断观察，周月只聚合当时已见日线，不能借未来检查点还原历史。

## 固定并行接口

DRAW-02：`DrawingPriceBasis={scale:number,offset:number}` 表示已发生权息累计仿射变换P*scale+offset；无事件或raw为1/0。`TrainingBarsPayload.drawingPriceBasis`与bars同次返回，不含未来权息，不暴露盲训日期。Drawing可选`priceBasis`；旧到新变换为`(value-old.offset)/old.scale*new.scale+new.offset`，不四舍五入。主图各锚点统一转换，旧无基准画线保留原值并采用首个可靠载入基准，不猜创建日期。KlineChart新增可选`drawingPriceBasis` prop；readOnly录制快照不按当前行情二次复权。Training由集成人接线，worker不写Training。

REC-02：存储实现新增`remove(id):Promise<void>`，compact接口可选以兼容旧自定义storage，但生产实现/内存实现必须支持。删除目标会话新旧数据，不能删其他会话。useRecording公开`finishSession(keep:boolean):Promise<void>`和`businessEventCount`；阻止新捕获，等待在途持久化后保留或删除，防止unmount flush复活。可选`canonicalChart?:()=>ChartCapture|null`由Training提供同期1D行情和当前显示画线，没有时兼容原capture。新录制不再记录view/theme/tool/load/save业务事件；保留推进、交易、图形和必要生命周期元事件，计数排除cancel/no-op/元数据。

REC-03：SessionReplay只消费文件。新录制检查点提供1D基础数据，按日建立稀疏索引，只解码当天最后安全检查点。旧文件缺日线/暂停缺日则明确缺失，不从未来补齐；可用周期如实提示。前端聚合不得引入node依赖。倒退/前进/空格每次一个已录交易日；间隔可选0.2～10秒。展示本日最终状态和业务动作详情，系统事件不进业务列表。日期/周期/播放独立，缩放保留，末日停止。worker只写SessionReplay、新dailyReplay模块及专属测试，不改KlineChart或useRecording。

## 调度与验收

三个GLM独立worktree，最高思考档、配置1M，每项Prompt/日志/看板单独登记。集成人负责Training、App、CSS、接口适配和最终验收；共享文件不并写。先审查，再串行合入ACCEPT-01。新候选完整单测、类型/构建、M2、Journey；主代理检查深浅主题及1071×728等用户布局。7529验收库和浏览器录像保留，不自动猜测修复旧线。
