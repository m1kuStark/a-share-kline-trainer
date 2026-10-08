# 真实用户旅程

从仓库根运行 `npm run journey -- --retries=0`。运行器创建独立run、复制固定真实样本、分别构建并启动专属服务，Playwright按该manifest连接；结束后关闭自有服务，证据保留在 `.runs/run-*/artifacts/`。不覆盖生产dist或docs历史截图。

`npx playwright test --list` 可仅列清单；直接执行测试会拒绝缺失运行manifest，不回退固定8791。使用 `npm run journey -- e2e/pane-resize.spec.ts --retries=0`定向运行。

| 套件 | 覆盖 |
|---|---|
| [ma-settings](ma-settings.spec.ts) | 八条MA参数、草稿/取消/校验、颜色和持久化、周期共用、1000周期预热、视窗画线保留及双主题尺寸 |
| [acceptance-feedback](acceptance-feedback.spec.ts) | 录像入口、活动训练往返、快捷键与顶部空间 |
| [drawing-basis](drawing-basis.spec.ts) | 除权推进/轴缩放/撤销刷新时画线锚点对齐 |
| [recording](recording.spec.ts) | 默认录制、交易拒单、周期/绘图、暂停刷新、导出与只读回放 |
| [recording-long](recording-long.spec.ts) | v2 gzip、两年真实推进/交易/画线/周期/刷新、离线回放与体积/耗时 |
| [recording-migration](recording-migration.spec.ts) | v1存储保留及迁移、损坏导入、旧JSON、复制标签页独立录制 |
| [journey](journey.spec.ts) | 创建、交易、画线、手势、多选、周期、主题 |
| [m3-tools](m3-tools.spec.ts) | 23工具、保存恢复、跨窗格、故障注入 |
| [m3-feedback](m3-feedback.spec.ts) | 收藏拖拽、自定义隔离、保存栏布局 |
| [m3-round3](m3-round3.spec.ts) | 840根、周期快捷键、纯黑、成交带、诅咒线 |
| [compact-chart](compact-chart.spec.ts) | 紧凑布局、实际日期、刷新与回到最新 |
| [cost-basis](cost-basis.spec.ts) | 权息成本、清仓后GET失败、周期恢复 |
| [pane-resize](pane-resize.spec.ts) | 原生分隔条所有权、对角拖动、组合模式 |
| [data-update](data-update.spec.ts) | 更新入口、建议弹窗双路径、失败/409状态 |
| [order-panel](order-panel.spec.ts) | 统一下单面板标签页、多条件单挂单/撤单、悬停信息主题一致、开盘阶段唯一价位线 |
| [phase-price-line](phase-price-line.spec.ts) | 开盘/收盘一致虚线与唯一价格轴标签、实际日线前收配色、跳空价格范围 |
| [data-update-feedback](data-update-feedback.spec.ts) | 训练页休市误报隔离、扫描未变时完成与下一步提示、失败/409可见反馈 |
| [rankings-navigation](rankings-navigation.spec.ts) | 训练周期下固定周期/自定义区间子列表、五档切换、迟到请求隔离 |

同run保持单worker与单活动训练；每例清理活动训练，不依赖前例选中状态。不同run的数据库、端口、构建和报告独立，允许不同工作副本并行。证据路径统一由[runtime helper](runtime.ts)提供；新测试不得硬编码端口或写docs截图目录。

冻结样本有日期及文件哈希；复制不等于历史全版本保护，DATA-03仍是业务待办。测试快照不提交私人源数据；正式报告可提交指纹和必要截图。来源缺失报错，不自动安装数据源或下载。

真实鼠标/键盘与只读hooks纪律见[断言](docs/assertions.md)、[AGENTS](AGENTS.md)。主代理视觉检查后将选定证据归档，不能只凭浏览器命令通过替代人工阅读截图或用户验收。
