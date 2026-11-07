import { describe, expect, it } from 'vitest'
import { DRAW_TOOLS } from '../../web/src/drawTools'

// UI-TOOLBAR-01（Issue #8 工具栏布局）：图形化悬浮工具面板的注册表契约。
// 23 个工具必须有唯一 name/label、非空中文描述与几何 glyph；hover 描述不能重复成通用占位。
describe('UI-TOOLBAR-01 画线工具注册表（描述与图形）', () => {
  it('23 个工具齐全：唯一 name/label、非空 description/glyph', () => {
    expect(DRAW_TOOLS).toHaveLength(23)
    expect(new Set(DRAW_TOOLS.map(tool => tool.name)).size).toBe(23)
    expect(new Set(DRAW_TOOLS.map(tool => tool.label)).size).toBe(23)
    for (const tool of DRAW_TOOLS) {
      expect(tool.name.length, tool.name).toBeGreaterThan(0)
      expect(tool.label.length, tool.name).toBeGreaterThan(0)
      expect(tool.description.length, tool.name).toBeGreaterThan(5)
      expect(tool.glyph.length, tool.name).toBeGreaterThan(0)
    }
  })

  it('工具描述各不相同（hover 展示的是具体用途而非通用文案）', () => {
    const descriptions = DRAW_TOOLS.map(tool => tool.description)
    expect(new Set(descriptions).size).toBe(descriptions.length)
    // 关键工具的用途描述可被用户直接理解
    expect(DRAW_TOOLS.find(tool => tool.name === 'segment')?.description).toContain('两点之间')
    expect(DRAW_TOOLS.find(tool => tool.name === 'textAnnotation')?.description).toContain('文字')
  })
})
