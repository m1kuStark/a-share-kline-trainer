import { DRAW_TOOLS } from './drawTools'

export const FAVORITE_TOOLS_STORAGE_KEY = 'trainer.favoriteTools.v1'
export const TOOL_PREFERENCES_STORAGE_KEY = 'trainer.toolPreferences.v1'
export const DEFAULT_FAVORITE_TOOLS = [
  'segment', 'rayLine', 'straightLine', 'horizontalStraightLine',
  'verticalStraightLine', 'priceLine', 'percentageLine',
]

const knownTools = new Set(DRAW_TOOLS.map(tool => tool.name))

export interface ToolStylePreference {
  color: string
  size: number
  style: 'solid' | 'dashed' | 'dotted'
  textColor: string
  textSize: number
}

export type ToolStylePreferences = Record<string, ToolStylePreference>
export const DEFAULT_TOOL_STYLE: ToolStylePreference = { color: '#f5c343', size: 1, style: 'dashed', textColor: '#f5c343', textSize: 14 }

export function loadToolStylePreferences(storage: Pick<Storage, 'getItem'>): ToolStylePreferences {
  try {
    const raw = storage.getItem(TOOL_PREFERENCES_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: ToolStylePreferences = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!knownTools.has(name) || !value || typeof value !== 'object' || Array.isArray(value)) continue
      const item = value as Record<string, unknown>
      const color = typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : DEFAULT_TOOL_STYLE.color
      const textColor = typeof item.textColor === 'string' && /^#[0-9a-f]{6}$/i.test(item.textColor) ? item.textColor : color
      const size = typeof item.size === 'number' && Number.isFinite(item.size) ? Math.min(5, Math.max(1, Math.round(item.size))) : DEFAULT_TOOL_STYLE.size
      const textSize = typeof item.textSize === 'number' && Number.isFinite(item.textSize) ? Math.min(36, Math.max(10, Math.round(item.textSize))) : DEFAULT_TOOL_STYLE.textSize
      const style = item.style === 'solid' || item.style === 'dotted' || item.style === 'dashed' ? item.style : DEFAULT_TOOL_STYLE.style
      result[name] = { color, size, style, textColor, textSize }
    }
    return result
  } catch { return {} }
}

export function saveToolStylePreferences(storage: Pick<Storage, 'setItem'>, preferences: ToolStylePreferences): boolean {
  try { storage.setItem(TOOL_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences)); return true } catch { return false }
}

export function reconcileFavoriteTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_FAVORITE_TOOLS]
  const names = [...new Set(value.filter((name): name is string => typeof name === 'string' && knownTools.has(name)))]
  return value.length > 0 && names.length === 0 ? [...DEFAULT_FAVORITE_TOOLS] : names
}

export function moveFavoriteTool(favorites: readonly string[], name: string, index: number | null): string[] {
  if (!knownTools.has(name)) return [...favorites]
  const remaining = favorites.filter(tool => tool !== name)
  if (index !== null) {
    const position = Number.isFinite(index) ? Math.max(0, Math.min(remaining.length, Math.trunc(index))) : remaining.length
    remaining.splice(position, 0, name)
  }
  return remaining
}

export function loadFavoriteTools(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw = storage.getItem(FAVORITE_TOOLS_STORAGE_KEY)
    return raw === null ? [...DEFAULT_FAVORITE_TOOLS] : reconcileFavoriteTools(JSON.parse(raw))
  } catch {
    return [...DEFAULT_FAVORITE_TOOLS]
  }
}

export function saveFavoriteTools(storage: Pick<Storage, 'setItem'>, favorites: readonly string[]): boolean {
  try {
    storage.setItem(FAVORITE_TOOLS_STORAGE_KEY, JSON.stringify(favorites))
    return true
  } catch {
    return false
  }
}
