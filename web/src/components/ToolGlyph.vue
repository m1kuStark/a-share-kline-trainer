<script setup lang="ts">
// UI-TOOLBAR-01：画线工具的图形化图标（纯 SVG 内联，不引入新依赖）。
// 按 drawTools.glyph 几何种类绘制 24×24 版本；颜色继承 currentColor，随深浅主题/选中态变化。
import type { DrawTool } from '../drawTools'

defineProps<{ tool: DrawTool }>()
</script>

<template>
  <svg class="tool-glyph" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <template v-if="tool.glyph === 'segment'"><line x1="4" y1="18" x2="20" y2="6" /><circle cx="4" cy="18" r="1.4" fill="currentColor" /><circle cx="20" cy="6" r="1.4" fill="currentColor" /></template>
    <template v-else-if="tool.glyph === 'ray'"><line x1="4" y1="18" x2="20" y2="6" /><circle cx="4" cy="18" r="1.4" fill="currentColor" /><path d="M20 6l-3 1.4M20 6l-1.4 3" /></template>
    <template v-else-if="tool.glyph === 'line'"><line x1="2" y1="19" x2="22" y2="5" /></template>
    <template v-else-if="tool.glyph === 'hline'"><line x1="2" y1="12" x2="22" y2="12" /></template>
    <template v-else-if="tool.glyph === 'hseg'"><line x1="6" y1="12" x2="18" y2="12" /><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></template>
    <template v-else-if="tool.glyph === 'hray'"><line x1="6" y1="12" x2="20" y2="12" /><circle cx="6" cy="12" r="1.2" fill="currentColor" /><path d="M20 12l-3 1.4M20 12l-3-1.4" /></template>
    <template v-else-if="tool.glyph === 'vline'"><line x1="12" y1="2" x2="12" y2="22" /></template>
    <template v-else-if="tool.glyph === 'vseg'"><line x1="12" y1="6" x2="12" y2="18" /><circle cx="12" cy="6" r="1.2" fill="currentColor" /><circle cx="12" cy="18" r="1.2" fill="currentColor" /></template>
    <template v-else-if="tool.glyph === 'vray'"><line x1="12" y1="6" x2="12" y2="20" /><circle cx="12" cy="6" r="1.2" fill="currentColor" /><path d="M12 20l-1.4-3M12 20l1.4-3" /></template>
    <template v-else-if="tool.glyph === 'parallel'"><line x1="2" y1="15" x2="22" y2="9" /><line x1="2" y1="20" x2="22" y2="14" /></template>
    <template v-else-if="tool.glyph === 'channel'"><line x1="2" y1="7" x2="22" y2="13" /><line x1="2" y1="17" x2="22" y2="7" /></template>
    <template v-else-if="tool.glyph === 'fib'"><line x1="3" y1="5" x2="21" y2="5" /><line x1="3" y1="10" x2="21" y2="10" stroke-dasharray="2 2" /><line x1="3" y1="15" x2="21" y2="15" stroke-dasharray="2 2" /><line x1="3" y1="20" x2="21" y2="20" /></template>
    <template v-else-if="tool.glyph === 'polyline'"><polyline points="3,18 8,10 13,14 21,5" /></template>
    <template v-else-if="tool.glyph === 'hdash'"><line x1="2" y1="12" x2="22" y2="12" stroke-dasharray="4 3" /></template>
    <template v-else-if="tool.glyph === 'rect'"><rect x="4" y="7" width="16" height="11" rx="1" /></template>
    <template v-else-if="tool.glyph === 'circle'"><circle cx="12" cy="12" r="7" /></template>
    <template v-else-if="tool.glyph === 'arc'"><path d="M4 18 Q12 2 20 18" /></template>
    <template v-else-if="tool.glyph === 'arrow'"><line x1="4" y1="20" x2="19" y2="6" /><path d="M19 6l-4 1.2M19 6l-1.2 4" /></template>
    <template v-else-if="tool.glyph === 'bull'"><path d="M5 16L12 7l7 9" /><path d="M12 7v11" /><path d="M5 16l1.5-4M12 20l-1.5-4M19 16l-1.5-4" /></template>
    <template v-else-if="tool.glyph === 'bear'"><path d="M5 8l7 9 7-9" /><path d="M12 18V7" /><path d="M5 8l1.5 4M12 4l-1.5 4M19 8l-1.5 4" /></template>
    <template v-else-if="tool.glyph === 'percent'"><line x1="4" y1="20" x2="20" y2="4" /><circle cx="7" cy="7" r="2" /><circle cx="17" cy="17" r="2" /></template>
    <template v-else-if="tool.glyph === 'curse'"><path d="M3 17C8 8 14 21 21 8" /></template>
    <template v-else-if="tool.glyph === 'text'"><path d="M5 6h14M12 6v13M9 19h6" /></template>
    <template v-else><line x1="4" y1="20" x2="20" y2="4" /></template>
  </svg>
</template>
