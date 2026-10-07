import { ref } from 'vue'

export interface MaLine { period: number; color: string }
export interface MaSettings { version: 1; lines: MaLine[] }
export const MA_MAX_PERIOD = 1000
/** Preserve the old 200-bar warmup unless an enabled MA needs more history. */
export function maWarmup(settings: MaSettings): number {
  return Math.max(200, ...settings.lines.map(line => Math.max(0, line.period - 1)))
}
export const MA_STORAGE_KEY = 'trainer_ma_settings'
const COLORS = ['#f5a623', '#54b8cc', '#c793e0', '#64c978', '#ed718e', '#7797ef', '#d5bd69', '#9ca3af']
export const MA_PRESETS = [
  { label: '默认 25/60/144', periods: [25, 60, 144] },
  { label: '常用 5/10/20/60', periods: [5, 10, 20, 60] },
  { label: '中长 20/60/120/250', periods: [20, 60, 120, 250] },
] as const

export function maPreset(periods: readonly number[] = MA_PRESETS[0].periods): MaSettings {
  return { version: 1, lines: COLORS.map((color, index) => ({ period: periods[index] ?? 0, color })) }
}

/** Same validation for editor drafts and persisted preferences; never coerce blank input to zero. */
export function maValidationError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '均线配置格式无效'
  const settings = value as Partial<MaSettings>
  if (settings.version !== 1 || !Array.isArray(settings.lines) || settings.lines.length !== 8) return '均线配置需要八条参数'
  const periods = new Set<number>()
  for (let i = 0; i < settings.lines.length; i++) {
    const line = settings.lines[i]
    if (!line || !Number.isInteger(line.period) || line.period < 0 || line.period > MA_MAX_PERIOD) return `第 ${i + 1} 条周期须为 0～${MA_MAX_PERIOD} 的整数`
    if (line.period > 0 && periods.has(line.period)) return `第 ${i + 1} 条周期 ${line.period} 重复`
    if (typeof line.color !== 'string' || !/^#[\da-f]{6}$/i.test(line.color)) return `第 ${i + 1} 条颜色无效`
    if (line.period > 0) periods.add(line.period)
  }
  return null
}

export function readMaSettings(storage: Pick<Storage, 'getItem'>): MaSettings {
  try {
    const raw = storage.getItem(MA_STORAGE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    if (maValidationError(value) === null) return value as MaSettings
  } catch { /* Unavailable storage or corrupt preferences retain the existing defaults. */ }
  return maPreset()
}

export const appMaSettings = ref(readMaSettings({ getItem: key => localStorage.getItem(key) }))

/** Publish only after persistence succeeds, so the dialog can report an actionable failure. */
export function saveMaSettings(settings: MaSettings): void {
  const error = maValidationError(settings)
  if (error) throw new Error(error)
  const copy: MaSettings = { version: 1, lines: settings.lines.map(line => ({ ...line })) }
  localStorage.setItem(MA_STORAGE_KEY, JSON.stringify(copy))
  appMaSettings.value = copy
}
