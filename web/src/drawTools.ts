// M3 画线工具注册表：工具随交付单元逐个加入（docs/M3-画线工具链-开发计划.md D 单元）。
// name＝klinecharts 内置 overlay 名或自定义注册名；label＝工具条显示名。
export interface DrawTool {
  name: string
  label: string
}

export const DRAW_TOOLS: DrawTool[] = [
  { name: 'segment', label: '线段' },
]
