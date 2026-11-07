// M3 画线工具注册表：工具随交付单元逐个加入（docs/M3-画线工具链-开发计划.md D 单元）。
// name＝klinecharts 内置 overlay 名或自定义注册名；label＝工具条显示名。
// UI-TOOLBAR-01（Issue #8 工具栏布局）：每个工具补 description（hover 中文说明）与 glyph（图形化图标种类），
// 悬浮工具栏由 Topbar「划线」开关打开，图标由 ToolGlyph.vue 按 glyph 绘制，避免 23 个文本按钮纵向滚动。
export interface DrawTool {
  name: string
  label: string
  /** 悬浮/聚焦时显示的一句中文说明（用户拍板「hover 显示中文名称与描述」） */
  description: string
  /** 图形化图标的几何种类（ToolGlyph.vue 渲染，不引入新依赖） */
  glyph: string
}

export const DRAW_TOOLS: DrawTool[] = [
  { name: 'segment', label: '线段', description: '两点之间的直线段，用于标注两个价位/时间点', glyph: 'segment' },
  { name: 'rayLine', label: '射线', description: '从起点单向延伸的射线，常用于趋势方向', glyph: 'ray' },
  { name: 'straightLine', label: '直线', description: '两端无限延伸的直线，用于长期趋势线', glyph: 'line' },
  { name: 'horizontalStraightLine', label: '水平直线', description: '贯穿全图的水平线，标注支撑/压力位', glyph: 'hline' },
  { name: 'horizontalSegment', label: '水平线段', description: '限定区间的水平线段，标注局部平台', glyph: 'hseg' },
  { name: 'horizontalRayLine', label: '水平射线', description: '从起点水平单向延伸，标注后续价位', glyph: 'hray' },
  { name: 'verticalStraightLine', label: '垂直直线', description: '贯穿全图的垂直线，标注关键时间点', glyph: 'vline' },
  { name: 'verticalSegment', label: '垂直线段', description: '限定区间的垂直线段', glyph: 'vseg' },
  { name: 'verticalRayLine', label: '垂直射线', description: '从起点垂直单向延伸', glyph: 'vray' },
  { name: 'parallelStraightLine', label: '平行直线', description: '两条平行直线，标注通道方向', glyph: 'parallel' },
  { name: 'priceChannelLine', label: '价格通道线', description: '两条平行线组成价格通道，标注趋势区间', glyph: 'channel' },
  { name: 'fibonacciLine', label: '斐波那契线', description: '按斐波那契比例分割区间，标注回撤/扩展位', glyph: 'fib' },
  { name: 'polyline', label: '画笔', description: '多点折线，自由勾勒走势结构', glyph: 'polyline' },
  { name: 'priceLine', label: '价位线', description: '固定价位的水平虚线，标注成交/触发价位', glyph: 'hdash' },
  { name: 'rectangle', label: '矩形', description: '矩形区域，标注震荡箱体或密集成交区', glyph: 'rect' },
  { name: 'circle', label: '圆圈', description: '圆形区域，圈出关键形态', glyph: 'circle' },
  { name: 'arc', label: '圆弧', description: '圆弧线，刻画弧形支撑/压力', glyph: 'arc' },
  { name: 'arrowLine', label: '箭头线', description: '带方向的箭头线，标注走势方向', glyph: 'arrow' },
  { name: 'bullArrow', label: '看涨箭头', description: '固定样式的看涨标记箭头', glyph: 'bull' },
  { name: 'bearArrow', label: '看跌箭头', description: '固定样式的看跌标记箭头', glyph: 'bear' },
  { name: 'percentageLine', label: '百分比线', description: '按百分比分割区间，标注涨跌比例位', glyph: 'percent' },
  { name: 'curseLine', label: '诅咒线', description: '自定义趋势线，标注关键压力/支撑轨迹', glyph: 'curse' },
  { name: 'textAnnotation', label: '文本', description: '在图上添加文字注释', glyph: 'text' },
]
