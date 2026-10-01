export const KEYBOARD_SHORTCUTS_STORAGE_KEY = 'trainer.keyboardShortcuts.v1'
export const KEYBOARD_SHORTCUTS_CHANGED_EVENT = 'trainer:keyboard-shortcuts-changed'

export const SHORTCUT_ACTIONS = [
  'advance', 'timeframePrev', 'timeframeNext', 'undo', 'redo', 'deleteDrawing',
  'buy', 'sell', 'zoomIn', 'zoomOut', 'crosshairLeft', 'crosshairRight', 'resetView',
] as const
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number]

export const SHORTCUT_ACTION_LABELS: Record<ShortcutAction, string> = {
  advance: '推进下一日',
  timeframePrev: '切换到上一个周期',
  timeframeNext: '切换到下一个周期',
  undo: '撤销画线操作',
  redo: '重做画线操作',
  deleteDrawing: '删除选中画线',
  buy: '买入',
  sell: '卖出',
  zoomIn: '放大 K 线',
  zoomOut: '缩小 K 线',
  crosshairLeft: '十字光标向左',
  crosshairRight: '十字光标向右',
  resetView: '回到最新位置',
}

/** Each action may have two alternate shortcuts; each shortcut is one or two keys held together. */
export type Shortcut = readonly string[]
export type ShortcutBinding = Shortcut[]
export type KeyboardShortcutPreferences = Record<ShortcutAction, ShortcutBinding>

const DEFAULTS: KeyboardShortcutPreferences = {
  advance: [['Space']],
  timeframePrev: [['BracketLeft']],
  timeframeNext: [['BracketRight']],
  undo: [['Control', 'KeyZ']],
  redo: [['Control', 'KeyY']],
  deleteDrawing: [['Delete']],
  buy: [['KeyB']],
  sell: [['KeyS']],
  zoomIn: [['ArrowUp']],
  zoomOut: [['ArrowDown']],
  crosshairLeft: [['ArrowLeft']],
  crosshairRight: [['ArrowRight']],
  resetView: [['Home']],
}

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcutPreferences = clonePreferences(DEFAULTS)

const MODIFIER_ALIASES: Record<string, string> = {
  ControlLeft: 'Control', ControlRight: 'Control', Ctrl: 'Control',
  ShiftLeft: 'Shift', ShiftRight: 'Shift',
  AltLeft: 'Alt', AltRight: 'Alt', Option: 'Alt',
  MetaLeft: 'Meta', MetaRight: 'Meta', Cmd: 'Meta', Command: 'Meta',
}
const MODIFIER_ORDER = ['Control', 'Shift', 'Alt', 'Meta']

export function normalizeShortcutKey(key: string): string {
  return MODIFIER_ALIASES[key] ?? key
}

export function normalizeShortcut(keys: readonly string[]): string[] {
  const unique = [...new Set(keys.map(normalizeShortcutKey).filter(Boolean))]
  return unique.sort((a, b) => {
    const ai = MODIFIER_ORDER.indexOf(a)
    const bi = MODIFIER_ORDER.indexOf(b)
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    return a.localeCompare(b)
  })
}

export function shortcutId(keys: readonly string[]): string {
  return normalizeShortcut(keys).join('+')
}

export function formatShortcut(keys: readonly string[]): string {
  const labels: Record<string, string> = {
    Space: '空格', BracketLeft: '[', BracketRight: ']', Delete: 'Delete',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Win',
  }
  return normalizeShortcut(keys).map(key => labels[key] ?? key.replace(/^Key/, '')).join(' + ')
}

export function clonePreferences(preferences: KeyboardShortcutPreferences): KeyboardShortcutPreferences {
  return Object.fromEntries(SHORTCUT_ACTIONS.map(action => [
    action,
    (preferences[action] ?? []).map(keys => [...keys]),
  ])) as unknown as KeyboardShortcutPreferences
}

function isValidShortcut(value: unknown): value is Shortcut {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2 &&
    value.every(key => typeof key === 'string' && key.length > 0 && key.length <= 40)
}

