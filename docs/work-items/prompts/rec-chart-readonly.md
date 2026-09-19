极小任务REC-CHART-A，只改web/src/components/KlineChart.vue和server/test/recording-chart-readonly.test.ts。不要做采集/capture/action事件，本轮仅readOnly保护；不git提交、不浏览器。先读局部AGENTS及KlineChart，用rg定位函数，不需要通读所有文档。
1 props新增readOnly?:boolean默认false。
2 restoreDrawings给用户overlay设置lock/ignoreEvent=props.readOnly，仍可显示保存画线。
3 各写入口（deleteSelected/clearDrawings/undoDrawing/redoDrawing/applyEdit/文本确认/绘图启动watch/多选拖动写等）readOnly时直接返回；recordDrawings也return保证不emit drawingsChange；不要禁止普通平移缩放和十字线。
4 readOnly模式禁右键编辑菜单、图形拖动；选中/控件隐藏不足以保证不可编辑。不要改既有事件优先级和默认非readonly行为。恢复图形属于允许的展示，不因readonly拦住restoreDrawings内部清理。
5 只增加必要的契约回归与纯函数可测约束，不写大测试框架。npm test -- server/test/recording-chart-readonly.test.ts server/test/frontend-contract.test.ts，npm run typecheck:web。
完成这些就返回，不继续实现更大录制任务，不改chartCapture.ts/types/其他页面。无需重新设计，按明确列举入口执行。