function normalizeBinding(value: unknown): ShortcutBinding {
  if (!Array.isArray(value)) return []
  const result: ShortcutBinding = []
  const seen = new Set<string>()
  for (const item of value.slice(0, 2)) {
    if (!isValidShortcut(item)) continue
    const keys = normalizeShortcut(item)
    if (keys.length > 2) continue
    const id = keys.join('+')
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(keys)
  }
  return result
}

function normalizePreferences(value: Record<string, unknown> | KeyboardShortcutPreferences): KeyboardShortcutPreferences {
  const result = clonePreferences(DEFAULTS)
  const used = new Set<string>()
  for (const action of SHORTCUT_ACTIONS) {
    const source = Object.prototype.hasOwnProperty.call(value, action) ? value[action] : result[action]
    result[action] = normalizeBinding(source).filter(binding => {
      const id = shortcutId(binding)
      if (!id || used.has(id)) return false
      used.add(id)
      return true
    })
  }
  return result
}

export function validateKeyboardShortcuts(preferences: KeyboardShortcutPreferences): boolean {
  const used = new Set<string>()
  for (const action of SHORTCUT_ACTIONS) {
    const bindings = preferences[action]
    if (!Array.isArray(bindings) || bindings.length > 2) return false
    for (const binding of bindings) {
      if (!isValidShortcut(binding)) return false
      const normalized = normalizeShortcut(binding)
      if (normalized.length < 1 || normalized.length > 2) return false
      const id = normalized.join('+')
      if (used.has(id)) return false
      used.add(id)
    }
  }
  return true
}

export function loadKeyboardShortcuts(storage: Pick<Storage, 'getItem'>): KeyboardShortcutPreferences {
  try {
    const raw = storage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY)
    if (!raw) return clonePreferences(DEFAULTS)
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return clonePreferences(DEFAULTS)
    const input = parsed as Record<string, unknown>
    return normalizePreferences(input)
  } catch { return clonePreferences(DEFAULTS) }
}

export function saveKeyboardShortcuts(storage: Pick<Storage, 'setItem'>, preferences: KeyboardShortcutPreferences): boolean {
  try {
    if (!validateKeyboardShortcuts(preferences)) return false
    storage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, JSON.stringify(clonePreferences(preferences)))
    return true
  } catch { return false }
}

export function shortcutConflict(
  preferences: KeyboardShortcutPreferences,
  action: ShortcutAction,
  candidate: readonly string[],
  ignoreIndex = -1,
): ShortcutAction | null {
  const id = shortcutId(candidate)
  if (!id) return null
  for (const other of SHORTCUT_ACTIONS) {
    const bindings = preferences[other]
    for (let index = 0; index < bindings.length; index++) {
      if (other === action && index === ignoreIndex) continue
      if (shortcutId(bindings[index]) === id) return other
    }
  }
  return null
}

function eventKeyCodes(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>, pressed: ReadonlySet<string>): Set<string> {
  const keys = new Set([...pressed].map(normalizeShortcutKey))
  if (event.code) keys.add(normalizeShortcutKey(event.code))
  if (event.ctrlKey) keys.add('Control')
  if (event.shiftKey) keys.add('Shift')
  if (event.altKey) keys.add('Alt')
  if (event.metaKey) keys.add('Meta')
  return keys
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'repeat' | 'isComposing'>,
  binding: ShortcutBinding,
  pressed: ReadonlySet<string> = new Set(),
): boolean {
  if (event.repeat || event.isComposing) return false
  const current = shortcutId([...eventKeyCodes(event, pressed)])
  return binding.some(shortcut => shortcutId(shortcut) === current)
}

export function matchesActionShortcut(
  action: ShortcutAction,
  event: Parameters<typeof matchesShortcut>[0],
  preferences: KeyboardShortcutPreferences,
  pressed: ReadonlySet<string> = new Set(),
): boolean {
  return matchesShortcut(event, preferences[action] ?? [], pressed)
}

export function notifyKeyboardShortcutsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(KEYBOARD_SHORTCUTS_CHANGED_EVENT))
}
